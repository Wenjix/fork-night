import type { KeyObject } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { PrivyApiError, type PrivyRest } from "../privy/rest.ts";
import { DelegationRefused, privyX402Signer } from "../privy/x402-signer.ts";
import { loadFundingConfig } from "../x402/config.ts";
import { BASE_SEPOLIA, TOP_UP, explorerUrl, intentId, recordPaths, TESTNET_USDC } from "../x402/ids.ts";
import type { FundingSummary, PaymentAttempt, fundRoom, resumeAttempt } from "../x402/payer.ts";
import type { FundingReceipt } from "../x402/records.ts";
import type { ReceiptStore } from "../x402/store.ts";
import type { JobRecord } from "./job-types.ts";
import {
  SessionRefused,
  reservePayment,
  sessionBlock,
  sessionPath,
  updateReservation,
  type DelegationSession,
  type Reservation,
} from "./session.ts";
import type { NightWatchStore } from "./store.ts";

/**
 * The Night Watch's one capped room top-up: 1.00 test USDC on Base Sepolia through the local x402
 * door, signed by the maker's Privy wallet through the Night Watch signer.
 *
 * Every payment is reserved in the session before anything is signed. A signed payment is only
 * ever re-sent (resumed), never signed again, while it can still settle; a reservation is released
 * only when the payment provably did not settle.
 */

/** Longest authorization the signer accepts, measured from the moment it signs. */
export const SIGNER_LIFETIME_SECONDS = 150;
const RESUME_MARGIN_SECONDS = 6;
const RECONCILE = "Run npm run x402:reconcile -- --apply; the Night Watch will not sign again while this payment can settle.";

export type Door = { url: string; payTo: string };
export type ReconciledPayment =
  | { state: "credited"; transaction: string; explorerUrl: string; creditsAdded: number }
  | { state: "expired" };

export type TopUpDeps = {
  store: NightWatchStore;
  now: () => Date;
  privy: Pick<PrivyRest, "signTypedData"> | null;
  authorizationKey: KeyObject | null;
  fundRoom: typeof fundRoom;
  resumeAttempt: typeof resumeAttempt;
  readAgentToken: () => Promise<string | null>;
  /** The room's local door URL (it contains the private funding reference: never log it). */
  door: (roomId: string) => Promise<Door | null>;
  /** What the reconciler recorded for a payment whose window passed, if it has. */
  reconciled?: (payment: { payer: string; nonce: string }) => Promise<ReconciledPayment | null>;
  /** USDC's own record (EIP-3009 `authorizationState`): true once an authorization was used, false while unused. */
  authorizationUsed?: (payment: { payer: string; nonce: string }) => Promise<boolean | null>;
};

export type TopUpResult =
  | {
      kind: "credited";
      reservationId: string;
      transaction: string | null;
      explorerUrl: string | null;
      creditsAdded: number;
      recordFile: string | null;
      message: string;
    }
  | { kind: "waiting"; reservationId: string; recordFile: string | null; retryInSeconds: number; message: string }
  | { kind: "blocked"; reservationId: string | null; message: string };

export const paymentRecordDir = (store: NightWatchStore) => join(store.root, "payments");

/** Hides the door's private funding reference in anything shown or logged. */
export const redact = (text: string) => text.replace(/\/api\/x402\/fund\/[A-Za-z0-9_-]+/g, "/api/x402/fund/…");

/** The local door for a room: `<origin>/api/x402/fund/<ref>` from the operator's x402 funding config. */
export function fundingDoor(origin = process.env.NIGHT_WATCH_DOOR_ORIGIN ?? "http://127.0.0.1:3005", load = loadFundingConfig) {
  return async (roomId: string): Promise<Door | null> => {
    const config = await load();
    const reference = config && Object.entries(config.rooms).find(([, room]) => room.roomId === roomId)?.[0];
    const payTo = config?.payTo[BASE_SEPOLIA];
    if (!reference || !payTo) return null;
    return { url: `${origin.replace(/\/+$/, "")}/api/x402/fund/${reference}`, payTo };
  };
}

