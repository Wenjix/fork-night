import { isUuid } from "../lib/pilot.ts";
import { canonicalJson } from "../experiments/storage.ts";
import type { MppChallenge } from "../mpp/adapter.ts";
import type { PresentedCharge } from "../mpp/funding.ts";
import { MPP_TOP_UP, PATHUSD, TEMPO_MODERATO, mppIntentId, mppRecordPaths, mppRefillRequestId, sameAddress } from "../mpp/ids.ts";
import type { MppReceipt } from "../mpp/records.ts";

export const WREN_FUNDING = {
  roomId: "kessler-ward",
  steward: "0x951c8D90d0D1e81351ED802178823C60cce3BD98",
  payTo: "0x3B02f4be77C010d872Ace7149051003AB9855Ca1",
  currency: PATHUSD,
  network: TEMPO_MODERATO,
  allowanceAtomic: "2000000",
  periodSeconds: 86400,
} as const;

export type WrenCreditsInput = {
  requestId: string;
  roomId: string;
  claimToken: string;
  actorId: string;
  requiredCredits: 1;
};
export type WrenCredits = { state: "ready" | "pending" | "blocked"; receiptId?: string; message?: string };
export type WrenFundingPolicy = {
  enabled: boolean;
  room_id: string;
  network: string;
  steward: string;
  pay_to: string;
  currency: string;
  access_key: string;
  authorized_at: string;
  expires_at: string;
  authorization_tx: string;
  allowance_atomic: number;
  period_seconds: number;
  topups_per_day: number;
};
export type WrenPayment = {
  kind: "wren/hosted-mpp-payment/v1";
  roomId: string;
  actorId: string;
  network: typeof TEMPO_MODERATO;
  credential: string;
  transaction: string;
  intentId: string;
  payer: string;
  payTo: string;
  currency: string;
  amount: string;
  validBefore: number;
};
export type WrenPaymentRow = {
  id: string;
  request_id: string;
  room_id: string;
  actor_id: string;
  state: "claimed" | "signed" | "pending" | "credited" | "blocked";
  payment: WrenPayment | null;
  receipt_id: string | null;
  message: string | null;
};
export type WrenFundingPreflight = {
  roomId: string;
  actorId: string;
  policy: WrenFundingPolicy;
  creditsReady: boolean;
  budgetReady: boolean;
};
export type WrenPaymentClaim = {
  state: "ready" | "pending" | "blocked" | "claimed" | "existing";
  message?: string;
  payment?: WrenPaymentRow;
};

/** All writes are fenced by the current database request claim. */
export interface WrenFundingDeps {
  preflight(input: WrenCreditsInput): Promise<WrenFundingPreflight>;
  claim(input: WrenCreditsInput): Promise<WrenPaymentClaim>;
  save(input: WrenCreditsInput, state: WrenPaymentRow["state"], payment: WrenPayment | null, receiptId?: string, message?: string): Promise<WrenPaymentRow>;
  offer(input: WrenCreditsInput, policy: WrenFundingPolicy): Promise<MppChallenge>;
  /** Reads live metadata, limits and scopes; signs one pull payment, never broadcasts. */
  sign(challenge: MppChallenge, policy: WrenFundingPolicy): Promise<string>;
  inspectSigned(input: WrenCreditsInput, credential: string): Promise<PresentedCharge>;
  pay(input: WrenCreditsInput, payment: WrenPayment): Promise<void>;
  receipt(payment: WrenPayment): Promise<MppReceipt | null>;
  now?: () => number;
}

const blocked = (message: string): WrenCredits => ({ state: "blocked", message });
const pending = (): WrenCredits => ({ state: "pending", message: "Wren's test-credit payment is being checked. No second payment was made." });

export function validWrenFundingPolicy(policy: WrenFundingPolicy, now: number) {
  const authorized = Date.parse(policy.authorized_at), expires = Date.parse(policy.expires_at);
  return policy.enabled === true && policy.room_id === WREN_FUNDING.roomId && policy.network === TEMPO_MODERATO
    && sameAddress(policy.steward, WREN_FUNDING.steward) && sameAddress(policy.pay_to, WREN_FUNDING.payTo)
    && sameAddress(policy.currency, PATHUSD) && /^0x[0-9a-fA-F]{40}$/.test(policy.access_key)
    && /^0x[0-9a-fA-F]{64}$/.test(policy.authorization_tx)
    && policy.allowance_atomic === 2000000 && policy.period_seconds === 86400 && policy.topups_per_day === 1
    && Number.isFinite(authorized) && authorized <= now && expires > now && expires <= authorized + 86400_000;
}

function paymentMatches(payment: WrenPayment, input: WrenCreditsInput) {
  return payment.kind === "wren/hosted-mpp-payment/v1" && payment.roomId === input.roomId && payment.actorId === input.actorId
    && payment.network === TEMPO_MODERATO && sameAddress(payment.payer, WREN_FUNDING.steward)
    && sameAddress(payment.payTo, WREN_FUNDING.payTo) && sameAddress(payment.currency, PATHUSD)
    && payment.amount === MPP_TOP_UP.atomic && /^0x[0-9a-f]{64}$/.test(payment.transaction)
    && /^[0-9a-f]{64}$/.test(payment.intentId) && payment.credential.startsWith("Payment ")
    && Number.isSafeInteger(payment.validBefore) && payment.validBefore > 0;
}

