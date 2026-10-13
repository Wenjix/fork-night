// Wren's allowance and MPP top-up (Tempo Moderato testnet only). Loaded only by `status` (reads) and by
// live top-ups. Uses this folder's pinned mppx 0.13.4 / viem 2.57.3 (same lockfile as vendor/mpp-adapter).
// The agent signs with a Tempo access key acting for the steward's account; Tempo enforces its limit,
// scope, expiry and revocation. Keys, credentials and signatures are never printed or journaled.
import { randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Challenge, Credential } from "mppx";
import { tempo as tempoClient } from "mppx/client";
import { createClient, decodeErrorResult, encodeFunctionData, http, keccak256, parseAbi, stringToHex, toFunctionSelector } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import { estimateGas } from "viem/actions";
import { formatAbiItem } from "viem/utils";
import { Abis, Account, Actions, Transaction } from "viem/tempo";
import { tempoModerato } from "viem/tempo/chains";

export const MODERATO_RPC = "https://rpc.moderato.tempo.xyz";
export const EXPLORER = "https://explore.testnet.tempo.xyz";
export const PATHUSD = "0x20c0000000000000000000000000000000000000";
// The only door Wren may pay. Any other URL is refused before a request is made.
// The one door Wren may pay: the night-shift MPP funding URL that scripts/mpp-setup.ts prints for your local setup.
// The Oct 12 run pinned the literal URL here; this public copy reads it from WREN_DOOR_URL so the local funding
// reference stays out of the repository. config.json mpp.doorUrl must match it exactly, or Wren refuses to pay.
export const NIGHT_SHIFT_DOOR = process.env.WREN_DOOR_URL ?? "http://127.0.0.1:3005/api/mpp/fund/<funding-ref>";
const AGENT_TOKEN_HEADER = "x-fork-night-agent";
const AGENT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const TX = /^0x[0-9a-f]{64}$/;
// A saved payment that may still land or credit blocks every new signature. "rejected" counts only after a re-send
// (a first-send 402 means the door recorded nothing); "landed-unreconciled" is one the chain shows landed that the
// door has not answered as credited yet. "expired-local" (resolutionFor below) and every other state are resolved.
export const UNRESOLVED = (r) => ["signed", "unknown", "pending", "landed-unreconciled"].includes(r.state) || (r.state === "rejected" && (r.sends ?? 1) > 1);
/** Re-sent on resume: the door answers a recorded payment from its records or the chain, never broadcasting it twice. */
const RESEND = new Set(["signed", "pending", "unknown", "landed-unreconciled"]);
/** Left open by the door: once its signed deadline is past, only the chain can resolve it. */
export const NEEDS_CHAIN_CHECK = (r) => r.state === "unknown" || (r.state === "rejected" && (r.sends ?? 1) > 1);
/** A resumed payment that ended without a credit and can never land (by its summary): the run goes on to a fresh one. */
const SPENT_NOTHING = (result) => result.outcome === "expired" || result.outcome === "expired-local" || (result.outcome === "rejected" && (result.sends ?? 1) <= 1);
/** How far past validBefore (seconds) a payment must be before Wren asks the chain whether it landed. */
export const RESOLVE_MARGIN_SECONDS = 120; // matches the door's reconciler (src/mpp/ids.ts: head > validBefore + 120 s)
const RECONCILE_STEP = "node --env-file-if-exists=.env.local scripts/mpp-reconcile.ts";
const RECONCILE_MESSAGE = `Moderato shows this payment landed, but the door has not answered it as credited. Operator: run the door's reconcile (${RECONCILE_STEP}, then again with --apply), then re-run Wren; it re-sends the same saved payment once and the door answers from its records. Never sign a new payment for it.`;
// Only keychain or TIP-20 refusals mean this key may not make the payment (limit, scope, expiry, revocation, balance).
export const KEYCHAIN_REFUSALS = new Set(["SpendingLimitExceeded", "CallNotAllowed", "KeyExpired", "KeyAlreadyRevoked", "KeyNotFound", "InsufficientBalance", "UnauthorizedCaller"]);
const REFUSAL_ABI = [...Abis.accountKeychain, ...Abis.tip20].filter((item) => item.type === "error");
const REFUSAL_SELECTORS = new Map(REFUSAL_ABI.map((item) => [toFunctionSelector(formatAbiItem(item)).toLowerCase(), item.name]));

