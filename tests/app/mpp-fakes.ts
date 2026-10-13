import { createHash, createHmac, randomBytes } from "node:crypto";
import type { AdapterError, Eip1193Request, MppAdapter, MppChallenge, MppCredential } from "../../src/mpp/adapter.ts";
import { MPP_MEMO_TAG, TRANSFER_WITH_MEMO_TOPIC, type ChainReader, type ChainVerdict, type TempoRpc } from "../../src/mpp/chain.ts";
import type { MppDoorConfig, MppRoom } from "../../src/mpp/config.ts";
import type { ChargePort, ChargeSettlement, ChargeVerification, PresentedCharge } from "../../src/mpp/funding.ts";
import { MPP_REALM, PATHUSD, TEMPO_MODERATO } from "../../src/mpp/ids.ts";
import type { MppIntent } from "../../src/mpp/records.ts";
import { OTHER_REF, REF, STEWARD } from "./x402-fakes.ts";

export { OTHER_REF, REF, STEWARD };

/**
 * Everyone runs these tests: any request that would leave this machine (Moderato, the faucet, Supabase)
 * fails the run. Loopback stays open for the in-process door the payer tests talk to.
 */
export function blockNetwork() {
  const real = globalThis.fetch;
  globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    return url.hostname === "127.0.0.1" ? real(input, init) : Promise.reject(new Error(`offline test: blocked ${url.host}`));
  };
}
export const PAY_TO = "0x845212503625C1B2759d3315d1f7F53dc8446bD4";
export const PAYER = "0x691356eadc2e88c01da7e6b29a8fc9d08b92bbfb";
export const CHALLENGE_KEY = Buffer.alloc(32, 9).toString("base64url");

export const doorConfig = (maxTopUps = 2): MppDoorConfig => ({
  network: TEMPO_MODERATO,
  recipient: PAY_TO,
  currency: PATHUSD,
  rooms: { lighthouse: { maxTopUps }, "paper-moon": { maxTopUps } },
});
export const doorRooms = (maxTopUps = 2): Record<string, MppRoom> => ({
  [REF]: { roomId: "lighthouse", stewardProfileId: STEWARD, maxTopUps },
  [OTHER_REF]: { roomId: "paper-moon", stewardProfileId: STEWARD, maxTopUps },
});

/** A test credential: JSON in the Authorization header after the Payment scheme. */
export type TestCharge = { challenge?: string; tag?: string; payer?: string; room?: string; stale?: string };
export const chargeHeader = (charge: TestCharge) => `Payment ${Buffer.from(JSON.stringify(charge)).toString("base64url")}`;
const hashOf = (value: string) => `0x${createHash("sha256").update(value).digest("hex")}`;

/** A scripted ChargePort: the challenge names the intent, the tag varies the signed payload. */
export function fakeCharges() {
  const calls: string[] = [];
  let verification: ChargeVerification | Error = { valid: true };
  let settlement: ChargeSettlement | ((charge: PresentedCharge) => ChargeSettlement) = (charge) => ({
    kind: "settled",
    transaction: charge.transaction.toUpperCase().replace(/^0X/, "0x"),
    receipt: { method: "tempo", status: "success", reference: charge.transaction },
    receiptHeader: `receipt:${charge.transaction.slice(2, 10)}`,
  });
  let stale: string | null = null;
  let offers = 0;
  const port: ChargePort = {
    // Not recorded in calls: it decodes only, with no check and no network, before any other step.
    identify(authorization) {
      let charge: TestCharge;
      try { charge = JSON.parse(Buffer.from(authorization.replace(/^Payment /, ""), "base64url").toString()); } catch { return null; }
      if (!charge || typeof charge !== "object") return null;
      const challengeId = charge.challenge ?? "challenge-a";
      return { challengeId, payloadDigest: createHash("sha256").update(`${challengeId}|${charge.tag ?? ""}`).digest("hex") };
    },
    async offer(room, error) {
      calls.push(`offer${error ? `:${error}` : ""}`);
      offers += 1;
      return { header: `Payment id="challenge-${offers}", realm="${MPP_REALM}", method="tempo", intent="charge"`, body: { status: 402, room: room.roomId, error } };
    },
    async present(authorization, room) {
      calls.push("present");
      let charge: TestCharge;
      try { charge = JSON.parse(Buffer.from(authorization.replace(/^Payment /, ""), "base64url").toString()); } catch { return { invalid: "undecodable" }; }
      if (charge.room && charge.room !== room.roomId) return { invalid: "This payment was made for a different funding link." };
      const challengeId = charge.challenge ?? "challenge-a";
      const signed = `${challengeId}|${charge.tag ?? ""}`;
      return {
        challengeId,
        challengeExpires: "2026-10-12T12:05:00.000Z",
        realm: MPP_REALM,
        roomTag: "0123456789abcdef",
        payer: (charge.payer ?? PAYER).toLowerCase(),
        payTo: PAY_TO,
        currency: PATHUSD,
        amount: "1000000",
        transaction: hashOf(signed),
        validBefore: 1_791_806_425,
        payloadDigest: createHash("sha256").update(signed).digest("hex"),
        signedTransaction: `0x76${Buffer.from(signed).toString("hex")}`,
        credential: charge,
        ...(stale ? { stale } : {}),
      };
    },
    async verify() {
      calls.push("verify");
      if (verification instanceof Error) throw verification;
      return verification;
    },
    async settle(charge) {
      calls.push("settle");
      return typeof settlement === "function" ? settlement(charge) : settlement;
    },
  };
  return {
    port, calls,
    setVerification(value: ChargeVerification | Error) { verification = value; },
    setSettlement(value: ChargeSettlement | ((charge: PresentedCharge) => ChargeSettlement)) { settlement = value; },
    setStale(reason: string | null) { stale = reason; },
  };
}