function receiptMatches(receipt: MppReceipt, payment: WrenPayment) {
  return receipt.kind === "fork-night/mpp-receipt/v1" && receipt.intentId === payment.intentId
    && receipt.roomId === payment.roomId && receipt.network === TEMPO_MODERATO && receipt.transaction === payment.transaction
    && sameAddress(receipt.payer, payment.payer) && sameAddress(receipt.payTo, payment.payTo)
    && sameAddress(receipt.currency, payment.currency) && receipt.amount === MPP_TOP_UP.atomic
    && receipt.refillRequestId === mppRefillRequestId(payment.transaction) && receipt.refill.added === 5;
}

/**
 * Uses room credits first. A real MPP purchase is persisted before broadcast,
 * confirmed by the existing seller, and accepted only with its durable receipt.
 * An ambiguous payment permanently blocks replacement signing until reconciled.
 */
export async function ensureWrenCredits(input: WrenCreditsInput, provided?: WrenFundingDeps): Promise<WrenCredits> {
  if (input.roomId !== WREN_FUNDING.roomId || input.requiredCredits !== 1 || !isUuid(input.requestId)
      || !isUuid(input.actorId) || !isUuid(input.claimToken))
    return blocked("Choose a saved Kessler Ward request before asking Wren to buy credits.");
  let deps: WrenFundingDeps;
  try {
    deps = provided ?? await import("./wren-funding-runtime.ts").then((module) => module.wrenFundingDeps());
  } catch {
    return blocked("Wren's hosted test-credit purchase is not configured.");
  }
  let payment: WrenPayment | null = null;
  let claimed = false;
  try {
    const preflight = await deps.preflight(input);
    if (preflight.roomId !== input.roomId || preflight.actorId !== input.actorId)
      return blocked("This Wren request belongs to another room or maker.");
    // claim() returns an existing payment before checking current policy or
    // balance: a previous signed payment must be resolved even after expiry.
    const admission = await deps.claim(input);
    if (admission.state === "ready")
      return preflight.budgetReady ? { state: "ready" } : blocked("The existing inference allowance cannot cover this preview.");
    if (admission.state === "blocked") return blocked(admission.message ?? "Wren cannot buy credits under the current allowance.");
    if (admission.state === "pending") return pending();
    const row = admission.payment;
    if (!row || row.request_id !== input.requestId || row.room_id !== input.roomId || row.actor_id !== input.actorId)
      return blocked("The saved test-credit payment could not be verified.");
    claimed = true;
    payment = row.payment;
    if (row.state === "blocked") return blocked(row.message ?? "This test-credit purchase needs operator review.");
    if (payment && !paymentMatches(payment, input)) return pending();
    if (!payment) {
      if (!preflight.budgetReady || !validWrenFundingPolicy(preflight.policy, (deps.now ?? Date.now)())) {
        await deps.save(input, "blocked", null, undefined, "Wren needs a current, explicitly authorized testnet allowance.");
        return blocked("Wren needs a current, explicitly authorized testnet allowance before buying credits.");
      }
      const challenge = await deps.offer(input, preflight.policy);
      const credential = await deps.sign(challenge, preflight.policy);
      const charge = await deps.inspectSigned(input, credential);
      if (charge.stale) throw new Error("The signed payment is stale.");
      payment = {
        kind: "wren/hosted-mpp-payment/v1", roomId: input.roomId, actorId: input.actorId,
        network: TEMPO_MODERATO, credential, transaction: charge.transaction, intentId: mppIntentId(charge.challengeId),
        payer: charge.payer, payTo: charge.payTo, currency: charge.currency, amount: charge.amount, validBefore: charge.validBefore,
      };
      if (!paymentMatches(payment, input)) throw new Error("The signed payment is outside this allowance.");
      const saved = await deps.save(input, "signed", payment);
      if (!saved.payment || canonicalJson(saved.payment) !== canonicalJson(payment)) return pending();
      // No network send is possible until this exact credential read back from
      // the fenced, private, durable database row.
      payment = saved.payment;
    }
    const resolve = async () => {
      const receipt = await deps.receipt(payment!);
      if (!receipt || !receiptMatches(receipt, payment!)) return null;
      const receiptId = mppRecordPaths(payment!.intentId, input.roomId).receipt;
      await deps.save(input, "credited", payment, receiptId);
      const current = await deps.preflight(input);
      return current.creditsReady && current.budgetReady
        ? { state: "ready", receiptId } as WrenCredits
        : blocked("The purchase is recorded; the current room or inference allowance cannot admit this preview.");
    };
    const recorded = await resolve();
    if (recorded) return recorded;
    if (row.state === "credited") return pending();
    await deps.pay(input, payment);
    const confirmed = await resolve();
    if (confirmed) return confirmed;
    await deps.save(input, "pending", payment, undefined, "The exact signed payment needs reconciliation; never sign another.");
    return pending();
  } catch {
    // Never copy provider/library errors into a response: signer errors may
    // include credentials. Once a credential exists, even a lost write or send
    // acknowledgement must not invite a replacement payment.
    if (payment) return pending();
    if (claimed) {
      await deps.save(input, "blocked", null, undefined, "The purchase stopped before broadcast.").catch(() => undefined);
    }
    return blocked("Wren could not prepare a test-credit purchase. The existing allowance was not expanded.");
  }
}
