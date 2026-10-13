import type { FundingLedger, RefillResult } from "../x402/ledger.ts";
import { TESTNET_LABEL } from "../x402/records.ts";
import { keepFirst, readRecord, recordBytes, type ReceiptStore } from "../x402/store.ts";
import {
  INTENT_ID_PATTERN,
  TEMPO_MODERATO,
  mppExplorerUrl,
  mppRecordPaths,
  mppRefillRequestId,
  normalizeHash,
} from "./ids.ts";

export { TESTNET_LABEL };

/**
 * Written before the signed transaction is broadcast; one per MPP challenge, bound to the first
 * room it was presented to. The transaction hash is known before broadcast (no fee sponsor).
 */
export type MppIntent = {
  kind: "fork-night/mpp-intent/v1";
  intentId: string;
  network: typeof TEMPO_MODERATO;
  challengeId: string;
  challengeExpires: string | null;
  realm: string;
  roomId: string;
  stewardProfileId: string;
  credits: 5;
  payer: string;
  payTo: string;
  currency: string;
  amount: string;
  /** keccak256 of the signed Tempo transaction: the on-chain hash once it lands. */
  transaction: string;
  /** The transaction's expiring-nonce deadline, Unix seconds. */
  validBefore: number;
  payloadDigest: string;
  /** The signed transaction (public once broadcast); kept as evidence in the private bucket. */
  signedTransaction: string;
  createdAt: string;
};

/** Written after the refill succeeded for a confirmed payment. */
export type MppReceipt = {
  kind: "fork-night/mpp-receipt/v1";
  intentId: string;
  roomId: string;
  network: typeof TEMPO_MODERATO;
  transaction: string;
  explorerUrl: string;
  payer: string;
  payTo: string;
  currency: string;
  amount: string;
  refillRequestId: string;
  refill: RefillResult;
  settlement: unknown;
  /** Encoded Payment-Receipt when the route broadcast it; null when the payment was found on chain. */
  paymentReceipt: string | null;
  source: "route" | "reconciler";
  label: string;
  recordedAt: string;
};

/**
 * The transaction that paid this intent, recorded before the room is credited. Only this
 * transaction can ever credit the intent, so a second hash can never credit one payment twice.
 */
export type MppSettlement = {
  kind: "fork-night/mpp-settlement/v1";
  intentId: string;
  network: typeof TEMPO_MODERATO;
  transaction: string;
  refillRequestId: string;
  via: "broadcast" | "chain";
  recordedAt: string;
};

/** Written by the reconciler once the chain shows the payment can never land. */
export type MppExpired = {
  kind: "fork-night/mpp-expired/v1";
  intentId: string;
  roomId: string;
  network: typeof TEMPO_MODERATO;
  reason: string;
  evidence: Record<string, unknown>;
  recordedAt: string;
};

export type MppPaid = {
  transaction: string;
  settlement: unknown;
  paymentReceipt: string | null;
  source: MppReceipt["source"];
  /** The ID already bound by the settlement record; derived from the transaction when absent. */
  refillRequestId?: string;
};

/** Credits the room once for a confirmed payment, then records the receipt. Shared by route and reconciler. */
export async function creditMppPayment(
  deps: { store: ReceiptStore; ledger: FundingLedger; now: () => Date },
  intent: MppIntent,
  paid: MppPaid,
) {
  const transaction = normalizeHash(paid.transaction);
  const requestId = paid.refillRequestId ?? mppRefillRequestId(transaction);
  // The actor is the steward recorded with the intent, so a replay always matches the first refill.
  const refill = await deps.ledger.refill(requestId, intent.roomId, intent.stewardProfileId);
  return keepFirst<MppReceipt>(deps.store, mppRecordPaths(intent.intentId, intent.roomId).receipt, {
    kind: "fork-night/mpp-receipt/v1",
    intentId: intent.intentId,
    roomId: intent.roomId,
    network: TEMPO_MODERATO,
    transaction,
    explorerUrl: mppExplorerUrl(transaction),
    payer: intent.payer,
    payTo: intent.payTo,
    currency: intent.currency,
    amount: intent.amount,
    refillRequestId: requestId,
    refill,
    settlement: paid.settlement,
    paymentReceipt: paid.paymentReceipt,
    source: paid.source,
    label: TESTNET_LABEL,
    recordedAt: deps.now().toISOString(),
  });
}

/**
 * MPP top-ups that hold a slot of the room's MPP limit: every intent except ones the chain showed
 * can no longer land. Per rail: x402 records are never counted here, nor MPP records by x402.
 */
export async function activeMppTopUps(store: ReceiptStore, roomId: string, except?: string) {
  let active = 0;
  for (const name of await store.list(`mpp/rooms/${roomId}`)) {
    const id = name.replace(/\.json$/, "");
    if (!INTENT_ID_PATTERN.test(id) || id === except) continue;
    const paths = mppRecordPaths(id, roomId);
    const [receipt, expired] = await Promise.all([store.read(paths.receipt), store.read(paths.expired)]);
    if (expired && !receipt) continue;
    active += 1;
  }
  return active;
}

/** Append-only evidence for anything short of a credited receipt. Never decides an outcome. */
export async function recordMppEvent(
  store: ReceiptStore,
  intentId: string,
  kind: string,
  at: Date,
  detail: Record<string, unknown>,
) {
  const path = `mpp/events/${intentId}/${at.toISOString().replace(/[:.]/g, "-")}-${kind}.json`;
  try {
    await store.create(path, recordBytes({ kind, at: at.toISOString(), ...detail }));
  } catch (error) {
    console.warn(`mpp: could not record ${kind} for ${intentId.slice(0, 12)}`, (error as Error).message);
  }
}

export async function readMppIntent(store: ReceiptStore, id: string) {
  return readRecord<MppIntent>(store, `mpp/intents/${id}.json`);
}