/** Reads the door's own receipt or expired marker for a payment (read-only), as the reconciler leaves them. */
export function reconciledFromReceipts(receipts: ReceiptStore, roomId: string) {
  return async ({ payer, nonce }: { payer: string; nonce: string }): Promise<ReconciledPayment | null> => {
    const paths = recordPaths(intentId({ network: BASE_SEPOLIA, payer, nonce }), roomId);
    const receipt = await receipts.read(paths.receipt);
    if (receipt) {
      const parsed = JSON.parse(receipt.toString("utf8")) as FundingReceipt;
      return { state: "credited", transaction: parsed.transaction, explorerUrl: parsed.explorerUrl, creditsAdded: parsed.refill?.added ?? TOP_UP.credits };
    }
    return (await receipts.read(paths.expired)) ? { state: "expired" } : null;
  };
}

const openFor = (session: DelegationSession, jobId: string) =>
  session.reservations.filter((item) => item.jobId === jobId && (item.state === "reserved" || item.state === "signed")).at(-1);

function noted(reservation: Reservation) {
  const nonce = /nonce=(0x[0-9a-f]{64})/i.exec(reservation.note ?? "")?.[1]?.toLowerCase() ?? null;
  const validBefore = Number(/validBefore=([0-9]{1,20})/.exec(reservation.note ?? "")?.[1] ?? Number.NaN);
  return { nonce, validBefore: Number.isSafeInteger(validBefore) ? validBefore : null };
}

async function readAttempt(file: string): Promise<PaymentAttempt | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as PaymentAttempt;
  } catch {
    return null;
  }
}

/** The payer's record for a signed nonce, when the job lost track of it (interrupted before saving). */
async function findAttempt(store: NightWatchStore, nonce: string): Promise<string | null> {
  const directory = paymentRecordDir(store);
  const names = await readdir(directory).catch(() => [] as string[]);
  for (const name of names.filter((entry) => entry.endsWith(".json")).sort()) {
    const attempt = await readAttempt(join(directory, name));
    if (attempt?.evmNonce?.toLowerCase() === nonce) return join(directory, name);
  }
  return null;
}

function creditedFromAttempt(attempt: PaymentAttempt) {
  const reply = (attempt.response && typeof attempt.response === "object" ? attempt.response : {}) as Record<string, unknown>;
  const candidate = typeof reply.transaction === "string" ? reply.transaction : attempt.settlement?.transaction;
  const transaction = typeof candidate === "string" && /^0x[0-9a-fA-F]{64}$/.test(candidate) ? candidate : null;
  return {
    transaction,
    explorerUrl: transaction ? explorerUrl(BASE_SEPOLIA, transaction) : null,
    creditsAdded: typeof reply.added === "number" ? reply.added : TOP_UP.credits,
  };
}

async function settle(deps: TopUpDeps, session: DelegationSession, reservationId: string, credited: { transaction: string | null; explorerUrl: string | null; creditsAdded: number }, recordFile: string | null): Promise<TopUpResult> {
  await updateReservation(
    deps.store,
    session.id,
    reservationId,
    { state: "settled", transaction: credited.transaction, explorerUrl: credited.explorerUrl, creditsAdded: credited.creditsAdded, ...(recordFile ? { recordFile } : {}) },
    deps.now(),
  );
  return {
    kind: "credited",
    reservationId,
    ...credited,
    recordFile,
    message: `Added ${credited.creditsAdded} test credits to the room with one top-up of 1.00 test USDC.`,
  };
}

async function release(deps: TopUpDeps, session: DelegationSession, reservationId: string, note: string, message: string): Promise<TopUpResult> {
  await updateReservation(deps.store, session.id, reservationId, { state: "released", note: note.slice(0, 300) }, deps.now());
  return { kind: "blocked", reservationId, message };
}

type Ready =
  | { ok: false; problem: string }
  | { ok: true; agentToken: string; door: Door; privy: Pick<PrivyRest, "signTypedData">; authorizationKey: KeyObject };

