import type { FundingLedger } from "../x402/ledger.ts";
import { keepFirst, readRecord, type ReceiptStore } from "../x402/store.ts";
import type { ChainReader } from "./chain.ts";
import {
  INTENT_ID_PATTERN,
  MPP_TOP_UP,
  MODERATO_TEST_TOKENS,
  TEMPO_MODERATO,
  TRANSACTION_PATTERN,
  mppExplorerUrl,
  mppIntentId,
  mppRecordPaths,
  mppRefillRequestId,
  normalizeHash,
  sameAddress,
} from "./ids.ts";
import {
  creditMppPayment,
  readMppIntent,
  type MppExpired,
  type MppReceipt,
  type MppSettlement,
} from "./records.ts";

export type MppReconcileOutcome = "skipped" | "paid" | "credited" | "unpayable" | "expired" | "pending" | "error";
export type MppReconcileEntry = {
  id: string;
  room: string | null;
  outcome: MppReconcileOutcome;
  transaction: string | null;
  explorerUrl: string | null;
  reason: string;
};
export type MppReconcileReport = {
  apply: boolean;
  network: typeof TEMPO_MODERATO;
  checkedAt: string;
  errors: number;
  counts: Partial<Record<MppReconcileOutcome, number>>;
  intents: MppReconcileEntry[];
};
type Deps = {
  store: ReceiptStore;
  ledger: FundingLedger;
  chain: ChainReader;
  now: () => Date;
  apply: boolean;
  /** Read-only second look at intents already marked expired (never written, never credited): flags a false expiry. */
  recheckExpired?: boolean;
};

/**
 * Resolves MPP intents that have neither a receipt nor an expired marker, from chain evidence only.
 * Without apply nothing is written. With apply, a paid intent gets its room pointer and settlement record
 * (bound to the transaction the intent recorded), then the route's own idempotent credit (the same refill
 * request ID); a provably unpayable one gets its expired marker. recheckExpired re-reads expired intents
 * and reports any the chain now shows paid, without writing.
 */
export async function reconcileMppIntents(deps: Deps): Promise<MppReconcileReport> {
  const intents: MppReconcileEntry[] = [];
  for (const name of (await deps.store.list("mpp/intents")).sort()) {
    const id = name.replace(/\.json$/, "");
    if (`${id}.json` === name && INTENT_ID_PATTERN.test(id)) intents.push(await reconcileOne(deps, id));
  }
  const counts: MppReconcileReport["counts"] = {};
  for (const { outcome } of intents) counts[outcome] = (counts[outcome] ?? 0) + 1;
  return { apply: deps.apply, network: TEMPO_MODERATO, checkedAt: deps.now().toISOString(), errors: counts.error ?? 0, counts, intents };
}

