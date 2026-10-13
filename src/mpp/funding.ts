import { fundingRefusal, type FundingLedger } from "../x402/ledger.ts";
import {
  keepFirst,
  readRecord,
  recordBytes,
  StoredConflictError,
  type ReceiptStore,
} from "../x402/store.ts";
import type { ChainReader } from "./chain.ts";
import type { MppRoom } from "./config.ts";
import {
  MPP_COMMANDS,
  MPP_REALM,
  TEMPO_MODERATO,
  TRANSACTION_PATTERN,
  mppExplorerUrl,
  mppIntentId,
  mppRecordPaths,
  mppRefillRequestId,
  normalizeHash,
} from "./ids.ts";
import {
  activeMppTopUps,
  creditMppPayment,
  recordMppEvent,
  TESTNET_LABEL,
  type MppIntent,
  type MppReceipt,
  type MppSettlement,
} from "./records.ts";

/** An MPP credential decoded and matched to this room's offer, without any network call. */
export type PresentedCharge = {
  challengeId: string;
  challengeExpires: string | null;
  realm: string;
  /** HMAC tag binding the challenge to the room it was offered for. */
  roomTag: string;
  payer: string;
  payTo: string;
  currency: string;
  amount: string;
  /** keccak256 of the signed transaction, lowercase: the on-chain hash (no fee sponsor). */
  transaction: string;
  validBefore: number;
  payloadDigest: string;
  signedTransaction: string;
  /** The parsed credential, handed back to verify and settle. */
  credential: unknown;
  /** The challenge or transaction window is off: a recorded payment still gets its outcome, a new one a fresh offer. */
  stale?: string;
};
/** What a credential claims, decoded without any check: enough to find a payment this door already recorded. */
export type ChargeIdentity = { challengeId: string; payloadDigest: string | null };
export type ChargeVerification = { valid: true } | { valid: false; reason: string };
export type ChargeSettlement =
  | { kind: "settled"; transaction: string; receiptHeader: string; receipt: unknown }
  | { kind: "pending"; transaction: string | null; reason: string }
  | { kind: "failed"; reason: string };

/** What the door needs from mppx; the adapter in charge.ts wraps mppx 0.13.4. */
export interface ChargePort {
  /**
   * The challenge ID and the signed payment's digest only: no HMAC, offer or network check, so a recorded payment
   * is still recognized after the key, token or recipient changed. Null when the credential cannot be decoded.
   */
  identify(authorization: string): ChargeIdentity | null;
  /** A fresh challenge for this room: the WWW-Authenticate value and a problem body. */
  offer(room: MppRoom, error?: string): Promise<{ header: string; body: unknown }>;
  /** Decodes and matches an Authorization: Payment credential without any network call. */
  present(authorization: string, room: MppRoom): Promise<PresentedCharge | { invalid: string }>;
  /** mppx validateCredential: no replay marker, no broadcast. Throws when the chain cannot be reached. */
  verify(charge: PresentedCharge): Promise<ChargeVerification>;
  /** mppx broadcastCredential. Never throws; anything that may have reached the chain is "pending". */
  settle(charge: PresentedCharge): Promise<ChargeSettlement>;
}

export type MppFundingDeps = {
  /** Funding reference → room, already joined from the x402 opt-in and the MPP limit. */
  rooms: Record<string, MppRoom>;
  charges: ChargePort;
  /** Reads the chain for a recorded intent; the route never broadcasts a recorded payment again. */
  chain: ChainReader;
  store: ReceiptStore;
  ledger: FundingLedger;
  now?: () => Date;
};

const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

// One local process serves the proof; per-room serialization keeps the MPP limit exact. This lock is
// the MPP rail's own: x402's lock is module-private and limits are per rail (COORDINATION.md).
const roomLocks = new Map<string, Promise<void>>();
async function withMppRoomLock<T>(roomId: string, run: () => Promise<T>): Promise<T> {
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

function intentConflict(intent: MppIntent, room: MppRoom, payloadDigest: string | null) {
  if (intent.roomId !== room.roomId) return "This payment was already presented for another room.";
  if (intent.payloadDigest !== payloadDigest)
    return "A different payment was already presented for this offer. Wait for it to be reconciled; do not pay again.";
  return null;
}

const credited = (receipt: MppReceipt, replayed: boolean, header: string | null) =>
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
    header ? { "Payment-Receipt": header } : {},
  );

