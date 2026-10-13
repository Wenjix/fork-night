import { randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { AGENT_TOKEN_HEADER, AGENT_TOKEN_PATTERN } from "../x402/config.ts";
import type { Eip1193Request, MppAccount, MppAdapter, MppChallenge } from "./adapter.ts";
import {
  MODERATO_CHAIN_ID,
  MPP_COMMANDS,
  MPP_TOP_UP,
  PATHUSD,
  TEMPO_MODERATO,
  TRANSACTION_PATTERN,
  mppExplorerUrl,
  normalizeHash,
  sameAddress,
} from "./ids.ts";

export type MppAttemptState = "signed" | "credited" | "pending" | "rejected" | "expired" | "refused" | "unknown";

/** One signed payment, saved before it is sent so a lost answer is re-sent, never re-signed. */
export type MppPaymentAttempt = {
  version: 1;
  kind: "fork-night/mpp-payment/v1";
  url: string;
  network: typeof TEMPO_MODERATO;
  /** The Authorization header value. It pays exactly this offer; --resume sends it again unchanged. */
  credential: string;
  challengeId: string;
  payer: string;
  payTo: string;
  currency: string;
  amount: string;
  transaction: string;
  validBefore: number;
  createdAt: string;
  state: MppAttemptState;
  sends?: number;
  lastSentAt?: string;
  lastStatus?: number;
  lastError?: string;
  response?: unknown;
  /** The encoded Payment-Receipt header, when the room sent one. */
  paymentReceipt?: string;
};

export type MppFundingSummary = {
  status: number | null;
  outcome: Exclude<MppAttemptState, "signed"> | "declined" | "not-offered";
  network: typeof TEMPO_MODERATO;
  transaction: string | null;
  explorerUrl: string | null;
  credits: { added: number; replayed: boolean; room: unknown } | null;
  message: string;
  recordFile: string | null;
};

const OFFER_TIMEOUT_MS = 30_000;
// Covers validation, the synchronous broadcast and, on a resume, the door's chain read.
const PAYMENT_TIMEOUT_MS = 120_000;
const RECONCILE = `do not sign again; run ${MPP_COMMANDS.reconcile}`;
const AFTER_RECONCILE = "Signing a new payment is safe once the reconciler marks this one expired.";
const SIGN_AGAIN = `Signing a new payment is safe: run ${MPP_COMMANDS.fund} again.`;
const ROOM_EXPIRED = /expired before it settled/;
const STATES: MppAttemptState[] = ["signed", "credited", "pending", "rejected", "expired", "refused", "unknown"];

/** The route's local secret: sent only to loopback, never stored in a record or printed. */
function agentHeader(token: unknown) {
  if (typeof token !== "string" || !AGENT_TOKEN_PATTERN.test(token))
    throw new Error("No valid local agent token. Run npm run x402:setup -- init first; nothing was signed.");
  return { [AGENT_TOKEN_HEADER]: token };
}

function assertLocal(url: string) {
  let parsed: URL | undefined;
  try { parsed = new URL(url); } catch { parsed = undefined; }
  if (!parsed || !["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password ||
      !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname))
    throw new Error("This testnet payer only pays rooms on this machine (a loopback funding URL).");
}

type OfferedChallenge = Pick<MppChallenge, "id" | "method" | "intent" | "expires" | "request">;

/** Agent hygiene before anything is signed: only the reviewed Moderato top-up, to the configured payTo. */
export function chooseChallenge(
  challenge: OfferedChallenge,
  expected: { payTo?: string; currency?: string } = {},
  now: () => Date = () => new Date(),
): { accept: OfferedChallenge } | { declined: string } {
  if (challenge?.method !== "tempo" || challenge.intent !== "charge")
    return { declined: "The room's offer is not an MPP Tempo charge." };
  const request = challenge.request ?? {};
  const details = (request.methodDetails ?? {}) as Record<string, unknown>;
  if (details.chainId !== MODERATO_CHAIN_ID) return { declined: "The offer is not on Tempo Moderato (chain 42431)." };
  if (!sameAddress(request.currency, expected.currency ?? PATHUSD)) return { declined: "The offer is not for the configured Moderato test token." };
  if (typeof request.amount !== "string" || !/^[1-9][0-9]{0,17}$/.test(request.amount) || BigInt(request.amount) > BigInt(MPP_TOP_UP.atomic))
    return { declined: `The offer must ask for at most ${MPP_TOP_UP.atomic} atomic units (1.00 test USD).` };
  if (expected.payTo && !sameAddress(request.recipient, expected.payTo))
    return { declined: "The offer pays an address other than the configured payTo." };
  if (!Array.isArray(details.supportedModes) || !details.supportedModes.includes("pull") || details.feePayer || details.splits)
    return { declined: "The offer must accept a signed transaction (pull mode) with no fee sponsor or splits." };
  const expires = Date.parse(String(challenge.expires ?? ""));
  if (!Number.isFinite(expires) || expires <= now().getTime() || expires > now().getTime() + 15 * 60_000)
    return { declined: "The offer's expiry is missing or outside 15 minutes." };
  return { accept: challenge };
}

async function readReply(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => "");
  try { return text ? JSON.parse(text) : null; } catch { return text.slice(0, 500); }
}