const chain = tempoModerato.extend({ feeToken: PATHUSD });
const transport = () => http(MODERATO_RPC, { retryCount: 1, timeout: 30_000 });
const readClient = () => createClient({ chain, transport: transport() });
export const usd = (atomic) => (Number(atomic) / 1e6).toFixed(6);
export const explorerUrl = (hash) => `${EXPLORER}/tx/${String(hash).toLowerCase()}`;
const sameAddress = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
export const maskDoor = (url) => url.replace(/(fund\/)(.{4}).+(.{2})$/, "$1$2…$3");

/** Short, key-free description of a chain or mppx failure, with the keychain error name when there is one. */
export function refusalOf(error) {
  const text = [error?.shortMessage, error?.details, error?.message, error?.cause?.shortMessage, error?.cause?.details]
    .filter(Boolean).map(String).join(" | ");
  const name = (text.match(/(SpendingLimitExceeded|CallNotAllowed|KeyExpired|KeyAlreadyRevoked|KeyNotFound|InsufficientBalance|UnauthorizedCaller)/) ?? [])[1] ?? null;
  return { name, message: text.split("\n")[0].replace(/0x[0-9a-fA-F]{100,}/g, "0x…").slice(0, 300) };
}

/** Revert data anywhere in the error's cause chain (viem puts it on RawContractError and RPC errors). */
function revertDataOf(error) {
  for (let e = error, depth = 0; e && depth < 12; e = e.cause, depth++) {
    for (const data of [e.data, e.data?.data]) if (typeof data === "string" && /^0x[0-9a-fA-F]{8,}$/.test(data)) return data;
  }
  return null;
}

/**
 * The keychain/TIP-20 error name decoded from the revert data (by its 4-byte selector when the arguments are cut
 * short), else the one the node's own message spells out, else null.
 */
export function refusalNameOf(error) {
  const data = revertDataOf(error);
  if (data) {
    try { return decodeErrorResult({ abi: REFUSAL_ABI, data }).errorName; } catch {}
    const bySelector = REFUSAL_SELECTORS.get(data.slice(0, 10).toLowerCase());
    if (bySelector) return bySelector;
  }
  return refusalOf(error).name;
}

/**
 * Pure. A failure to create the credential (mppx prepares the transaction over the Moderato RPC, then signs) is
 * "allowance-exhausted" only for a keychain/TIP-20 refusal; anything else (an RPC timeout or 429, a fee read, …)
 * is "sign-failed": nothing was signed, and the turn pauses so a re-run fetches a fresh offer.
 */
export function classifySignFailure(error) {
  const name = refusalNameOf(error);
  const { message } = refusalOf(error);
  return KEYCHAIN_REFUSALS.has(name) ? { outcome: "allowance-exhausted", name, message } : { outcome: "sign-failed", name: name ?? null, message };
}

const iso = (seconds) => new Date(seconds * 1000).toISOString();

/**
 * Pure. What a saved payment that the door left open (unknown, or rejected after a re-send) resolves to.
 * `facts` is what Moderato showed for record.transaction ({ receipt, transaction, headTimestamp }); leave it
 * undefined before the lookup. A transaction with an expiring nonce can never be included once the chain is past
 * its validBefore, so: no receipt, not known to the node, and the head past validBefore + margin → "expired-local"
 * (a new signature is allowed). A receipt → "landed" (operator reconciles; nothing new is signed). Otherwise wait.
 */
export function resolutionFor(record, nowSeconds, facts) {
  const validBefore = Number(record?.validBefore);
  if (!Number.isInteger(validBefore) || validBefore <= 0 || !TX.test(String(record?.transaction ?? "")))
    return { decision: "operator", reason: "The saved payment has no signed deadline or transaction hash to check on chain; check it by hand. Never sign a new payment for it." };
  const after = validBefore + RESOLVE_MARGIN_SECONDS;
  if (!(nowSeconds > after)) return { decision: "wait", after, reason: `Its signed deadline has not passed by ${RESOLVE_MARGIN_SECONDS} s yet; re-run after ${iso(after)} so Wren can check the chain.` };
  if (facts === undefined) return { decision: "lookup", after };
  if (facts?.receipt) {
    const block = /^0x[0-9a-f]+$/i.test(String(facts.receipt.blockNumber ?? "")) ? Number(BigInt(facts.receipt.blockNumber)) : null;
    return { decision: "landed", after, receiptStatus: facts.receipt.status ?? null, blockNumber: block };
  }
  if (facts?.transaction) return { decision: "wait", after, reason: "Moderato still knows the transaction; re-run later." };
  const head = Number(facts?.headTimestamp);
  if (!Number.isFinite(head) || !(head > after)) return { decision: "wait", after, reason: `Moderato's head is not past ${iso(after)} yet; re-run later.` };
  return { decision: "expired-local", after, headTimestamp: head };
}