/** A scripted chain reader for the door's resume path and the reconciler. */
export function fakeChain(initial: ChainVerdict | Error = { status: "pending", reason: "not on chain yet" }) {
  const inspected: string[] = [];
  let verdict: ChainVerdict | Error | ((intent: MppIntent) => ChainVerdict) = initial;
  const reader: ChainReader = {
    async inspect(intent) {
      inspected.push(intent.intentId);
      if (verdict instanceof Error) throw verdict;
      return typeof verdict === "function" ? verdict(intent) : verdict;
    },
  };
  return { reader, inspected, set(value: ChainVerdict | Error | ((intent: MppIntent) => ChainVerdict)) { verdict = value; } };
}

export const mppRequest = (ref = REF, charge?: TestCharge, init: RequestInit = {}) =>
  new Request(`http://127.0.0.1:3005/api/mpp/fund/${ref}`, {
    method: "POST",
    ...init,
    headers: {
      host: "127.0.0.1:3005",
      ...(charge ? { authorization: chargeHeader(charge) } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
  });

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
/** A stand-in for keccak256 in the fakes (SHA3-256, not Keccak): the fake signer, chain and reader agree on it. */
export const fakeKeccak = (value: string) => `0x${createHash("sha3-256").update(value, "utf8").digest("hex")}`;
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const decode = (value: string) => JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
const pad32 = (hex: string) => hex.replace(/^0x/, "").toLowerCase().padStart(64, "0");

type FakeTx = { type: string; from: string; chainId: number; validBefore: number | null; sponsored?: boolean; calls: { to: string; data: string }[]; nonce: string };
/** The fake "signed transaction" is the hex of its JSON; its hash is SHA-256 of those bytes. */
export const fakeSigned = (tx: FakeTx) => `0x${Buffer.from(JSON.stringify(tx)).toString("hex")}`;
const fakeHash = (signed: string) => `0x${sha256(signed.toLowerCase())}`;

/** transferWithMemo(recipient, amount, memo) calldata, as mppx's client builds it. */
export const transferWithMemoData = (recipient: string, atomic: bigint | string, memo: string) =>
  `0x95777d59${pad32(recipient)}${pad32(BigInt(atomic).toString(16))}${memo.replace(/^0x/, "").toLowerCase()}`;

/** A credential for a challenge whose fake signed transaction makes exactly these calls, as a non-stock payer could sign. */
export function customCredential(challenge: MppChallenge, from: string, calls: { to: string; data: string }[], validBefore: number) {
  const sender = from.toLowerCase();
  const signature = fakeSigned({ type: "tempo", from: sender, chainId: 42431, validBefore, calls, nonce: randomBytes(8).toString("hex") });
  return { signature, credential: `Payment ${encode({ challenge, payload: { type: "transaction", signature }, source: `did:pkh:eip155:42431:${sender}` })}` };
}

/**
 * A deterministic stand-in for the isolated adapter (no mppx, no viem): HMAC-bound challenges, JSON
 * credentials, transferWithMemo calls with the MPP memo layout, and a broadcast that goes through the
 * caller's EIP-1193 request function exactly as the real adapter's does. `script` overrides outcomes.
 */
export function fakeAdapter(options: { now?: () => number } = {}) {
  const now = options.now ?? Date.now;
  const used = new Set<string>();
  const script: { validate: { ok: true } | { ok: false; error: AdapterError } | null; beforeSend: AdapterError | null } = { validate: null, beforeSend: null };
  const memoFor = (realm: string, challengeId: string) =>
    `0x${MPP_MEMO_TAG}01${fakeKeccak(realm).slice(2, 22)}${"0".repeat(20)}${fakeKeccak(challengeId).slice(2, 16)}`;
  const fields = (challenge: Omit<MppChallenge, "id">) =>
    JSON.stringify([challenge.realm, challenge.method, challenge.intent, challenge.request, challenge.expires, challenge.opaque]);
  const adapter: MppAdapter = {
    adapterVersion: 1,
    versions: { mppx: "0.13.4", viem: "2.57.3" },
    chainId: 42431,
    rpcUrl: "https://rpc.moderato.tempo.xyz",
    createChargeServer({ secretKey, realm, currency, recipient, chainId, request }) {
      const sign = (challenge: Omit<MppChallenge, "id">) => createHmac("sha256", secretKey).update(fields(challenge)).digest("base64url");
      const validate = async (credential: MppCredential, route: { meta: Record<string, string> }) => {
        if (script.validate) return script.validate;
        const { id, ...rest } = credential.challenge;
        if (id !== sign(rest)) return { ok: false as const, error: { kind: "payment" as const, name: "InvalidChallengeError", message: "Challenge is invalid." } };
        if (decode(String(rest.opaque)).r !== route.meta.r)
          return { ok: false as const, error: { kind: "payment" as const, name: "InvalidChallengeError", message: "credential opaque does not match this route's requirements." } };
        if (Date.parse(String(rest.expires)) <= now())
          return { ok: false as const, error: { kind: "expired" as const, name: "PaymentExpiredError", message: `Payment expired at ${rest.expires}.` } };
        try {
          await request?.({ method: "eth_call", params: [] });
        } catch (error) {
          const message = (error as Error).message;
          return { ok: false as const, error: { kind: /revert/i.test(message) ? "revert" as const : "other" as const, name: "CallExecutionError", message } };
        }
        return { ok: true as const };
      };
      return {
        async challenge({ amount, meta, expires }) {
          const rest = {
            realm, method: "tempo", intent: "charge",
            request: { amount: (BigInt(amount) * 1_000_000n).toString(), currency, methodDetails: { chainId, supportedModes: ["pull"] }, recipient },
            expires: expires ?? new Date(now() + 300_000).toISOString(),
            opaque: encode({ _mppx_nonce: `0x${randomBytes(32).toString("hex")}`, ...meta }),
          };
          const challenge = { id: sign(rest), ...rest };
          return { header: `Payment ${encode(challenge)}`, id: challenge.id, expires: challenge.expires };
        },
        verifyChallenge(challenge) {
          const { id, ...rest } = challenge;
          return id === sign(rest);
        },
        validate,
        async broadcast(credential, route) {
          const validation = await validate(credential, route);
          if (!validation.ok) return { ok: false, error: validation.error, attempted: false, sentHash: null };
          if (script.beforeSend) return { ok: false, error: script.beforeSend, attempted: false, sentHash: null };
          const signature = String((credential.payload as { signature?: unknown }).signature);
          const hash = fakeHash(signature);
          if (used.has(hash))
            return { ok: false, error: { kind: "payment", name: "VerificationFailedError", message: "Payment verification failed: Transaction hash has already been used." }, attempted: false, sentHash: null };
          used.add(hash);
          try {
            const receipt = await request!({ method: "eth_sendRawTransactionSync", params: [signature] }) as { status: string; transactionHash: string };
            if (receipt.status !== "0x1")
              return { ok: false, error: { kind: "other", name: "Error", message: `Transaction reverted: ${hash}` }, attempted: true, sentHash: hash };
            const paid = { method: "tempo", status: "success", timestamp: new Date(now()).toISOString(), reference: receipt.transactionHash, fundingCurrency: currency };
            return { ok: true, reference: receipt.transactionHash, status: "success", receipt: paid, receiptHeader: encode(paid), attempted: true, sentHash: hash };
          } catch (error) {
            return { ok: false, error: { kind: "other", name: (error as Error).name, message: (error as Error).message }, attempted: true, sentHash: hash };
          }
        },
      };
    },
    async decodeTransaction(signed) {
      const tx = JSON.parse(Buffer.from(signed.slice(2), "hex").toString("utf8")) as FakeTx;
      return { type: tx.type, from: tx.from, chainId: tx.chainId, validBefore: tx.validBefore, sponsored: !!tx.sponsored, calls: tx.calls, hash: fakeHash(signed) };
    },
    readCredential(authorization) {
      const match = /(?:^|,\s*)Payment\s+(\S+)/.exec(authorization);
      return match ? decode(match[1]) as MppCredential : null;
    },
    parseChallengeHeader(header) {
      const match = /^Payment\s+(\S+)$/.exec(header.trim());
      if (!match) throw new Error("No Payment challenge.");
      return decode(match[1]) as MppChallenge;
    },
    readReceiptHeader(header) {
      try { return header ? decode(header) : null; } catch { return null; }
    },
    keccakUtf8: fakeKeccak,
    generatePrivateKey: () => `0x${randomBytes(32).toString("hex")}`,
    addressOf(privateKey) {
      if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new Error("not a valid secp256k1 private key");
      return `0x${sha256(`address|${privateKey.toLowerCase()}`).slice(0, 40)}`;
    },
    accountFromKey(privateKey) {
      return Object.freeze({ address: adapter.addressOf(privateKey) });
    },
    async faucet({ address, request }) {
      const result = await request!({ method: "tempo_fundAddress", params: [address] });
      return (Array.isArray(result) ? result : [result]).filter((hash): hash is string => typeof hash === "string" && /^0x[0-9a-fA-F]{64}$/.test(hash));
    },
    async createPayment({ account, challenge, expectedRecipient, request }) {
      await request?.({ method: "eth_estimateGas", params: [] });
      const recipient = String(challenge.request.recipient);
      if (recipient.toLowerCase() !== expectedRecipient.toLowerCase()) throw new Error(`Unexpected primary recipient: ${recipient}`);
      const validBefore = Math.min(Math.floor(now() / 1000) + 25, Math.floor(Date.parse(String(challenge.expires)) / 1000));
      const amount = BigInt(String(challenge.request.amount)).toString(16);
      const data = `0x95777d59${pad32(recipient)}${pad32(amount)}${memoFor(challenge.realm, challenge.id).slice(2)}`;
      const from = account.address.toLowerCase();
      const signature = fakeSigned({ type: "tempo", from, chainId: 42431, validBefore, calls: [{ to: String(challenge.request.currency), data }], nonce: randomBytes(8).toString("hex") });
      const credential = `Payment ${encode({ challenge, payload: { type: "transaction", signature }, source: `did:pkh:eip155:42431:${from}` })}`;
      return { credential, transaction: fakeHash(signature), validBefore, payer: account.address };
    },
  };
  return { adapter, script, used, memoFor };
}

type FakeLog = { address: string; topics: string[]; data: string; transactionHash: string; blockNumber: string; logIndex: string };
type FakeReceipt = { status: string; blockNumber: string; transactionHash: string; logs: FakeLog[] } & Record<string, unknown>;
const hex = (value: bigint | number) => `0x${value.toString(16)}`;

/**
 * An offline Tempo Moderato for the fake or the real adapter: enough JSON-RPC for the mppx client to sign,
 * for mppx to validate and broadcast, and for the chain reader to find receipts and memo logs. A landed
 * transferWithMemo call emits TransferWithMemo(from, to, amount, memo). Blocks are 0.5 s apart.
 */
export function fakeModerato(adapter: Pick<MppAdapter, "decodeTransaction">, options: { clock?: () => number } = {}) {
  const clock = options.clock ?? Date.now;
  const calls: string[] = [];
  const receipts = new Map<string, FakeReceipt>();
  const logs: FakeLog[] = [];
  const sentRaw: string[] = [];
  let headNumber = 5_000_000n;
  let headLag = 0n;
  let simulation: Error | null = null;
  let broadcast: "land" | "land-then-timeout" | "reject" | "revert" = "land";
  let hideReceipts = false;
  let missReceipts = 0;
  let lagLogs = 0;
  const headTimestamp = () => Math.floor(clock() / 1000);
  const timestampOf = (number: bigint) => headTimestamp() - Math.ceil(Number(headNumber - number) / 2);

  async function land(raw: string, status: "0x1" | "0x0") {
    const tx = await adapter.decodeTransaction(raw);
    const transactionHash = tx.hash.toLowerCase();
    headNumber += 1n;
    const blockNumber = hex(headNumber);
    const entries: FakeLog[] = [];
    if (status === "0x1") for (const [index, call] of tx.calls.entries()) {
      const data = call.data.toLowerCase();
      if (!data.startsWith("0x95777d59")) continue;
      entries.push({
        address: String(call.to),
        topics: [TRANSFER_WITH_MEMO_TOPIC, `0x${pad32(String(tx.from))}`, `0x${data.slice(10, 74)}`, `0x${data.slice(138, 202)}`],
        data: `0x${data.slice(74, 138)}`,
        transactionHash, blockNumber, logIndex: hex(index),
      });
    }
    const receipt: FakeReceipt = {
      status, blockNumber, transactionHash, logs: entries, from: String(tx.from), to: tx.calls[0]?.to ?? null,
      blockHash: `0x${"ab".repeat(32)}`, transactionIndex: "0x0", gasUsed: "0xb63f", cumulativeGasUsed: "0xb63f",
      effectiveGasPrice: "0x4a817c800", logsBloom: `0x${"00".repeat(256)}`, type: "0x76", contractAddress: null,
    };
    receipts.set(transactionHash, receipt);
    logs.push(...entries);
    return receipt;
  }

  const request: Eip1193Request = async ({ method, params }) => {
    calls.push(method);
    const args = (params ?? []) as unknown[];
    switch (method) {
      case "eth_chainId": return "0xa5bf";
      case "eth_estimateGas": return "0xb63f";
      case "eth_maxPriorityFeePerGas": return "0x0";
      case "eth_gasPrice": return "0x4a817c800";
      case "eth_getBlockByNumber": {
        const tag = args[0];
        const head = headNumber - headLag;
        const number = tag === "latest" ? head : BigInt(String(tag));
        if (number > head) return null;
        return { number: hex(number), timestamp: hex(timestampOf(number)), baseFeePerGas: "0x4a817c800", hash: `0x${"00".repeat(32)}`, transactions: [] };
      }
      case "eth_call":
        if (simulation) throw simulation;
        return "0x";
      case "eth_sendRawTransactionSync":
      case "eth_sendRawTransaction": {
        const raw = String(args[0]);
        sentRaw.push(raw);
        if (broadcast === "reject")
          throw Object.assign(new Error("'valid_before' is too close to current time"), { code: -32000 });
        const receipt = await land(raw, broadcast === "revert" ? "0x0" : "0x1");
        if (broadcast === "land-then-timeout") throw Object.assign(new Error("The request took too long to respond."), { name: "TimeoutError" });
        return method === "eth_sendRawTransaction" ? receipt.transactionHash : receipt;
      }
      case "eth_getTransactionReceipt":
        if (missReceipts > 0) { missReceipts -= 1; return null; }
        return hideReceipts ? null : receipts.get(String(args[0]).toLowerCase()) ?? null;
      case "eth_getLogs": {
        const filter = args[0] as { address: string; topics: (string | null)[]; fromBlock: string; toBlock: string };
        if (lagLogs > 0 || BigInt(filter.toBlock) > headNumber - headLag) {
          lagLogs = Math.max(0, lagLogs - 1);
          throw Object.assign(new Error("block range extends beyond current head block"), { code: -32602 });
        }
        return logs.filter((log) =>
          log.address.toLowerCase() === filter.address.toLowerCase() &&
          BigInt(log.blockNumber) >= BigInt(filter.fromBlock) && BigInt(log.blockNumber) <= BigInt(filter.toBlock) &&
          filter.topics.every((topic, index) => !topic || log.topics[index]?.toLowerCase() === topic.toLowerCase()));
      }
    }
    throw new Error(`offline fake: ${method} is not scripted`);
  };

  const rpc: TempoRpc = async <T>(method: string, params: unknown[]) => {
    try {
      return await request({ method, params }) as T;
    } catch (error) {
      throw Object.assign(new Error(`Moderato ${method}: ${(error as Error).message}`), { code: (error as { code?: number }).code });
    }
  };
  return {
    request, rpc, calls, receipts, logs, sentRaw,
    setSimulation(error: Error | null) { simulation = error; },
    setBroadcast(mode: typeof broadcast) { broadcast = mode; },
    setHeadLag(blocks: bigint) { headLag = blocks; },
    hideReceipts(value: boolean) { hideReceipts = value; },
    /** The next lookups miss, as on a lagging replica. */
    missReceipts(count: number) { missReceipts = count; },
    /** The next eth_getLogs calls land on a replica whose head is below toBlock. */
    lagLogs(count: number) { lagLogs = count; },
    advanceBlocks(blocks: bigint) { headNumber += blocks; },
    land,
  };
}