function reasonOf(body: unknown) {
  const value = typeof body === "string" ? body : (body as { error?: unknown } | null)?.error;
  return typeof value === "string" && value ? value.slice(0, 300) : null;
}

function describe(error: unknown) {
  const { message, cause } = error as Error & { cause?: { code?: string; message?: string } };
  const short = (error as { shortMessage?: unknown }).shortMessage;
  const detail = cause?.message || cause?.code;
  const text = typeof short === "string" ? short : message;
  return detail ? `${text} (${detail})` : text;
}

/** tmp + fsync, then link for a new record (never replaces a file) or rename to update this record. */
async function persist(file: string, attempt: MppPaymentAttempt, create = false) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(attempt, null, 2)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await (create ? link(temporary, file) : rename(temporary, file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new Error(`A payment record already exists at ${file}; refusing to overwrite it. Nothing was sent.`);
    throw error;
  } finally {
    await rm(temporary, { force: true });
  }
  const directory = await open(dirname(file), "r").catch(() => null);
  try { await directory?.sync(); } catch {} finally { await directory?.close(); }
}

function messageFor(attempt: MppPaymentAttempt, reply: Record<string, unknown>, recordFile: string, credits: MppFundingSummary["credits"]) {
  const reason = reasonOf(attempt.response);
  switch (attempt.state) {
    case "credited":
      return `The room was credited with ${credits?.added} test credits${
        credits?.replayed ? " (an earlier credit for this same payment; nothing was charged twice)" : ""}.`;
    case "pending":
      return reply.status === "settled-credit-pending"
        ? `The payment landed, but the room is not credited yet: ${RECONCILE} to credit it.`
        : `The payment is pending and may still land: re-send the same payment with --resume ${recordFile} or run ${MPP_COMMANDS.reconcile}; do not sign again. ${AFTER_RECONCILE}`;
    case "rejected":
      return `The room rejected this payment${reason ? ` (${reason})` : ""}. ${(attempt.sends ?? 1) > 1
        ? `An earlier send may have landed: ${RECONCILE}. ${AFTER_RECONCILE}`
        : "It was not broadcast."}`;
    case "expired":
      return `This payment expired before it settled; nothing was charged. ${SIGN_AGAIN}`;
    case "refused":
      return `The room refused this payment${reason ? ` (${reason})` : ""}; nothing was broadcast for it.`;
    default: {
      const answer = attempt.lastError ?? `HTTP ${attempt.lastStatus}${reason ? `: ${reason}` : ""}`;
      return `No definite answer (${answer}). Re-send the same signed payment with --resume ${recordFile}; do not sign a new one.`;
    }
  }
}