/**
 * POST /api/mpp/fund/[fundingRef]. Order: stored outcome (by challenge, before any check against the current
 * offer) → match → verify → eligibility → durable intent and room pointer → broadcast → settlement record →
 * idempotent refill → receipt. Nothing is broadcast without an intent, nothing is credited without a confirmed
 * transfer of the recorded transaction, every room refusal precedes the broadcast, and a recorded payment is
 * resolved from the chain, never broadcast again or offered a fresh payment while it may still land.
 */
export async function handleMppFunding(request: Request, fundingRef: string, deps: MppFundingDeps) {
  const room = Object.hasOwn(deps.rooms, fundingRef) ? deps.rooms[fundingRef] : undefined;
  if (!room) return reply({ error: "Not found." }, 404);
  if (request.method !== "POST") return reply({ error: "Use POST to fund this room." }, 405, { Allow: "POST" });
  if (Number(request.headers.get("content-length") ?? 0) > 1024)
    return reply({ error: "The funding request is too large." }, 413);
  const now = deps.now ?? (() => new Date());
  const authorization = request.headers.get("authorization");

  const refusal = async (except?: string) => {
    const [state, active] = await Promise.all([
      deps.ledger.state(room.roomId, room.stewardProfileId),
      activeMppTopUps(deps.store, room.roomId, except),
    ]);
    return fundingRefusal(state, active, room.maxTopUps);
  };
  // A fresh challenge only for an eligible room, so an MPP client never pays a room that would refuse it.
  const offer = async (error?: string) => {
    const refused = await refusal();
    if (refused) return reply({ error: error ? `${error} ${refused}` : refused }, 409);
    const { header, body } = await deps.charges.offer(room, error);
    return reply(body, 402, { "WWW-Authenticate": header });
  };
  // Only before any credential is recorded: nothing was charged, and nothing about this credential is stored.
  const unavailable = () =>
    reply({ error: "Room funding is unavailable right now. Nothing was charged; try again." }, 503);
  // After a credential is presented, a storage failure must never invite a second signature.
  const uncheckable = (detail = "Could not check this payment right now.") =>
    reply({ error: `${detail} Re-send the same payment later; do not sign a new one.` }, 503);
  const pending = (transaction: string | null, message: string, extra: Record<string, unknown> = {}) =>
    reply({
      status: "pending",
      network: TEMPO_MODERATO,
      transaction,
      ...(transaction ? { explorerUrl: mppExplorerUrl(transaction) } : {}),
      message,
      ...extra,
    }, 202);
  /** A recorded payment whose outcome cannot be read right now: it may have landed. */
  const recordedUnreadable = (transaction: string | null) => pending(transaction,
    "This payment was already presented, but its outcome could not be read right now. Re-send the same payment later or reconcile; do not sign a new payment.");

  /**
   * Credits a confirmed transfer once: only the transaction the intent recorded before the broadcast, with its
   * room pointer and settlement record written first, then the refill, then the receipt.
   */
  const creditConfirmed = async (
    intent: MppIntent,
    paid: { transaction: string; via: MppSettlement["via"]; settlement: unknown; header: string | null },
  ) => {
    const transaction = normalizeHash(paid.transaction);
    const requestId = mppRefillRequestId(transaction);
    const paths = mppRecordPaths(intent.intentId, intent.roomId);
    const creditPending = async (reason: string, detail: Record<string, unknown> = {}) => {
      await recordMppEvent(deps.store, intent.intentId, "credit-pending", now(), { transaction, reason, ...detail });
      return reply(
        {
          status: "settled-credit-pending",
          network: TEMPO_MODERATO,
          transaction,
          explorerUrl: mppExplorerUrl(transaction),
          message: "The payment landed. Credits are added when the operator reconciles it; do not pay again.",
        },
        202,
        paid.header ? { "Payment-Receipt": paid.header } : {},
      );
    };
    // MS-3: a transaction other than the recorded one is never credited, by the route or the reconciler.
    if (transaction !== normalizeHash(intent.transaction)) {
      await recordMppEvent(deps.store, intent.intentId, "hash-differs", now(), { recorded: intent.transaction, landed: transaction, via: paid.via });
      await recordMppEvent(deps.store, intent.intentId, "credit-pending", now(), {
        transaction, recorded: intent.transaction, handCheck: true,
        reason: "The confirmed transaction differs from the one recorded for this payment; check by hand.",
      });
      return reply(
        {
          status: "settled-credit-pending",
          network: TEMPO_MODERATO,
          transaction: intent.transaction,
          explorerUrl: mppExplorerUrl(intent.transaction),
          reported: transaction,
          handCheck: true,
          message: "The payment system confirmed a transaction other than the one this door recorded for this payment, so it is not credited; it must be checked by hand. Do not pay again.",
        },
        202,
      );
    }
    // The room pointer holds this payment's slot of the MPP limit before it is credited (its first write may have failed).
    try { await keepFirst(deps.store, paths.roomIndex, { intentId: intent.intentId, roomId: intent.roomId }); }
    catch (error) { return creditPending(`The room pointer could not be recorded: ${(error as Error).message}`); }
    // The transaction is bound to the intent before any credit, so no other hash can credit it again.
    let recorded: MppSettlement;
    try {
      recorded = await keepFirst<MppSettlement>(deps.store, paths.settlement, {
        kind: "fork-night/mpp-settlement/v1",
        intentId: intent.intentId,
        network: TEMPO_MODERATO,
        transaction,
        refillRequestId: requestId,
        via: paid.via,
        recordedAt: now().toISOString(),
      });
    } catch (error) {
      return creditPending(`The settlement could not be recorded: ${(error as Error).message}`);
    }
    if (recorded.transaction !== transaction || recorded.refillRequestId !== requestId)
      return creditPending("Another transaction is already recorded for this payment.", { recorded: recorded.transaction });
    try {
      const receipt = await creditMppPayment({ store: deps.store, ledger: deps.ledger, now }, intent, {
        transaction,
        settlement: paid.settlement,
        paymentReceipt: paid.header,
        source: "route",
        refillRequestId: requestId,
      });
      return credited(receipt, false, paid.header);
    } catch (error) {
      return creditPending((error as Error).message);
    }
  };

  /** A recorded payment presented again: answer from the chain only. It is never broadcast twice. */
  const resolveRecorded = async (intent: MppIntent) => {
    // While it may still land it holds its slot, even if the pointer's first write failed.
    await keepFirst(deps.store, mppRecordPaths(intent.intentId, intent.roomId).roomIndex, { intentId: intent.intentId, roomId: intent.roomId })
      .catch(() => null);
    let verdict: Awaited<ReturnType<ChainReader["inspect"]>>;
    try {
      verdict = await deps.chain.inspect(intent);
    } catch (error) {
      return pending(intent.transaction,
        "This payment was already presented and may have landed, but the chain could not be read right now. Re-send the same payment later or reconcile; do not sign a new payment.",
        { reason: (error as Error).message.slice(0, 200) });
    }
    if (verdict.status === "paid") {
      if (!TRANSACTION_PATTERN.test(normalizeHash(verdict.transaction)))
        return pending(intent.transaction, "The chain reader returned a malformed transaction; check by hand. Do not sign a new payment.");
      return creditConfirmed(intent, { transaction: verdict.transaction, via: "chain", settlement: verdict.evidence, header: null });
    }
    if (verdict.status === "unpayable")
      return pending(intent.transaction,
        `${verdict.reason} Run ${MPP_COMMANDS.reconcile} --apply to record it; signing a new payment is safe after that.`);
    return pending(intent.transaction,
      `This payment was already presented and may still land (${verdict.reason}). Credits follow reconciliation; do not sign a new payment.`);
  };

  /**
   * The same signed payment again: answered from its receipt, its expired marker or the chain, before any check
   * that depends on this server's current offer (key, token, recipient). It was matched when it was recorded.
   */
  const answerRecorded = async (intent: MppIntent, payloadDigest: string | null) => {
    const conflict = intentConflict(intent, room, payloadDigest);
    if (conflict) return reply({ error: conflict }, 409);
    const paths = mppRecordPaths(intent.intentId, intent.roomId);
    let expired: Buffer | null;
    try {
      const receipt = await readRecord<MppReceipt>(deps.store, paths.receipt);
      if (receipt) return credited(receipt, true, receipt.paymentReceipt);
      expired = await deps.store.read(paths.expired);
    } catch { return recordedUnreadable(intent.transaction); }
    if (expired) {
      try { return await offer("This payment expired before it settled; nothing was charged."); }
      catch { return unavailable(); }
    }
    return resolveRecorded(intent);
  };
  const readIntent = (challengeId: string) =>
    readRecord<MppIntent>(deps.store, mppRecordPaths(mppIntentId(challengeId), room.roomId).intent);

  return withMppRoomLock(room.roomId, async () => {
    if (!authorization) {
      try { return await offer(); } catch { return unavailable(); }
    }
    // A recorded payment first, so a config change or key rotation never turns it into a fresh offer.
    let identity: ChargeIdentity | null;
    try { identity = deps.charges.identify(authorization); } catch { identity = null; }
    if (identity) {
      let recorded: MppIntent | null;
      try { recorded = await readIntent(identity.challengeId); } catch { return uncheckable(); }
      if (recorded) return answerRecorded(recorded, identity.payloadDigest);
    }

    let charge: PresentedCharge | { invalid: string };
    try { charge = await deps.charges.present(authorization, room); } catch { return unavailable(); }
    if ("invalid" in charge) {
      try { return await offer(charge.invalid); } catch { return unavailable(); }
    }
    const id = mppIntentId(charge.challengeId);
    const paths = mppRecordPaths(id, room.roomId);
    if (charge.challengeId !== identity?.challengeId) {
      // identify() and present() decode the same credential; this only guards a port where they disagree.
      let recorded: MppIntent | null;
      try { recorded = await readIntent(charge.challengeId); } catch { return uncheckable(); }
      if (recorded) return answerRecorded(recorded, charge.payloadDigest);
    }

    if (charge.stale) {
      try { return await offer(charge.stale); } catch { return unavailable(); }
    }

    let verification: ChargeVerification;
    try { verification = await deps.charges.verify(charge); } catch { return unavailable(); }
    if (!verification.valid) {
      try { return await offer(verification.reason); } catch { return unavailable(); }
    }

    try {
      const refused = await refusal();
      if (refused) return reply({ error: refused }, 409);
    } catch { return unavailable(); }

    const fresh: MppIntent = {
      kind: "fork-night/mpp-intent/v1",
      intentId: id,
      network: TEMPO_MODERATO,
      challengeId: charge.challengeId,
      challengeExpires: charge.challengeExpires,
      realm: charge.realm,
      roomId: room.roomId,
      stewardProfileId: room.stewardProfileId,
      credits: 5,
      payer: charge.payer,
      payTo: charge.payTo,
      currency: charge.currency,
      amount: charge.amount,
      transaction: charge.transaction,
      validBefore: charge.validBefore,
      payloadDigest: charge.payloadDigest,
      signedTransaction: charge.signedTransaction,
      createdAt: now().toISOString(),
    };
    try {
      await deps.store.create(paths.intent, recordBytes(fresh));
    } catch (error) {
      // The write may have landed before the error (a lost acknowledgement): never say that nothing was charged.
      if (!(error instanceof StoredConflictError)) return uncheckable("Could not record this payment; nothing was broadcast.");
      // Another request (another process) claimed this challenge first.
      const winner = await readRecord<MppIntent>(deps.store, paths.intent).catch(() => null);
      if (!winner) return recordedUnreadable(charge.transaction);
      return answerRecorded(winner, charge.payloadDigest);
    }
    const intent = fresh;
    // The room index counts this intent against the MPP limit before anything is broadcast.
    try { await keepFirst(deps.store, paths.roomIndex, { intentId: id, roomId: room.roomId }); }
    catch { return uncheckable("Could not record this payment; nothing was broadcast."); }

    const settlement = await deps.charges.settle(charge).catch((error: unknown): ChargeSettlement =>
      ({ kind: "pending", transaction: null, reason: (error as Error).name || "settle_error" }));
    if (settlement.kind === "failed") {
      await recordMppEvent(deps.store, id, "settle-failed", now(), { reason: settlement.reason });
      try { return await offer(`The payment did not settle: ${settlement.reason}`); } catch { return unavailable(); }
    }
    if (settlement.kind === "pending") {
      await recordMppEvent(deps.store, id, "settle-pending", now(), {
        reason: settlement.reason,
        transaction: settlement.transaction,
      });
      return pending(settlement.transaction ?? intent.transaction,
        "The payment is pending. Re-send the same payment later or reconcile; credits follow, and you must not sign a new payment.");
    }
    if (!TRANSACTION_PATTERN.test(normalizeHash(settlement.transaction))) {
      await recordMppEvent(deps.store, id, "settle-pending", now(), { reason: "malformed transaction", transaction: settlement.transaction });
      return pending(intent.transaction, "The payment's outcome is unclear; credits follow reconciliation. Do not sign a new payment.");
    }
    return creditConfirmed(intent, {
      transaction: settlement.transaction,
      via: "broadcast",
      settlement: { receipt: settlement.receipt, realm: MPP_REALM },
      header: settlement.receiptHeader,
    });
  });
}