/** Moderato's view of one transaction hash: its receipt, the transaction if a node still has it, and the head's time. */
async function readChainFacts(transaction) {
  const client = readClient();
  const ask = (method, params) => client.request({ method, params });
  const head = await ask("eth_getBlockByNumber", ["latest", false]);
  const headTimestamp = /^0x[0-9a-f]+$/i.test(String(head?.timestamp ?? "")) ? Number(BigInt(head.timestamp)) : null;
  const receiptOf = async () => {
    const found = await ask("eth_getTransactionReceipt", [transaction]);
    return found && String(found.transactionHash ?? "").toLowerCase() === transaction ? found : null;
  };
  let receipt = await receiptOf();
  const pooled = receipt ? null : await ask("eth_getTransactionByHash", [transaction]);
  // A lagging replica can miss a receipt: ask once more before calling it absent.
  if (!receipt && !pooled) { await new Promise((r) => setTimeout(r, 1500)); receipt = await receiptOf(); }
  return { receipt, transaction: pooled ?? null, headTimestamp };
}

async function keyFrom(repo, allowance) {
  const key = (await readFile(join(repo, allowance.agentKeyFile), "utf8")).trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error(`The allowance key file ${allowance.agentKeyFile} is not a secp256k1 key.`);
  return key;
}

/** Read-only allowance facts: remaining limit, key metadata, and a simulation of the exact door payment (nothing signed or sent). */
export async function allowanceReport(repo, cfg) {
  const out = { steward: cfg.allowance.stewardAddress, accessKey: null, payTo: cfg.mpp.payTo };
  let key;
  try { key = await keyFrom(repo, cfg.allowance); } catch (error) { return { ...out, error: error.message }; }
  out.accessKey = privateKeyToAddress(key);
  const client = readClient();
  try {
    const { remaining, periodEnd } = await Actions.accessKey.getRemainingLimit(client, { account: out.steward, accessKey: out.accessKey, token: PATHUSD });
    out.remaining = usd(remaining);
    out.remainingAtomic = remaining.toString();
    out.periodEnd = periodEnd === undefined ? null : new Date(Number(periodEnd) * 1000).toISOString();
    out.coversTopUp = remaining >= BigInt(cfg.mpp.amountAtomic);
  } catch (error) { out.remainingError = refusalOf(error).message; }
  try {
    const meta = await Actions.accessKey.getMetadata(client, { account: out.steward, accessKey: out.accessKey });
    out.key = {
      expiry: meta?.expiry ? new Date(Number(meta.expiry) * 1000).toISOString() : null,
      isRevoked: meta?.isRevoked ?? null,
      spendPolicy: meta?.spendPolicy ?? null,
    };
  } catch (error) { out.keyError = refusalOf(error).message; }
  // The door's call shape (one pathUSD transferWithMemo of 1.00 to payTo), simulated through the keychain.
  try {
    const account = Account.fromSecp256k1(key, { access: out.steward });
    const data = encodeFunctionData({
      abi: parseAbi(["function transferWithMemo(address to, uint256 amount, bytes32 memo)"]),
      functionName: "transferWithMemo",
      args: [cfg.mpp.payTo, BigInt(cfg.mpp.amountAtomic), keccak256(stringToHex("wren-status-simulation"))],
    });
    await estimateGas(client, { account, calls: [{ to: PATHUSD, data }], nonceKey: "expiring", validBefore: Math.floor(Date.now() / 1000) + 25 });
    out.doorPaymentSimulation = "ok";
  } catch (error) {
    const refusal = refusalOf(error);
    out.doorPaymentSimulation = `refused: ${refusal.name ?? refusal.message}`;
  }
  return out;
}