function summarize(attempt: MppPaymentAttempt, recordFile: string, note = ""): MppFundingSummary {
  const reply = (attempt.response && typeof attempt.response === "object" ? attempt.response : {}) as Record<string, unknown>;
  const candidate = typeof reply.transaction === "string" ? reply.transaction : attempt.transaction;
  const transaction = TRANSACTION_PATTERN.test(normalizeHash(candidate)) ? normalizeHash(candidate) : null;
  const outcome = attempt.state === "signed" ? "unknown" : attempt.state;
  const credits = outcome === "credited"
    ? { added: typeof reply.added === "number" ? reply.added : MPP_TOP_UP.credits, replayed: reply.replayed === true, room: reply.credits ?? null }
    : null;
  return {
    status: attempt.lastStatus ?? null,
    outcome,
    network: TEMPO_MODERATO,
    transaction,
    explorerUrl: transaction ? mppExplorerUrl(transaction) : null,
    credits,
    message: messageFor(attempt, reply, recordFile, credits) + note,
    recordFile,
  };
}

const stateFor = (status: number, reply: unknown): MppAttemptState =>
  status === 200 ? "credited" : status === 202 ? "pending" : status === 409 ? "refused"
    : status === 402 ? (ROOM_EXPIRED.test(reasonOf(reply) ?? "") ? "expired" : "rejected") : "unknown";

async function send(recordFile: string, attempt: MppPaymentAttempt, agent: Record<string, string>, fetchImpl: typeof fetch, now: () => Date) {
  const sent = { sends: (attempt.sends ?? 0) + 1, lastSentAt: now().toISOString() };
  let next: MppPaymentAttempt;
  try {
    const response = await fetchImpl(attempt.url, {
      method: "POST",
      headers: { ...agent, authorization: attempt.credential },
      redirect: "error",
      signal: AbortSignal.timeout(PAYMENT_TIMEOUT_MS),
    });
    const reply = await readReply(response);
    next = {
      ...attempt, ...sent,
      state: stateFor(response.status, reply),
      lastStatus: response.status,
      lastError: undefined,
      response: reply,
      paymentReceipt: response.headers.get("Payment-Receipt") ?? undefined,
    };
  } catch (error) {
    // The room may have received it: only this exact payment may be sent again.
    next = { ...attempt, ...sent, state: "unknown", lastStatus: undefined, lastError: describe(error), response: undefined, paymentReceipt: undefined };
  }
  let note = "";
  try { await persist(recordFile, next); } catch (error) { note = ` The record was not updated: ${(error as Error).message}`; }
  return summarize(next, recordFile, note);
}

/**
 * The patron agent: unpaid POST → 402 challenge → hygiene → sign one Tempo transaction (pull mode,
 * never broadcast here) → durable record → paid POST. Every request carries the local agent token.
 * A 409 room is never signed for; anything indeterminate is left to --resume or the reconciler.
 * mppx.fetch is not used: it would sign and pay again when a re-sent credential meets a 402.
 */
