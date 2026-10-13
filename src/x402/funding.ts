import type { FundingConfig, FundingRoom } from "./config.ts";
import {
  explorerUrl,
  intentId,
  normalizeTransaction,
  recordPaths,
  refillRequestId,
  type IntentKey,
  type Testnet,
} from "./ids.ts";
import { fundingRefusal, type FundingLedger } from "./ledger.ts";
import {
  activeTopUps,
  creditSettledPayment,
  recordEvent,
  TESTNET_LABEL,
  type FundingIntent,
  type FundingReceipt,
  type FundingSettlement,
} from "./records.ts";
import {
  keepFirst,
  readRecord,
  recordBytes,
  StoredConflictError,
  type ReceiptStore,
} from "./store.ts";

/** What the route needs from x402; the adapter in payment.ts wraps @x402/core. */
export type ResourceInfo = { url: string; description: string; mimeType: string };
export type PresentedPayment = {
  network: Testnet;
  key: IntentKey;
  payer: string;
  payTo: string;
  asset: string;
  amount: string;
  payloadDigest: string;
  payload: unknown;
  requirement: unknown;
  validUntil: string | null;
  /** Only the EVM validity window is off: a recorded payment still gets its outcome, a new one a fresh offer. */
  stale?: string;
};
export type Verification = { valid: true; payer: string } | { valid: false; reason: string };
export type Settlement =
  | { kind: "settled"; transaction: string; response: unknown; header: string }
  | { kind: "pending"; transaction: string | null; reason: string }
  | { kind: "failed"; reason: string };
export interface PaymentPort {
  offer(resource: ResourceInfo, error?: string): Promise<{ header: string; body: unknown }>;
  /** Decodes and matches a PAYMENT-SIGNATURE header without contacting the facilitator. */
  present(header: string, resource: ResourceInfo): Promise<PresentedPayment | { invalid: string }>;
  /** Throws when the facilitator cannot be reached. */
  verify(payment: PresentedPayment): Promise<Verification>;
  /** Never throws for a facilitator outcome; anything indeterminate is "pending". */
  settle(payment: PresentedPayment): Promise<Settlement>;
}

export type FundingDeps = {
  config: FundingConfig;
  payments: PaymentPort;
  store: ReceiptStore;
  ledger: FundingLedger;
  now?: () => Date;
};

const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

// One local process serves the proof; per-room serialization keeps the ceiling exact.
const roomLocks = new Map<string, Promise<void>>();
async function withRoomLock<T>(roomId: string, run: () => Promise<T>): Promise<T> {
  const previous = roomLocks.get(roomId) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => mine);
  roomLocks.set(roomId, tail);
  await previous;
  try {
    return await run();
  } finally {
    release();
    if (roomLocks.get(roomId) === tail) roomLocks.delete(roomId);
  }
}

function resourceFor(request: Request, fundingRef: string): ResourceInfo {
  const url = new URL(request.url);
  // Next rewrites 127.0.0.1 to localhost in request.url; keep the address the agent used.
  const host = request.headers.get("host") ?? url.host;
  return {
    url: `${url.protocol}//${host}/api/x402/fund/${fundingRef}`,
    description: "Fork Night room top-up: 5 test credits (testnet)",
    mimeType: "application/json",
  };
}

function intentConflict(intent: FundingIntent, room: FundingRoom, payment: PresentedPayment) {
  if (intent.roomId !== room.roomId) return "This payment was already presented for another room.";
  if (intent.payloadDigest !== payment.payloadDigest)
    return "A different payment was already presented for this offer. Wait for it to be reconciled; do not pay again.";
  return null;
}

const credited = (receipt: FundingReceipt, replayed: boolean, header: string | null) =>
  reply(
    {
      status: "credited",
      added: receipt.refill.added,
      replayed: replayed || receipt.refill.replayed,
      credits: receipt.refill.credits,
      network: receipt.network,
      transaction: receipt.transaction,
      explorerUrl: receipt.explorerUrl,
      label: TESTNET_LABEL,
    },
    200,
    header ? { "PAYMENT-RESPONSE": header } : {},
  );

