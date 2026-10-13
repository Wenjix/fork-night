import { randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { decodePaymentResponseHeader } from "@x402/core/http";
import type { PaymentRequired, PaymentRequirements, SettleResponse } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { AGENT_TOKEN_HEADER, AGENT_TOKEN_PATTERN } from "./config.ts";
import {
  BASE_SEPOLIA,
  MAX_TIMEOUT_SECONDS,
  MEMO_PATTERN,
  SOLANA_DEVNET,
  TESTNET_USDC,
  TOP_UP,
  explorerUrl,
  isTestnet,
  type Testnet,
} from "./ids.ts";

/** The local agent's throwaway testnet key for exactly one network. */
export type PayerSigner =
  | { network: typeof BASE_SEPOLIA; signer: ConstructorParameters<typeof ExactEvmScheme>[0] }
  | { network: typeof SOLANA_DEVNET; signer: ConstructorParameters<typeof ExactSvmScheme>[0] };

export type AttemptState = "signed" | "credited" | "pending" | "rejected" | "expired" | "refused" | "unknown";

/** One signed payment, saved before it is sent so a lost answer is re-sent, never re-signed. */
export type PaymentAttempt = {
  version: 1;
  url: string;
  network: Testnet;
  header: string;
  payer: string;
  evmNonce?: string;
  svmMemo?: string;
  /** EVM authorization deadline, Unix seconds. */
  validBefore?: string;
  createdAt: string;
  state: AttemptState;
  sends?: number;
  lastSentAt?: string;
  lastStatus?: number;
  lastError?: string;
  response?: unknown;
  settlement?: SettleResponse;
};

export type FundingSummary = {
  status: number | null;
  outcome: Exclude<AttemptState, "signed"> | "declined" | "not-offered";
  network: Testnet;
  transaction: string | null;
  explorerUrl: string | null;
  credits: { added: number; replayed: boolean; room: unknown } | null;
  message: string;
  recordFile: string | null;
};

const OFFER_TIMEOUT_MS = 30_000;
// Covers verify, settle and the SDK's one pending retry, each up to the facilitator's 90-second timeout.
const PAYMENT_TIMEOUT_MS = 300_000;
// The route and the facilitator refuse an authorization with less than six seconds left.
const EXPIRY_MARGIN_SECONDS = 6;
const RECONCILE = "do not sign again; run npm run x402:reconcile";
const AFTER_RECONCILE = "Signing a new payment is safe once the reconciler marks this one expired.";
const SIGN_AGAIN = "Signing a new payment is safe: run npm run x402:fund again.";
// The room's answer once the reconciler proved the payment can no longer settle.
const ROOM_EXPIRED = /expired before it settled/;
const STATES: AttemptState[] = ["signed", "credited", "pending", "rejected", "expired", "refused", "unknown"];
const SLUG: Record<Testnet, string> = { [BASE_SEPOLIA]: "base-sepolia", [SOLANA_DEVNET]: "solana-devnet" };
const TRANSACTION: Record<Testnet, RegExp> = {
  [BASE_SEPOLIA]: /^0x[0-9a-fA-F]{64}$/,
  [SOLANA_DEVNET]: /^[1-9A-HJ-NP-Za-km-z]{64,90}$/,
};

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

const sameAddress = (network: Testnet, value: unknown, expected: string) =>
  typeof value === "string" &&
  (network === BASE_SEPOLIA ? value.toLowerCase() === expected.toLowerCase() : value === expected);

/** Agent hygiene before anything is signed: only the reviewed testnet top-up, to the configured payee. */
export function chooseOffer(
  required: PaymentRequired,
  network: Testnet,
  expected: { payTo?: string } = {},
): { accept: PaymentRequirements } | { declined: string } {
  if (required?.x402Version !== 2 || !Array.isArray(required.accepts))
    return { declined: "The room's offer is not an x402 version 2 payment request." };
  const accept = required.accepts.find((item) => item?.network === network && item.scheme === "exact");
  if (!accept) return { declined: `The room offered no exact payment on ${network}.` };
  if (!sameAddress(network, accept.asset, TESTNET_USDC[network]))
    return { declined: "The offer is not for Circle test USDC on this testnet." };
  if (typeof accept.amount !== "string" || !/^[1-9][0-9]{0,17}$/.test(accept.amount) ||
      BigInt(accept.amount) > BigInt(TOP_UP.atomic))
    return { declined: `The offer must ask for at most ${TOP_UP.atomic} atomic units (1.00 test USDC).` };
  if (expected.payTo && !sameAddress(network, accept.payTo, expected.payTo))
    return { declined: "The offer pays an address other than the configured payTo." };
  // The EVM authorization lives this long; the room never offers more.
  if (!Number.isInteger(accept.maxTimeoutSeconds) || accept.maxTimeoutSeconds < 1 ||
      accept.maxTimeoutSeconds > MAX_TIMEOUT_SECONDS)
    return { declined: `The offer's payment window must be 1 to ${MAX_TIMEOUT_SECONDS} seconds.` };
  const extra = accept.extra ?? {};
  if (network === SOLANA_DEVNET && (typeof extra.memo !== "string" || !MEMO_PATTERN.test(extra.memo)))
    return { declined: "The Solana offer has no valid seller memo." };
  // The room accepts only EIP-3009 authorizations, so a Permit2 offer is never signed.
  if (network === BASE_SEPOLIA && (extra.assetTransferMethod ?? "eip3009") !== "eip3009")
    return { declined: "The Base Sepolia offer must use an EIP-3009 authorization." };
  return { accept };
}

async function readReply(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => "");
  try { return text ? JSON.parse(text) : null; } catch { return text.slice(0, 500); }
}