/** The payer's hygiene before signing (mirrors src/mpp/payer.ts chooseChallenge, pinned to Wren's config). */
export function checkChallenge(challenge, cfg, now = Date.now()) {
  if (challenge?.method !== "tempo" || challenge.intent !== "charge") return "The offer is not an MPP Tempo charge.";
  const request = challenge.request ?? {};
  const details = request.methodDetails ?? {};
  if (details.chainId !== cfg.mpp.chainId) return "The offer is not on Tempo Moderato (42431).";
  if (!sameAddress(request.currency, cfg.mpp.currency)) return "The offer is not in pathUSD.";
  if (String(request.amount) !== cfg.mpp.amountAtomic) return `The offer must ask for exactly ${cfg.mpp.amountAtomic} atomic pathUSD.`;
  if (!sameAddress(request.recipient, cfg.mpp.payTo)) return "The offer pays an address other than the night-shift door's pinned recipient.";
  if (!Array.isArray(details.supportedModes) || !details.supportedModes.includes("pull") || details.feePayer || details.splits)
    return "The offer must be pull mode with no fee sponsor or splits.";
  const expires = Date.parse(String(challenge.expires ?? ""));
  if (!Number.isFinite(expires) || expires <= now || expires > now + 15 * 60_000) return "The offer's expiry is missing or outside 15 minutes.";
  return null;
}

