import { createHash } from "node:crypto";
import type { FundingConfig } from "../../src/x402/config.ts";
import type { PaymentPort, PresentedPayment, Settlement, Verification } from "../../src/x402/funding.ts";
import { BASE_SEPOLIA, SOLANA_DEVNET, TESTNET_USDC, type Testnet } from "../../src/x402/ids.ts";
import { RefillRefusedError, type FundingLedger, type RoomFundingState } from "../../src/x402/ledger.ts";
import { StoredConflictError, type ReceiptStore } from "../../src/x402/store.ts";

export const REF = "ref_lighthouse_aaaaaaaaaaaaa";
export const OTHER_REF = "ref_paper_moon_bbbbbbbbbbbbbb";
export const STEWARD = "95000000-0000-4000-8000-000000000001";
export const PAY_TO = {
  [SOLANA_DEVNET]: "3tNxPn7wMHxDrs3PekPVkodFLjXHmnZx9cX7tLkhEQFD",
  [BASE_SEPOLIA]: "0x4A6DE1347E9b2E466e5EAe6ba18dd63d7080BfdE",
};

export const fundingConfig = (maxTopUps = 2): FundingConfig => ({
  facilitatorUrl: "https://x402.org/facilitator",
  payTo: PAY_TO,
  rooms: {
    [REF]: { roomId: "lighthouse", stewardProfileId: STEWARD, maxTopUps },
    [OTHER_REF]: { roomId: "paper-moon", stewardProfileId: STEWARD, maxTopUps },
  },
});

/** In-memory write-once store with failure injection. */
export function memoryStore() {
  const objects = new Map<string, Buffer>();
  const failCreate: RegExp[] = [];
  const store: ReceiptStore = {
    async read(path) { return objects.get(path) ?? null; },
    async create(path, bytes) {
      if (failCreate.some((pattern) => pattern.test(path))) throw new Error("storage unavailable");
      const existing = objects.get(path);
      if (existing) {
        if (!existing.equals(bytes)) throw new StoredConflictError(path);
        return "existing";
      }
      objects.set(path, Buffer.from(bytes));
      return "created";
    },
    async list(prefix) {
      const base = prefix.replace(/\/?$/, "/");
      return [...objects.keys()].filter((key) => key.startsWith(base) && !key.slice(base.length).includes("/"))
        .map((key) => key.slice(base.length));
    },
  };
  const json = (path: string) => { const bytes = objects.get(path); return bytes ? JSON.parse(bytes.toString()) : null; };
  const paths = (prefix: string) => [...objects.keys()].filter((key) => key.startsWith(prefix));
  return { store, objects, failCreate, json, paths };
}

/** Mirrors pilot_refill_room: five credits, idempotent on request ID, bound to room and actor. */
export function memoryLedger() {
  const rooms: Record<string, RoomFundingState> = {
    lighthouse: { open: true, deliveryLimit: 0, stewardExists: true },
    "paper-moon": { open: true, deliveryLimit: 4, stewardExists: true },
  };
  const refills = new Map<string, { roomId: string; actor: string }>();
  const calls: string[] = [];
  let failRefill: Error | null = null;
  const ledger: FundingLedger = {
    async state(roomId) {
      calls.push(`state:${roomId}`);
      return rooms[roomId] ?? { open: false, deliveryLimit: null, stewardExists: true };
    },
    async refill(requestId, roomId, actor) {
      calls.push(`refill:${requestId}`);
      if (failRefill) throw failRefill;
      const prior = refills.get(requestId);
      if (prior) {
        if (prior.roomId !== roomId || prior.actor !== actor)
          throw new RefillRefusedError("This refill belongs to another room or guest");
        return { added: 5, replayed: true, credits: { limit: rooms[roomId].deliveryLimit } };
      }
      refills.set(requestId, { roomId, actor });
      rooms[roomId].deliveryLimit = (rooms[roomId].deliveryLimit ?? 0) + 5;
      return { added: 5, replayed: false, credits: { limit: rooms[roomId].deliveryLimit } };
    },
  };
  return {
    ledger, rooms, refills, calls,
    failNextRefills(error: Error | null) { failRefill = error; },
  };
}

/** A test payment presented as JSON in the PAYMENT-SIGNATURE header. */
export type TestPayment = { network: Testnet; payer?: string; nonce?: string; memo?: string; tag?: string; resource?: string };
export const paymentHeader = (payment: TestPayment) => Buffer.from(JSON.stringify(payment)).toString("base64");

export function fakePayments() {
  const calls: string[] = [];
  let verification: Verification | Error = { valid: true, payer: "" };
  let settlement: Settlement | ((payment: PresentedPayment) => Settlement) = (payment) => ({
    kind: "settled",
    transaction: payment.network === BASE_SEPOLIA
      ? `0x${createHash("sha256").update(payment.payloadDigest).digest("hex").toUpperCase()}`
      : `sig${createHash("sha256").update(payment.payloadDigest).digest("hex")}`,
    response: { success: true, network: payment.network },
    header: `settled:${payment.payloadDigest.slice(0, 8)}`,
  });
  let offers = 0;
  // Like a clock past validBefore: the same header (and digest) presents as stale.
  let stale: string | null = null;
  const port: PaymentPort = {
    async offer(_resource, error) {
      calls.push(`offer${error ? `:${error}` : ""}`);
      offers += 1;
      return { header: `offer-${offers}`, body: { x402Version: 2, error } };
    },
    async present(header, resource) {
      calls.push("present");
      let payment: TestPayment;
      try { payment = JSON.parse(Buffer.from(header, "base64").toString()); } catch { return { invalid: "undecodable" }; }
      if (payment.resource && payment.resource !== resource.url) return { invalid: "wrong resource" };
      const network = payment.network;
      const key = network === SOLANA_DEVNET
        ? { network, memo: payment.memo ?? "a".repeat(32) }
        : { network, payer: (payment.payer ?? "0x309a90aA8453E78f1B5878B46E5B65342dF7Fe83").toLowerCase(), nonce: payment.nonce ?? `0x${"1".repeat(64)}` };
      return {
        network, key,
        payer: payment.payer ?? "payer",
        payTo: PAY_TO[network], asset: TESTNET_USDC[network], amount: "1000000",
        payloadDigest: createHash("sha256").update(header).digest("hex"),
        payload: payment, requirement: { network }, validUntil: null,
        ...(stale ? { stale } : {}),
      };
    },
    async verify(payment) {
      calls.push("verify");
      if (verification instanceof Error) throw verification;
      return verification.valid ? { valid: true, payer: payment.payer } : verification;
    },
    async settle(payment) {
      calls.push("settle");
      return typeof settlement === "function" ? settlement(payment) : settlement;
    },
  };
  return {
    port, calls,
    setVerification(value: Verification | Error) { verification = value; },
    setSettlement(value: Settlement | ((payment: PresentedPayment) => Settlement)) { settlement = value; },
    setStale(reason: string | null) { stale = reason; },
  };
}

export const fundingRequest = (ref = REF, payment?: TestPayment, init: RequestInit = {}) =>
  new Request(`http://127.0.0.1:3005/api/x402/fund/${ref}`, {
    method: "POST",
    ...init,
    headers: {
      host: "127.0.0.1:3005",
      ...(payment ? { "payment-signature": paymentHeader(payment) } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