function reasonOf(body: unknown) {
  const value = typeof body === "string" ? body : (body as { error?: unknown } | null)?.error;
  return typeof value === "string" && value ? value.slice(0, 300) : null;
}

function settlementOf(headers: Headers): SettleResponse | undefined {
  const raw = headers.get("PAYMENT-RESPONSE") ?? headers.get("X-PAYMENT-RESPONSE");
  try { return raw ? decodePaymentResponseHeader(raw) : undefined; } catch { return undefined; }
}

function describe(error: unknown) {
  const { message, cause } = error as Error & { cause?: { code?: string; message?: string } };
  const detail = cause?.message || cause?.code;
  return detail ? `${message} (${detail})` : message;
}

/** tmp + fsync, then link for a new record (never replaces a file) or rename to update this record. */
async function persist(file: string, attempt: PaymentAttempt, create = false) {
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

function messageFor(attempt: PaymentAttempt, reply: Record<string, unknown>, recordFile: string, credits: FundingSummary["credits"]) {
  const reason = reasonOf(attempt.response);
  switch (attempt.state) {
    case "credited":
      return `The room was credited with ${credits?.added} test credits${
        credits?.replayed ? " (an earlier credit for this same payment; nothing settled twice)" : ""}.`;
    case "pending":
      return reply.status === "settled-credit-pending"
        ? `The payment settled, but the room is not credited yet: ${RECONCILE} to credit it.`
        : `The payment is pending and may still settle: ${RECONCILE}. ${AFTER_RECONCILE}`;
    case "rejected":
      return `The room rejected this payment${reason ? ` (${reason})` : ""}. ${(attempt.sends ?? 1) > 1
        ? `An earlier send may have reached settlement: ${RECONCILE}. ${AFTER_RECONCILE}`
        : "It did not settle."}`;
    case "expired":
      return `This payment expired before it settled; nothing was charged. ${SIGN_AGAIN}`;
    case "refused":
      return `The room refused this payment${reason ? ` (${reason})` : ""}; nothing settled.`;
    default: {
      const answer = attempt.lastError ?? `HTTP ${attempt.lastStatus}${reason ? `: ${reason}` : ""}`;
      const deadline = attempt.validBefore
        ? ` before ${new Date(Number(attempt.validBefore) * 1000).toISOString()}`
        : "";
      return `No definite answer (${answer}). Re-send the same signed payment${deadline} with --resume ${recordFile}; do not sign a new one.`;
    }
  }
}

function summarize(attempt: PaymentAttempt, recordFile: string, note = ""): FundingSummary {
  const reply = (attempt.response && typeof attempt.response === "object" ? attempt.response : {}) as Record<string, unknown>;
  const candidate = typeof reply.transaction === "string" ? reply.transaction : attempt.settlement?.transaction;
  const transaction = typeof candidate === "string" && TRANSACTION[attempt.network].test(candidate) ? candidate : null;
  const outcome = attempt.state === "signed" ? "unknown" : attempt.state;
  const credits = outcome === "credited"
    ? { added: typeof reply.added === "number" ? reply.added : TOP_UP.credits, replayed: reply.replayed === true, room: reply.credits ?? null }
    : null;
  return {
    status: attempt.lastStatus ?? null,
    outcome,
    network: attempt.network,
    transaction,
    explorerUrl: transaction ? explorerUrl(attempt.network, transaction) : null,
    credits,
    message: messageFor(attempt, reply, recordFile, credits) + note,
    recordFile,
  };
}

const stateFor = (status: number, reply: unknown): AttemptState =>
  status === 200 ? "credited" : status === 202 ? "pending" : status === 409 ? "refused"
    : status === 402 ? (ROOM_EXPIRED.test(reasonOf(reply) ?? "") ? "expired" : "rejected") : "unknown";

async function send(recordFile: string, attempt: PaymentAttempt, agent: Record<string, string>, fetchImpl: typeof fetch, now: () => Date) {
  const sent = { sends: (attempt.sends ?? 0) + 1, lastSentAt: now().toISOString() };
  let next: PaymentAttempt;
  try {
    const response = await fetchImpl(attempt.url, {
      method: "POST",
      headers: { ...agent, "PAYMENT-SIGNATURE": attempt.header },
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
      settlement: settlementOf(response.headers),
    };
  } catch (error) {
    // The room may have received it: only this exact payment may be sent again.
    next = { ...attempt, ...sent, state: "unknown", lastStatus: undefined, lastError: describe(error), response: undefined, settlement: undefined };
  }
  let note = "";
  try { await persist(recordFile, next); } catch (error) { note = ` The record was not updated: ${(error as Error).message}`; }
  return summarize(next, recordFile, note);
}

/**
 * The agent payer: unpaid POST → 402 offer → hygiene → sign once → durable record → paid POST.
 * Every request carries the local agent token. A 409 room is never signed for; anything
 * indeterminate is left to --resume or the reconciler.
 */
export async function fundRoom(options: PayerSigner & {
  url: string;
  recordDir: string;
  agentToken: string;
  expected?: { payTo?: string };
  fetchImpl?: typeof fetch;
  now?: () => Date;
}): Promise<FundingSummary> {
  const { network, url } = options;
  assertLocal(url);
  const agent = agentHeader(options.agentToken);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const early = (status: number, outcome: "refused" | "declined" | "not-offered", message: string): FundingSummary =>
    ({ status, outcome, network, transaction: null, explorerUrl: null, credits: null, message, recordFile: null });

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

  // Exactly the requested testnet: no wildcard or v1 registrations, and the default $1 spend cap.
  const client = new x402Client();
  if (options.network === BASE_SEPOLIA) client.register(BASE_SEPOLIA, new ExactEvmScheme(options.signer));
  else client.register(SOLANA_DEVNET, new ExactSvmScheme(options.signer));
  const http = new x402HTTPClient(client);
  let required: PaymentRequired;
  try {
    required = http.getPaymentRequiredResponse((name) => unpaid.headers.get(name), body);
  } catch {
    return early(402, "declined", "The room's 402 carried no readable PAYMENT-REQUIRED offer. Nothing was signed.");
  }
  const choice = chooseOffer(required, network, options.expected);
  if ("declined" in choice) return early(402, "declined", `${choice.declined} Nothing was signed.`);

  const payload = await http.createPaymentPayload({ ...required, accepts: [choice.accept] });
  const header = http.encodePaymentSignatureHeader(payload)["PAYMENT-SIGNATURE"];
  const authorization = (payload.payload as { authorization?: { nonce?: unknown; validBefore?: unknown } }).authorization;
  const evmNonce = authorization?.nonce, validBefore = authorization?.validBefore;
  if (!header || (network === BASE_SEPOLIA && (typeof evmNonce !== "string" || typeof validBefore !== "string")))
    throw new Error("The signed payment is not an x402 v2 EIP-3009 or Solana exact payment. Nothing was sent.");
  const attempt: PaymentAttempt = {
    version: 1,
    url,
    network,
    header,
    payer: options.signer.address,
    ...(network === BASE_SEPOLIA
      ? { evmNonce: evmNonce as string, validBefore: validBefore as string }
      : { svmMemo: choice.accept.extra.memo as string }),
    createdAt: now().toISOString(),
    state: "signed",
  };
  await mkdir(options.recordDir, { recursive: true, mode: 0o700 });
  const recordFile = join(options.recordDir, `${attempt.createdAt.replace(/[:.]/g, "-")}-${SLUG[network]}.json`);
  await persist(recordFile, attempt, true);
  return send(recordFile, attempt, agent, fetchImpl, now);
}

async function readAttempt(file: string): Promise<PaymentAttempt> {
  let attempt: PaymentAttempt | null;
  try { attempt = JSON.parse(await readFile(file, "utf8")); } catch { attempt = null; }
  if (!attempt || attempt.version !== 1 || typeof attempt.url !== "string" || typeof attempt.header !== "string" ||
      !isTestnet(attempt.network) || !STATES.includes(attempt.state) ||
      (attempt.network === BASE_SEPOLIA && !/^[0-9]{1,20}$/.test(String(attempt.validBefore))))
    throw new Error(`No x402 payment record could be read at ${file}.`);
  assertLocal(attempt.url);
  return attempt;
}

/** Re-sends exactly the persisted PAYMENT-SIGNATURE with plain fetch. It never signs. */
export async function resumeAttempt(
  recordFile: string,
  options: { agentToken: string; fetchImpl?: typeof fetch; now?: () => Date },
): Promise<FundingSummary> {
  const agent = agentHeader(options.agentToken);
  const attempt = await readAttempt(recordFile);
  const now = options.now ?? (() => new Date());
  if (attempt.state === "credited") throw new Error("This payment was already credited; there is nothing to re-send.");
  if (attempt.state === "expired")
    throw new Error(`This payment expired before it settled; nothing was charged and there is nothing to re-send. ${SIGN_AGAIN}`);
  if (attempt.state === "rejected")
    throw new Error(`The room rejected this payment, so re-sending it cannot succeed. ${(attempt.sends ?? 1) > 1
      ? `If an earlier send may have settled, ${RECONCILE}. ${AFTER_RECONCILE}` : "It did not settle."}`);
  if (attempt.validBefore && now().getTime() / 1000 + EXPIRY_MARGIN_SECONDS >= Number(attempt.validBefore))
    throw new Error(`This authorization expired at ${new Date(Number(attempt.validBefore) * 1000).toISOString()}, so re-sending cannot settle it: ${RECONCILE} to learn whether it was paid. ${AFTER_RECONCILE}`);
  return send(recordFile, attempt, agent, options.fetchImpl ?? globalThis.fetch, now);
}