/**
 * POST /api/x402/fund/[fundingRef]. Order: match → stored outcome → verify → eligibility →
 * durable intent → settle → settlement record → idempotent refill → receipt. Nothing settles
 * without an intent, nothing is credited without a recorded settlement, and every room
 * refusal precedes settlement.
 */
export async function handleFunding(request: Request, fundingRef: string, deps: FundingDeps) {
  const room = Object.hasOwn(deps.config.rooms, fundingRef) ? deps.config.rooms[fundingRef] : undefined;
  if (!room) return reply({ error: "Not found." }, 404);
  if (request.method !== "POST") return reply({ error: "Use POST to fund this room." }, 405, { Allow: "POST" });
  if (Number(request.headers.get("content-length") ?? 0) > 1024)
    return reply({ error: "The funding request is too large." }, 413);
  const now = deps.now ?? (() => new Date());
  const resource = resourceFor(request, fundingRef);
  const signature = request.headers.get("payment-signature");

  const refusal = async (except?: string) => {
    const [state, active] = await Promise.all([
      deps.ledger.state(room.roomId, room.stewardProfileId),
      activeTopUps(deps.store, room.roomId, except),
    ]);
    return fundingRefusal(state, active, room.maxTopUps);
  };
  // A fresh offer only for an eligible room, so an x402 client never pays a room that would refuse it.
  const offer = async (error?: string) => {
    const refused = await refusal();
    if (refused) return reply({ error: error ? `${error} ${refused}` : refused }, 409);
    const { header, body } = await deps.payments.offer(resource, error);
    return reply(body, 402, { "PAYMENT-REQUIRED": header });
  };
  const unavailable = () =>
    reply({ error: "Room funding is unavailable right now. Nothing was charged; try again." }, 503);
  // A payment presented before may already have settled, so it is never offered a fresh payment.
  const mayHaveSettled = (network: Testnet) =>
    reply(
      {
        status: "pending",
        network,
        message: "This payment was already presented and may have settled. Credits follow reconciliation; do not sign a new payment.",
      },
      202,
    );

  return withRoomLock(room.roomId, async () => {
    if (!signature) {
      try { return await offer(); } catch { return unavailable(); }
    }
    let payment: PresentedPayment | { invalid: string };
    try { payment = await deps.payments.present(signature, resource); } catch { return unavailable(); }
    if ("invalid" in payment) {
      try { return await offer(payment.invalid); } catch { return unavailable(); }
    }
    const id = intentId(payment.key);
    const paths = recordPaths(id, room.roomId);

    let intent: FundingIntent | null;
    try {
      intent = await readRecord<FundingIntent>(deps.store, paths.intent);
      if (intent) {
        const conflict = intentConflict(intent, room, payment);
        if (conflict) return reply({ error: conflict }, 409);
        // The same signed payment again after a lost response: answer from the receipt, settle nothing.
        const receipt = await readRecord<FundingReceipt>(deps.store, paths.receipt);
        if (receipt) return credited(receipt, true, receipt.paymentResponse);
        if (await deps.store.read(paths.expired)) {
          try { return await offer("This payment expired before it settled; nothing was charged."); }
          catch { return unavailable(); }
        }
      }
    } catch { return unavailable(); }

    if (payment.stale) {
      if (intent) return mayHaveSettled(payment.network);
      try { return await offer(payment.stale); } catch { return unavailable(); }
    }

    let verification: Verification;
    try { verification = await deps.payments.verify(payment); } catch { return unavailable(); }
    if (!verification.valid) {
      // A used nonce or a landed transaction no longer verifies.
      if (intent) return mayHaveSettled(payment.network);
      try { return await offer(verification.reason); } catch { return unavailable(); }
    }

    try {
      const refused = await refusal(intent ? id : undefined);
      if (refused) return reply({ error: refused }, 409);
    } catch { return unavailable(); }

    if (!intent) {
      const fresh: FundingIntent = {
        kind: "fork-night/x402-intent/v1",
        intentId: id,
        key: payment.key,
        roomId: room.roomId,
        stewardProfileId: room.stewardProfileId,
        credits: 5,
        payer: payment.payer,
        payTo: payment.payTo,
        asset: payment.asset,
        amount: payment.amount,
        payloadDigest: payment.payloadDigest,
        payload: payment.payload,
        requirement: payment.requirement,
        validUntil: payment.validUntil,
        createdAt: now().toISOString(),
      };
      try {
        await deps.store.create(paths.intent, recordBytes(fresh));
        intent = fresh;
      } catch (error) {
        if (!(error instanceof StoredConflictError)) return unavailable();
        // Another request claimed this payment first.
        const winner = await readRecord<FundingIntent>(deps.store, paths.intent).catch(() => null);
        if (!winner) return unavailable();
        const conflict = intentConflict(winner, room, payment);
        if (conflict) return reply({ error: conflict }, 409);
        intent = winner;
      }
    }
    // The room index counts this intent against the steward's ceiling before anything settles.
    try { await keepFirst(deps.store, paths.roomIndex, { intentId: id, roomId: room.roomId }); }
    catch { return unavailable(); }

    let settlement: Settlement;
    try {
      settlement = await deps.payments.settle(payment);
    } catch (error) {
      // Settlement may have been attempted, so the intent stays for the reconciler.
      settlement = { kind: "pending", transaction: null, reason: (error as Error).name || "settle_error" };
    }
    if (settlement.kind === "failed") {
      await recordEvent(deps.store, id, "settle-failed", now(), { reason: settlement.reason });
      try { return await offer(`The payment did not settle: ${settlement.reason}`); } catch { return unavailable(); }
    }
    if (settlement.kind === "pending") {
      await recordEvent(deps.store, id, "settle-pending", now(), {
        reason: settlement.reason,
        transaction: settlement.transaction,
      });
      return reply(
        {
          status: "pending",
          network: payment.network,
          transaction: settlement.transaction,
          message: "The payment is pending. Credits follow after reconciliation; do not sign a new payment.",
        },
        202,
      );
    }
    const settled = settlement;
    const creditPending = async (reason: string, detail: Record<string, unknown> = {}) => {
      await recordEvent(deps.store, id, "credit-pending", now(), { transaction: settled.transaction, reason, ...detail });
      return reply(
        {
          status: "settled-credit-pending",
          network: payment.network,
          transaction: settled.transaction,
          explorerUrl: explorerUrl(payment.network, settled.transaction),
          message: "The payment settled. Credits are added when the operator reconciles it; do not pay again.",
        },
        202,
        { "PAYMENT-RESPONSE": settled.header },
      );
    };
    // The reported transaction is bound to the intent before any credit, so no other hash can credit it again.
    const transaction = normalizeTransaction(payment.network, settled.transaction);
    const requestId = refillRequestId(payment.network, transaction);
    let recorded: FundingSettlement;
    try {
      recorded = await keepFirst<FundingSettlement>(deps.store, paths.settlement, {
        kind: "fork-night/x402-settlement/v1",
        intentId: id,
        network: payment.network,
        transaction,
        refillRequestId: requestId,
        recordedAt: now().toISOString(),
      });
    } catch (error) {
      return creditPending(`The settlement could not be recorded: ${(error as Error).message}`);
    }
    if (recorded.transaction !== transaction || recorded.refillRequestId !== requestId)
      return creditPending("Another transaction is already recorded for this payment.", { recorded: recorded.transaction });
    try {
      const receipt = await creditSettledPayment({ ...deps, now }, intent, {
        transaction: settled.transaction,
        settlement: settled.response,
        paymentResponse: settled.header,
        source: "route",
        refillRequestId: requestId,
      });
      return credited(receipt, false, settled.header);
    } catch (error) {
      return creditPending((error as Error).message);
    }
  });
}