/** Before anything is reserved: everything the payment needs on this machine. */
async function prerequisites(deps: TopUpDeps, job: JobRecord, session: DelegationSession): Promise<Ready> {
  const block = sessionBlock(session, deps.now());
  if (block) return { ok: false, problem: `${block.message} Nothing was signed.` };
  if (!deps.privy || !deps.authorizationKey)
    return { ok: false, problem: "Privy signing is not set up on this machine (scripts/night-watch-privy.ts setup). Nothing was signed." };
  const agentToken = await deps.readAgentToken();
  if (!agentToken) return { ok: false, problem: "The local x402 agent token is missing (npm run x402:setup -- init). Nothing was signed." };
  const door = await deps.door(job.roomId);
  if (!door) return { ok: false, problem: "This room has no local test-credit door on this machine (npm run x402:setup). Nothing was signed." };
  if (door.payTo.toLowerCase() !== session.limits.payTo.toLowerCase())
    return { ok: false, problem: "The room's door now pays a different address than the maker approved. Nothing was signed." };
  return { ok: true, agentToken, door, privy: deps.privy, authorizationKey: deps.authorizationKey };
}

function refusalMessage(error: unknown) {
  if (error instanceof DelegationRefused) return `The Night Watch signer refused: ${error.message} Nothing was signed.`;
  if (error instanceof PrivyApiError)
    return error.policyDenied ? `Privy refused the signature: ${error.message}. Nothing was paid.` : `Privy could not sign the top-up: ${error.message}. Nothing was paid.`;
  if (error instanceof SessionRefused) return `${error.message} Nothing was signed.`;
  const message = error instanceof Error ? error.message : String(error);
  return `The top-up could not start: ${redact(message).slice(0, 240)}`;
}

/** Maps a payer outcome onto the reservation. Pending and unknown keep the signed payment for resuming. */
async function applySummary(deps: TopUpDeps, session: DelegationSession, reservationId: string, summary: FundingSummary): Promise<TopUpResult> {
  switch (summary.outcome) {
    case "credited":
      return settle(
        deps,
        session,
        reservationId,
        { transaction: summary.transaction, explorerUrl: summary.explorerUrl, creditsAdded: summary.credits?.added ?? TOP_UP.credits },
        summary.recordFile,
      );
    case "pending":
    case "unknown":
      await updateReservation(deps.store, session.id, reservationId, { state: "signed", ...(summary.recordFile ? { recordFile: summary.recordFile } : {}) }, deps.now());
      return {
        kind: "waiting",
        reservationId,
        recordFile: summary.recordFile,
        retryInSeconds: 10,
        message: "The top-up is signed and waiting for the room's answer. It will be re-sent, never signed again.",
      };
    default:
      return release(deps, session, reservationId, `${summary.outcome}: ${summary.message}`, summary.message);
  }
}

/**
 * Buys one room top-up for a job. A job whose payment is already signed is resumed instead: this
 * never calls the payer again while a signed payment can settle.
 */