export async function fundMppRoom(options: {
  url: string;
  recordDir: string;
  agentToken: string;
  /** The isolated adapter (vendor/mpp-adapter) and an account it made from the payer wallet. */
  adapter: MppAdapter;
  account: MppAccount;
  expected?: { payTo?: string; currency?: string };
  rpc?: Eip1193Request;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}): Promise<MppFundingSummary> {
  const { url, account, adapter } = options;
  assertLocal(url);
  const agent = agentHeader(options.agentToken);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const early = (status: number, outcome: "refused" | "declined" | "not-offered", message: string): MppFundingSummary =>
    ({ status, outcome, network: TEMPO_MODERATO, transaction: null, explorerUrl: null, credits: null, message, recordFile: null });

  let unpaid: Response;
  try {
    unpaid = await fetchImpl(url, { method: "POST", headers: agent, redirect: "error", signal: AbortSignal.timeout(OFFER_TIMEOUT_MS) });
  } catch (error) {
    throw new Error(`Could not reach ${url}: ${describe(error)}. Is the local server running with PILOT_LOCAL_CONTROLS=1? Nothing was signed.`);
  }
  const body = await readReply(unpaid);
  const reason = reasonOf(body);
  if (unpaid.status === 409)
    return early(409, "refused", `The room refused to take a payment${reason ? ` (${reason})` : ""}. Nothing was signed.`);
  if (unpaid.status !== 402)
    return early(unpaid.status, "not-offered",
      `The room did not offer a payment (HTTP ${unpaid.status}${reason ? `: ${reason}` : ""}). Nothing was signed.${unpaid.status === 404
        ? " Check the funding link, and that the server runs with PILOT_LOCAL_CONTROLS=1 and this machine's agent token." : ""}`);
  let challenge: MppChallenge;
  try {
    challenge = adapter.parseChallengeHeader(unpaid.headers.get("WWW-Authenticate") ?? "");
  } catch {
    return early(402, "declined", "The room's 402 carried no readable WWW-Authenticate Payment challenge. Nothing was signed.");
  }
  const choice = chooseChallenge(challenge, options.expected, now);
  if ("declined" in choice) return early(402, "declined", `${choice.declined} Nothing was signed.`);

  const payTo = String(challenge.request.recipient);
  let signed: Awaited<ReturnType<MppAdapter["createPayment"]>>;
  try {
    // Signs exactly one transaction; mppx does not broadcast it in pull mode.
    signed = await adapter.createPayment({ account, challenge, expectedRecipient: payTo, ...(options.rpc ? { request: options.rpc } : {}) });
  } catch (error) {
    throw new Error(`Could not sign the payment: ${describe(error)}. Nothing was sent.`);
  }
  if (!signed.credential.startsWith("Payment ") || !TRANSACTION_PATTERN.test(normalizeHash(signed.transaction)))
    throw new Error("The signed payment is not a pull-mode Tempo transaction. Nothing was sent.");
  const attempt: MppPaymentAttempt = {
    version: 1,
    kind: "fork-night/mpp-payment/v1",
    url,
    network: TEMPO_MODERATO,
    credential: signed.credential,
    challengeId: challenge.id,
    payer: signed.payer,
    payTo,
    currency: String(challenge.request.currency),
    amount: String(challenge.request.amount),
    transaction: normalizeHash(signed.transaction),
    validBefore: Number(signed.validBefore),
    createdAt: now().toISOString(),
    state: "signed",
  };
  await mkdir(options.recordDir, { recursive: true, mode: 0o700 });
  const recordFile = join(options.recordDir, `${attempt.createdAt.replace(/[:.]/g, "-")}-tempo-moderato.json`);
  await persist(recordFile, attempt, true);
  return send(recordFile, attempt, agent, fetchImpl, now);
}

async function readAttempt(file: string): Promise<MppPaymentAttempt> {
  let attempt: MppPaymentAttempt | null;
  try { attempt = JSON.parse(await readFile(file, "utf8")); } catch { attempt = null; }
  if (!attempt || attempt.version !== 1 || attempt.kind !== "fork-night/mpp-payment/v1" || typeof attempt.url !== "string" ||
      typeof attempt.credential !== "string" || !attempt.credential.startsWith("Payment ") ||
      attempt.network !== TEMPO_MODERATO || !STATES.includes(attempt.state))
    throw new Error(`No MPP payment record could be read at ${file}.`);
  assertLocal(attempt.url);
  return attempt;
}

/**
 * Re-sends exactly the persisted credential with plain fetch. It never signs. The door answers a
 * recorded payment from its records or the chain, so a resume after validBefore still gets an answer.
 */
export async function resumeMppAttempt(
  recordFile: string,
  options: { agentToken: string; fetchImpl?: typeof fetch; now?: () => Date },
): Promise<MppFundingSummary> {
  const agent = agentHeader(options.agentToken);
  const attempt = await readAttempt(recordFile);
  if (attempt.state === "credited") throw new Error("This payment was already credited; there is nothing to re-send.");
  if (attempt.state === "expired")
    throw new Error(`This payment expired before it settled; nothing was charged and there is nothing to re-send. ${SIGN_AGAIN}`);
  if (attempt.state === "rejected")
    throw new Error(`The room rejected this payment, so re-sending it cannot succeed. ${(attempt.sends ?? 1) > 1
      ? `If an earlier send may have landed, ${RECONCILE}. ${AFTER_RECONCILE}` : "It was not broadcast."}`);
  return send(recordFile, attempt, agent, options.fetchImpl ?? globalThis.fetch, options.now ?? (() => new Date()));
}