/** tmp + fsync, then link (create; never replaces a record) or rename (update). Mode 0600. */
async function persist(file, record, create = false) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try { await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`); await handle.sync(); } finally { await handle.close(); }
  try { await (create ? link(temporary, file) : rename(temporary, file)); } finally { await rm(temporary, { force: true }); }
  const directory = await open(dirname(file), "r").catch(() => null);
  try { await directory?.sync(); } catch {} finally { await directory?.close(); }
}

async function records(dir) {
  const names = (await readdir(dir).catch(() => [])).filter((n) => n.endsWith(".json")).sort();
  const out = [];
  for (const name of names) {
    try { out.push({ file: join(dir, name), record: JSON.parse(await readFile(join(dir, name), "utf8")) }); } catch {}
  }
  return out;
}

async function readReply(response) {
  const text = await response.text().catch(() => "");
  try { return text ? JSON.parse(text) : null; } catch { return text.slice(0, 300); }
}
const reasonOf = (body) => {
  const value = typeof body === "string" ? body : body?.error;
  return typeof value === "string" && value ? value.slice(0, 300) : null;
};
const stateFor = (status, reply) => status === 200 ? "credited" : status === 202 ? "pending" : status === 409 ? "refused"
  : status === 402 ? (/expired before it settled/.test(reasonOf(reply) ?? "") ? "expired" : "rejected") : "unknown";

/** Sends exactly the saved credential (never a new signature) and records the answer. */
async function send(file, record, token) {
  const sent = { sends: (record.sends ?? 0) + 1, lastSentAt: new Date().toISOString() };
  let next;
  try {
    const response = await fetch(record.url, {
      method: "POST", headers: { [AGENT_TOKEN_HEADER]: token, authorization: record.credential }, redirect: "error", signal: AbortSignal.timeout(120_000),
    });
    const reply = await readReply(response);
    next = {
      ...record, ...sent, state: stateFor(response.status, reply), lastStatus: response.status, lastError: undefined, response: reply,
      paymentReceipt: response.headers.get("Payment-Receipt") ?? record.paymentReceipt,
    };
  } catch (error) {
    next = { ...record, ...sent, state: "unknown", lastStatus: undefined, lastError: refusalOf(error).message, response: undefined };
  }
  // A payment the chain showed landed stays so until the door answers it as credited (or, after its reconcile, expired).
  if (record.state === "landed-unreconciled" && next.state !== "credited" && next.state !== "expired")
    next = { ...next, state: "landed-unreconciled", answeredAs: next.state };
  await persist(file, next);
  return next;
}

const summary = (record, file, extra = {}) => {
  const reply = record.response && typeof record.response === "object" ? record.response : {};
  const tx = typeof reply.transaction === "string" && TX.test(reply.transaction.toLowerCase()) ? reply.transaction.toLowerCase() : record.transaction;
  return {
    outcome: record.state, status: record.lastStatus ?? null, transaction: tx ?? null, explorerUrl: tx ? explorerUrl(tx) : null,
    added: typeof reply.added === "number" ? reply.added : null, replayed: reply.replayed === true, credits: reply.credits ?? null,
    reason: reasonOf(record.response) ?? record.lastError ?? null, sends: record.sends ?? 0, receipt: Boolean(record.paymentReceipt), record: file, ...extra,
  };
};

/**
 * Re-sends a pending (202) or unknown payment up to `tries` times, spaced out, with the same credential.
 * QUIET is checked before each re-send; it stops early (the record keeps its state, so a later run resumes it).
 */
async function settle(file, record, token, journal, quiet, tries = 3) {
  for (let i = 0; i < tries && (record.state === "pending" || record.state === "unknown"); i++) {
    await new Promise((r) => setTimeout(r, (i + 1) * 15_000));
    if (quiet()) return { record, quiet: true };
    record = await send(file, record, token);
    await journal("topup-resend", { outcome: record.state, status: record.lastStatus ?? null, transaction: record.transaction, explorer: explorerUrl(record.transaction) });
  }
  return { record, quiet: false };
}

/** QUIET stops the top-up without changing anything: the outcome is "pending", so the turn pauses and a later run resumes. */
async function quietStop(journal, note, record = null, file = null) {
  await journal("topup-paused", { reason: "QUIET file present", note, transaction: record?.transaction ?? null });
  const extra = { outcome: "pending", quiet: true, reason: `QUIET file present; ${note}` };
  return record ? summary(record, file, extra) : { ...extra, signed: false };
}

/**
 * Where a payment the door answered (or did not) leaves things. Open outcomes (unknown, or rejected after a re-send)
 * go to the chain once the signed deadline is past: no trace → "expired-local" (resolved); a receipt →
 * "landed-unreconciled" (blocks every new signature until the door answers it as credited).
 */
async function conclude(file, record, { journal, chainFacts, now }) {
  if (record.state === "landed-unreconciled") return summary(record, file, { outcome: "needs-reconcile", reason: RECONCILE_MESSAGE });
  if (!NEEDS_CHAIN_CHECK(record)) return summary(record, file);
  const seconds = () => Math.floor(now() / 1000);
  let decision = resolutionFor(record, seconds());
  if (decision.decision === "lookup") {
    let facts;
    try { facts = await chainFacts(record.transaction); } catch (error) {
      const reason = `Moderato could not be read (${refusalOf(error).message}); nothing new is signed meanwhile. Re-run later.`;
      await journal("topup-check-failed", { transaction: record.transaction, previousState: record.state, reason });
      return summary(record, file, { outcome: "lookup-failed", reason });
    }
    decision = resolutionFor(record, seconds(), facts);
  }
  if (decision.decision === "expired-local") {
    const next = { ...record, state: "expired-local", previousState: record.state, resolvedAt: new Date(now()).toISOString(), resolution: { headTimestamp: decision.headTimestamp, after: decision.after } };
    await persist(file, next);
    const reason = "No receipt and unknown to the node with the chain past its signed deadline: it can never land. Nothing was charged; a new payment may be signed.";
    await journal("topup-expired-local", { transaction: record.transaction, explorer: explorerUrl(record.transaction), previousState: record.state, sends: record.sends ?? 0, validBefore: record.validBefore, headTimestamp: decision.headTimestamp, reason });
    return summary(next, file, { reason });
  }
  if (decision.decision === "landed") {
    const next = { ...record, state: "landed-unreconciled", previousState: record.state, landedSeenAt: new Date(now()).toISOString(), receiptStatus: decision.receiptStatus, blockNumber: decision.blockNumber };
    await persist(file, next);
    await journal("topup-landed-unreconciled", { transaction: record.transaction, explorer: explorerUrl(record.transaction), previousState: record.state, receiptStatus: decision.receiptStatus, blockNumber: decision.blockNumber, reason: RECONCILE_MESSAGE });
    return summary(next, file, { outcome: "needs-reconcile", reason: RECONCILE_MESSAGE });
  }
  if (decision.decision === "operator") {
    await journal("topup-blocked", { transaction: record.transaction ?? null, previousState: record.state, reason: decision.reason });
    return summary(record, file, { outcome: "needs-reconcile", reason: decision.reason });
  }
  // wait: an unknown outcome keeps its own label and reason; a rejected re-send waits for its deadline.
  if (record.state === "unknown") return summary(record, file);
  await journal("topup-waiting", { transaction: record.transaction, previousState: record.state, sends: record.sends ?? 0, reason: decision.reason });
  return summary(record, file, { outcome: "awaiting-expiry", reason: decision.reason });
}

/** One saved, unresolved payment: re-send it (QUIET permitting), then conclude. Null when it ended without a credit and nothing of it can land. */
async function resume(file, record, { agentToken, journal, quiet, chainFacts, now }) {
  if (record.url !== NIGHT_SHIFT_DOOR) throw new Error("A saved payment names another door; refusing.");
  let next = record;
  if (RESEND.has(record.state)) {
    if (quiet()) return quietStop(journal, "the saved payment was not re-sent", record, file);
    await journal("topup-resume", { transaction: record.transaction, explorer: explorerUrl(record.transaction), previousState: record.state });
    next = await send(file, record, agentToken);
    await journal("topup-sent", { outcome: next.state, status: next.lastStatus ?? null, transaction: next.transaction, explorer: explorerUrl(next.transaction) });
    const settled = await settle(file, next, agentToken, journal, quiet);
    next = settled.record;
    if (settled.quiet) return quietStop(journal, "the saved payment's re-sends stopped", next, file);
  }
  const result = await conclude(file, next, { journal, chainFacts, now });
  return SPENT_NOTHING(result) ? null : result;
}

/**
 * One MPP top-up for night-shift, paid by the allowance key. Order: refuse any other door → resume each
 * unresolved saved payment, oldest first (never sign a new one while one may land; one the chain proves can no
 * longer land is resolved) → remaining limit ≥ 1.00 → unpaid POST (402 offer) → hygiene → sign once (mppx pull
 * mode; the chain's simulation refuses an over-limit or out-of-scope key before signing) → save the signed
 * credential (0600) → paid POST → on 202, resume with the same credential. QUIET (`quiet()`) is checked before
 * the unpaid POST, before signing and before every re-send of a saved credential, never between signing and the
 * first send.
 */
export async function fundNightShift({ repo, cfg, agentToken, recordDir, journal, quiet = () => false, chainFacts = readChainFacts, now = () => Date.now() }) {
  if (cfg.mpp.doorUrl !== NIGHT_SHIFT_DOOR) throw new Error("Refusing: the configured door is not the night-shift MPP door.");
  if (!AGENT_TOKEN_PATTERN.test(agentToken ?? "")) throw new Error("No valid local agent token; nothing was signed.");
  await mkdir(recordDir, { recursive: true, mode: 0o700 });

  for (const { file, record } of (await records(recordDir)).filter(({ record }) => UNRESOLVED(record))) {
    const open = await resume(file, record, { agentToken, journal, quiet, chainFacts, now });
    if (open) return open;
  }

  if (quiet()) return quietStop(journal, "nothing was signed or sent");
  const key = await keyFrom(repo, cfg.allowance);
  const keyAddress = privateKeyToAddress(key);
  let remaining;
  try {
    ({ remaining } = await Actions.accessKey.getRemainingLimit(readClient(), { account: cfg.allowance.stewardAddress, accessKey: keyAddress, token: PATHUSD }));
  } catch (error) {
    await journal("topup-stopped", { reason: `allowance could not be read: ${refusalOf(error).message}` });
    return { outcome: "allowance-unreadable", reason: refusalOf(error).message };
  }
  await journal("allowance-checked", { remaining: usd(remaining), needed: usd(cfg.mpp.amountAtomic), accessKey: keyAddress, steward: cfg.allowance.stewardAddress });
  if (remaining < BigInt(cfg.mpp.amountAtomic)) {
    await journal("allowance exhausted", { remaining: usd(remaining), needed: usd(cfg.mpp.amountAtomic) });
    return { outcome: "allowance-exhausted", remaining: usd(remaining) };
  }

  if (quiet()) return quietStop(journal, "nothing was signed or sent");
  let unpaid;
  try {
    unpaid = await fetch(NIGHT_SHIFT_DOOR, { method: "POST", headers: { [AGENT_TOKEN_HEADER]: agentToken }, redirect: "error", signal: AbortSignal.timeout(30_000) });
  } catch (error) {
    await journal("topup-stopped", { reason: `door unreachable: ${refusalOf(error).message}` });
    return { outcome: "door-unreachable", reason: refusalOf(error).message };
  }
  const offer = await readReply(unpaid);
  if (unpaid.status !== 402) {
    await journal("topup-refused", { status: unpaid.status, reason: reasonOf(offer) });
    return { outcome: unpaid.status === 409 ? "door-refused" : "not-offered", status: unpaid.status, reason: reasonOf(offer) };
  }
  let challenge;
  try { challenge = Challenge.deserialize(String(unpaid.headers.get("WWW-Authenticate") ?? "")); } catch {
    await journal("topup-declined", { reason: "no readable Payment challenge" });
    return { outcome: "declined", reason: "no readable Payment challenge" };
  }
  const problem = checkChallenge(challenge, cfg);
  if (problem) {
    await journal("topup-declined", { reason: problem });
    return { outcome: "declined", reason: problem };
  }
  await journal("topup-offer", { amount: usd(challenge.request.amount), payTo: challenge.request.recipient, expires: challenge.expires });

  if (quiet()) return quietStop(journal, "the offer was not signed");
  let credential;
  try {
    const account = Account.fromSecp256k1(key, { access: cfg.allowance.stewardAddress });
    const client = createClient({ chain: tempoModerato, transport: transport() });
    credential = await tempoClient.charge({
      account, mode: "pull", expectedChainId: tempoModerato.id, allowedChainIds: [tempoModerato.id], expectedRecipients: [cfg.mpp.payTo],
      getClient: () => client,
    }).createCredential({ challenge, context: {} });
  } catch (error) {
    // Either way this stops before a signature exists.
    const failure = classifySignFailure(error);
    if (failure.outcome === "allowance-exhausted") {
      // A keychain or TIP-20 refusal (SpendingLimitExceeded, CallNotAllowed, KeyExpired, …): the key may not pay this.
      await journal("allowance exhausted", { refusal: failure.name, signed: false });
      return { outcome: "allowance-exhausted", reason: failure.name };
    }
    // Anything else (an RPC timeout or rate limit while mppx prepared the transaction, …): the turn pauses.
    await journal("topup-sign-failed", { outcome: "sign-failed", refusal: failure.name ?? failure.message, reason: failure.message, signed: false });
    return { outcome: "sign-failed", reason: failure.message, signed: false };
  }
  const payload = Credential.deserialize(credential).payload;
  if (!String(credential).startsWith("Payment ") || payload?.type !== "transaction" || typeof payload.signature !== "string")
    throw new Error("mppx did not produce a pull-mode transaction credential; nothing was sent.");
  const decoded = Transaction.deserialize(payload.signature);
  const transaction = keccak256(await Transaction.serialize(decoded)).toLowerCase();
  const record = {
    version: 1, kind: "wren/mpp-payment/v1", url: NIGHT_SHIFT_DOOR, network: "eip155:42431", credential, challengeId: challenge.id,
    payer: cfg.allowance.stewardAddress, accessKey: keyAddress, payTo: String(challenge.request.recipient), currency: String(challenge.request.currency),
    amount: String(challenge.request.amount), transaction, validBefore: Number(decoded.validBefore ?? 0), createdAt: new Date().toISOString(), state: "signed",
  };
  const file = join(recordDir, `${record.createdAt.replace(/[:.]/g, "-")}-night-shift.json`);
  await persist(file, record, true);
  await journal("topup-signed", { transaction, explorer: explorerUrl(transaction), challengeId: challenge.id, validBefore: record.validBefore, savedBeforeSend: true });
  let next = await send(file, record, agentToken);
  await journal("topup-sent", { outcome: next.state, status: next.lastStatus ?? null, transaction, explorer: explorerUrl(transaction), reason: reasonOf(next.response) ?? next.lastError ?? null });
  const settled = await settle(file, next, agentToken, journal, quiet);
  if (settled.quiet) return quietStop(journal, "the saved payment's re-sends stopped", settled.record, file);
  return conclude(file, settled.record, { journal, chainFacts, now });
}