export async function runTopUp(deps: TopUpDeps, job: JobRecord, session: DelegationSession): Promise<TopUpResult> {
  // A crash after settling but before the job was saved: use that top-up, never buy another.
  const unrecorded = session.reservations.find((item) => item.jobId === job.id && item.state === "settled" && item.id !== job.reservationId);
  if (unrecorded)
    return {
      kind: "credited",
      reservationId: unrecorded.id,
      transaction: unrecorded.transaction ?? null,
      explorerUrl: unrecorded.explorerUrl ?? null,
      creditsAdded: unrecorded.creditsAdded ?? TOP_UP.credits,
      recordFile: unrecorded.recordFile ?? null,
      message: "The top-up had already added test credits to the room.",
    };
  let reservation = openFor(session, job.id);
  if (reservation?.state === "signed") return resumeTopUp(deps, job, session);

  const ready = await prerequisites(deps, job, session);
  if (!ready.ok) {
    if (reservation) await updateReservation(deps.store, session.id, reservation.id, { state: "released", note: ready.problem }, deps.now());
    return { kind: "blocked", reservationId: reservation?.id ?? null, message: ready.problem };
  }
  if (!reservation) {
    try {
      reservation = (await reservePayment(deps.store, session.id, { jobId: job.id, amountAtomic: TOP_UP.atomic, now: deps.now() })).reservation;
    } catch (error) {
      if (error instanceof SessionRefused) return { kind: "blocked", reservationId: null, message: refusalMessage(error) };
      throw error;
    }
  }
  const reservationId = reservation.id;
  const signer = privyX402Signer({
    privy: ready.privy,
    walletId: session.privy.walletId,
    authorizationKey: ready.authorizationKey,
    bounds: {
      walletAddress: session.privy.walletAddress,
      chainId: session.limits.chainId,
      token: session.limits.token,
      payTo: session.limits.payTo,
      maxAmount: BigInt(session.limits.maxPaymentAtomic),
      deadline: Math.floor(Date.parse(session.deadline) / 1000),
      maxLifetimeSeconds: SIGNER_LIFETIME_SECONDS,
    },
    now: () => Math.floor(deps.now().getTime() / 1000),
    // The last check before Privy signs: the maker may have revoked since the job started.
    beforeSign: async (typedData) => {
      const note = `nonce=${String(typedData.message.nonce)} validBefore=${String(typedData.message.validBefore)}`;
      try {
        // Atomic with a revocation: the session is re-checked under the lock that marks this signed.
        await updateReservation(deps.store, session.id, reservationId, { state: "signed", note }, deps.now(), { requireOpen: true });
      } catch (error) {
        if (error instanceof SessionRefused) throw new DelegationRefused(error.message);
        throw error;
      }
    },
  });
  let summary: FundingSummary;
  try {
    summary = await deps.fundRoom({
      network: BASE_SEPOLIA,
      signer,
      url: ready.door.url,
      recordDir: paymentRecordDir(deps.store),
      agentToken: ready.agentToken,
      expected: { payTo: session.limits.payTo },
    });
  } catch (error) {
    // The payer throws only before the paid request is sent, so nothing can settle.
    return release(deps, session, reservationId, refusalMessage(error), refusalMessage(error));
  }
  return applySummary(deps, session, reservationId, summary);
}

