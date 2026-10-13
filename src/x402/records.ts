import {
  INTENT_ID_PATTERN,
  explorerUrl,
  recordPaths,
  refillRequestId,
  type IntentKey,
  type Testnet,
} from "./ids.ts";
import type { FundingLedger, RefillResult } from "./ledger.ts";
import { keepFirst, readRecord, recordBytes, type ReceiptStore } from "./store.ts";

export const TESTNET_LABEL =
  "Testnet funds demonstrate the payment rail; image costs are paid from the operator's approved allowance.";

/** Written before settlement; one per payment authorization, bound to the first room it was presented to. */
export type FundingIntent = {
  kind: "fork-night/x402-intent/v1";
  intentId: string;
  key: IntentKey;
  roomId: string;
  stewardProfileId: string;
  credits: 5;
  payer: string;
  payTo: string;
  asset: string;
  amount: string;
  payloadDigest: string;
  payload: unknown;
  requirement: unknown;
  /** EVM authorization validBefore; Solana payments expire with their blockhash. */
  validUntil: string | null;
  createdAt: string;
};

/** Written after the refill succeeded for a settled payment. */
export type FundingReceipt = {
  kind: "fork-night/x402-receipt/v1";
  intentId: string;
  roomId: string;
  network: Testnet;
  transaction: string;
  explorerUrl: string;
  payer: string;
  payTo: string;
  asset: string;
  amount: string;
  refillRequestId: string;
  refill: RefillResult;
  settlement: unknown;
  /** Encoded PAYMENT-RESPONSE when the route settled; null when the reconciler found it on chain. */
  paymentResponse: string | null;
  source: "route" | "reconciler";
  label: string;
  recordedAt: string;
};

/**
 * The transaction the facilitator reported, recorded before the room is credited. The reconciler
 * credits only this transaction, so a misreported hash can never credit one payment twice.
 */
export type FundingSettlement = {
  kind: "fork-night/x402-settlement/v1";
  intentId: string;
  network: Testnet;
  transaction: string;
  refillRequestId: string;
  recordedAt: string;
};

export type SettledPayment = {
  transaction: string;
  settlement: unknown;
  paymentResponse: string | null;
  source: FundingReceipt["source"];
  /** The ID already bound to this payment by its settlement record; derived from the transaction when absent. */
  refillRequestId?: string;
};

/** Credits the room once for a settled payment, then records the receipt. Shared by route and reconciler. */
export async function creditSettledPayment(
  deps: { store: ReceiptStore; ledger: FundingLedger; now: () => Date },
  intent: FundingIntent,
  paid: SettledPayment,
) {
  const network = intent.key.network;
  const requestId = paid.refillRequestId ?? refillRequestId(network, paid.transaction);
  const refill = await deps.ledger.refill(requestId, intent.roomId, intent.stewardProfileId);
  return keepFirst<FundingReceipt>(deps.store, recordPaths(intent.intentId, intent.roomId).receipt, {
    kind: "fork-night/x402-receipt/v1",
    intentId: intent.intentId,
    roomId: intent.roomId,
    network,
    transaction: paid.transaction,
    explorerUrl: explorerUrl(network, paid.transaction),
    payer: intent.payer,
    payTo: intent.payTo,
    asset: intent.asset,
    amount: intent.amount,
    refillRequestId: requestId,
    refill,
    settlement: paid.settlement,
    paymentResponse: paid.paymentResponse,
    source: paid.source,
    label: TESTNET_LABEL,
    recordedAt: deps.now().toISOString(),
  });
}

/** Top-ups that hold a ceiling slot: every intent except ones the chain showed can no longer settle. */
export async function activeTopUps(store: ReceiptStore, roomId: string, except?: string) {
  let active = 0;
  for (const name of await store.list(`x402/rooms/${roomId}`)) {
    const id = name.replace(/\.json$/, "");
    if (!INTENT_ID_PATTERN.test(id) || id === except) continue;
    const paths = recordPaths(id, roomId);
    const [receipt, expired] = await Promise.all([store.read(paths.receipt), store.read(paths.expired)]);
    if (expired && !receipt) continue;
    active += 1;
  }
  return active;
}

/** Append-only evidence for anything short of a credited receipt. Never decides an outcome. */
export async function recordEvent(
  store: ReceiptStore,
  intentId: string,
  kind: string,
  at: Date,
  detail: Record<string, unknown>,
) {
  const path = `x402/events/${intentId}/${at.toISOString().replace(/[:.]/g, "-")}-${kind}.json`;
  try {
    await store.create(path, recordBytes({ kind, at: at.toISOString(), ...detail }));
  } catch (error) {
    console.warn(`x402: could not record ${kind} for ${intentId.slice(0, 12)}`, (error as Error).message);
  }
}

export async function readIntent(store: ReceiptStore, id: string) {
  return readRecord<FundingIntent>(store, `x402/intents/${id}.json`);
}