async function reconcileOne(deps: Deps, id: string): Promise<MppReconcileEntry> {
  let room: string | null = null;
  const entry = (outcome: MppReconcileOutcome, reason: string, transaction: string | null = null): MppReconcileEntry => ({
    id: id.slice(0, 12),
    room,
    outcome,
    transaction,
    explorerUrl: transaction ? mppExplorerUrl(transaction) : null,
    reason,
  });
  try {
    const intent = await readMppIntent(deps.store, id);
    if (!intent || intent.kind !== "fork-night/mpp-intent/v1" || intent.intentId !== id || intent.network !== TEMPO_MODERATO ||
        typeof intent.challengeId !== "string" || mppIntentId(intent.challengeId) !== id)
      return entry("error", "The intent record is unreadable or does not match its challenge.");
    room = intent.roomId;
    if (intent.amount !== MPP_TOP_UP.atomic || !Object.values(MODERATO_TEST_TOKENS).some((token) => sameAddress(token, intent.currency)) ||
        !TRANSACTION_PATTERN.test(String(intent.transaction)) || !Number.isInteger(intent.validBefore) ||
        !Number.isFinite(Date.parse(intent.createdAt)))
      return entry("error", "The intent is not a 1.00 test USD top-up on Tempo Moderato.");
    const paths = mppRecordPaths(id, intent.roomId);
    const receipt = await readRecord<MppReceipt>(deps.store, paths.receipt);
    if (receipt) return entry("skipped", `Already credited by the ${receipt.source}.`, receipt.transaction);
    if (await deps.store.read(paths.expired)) {
      if (!deps.recheckExpired) return entry("skipped", "Already marked expired: nothing was charged; signing a new payment is safe.");
      const again = await deps.chain.inspect(intent);
      if (again.status === "unpayable") return entry("skipped", "Still expired: the chain shows nothing that pays it.");
      return entry("error", again.status === "paid"
        ? `It was marked expired, but the chain now shows it paid by ${normalizeHash(again.transaction)}; check by hand (it is never credited automatically).`
        : `It was marked expired; check by hand, because the chain now says: ${again.reason}`, intent.transaction);
    }

    const verdict = await deps.chain.inspect(intent);
    if (verdict.status === "pending")
      return entry(verdict.handCheck ? "error" : "pending", verdict.reason, intent.transaction);
    if (verdict.status === "paid") {
      const onChain = normalizeHash(verdict.transaction);
      if (!TRANSACTION_PATTERN.test(onChain)) return entry("error", "The chain reader returned a malformed transaction.");
      // MS-3: only the transaction this intent recorded before the broadcast can credit it.
      if (onChain !== normalizeHash(intent.transaction))
        return entry("error", `The chain shows ${onChain}, not the transaction this payment recorded (${intent.transaction}); check by hand.`, onChain);
      const requestId = mppRefillRequestId(onChain);
      // The route may already have bound a transaction; another hash must never credit this intent again.
      const mismatch = (bound: MppSettlement | null) => {
        if (!bound) return null;
        const recorded = normalizeHash(String(bound.transaction));
        return recorded !== onChain || bound.refillRequestId !== requestId
          ? entry("error", `The route recorded ${recorded} for this payment, but the chain shows ${onChain}; check by hand.`, onChain)
          : null;
      };
      const earlier = mismatch(await readRecord<MppSettlement>(deps.store, paths.settlement));
      if (earlier) return earlier;
      if (!deps.apply) return entry("paid", "Paid on chain; --apply credits the room.", onChain);
      // As in the route: the room pointer (its slot of the MPP limit) and the settlement record before any credit.
      await keepFirst(deps.store, paths.roomIndex, { intentId: id, roomId: intent.roomId });
      const bound = await keepFirst<MppSettlement>(deps.store, paths.settlement, {
        kind: "fork-night/mpp-settlement/v1",
        intentId: id,
        network: TEMPO_MODERATO,
        transaction: onChain,
        refillRequestId: requestId,
        via: "chain",
        recordedAt: deps.now().toISOString(),
      });
      const raced = mismatch(bound);
      if (raced) return raced;
      const credited = await creditMppPayment(deps, intent, {
        transaction: onChain,
        settlement: verdict.evidence,
        paymentReceipt: null,
        source: "reconciler",
        refillRequestId: requestId,
      });
      const done = credited.refill.replayed ? "The earlier refill was replayed" : "The room was credited";
      return entry("credited", `${done}; the receipt is recorded.`, credited.transaction);
    }
    if (!deps.apply) return entry("unpayable", `${verdict.reason} --apply marks it expired.`, intent.transaction);
    await keepFirst<MppExpired>(deps.store, paths.expired, {
      kind: "fork-night/mpp-expired/v1",
      intentId: id,
      roomId: intent.roomId,
      network: TEMPO_MODERATO,
      reason: verdict.reason,
      evidence: verdict.evidence,
      recordedAt: deps.now().toISOString(),
    });
    return entry("expired", `${verdict.reason} Nothing was charged; signing a new payment is safe.`, intent.transaction);
  } catch (error) {
    return entry("error", (error as Error).message);
  }
}