/** Follows a signed payment to its outcome by re-sending the saved payment or reading the reconciler's result. */
export async function resumeTopUp(deps: TopUpDeps, job: JobRecord, session: DelegationSession): Promise<TopUpResult> {
  const reservation =
    (job.reservationId ? session.reservations.find((item) => item.id === job.reservationId) : undefined) ?? openFor(session, job.id);
  if (!reservation) return { kind: "blocked", reservationId: null, message: "This job has no top-up in progress. Nothing was signed." };
  if (reservation.state === "settled")
    return {
      kind: "credited",
      reservationId: reservation.id,
      transaction: reservation.transaction ?? null,
      explorerUrl: reservation.explorerUrl ?? null,
      creditsAdded: reservation.creditsAdded ?? TOP_UP.credits,
      recordFile: reservation.recordFile ?? null,
      message: "The top-up had already added test credits to the room.",
    };
  if (reservation.state === "released")
    return { kind: "blocked", reservationId: reservation.id, message: "The top-up did not settle; nothing was charged." };
  if (reservation.state === "reserved") return runTopUp(deps, job, session);

  const { nonce, validBefore } = noted(reservation);
  const recordFile = job.paymentRecordFile ?? reservation.recordFile ?? (nonce ? await findAttempt(deps.store, nonce) : null);
  const nowSeconds = Math.floor(deps.now().getTime() / 1000);
  if (!recordFile) {
    // Signed (or about to be) but never saved by the payer, so it was never sent and cannot settle.
    const expires = validBefore ?? Math.floor(Date.parse(reservation.updatedAt) / 1000) + SIGNER_LIFETIME_SECONDS;
    if (nowSeconds > expires + 30)
      return release(deps, session, reservation.id, "signed but never sent; expired", "The signed top-up was never sent and has expired; nothing was charged.");
    return { kind: "waiting", reservationId: reservation.id, recordFile: null, retryInSeconds: Math.max(5, expires + 31 - nowSeconds), message: "Waiting for an unsent authorization to expire before deciding. Nothing new is signed." };
  }
  const attempt = await readAttempt(recordFile);
  if (!attempt) return { kind: "waiting", reservationId: reservation.id, recordFile, retryInSeconds: 60, message: `The payment record could not be read. ${RECONCILE}` };
  if (attempt.state === "credited") return settle(deps, session, reservation.id, creditedFromAttempt(attempt), recordFile);
  if (attempt.state === "expired") return release(deps, session, reservation.id, "expired before it settled", "The top-up expired before it settled; nothing was charged.");
  if (attempt.state === "refused" && (attempt.sends ?? 1) <= 1)
    return release(deps, session, reservation.id, "refused by the room", "The room refused the top-up; nothing settled.");
  if (attempt.state === "rejected" && (attempt.sends ?? 1) <= 1)
    return release(deps, session, reservation.id, "rejected by the room", "The room rejected the top-up; it did not settle.");

  const deadline = Number(attempt.validBefore ?? validBefore ?? 0);
  if (attempt.state !== "rejected" && attempt.state !== "refused" && nowSeconds + RESUME_MARGIN_SECONDS < deadline) {
    const agentToken = await deps.readAgentToken();
    if (!agentToken) return { kind: "waiting", reservationId: reservation.id, recordFile, retryInSeconds: 10, message: "The local x402 agent token is missing; the signed top-up waits to be re-sent." };
    let summary: FundingSummary;
    try {
      summary = await deps.resumeAttempt(recordFile, { agentToken });
    } catch {
      const latest = await readAttempt(recordFile);
      if (latest?.state === "credited") return settle(deps, session, reservation.id, creditedFromAttempt(latest), recordFile);
      return { kind: "waiting", reservationId: reservation.id, recordFile, retryInSeconds: 30, message: `The signed top-up could not be re-sent just now. ${RECONCILE}` };
    }
    // A re-sent payment the room rejects or refuses may still have settled from an earlier send.
    if (summary.outcome === "rejected" || summary.outcome === "refused")
      return { kind: "waiting", reservationId: reservation.id, recordFile, retryInSeconds: 60, message: `The room declined a re-sent top-up that may already have settled. ${RECONCILE}` };
    return applySummary(deps, session, reservation.id, { ...summary, recordFile });
  }

  const payer = attempt.payer ?? session.privy.walletAddress;
  const outcome = nonce || attempt.evmNonce ? await deps.reconciled?.({ payer, nonce: (attempt.evmNonce ?? nonce)! }) : null;
  if (outcome?.state === "credited") return settle(deps, session, reservation.id, outcome, recordFile);
  if (outcome?.state === "expired")
    return release(deps, session, reservation.id, "the reconciler marked it expired", "The top-up expired before it settled; nothing was charged.");
  // Past the window plus a margin, an authorization USDC never used can no longer settle.
  const usedNonce = attempt.evmNonce ?? nonce;
  if (usedNonce && deadline && nowSeconds > deadline + 30 && deps.authorizationUsed) {
    const used = await deps.authorizationUsed({ payer, nonce: usedNonce }).catch(() => null);
    if (used === false)
      return release(deps, session, reservation.id, "expired unused on Base Sepolia", "The top-up's authorization expired unused on Base Sepolia; nothing was charged.");
    if (used === true)
      return { kind: "waiting", reservationId: reservation.id, recordFile, retryInSeconds: 120, message: `USDC shows this authorization was used, but the room has no record of it yet. ${RECONCILE}` };
  }
  return { kind: "waiting", reservationId: reservation.id, recordFile, retryInSeconds: 60, message: `The top-up's payment window passed without a definite answer. ${RECONCILE}` };
}

/** Reads Base Sepolia USDC's `authorizationState(authorizer, nonce)`; null when it cannot be read. */
export function baseSepoliaAuthorizationState(rpcUrl = "https://sepolia.base.org") {
  return async ({ payer, nonce }: { payer: string; nonce: string }): Promise<boolean | null> => {
    const data = `0xe94a0102${payer.toLowerCase().replace(/^0x/, "").padStart(64, "0")}${nonce.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: TESTNET_USDC[BASE_SEPOLIA], data }, "latest"] }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await response.json().catch(() => null)) as { result?: string } | null;
    if (!body?.result || !/^0x[0-9a-f]{64}$/i.test(body.result)) return null;
    return BigInt(body.result) !== 0n;
  };
}
