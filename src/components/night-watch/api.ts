import type {
  ApiError,
  ClaimRequest,
  ClaimResponse,
  ClaimView,
  ConsentTerms,
  CopilotRequest,
  CopilotResponse,
  CreateJobRequest,
  CreateSessionRequest,
  CreateSessionResponse,
  EditionResponse,
  IdentityResponse,
  JobEvent,
  JobResponse,
  JobState,
  MeResponse,
  PublishResponse,
  RevokeSessionResponse,
  SessionResponse,
  SessionView,
  WorldMoment,
  WorldResponse,
} from "../../night-watch/api-types.ts";
import { NIGHT_WATCH_ROOM } from "../../night-watch/api-types.ts";

/**
 * Browser helpers for the /night-watch page: a typed client for the local Night Watch API and the
 * pure wording and formatting the page shows. Nothing here signs, pays or publishes by itself.
 */

export type Job = JobResponse["job"];
export type EditionMoment = EditionResponse["moments"][number];

export const API_ROOT = "/api/night-watch";
export const POLL_MS = 4_000;
/** GET /me asks Privy and Supabase on every call, so it slows down while nothing is running. */
export const IDLE_POLL_MS = 20_000;
export const BRIEF_LIMIT = 500;
export const MAX_HOURS = 12;
export const DEFAULT_HOURS = 2;
export const DEFAULT_START_SECONDS = 60;
/** One room top-up: 1.00 test USDC (six decimals) for five test credits. */
export const TOP_UP_ATOMIC = "1000000";
export const TOP_UP_CREDITS = 5;
export const PAYMENT_NETWORK = "eip155:84532" as const;
export const PAYMENT_NETWORK_NAME = "Base Sepolia";
export const ROOM_TITLE = "The Midnight Signal";
export const NO_PUBLISH = "Night Watch cannot publish or close an edition";
/** Phrases the Night Watch surfaces never use. */
export const BANNED_PHRASES = ["patron paid", "funded credits", "real money", "mainnet", "audited"] as const;

export const HOUR_CHOICES = [1, 2, 4, 8, 12] as const;
export const START_CHOICES = [
  { seconds: 60, label: "In 1 minute (demo)" },
  { seconds: 300, label: "In 5 minutes" },
  { seconds: 1_800, label: "In 30 minutes" },
  { seconds: 3_600, label: "In 1 hour" },
] as const;

// ---------------------------------------------------------------------------------------------
// Typed client

export class NightWatchApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "NightWatchApiError";
    this.status = status;
    this.code = code;
  }
}

export type TokenSource = () => Promise<string | null | undefined>;
type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
type CallOptions = { method?: "GET" | "POST"; body?: unknown; token?: TokenSource; signal?: AbortSignal; fetcher?: Fetcher };

const SIGN_IN_MESSAGE = "Sign in with Google on this machine first.";

/** A JSON error reply as the page shows it. A bare 404 is the local-only gate, not a missing record. */
export function apiErrorFrom(status: number, body: unknown): NightWatchApiError {
  const parsed = body && typeof body === "object" ? (body as Partial<ApiError>) : {};
  const code = typeof parsed.code === "string" && parsed.code ? parsed.code : "";
  const message = typeof parsed.error === "string" && parsed.error.trim() ? parsed.error.trim() : "";
  if (status === 404 && !code) {
    return new NightWatchApiError(404, "unavailable", "The Night Watch API is not available here. It runs only on the operator's own machine with local controls enabled.");
  }
  if (status === 401) return new NightWatchApiError(401, code || "sign_in", message || SIGN_IN_MESSAGE);
  return new NightWatchApiError(status, code || "error", message || `The Night Watch answered with status ${status}.`);
}

export async function callNightWatch<T>(path: string, options: CallOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.token) {
    const token = await options.token();
    if (!token) throw new NightWatchApiError(401, "sign_in", SIGN_IN_MESSAGE);
    headers.Authorization = `Bearer ${token}`;
  }
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(`${API_ROOT}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
      credentials: "same-origin",
      signal: options.signal,
    });
  } catch (error) {
    if ((error as { name?: string })?.name === "AbortError") throw error;
    throw new NightWatchApiError(0, "network", "The local Night Watch server did not answer. Check that the app is still running.");
  }
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok) throw apiErrorFrom(response.status, body);
  if (body === null) throw new NightWatchApiError(response.status, "invalid_reply", "The Night Watch sent an empty or unreadable reply.");
  return body as T;
}

/** Only same-origin Night Watch paths may receive the maker's bearer token. */
export function privateApiPath(path: string | null | undefined): string | null {
  if (typeof path !== "string" || !path.startsWith(`${API_ROOT}/`)) return null;
  if (path.includes("//") || path.includes("..") || path.includes("\\") || /[\s#]/.test(path)) return null;
  return path;
}

export async function fetchPrivateImage(path: string, token: TokenSource, options: { signal?: AbortSignal; fetcher?: Fetcher } = {}): Promise<Blob> {
  const safe = privateApiPath(path);
  if (!safe) throw new NightWatchApiError(400, "invalid_path", "That private image address is not a Night Watch address.");
  const bearer = await token();
  if (!bearer) throw new NightWatchApiError(401, "sign_in", SIGN_IN_MESSAGE);
  const response = await (options.fetcher ?? fetch)(safe, {
    headers: { Authorization: `Bearer ${bearer}` },
    cache: "no-store",
    credentials: "same-origin",
    signal: options.signal,
  });
  if (!response.ok) {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    throw apiErrorFrom(response.status, body);
  }
  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) throw new NightWatchApiError(502, "not_image", "The private candidate did not come back as an image.");
  return blob;
}

export function nightWatchClient(token: TokenSource, fetcher?: Fetcher) {
  const authed = <T>(path: string, options: Omit<CallOptions, "token" | "fetcher"> = {}) => callNightWatch<T>(path, { ...options, token, fetcher });
  const id = encodeURIComponent;
  return {
    world: (signal?: AbortSignal) => callNightWatch<WorldResponse>("/world", { fetcher, signal }),
    /** The same world, read as the signed-in maker so their own moment is not shown as a friend's. */
    viewerWorld: (signal?: AbortSignal) => authed<WorldResponse>("/world", { signal }),
    me: (signal?: AbortSignal) => authed<MeResponse>("/me", { signal }),
    createSession: (body: CreateSessionRequest) => authed<CreateSessionResponse>("/sessions", { method: "POST", body }),
    confirmSession: (sessionId: string) => authed<SessionResponse>(`/sessions/${id(sessionId)}/confirm`, { method: "POST", body: {} }),
    revokeSession: (sessionId: string) => authed<RevokeSessionResponse>(`/sessions/${id(sessionId)}/revoke`, { method: "POST", body: {} }),
    createJob: (body: CreateJobRequest) => authed<JobResponse>("/jobs", { method: "POST", body }),
    job: (jobId: string, signal?: AbortSignal) => authed<JobResponse>(`/jobs/${id(jobId)}`, { signal }),
    publish: (jobId: string, candidate: number) => authed<PublishResponse>(`/jobs/${id(jobId)}/publish`, { method: "POST", body: { candidate } }),
    edition: (tip: string, signal?: AbortSignal) => authed<EditionResponse>(`/edition?tip=${id(tip)}`, { signal }),
    claim: (body: ClaimRequest) => authed<ClaimResponse>("/claims", { method: "POST", body }),
    identity: (signal?: AbortSignal) => authed<IdentityResponse>("/identity", { signal }),
    /** The desk co-pilot's suggested briefs for a fork point (operator-paid, rate-limited). */
    copilot: (body: CopilotRequest, signal?: AbortSignal) => authed<CopilotResponse>("/copilot", { method: "POST", body, signal }),
    candidateImage: (path: string, signal?: AbortSignal) => fetchPrivateImage(path, token, { signal, fetcher }),
  };
}

export type NightWatchClient = ReturnType<typeof nightWatchClient>;

export const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

// ---------------------------------------------------------------------------------------------
// Amounts, addresses and times

function units(value: string | bigint, decimals: number): { whole: bigint; fraction: string; negative: boolean } {
  let amount: bigint;
  try {
    amount = typeof value === "bigint" ? value : BigInt(value);
  } catch {
    amount = 0n;
  }
  const negative = amount < 0n;
  if (negative) amount = -amount;
  const base = 10n ** BigInt(decimals);
  return { whole: amount / base, fraction: (amount % base).toString().padStart(decimals, "0"), negative };
}

/** Base units as a decimal string, trimmed to between `minFraction` and `maxFraction` digits (truncated). */
export function formatUnits(value: string | bigint, decimals: number, maxFraction: number, minFraction = 0): string {
  const { whole, fraction, negative } = units(value, decimals);
  let digits = fraction.slice(0, maxFraction).replace(/0+$/, "");
  if (digits.length < minFraction) digits = digits.padEnd(minFraction, "0");
  const text = digits ? `${whole}.${digits}` : `${whole}`;
  return negative ? `-${text}` : text;
}

/** "1.00 test USDC" from six-decimal base units. */
export const formatUsdc = (atomic: string | bigint) => `${formatUnits(atomic, 6, 6, 2)} test USDC`;

/** "0.25 test MON" from wei; tiny non-zero amounts read as "< 0.000001". */
export function formatMon(wei: string | bigint): string {
  const text = formatUnits(wei, 18, 6, 0);
  let positive = false;
  try {
    positive = BigInt(wei) > 0n;
  } catch {
    positive = false;
  }
  return positive && text === "0" ? "< 0.000001 test MON" : `${text} test MON`;
}

export function positiveWei(value: string | null | undefined): boolean {
  try {
    return !!value && BigInt(value) > 0n;
  } catch {
    return false;
  }
}

/** Operator inference expense, already in dollars as a decimal string. */
export function formatUsd(value: string | null | undefined): string {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return "≈$0.00";
  return `≈$${amount.toFixed(2)}`;
}

export function shortHex(value: string | null | undefined, head = 6, tail = 4): string {
  if (!value) return "";
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export const sameAddress = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** "1 h 59 min left", "4 min left" or "Ended". */
export function timeLeft(deadline: string, now: Date): string {
  const ms = Date.parse(deadline) - now.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return "Ended";
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes} min left`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min left` : `${hours} h left`;
}

/** "in 45 s", "in 3 min", "now". */
export function startsIn(runAfter: string, now: Date): string {
  const ms = Date.parse(runAfter) - now.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return "now";
  const seconds = Math.ceil(ms / 1_000);
  if (seconds < 90) return `in ${seconds} s`;
  return `in ${Math.round(seconds / 60)} min`;
}

export function clockTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export const candidateLetter = (number: number) =>
  Number.isInteger(number) && number >= 1 && number <= 26 ? String.fromCharCode(64 + number) : String(number);

// ---------------------------------------------------------------------------------------------
// Consent

export type DeskChoices = {
  forkPointId: string;
  brief: string;
  attempts: 1 | 2 | 3;
  maxPayments: 0 | 1;
  hours: number;
  startInSeconds: number;
};

export type ConsentPreview = Pick<ConsentTerms, "roomId" | "network" | "maxPaymentAtomic" | "totalAllowanceAtomic" | "maxPayments" | "attemptAllowance" | "deadline" | "purpose" | "revocation">;

export const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** What the maker agrees to before anything is created; the server's terms must match it. */
export function consentPreview(choices: DeskChoices, now: Date, forkPointTitle = "the chosen moment"): ConsentPreview {
  const deadline = new Date(now.getTime() + Math.round(choices.hours * 3_600_000));
  return {
    purpose: `Prepare ${plural(choices.attempts, "private candidate")} continuing “${forkPointTitle}” while you are away, buying at most ${choices.maxPayments ? "one room top-up" : "no room top-ups"}.`,
    roomId: NIGHT_WATCH_ROOM,
    network: PAYMENT_NETWORK,
    maxPaymentAtomic: TOP_UP_ATOMIC,
    totalAllowanceAtomic: (BigInt(TOP_UP_ATOMIC) * BigInt(choices.maxPayments)).toString(),
    maxPayments: choices.maxPayments,
    attemptAllowance: choices.attempts,
    deadline: deadline.toISOString(),
    revocation: "Revoke on this page at any time: the signer is removed from your wallet and its Privy policy is set to deny every request.",
  };
}

export type ConsentItem = { label: string; value: string };

/**
 * Limit, Allowed call, Only to and Expires are the labels of Wren's allowance on /agents, so both
 * agents read as the same kind of contract; the Night Watch adds attempts, what it never does and Revoke.
 */
export function consentItems(terms: ConsentPreview, formatDeadline: (iso: string) => string = dateTime, roomTitle = ROOM_TITLE): ConsentItem[] {
  const total = BigInt(terms.totalAllowanceAtomic || "0");
  return [
    { label: "Purpose", value: terms.purpose },
    {
      label: "Limit",
      value: total > 0n
        ? `${formatUsdc(total)} in at most ${plural(terms.maxPayments, "room top-up")}, each adding ${TOP_UP_CREDITS} test credits`
        : `${formatUsdc(0n)}: this Night Watch may not buy a top-up`,
    },
    {
      label: "Allowed call",
      value: terms.maxPayments === 0
        ? "None: no payments allowed"
        : `One USDC transfer authorization of at most ${formatUsdc(terms.maxPaymentAtomic)} on ${PAYMENT_NETWORK_NAME}, signed through your Privy wallet`,
    },
    { label: "Only to", value: `${roomTitle} (${terms.roomId}), through its top-up door` },
    { label: "Expires", value: `Signing stops at ${formatDeadline(terms.deadline)}` },
    { label: "Attempts", value: `Up to ${plural(terms.attemptAllowance, "private candidate")}; operator-paid inference` },
    { label: "Never", value: `${NO_PUBLISH}. Candidates stay private until you choose one.` },
    { label: "Revoke", value: terms.revocation },
  ];
}

/** Differences between what the maker saw and what the server is about to authorize. */
export function consentMismatches(preview: ConsentPreview, terms: ConsentTerms, toleranceMs = 5 * 60_000): string[] {
  const problems: string[] = [];
  if (terms.roomId !== preview.roomId) problems.push("room");
  if (terms.network !== preview.network) problems.push("network");
  if (terms.maxPaymentAtomic !== preview.maxPaymentAtomic) problems.push("largest single payment");
  if (terms.totalAllowanceAtomic !== preview.totalAllowanceAtomic) problems.push("total allowance");
  if (terms.maxPayments !== preview.maxPayments) problems.push("number of top-ups");
  if (terms.attemptAllowance !== preview.attemptAllowance) problems.push("attempts");
  const drift = Math.abs(Date.parse(terms.deadline) - Date.parse(preview.deadline));
  if (!Number.isFinite(drift) || drift > toleranceMs) problems.push("deadline");
  return problems;
}

export function deskProblems(choices: DeskChoices): string[] {
  const problems: string[] = [];
  const brief = choices.brief.trim();
  if (!choices.forkPointId) problems.push("Choose a fork point.");
  if (!brief) problems.push("Write a brief for the Night Watch.");
  if (brief.length > BRIEF_LIMIT) problems.push(`Keep the brief within ${BRIEF_LIMIT} characters.`);
  if (![1, 2, 3].includes(choices.attempts)) problems.push("Choose one to three candidates.");
  if (![0, 1].includes(choices.maxPayments)) problems.push("Choose whether one top-up is allowed.");
  if (!(choices.hours > 0 && choices.hours <= MAX_HOURS)) problems.push(`Authorize between 1 and ${MAX_HOURS} hours.`);
  if (!(choices.startInSeconds >= 0) || choices.startInSeconds >= choices.hours * 3_600) problems.push("Start the Night Watch before its allowance ends.");
  return problems;
}

/** Sessions that still hold (or are about to hold) a signer on the maker's wallet. */
export const openSessions = (sessions: SessionView[]) =>
  sessions.filter((session) => session.state === "active" || session.state === "awaiting_signer");

// ---------------------------------------------------------------------------------------------
// Job timeline

export const JOB_STEPS: { state: JobState; label: string; optional?: boolean }[] = [
  { state: "scheduled", label: "Scheduled" },
  { state: "checking", label: "Checking room credits" },
  { state: "topping_up", label: "Buying one room top-up", optional: true },
  { state: "waiting_payment", label: "Waiting for the payment to settle", optional: true },
  { state: "generating", label: "Preparing private candidates" },
  { state: "ready", label: "Ready for your review" },
  { state: "published", label: "Published by you" },
];

const STATE_LABELS: Record<JobState, string> = {
  scheduled: "Scheduled",
  checking: "Checking room credits",
  topping_up: "Buying a room top-up",
  waiting_payment: "Waiting for the payment to settle",
  generating: "Preparing private candidates",
  ready: "Ready for your review",
  blocked: "Stopped safely",
  failed: "Stopped with an error",
  published: "Published by you",
};

export const jobStateLabel = (state: JobState) => STATE_LABELS[state] ?? state;
export const isJobActive = (state: JobState) => !["ready", "blocked", "failed", "published"].includes(state);

export type StepStatus = "done" | "current" | "upcoming" | "skipped" | "stopped";
export type TimelineStep = { state: JobState; label: string; status: StepStatus; optional: boolean };

/**
 * Where a job is, step by step. A stopped job marks the last step it reached; payment steps read
 * as skipped when the job moved past them without a top-up.
 */
/** The runner's event names, mapped to the timeline step each one belongs to. */
const EVENT_STEP: Record<string, JobState> = {
  scheduled: "scheduled",
  started: "checking",
  checked: "checking",
  credits_changed: "checking",
  topping_up: "topping_up",
  topped_up: "topping_up",
  waiting_payment: "waiting_payment",
  payment_pending: "waiting_payment",
  generating: "generating",
  // The brain thinks once, before the first candidate is drawn.
  brain: "generating",
  prepared: "generating",
  candidate_failed: "generating",
  uncertain: "generating",
  refund_pending: "generating",
  ready: "ready",
  published: "published",
};

const EVENT_TITLES: Record<string, string> = {
  scheduled: "Scheduled",
  started: "Night Watch started",
  checked: "Checked room credits",
  credits_changed: "Room credits changed",
  topped_up: "Bought one room top-up",
  payment_pending: "Payment waiting to settle",
  prepared: "Prepared a private candidate",
  candidate_failed: "A candidate could not be prepared",
  uncertain: "A candidate's result is uncertain",
  refund_pending: "Room credit refund pending",
  ready: "Ready for your review",
  published: "Published by you",
};

export function jobTimeline(job: Pick<Job, "state" | "events" | "payment">): TimelineStep[] {
  const order = JOB_STEPS.map((step) => step.state);
  const reached = job.events.reduce((max, event) => Math.max(max, order.indexOf(EVENT_STEP[event.step] ?? (event.step as JobState))), -1);
  const paid = (!!job.payment && job.payment.state !== "released") ||
    job.events.some((event) => event.step === "topped_up" || event.step === "payment_pending");
  const stopped = job.state === "blocked" || job.state === "failed";
  const current = stopped ? Math.max(reached, 0) : job.state === "published" ? order.length : Math.max(order.indexOf(job.state), 0);
  return JOB_STEPS.map((step, index) => {
    let status: StepStatus = index < current ? "done" : index === current ? (stopped ? "stopped" : "current") : "upcoming";
    // A credited top-up stays done while the runner re-checks the room's credits.
    if (status === "upcoming" && step.optional && paid && index <= reached) status = "done";
    if (step.optional && status === "done" && !paid) status = "skipped";
    return { state: step.state, label: step.label, status, optional: !!step.optional };
  });
}

/** The brain's one event: it planned the takes, or the night fell back to the plain prompts. */
const brainTitle = (detail: string) => (/\bused the plain prompts\b/i.test(detail) ? "Used the plain prompts" : "Read the room and planned the takes");

/** Events newest last, with a readable step name. */
export function eventLines(events: JobEvent[]): { at: string; title: string; detail: string }[] {
  return [...events]
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .map((event) => ({
      at: event.at,
      title: event.step === "brain" ? brainTitle(event.detail) : EVENT_TITLES[event.step] ?? STATE_LABELS[event.step as JobState] ?? event.step.replace(/[_-]+/g, " "),
      detail: event.detail,
    }));
}

export function expenseText(expense: Job["expense"]): string {
  if (!expense.images) return "No images prepared yet, so no image inference expense.";
  const model = expense.model ? ` (${expense.model})` : "";
  return `Operator-paid inference: ${plural(expense.images, "image")}, ${formatUsd(expense.operatorPaidUsd)}${model}.`;
}

export type ReceiptView = {
  amount: string;
  credits: string;
  payer: string;
  payerIsYou: boolean;
  signedBy: string;
  network: string;
  transaction: string | null;
  explorerUrl: string | null;
};

export function receiptView(receipt: NonNullable<Job["receipt"]>, walletAddress?: string | null, roomTitle = ROOM_TITLE): ReceiptView {
  const payerIsYou = sameAddress(receipt.payer, walletAddress);
  return {
    amount: receipt.amountAtomic ? formatUsdc(receipt.amountAtomic) : formatUsdc(TOP_UP_ATOMIC),
    credits: `+${receipt.creditsAdded ?? TOP_UP_CREDITS} test credits to ${roomTitle}`,
    payer: payerIsYou ? `your in-app wallet (${shortHex(receipt.payer)})` : receipt.payer ? shortHex(receipt.payer) : "your in-app wallet",
    payerIsYou,
    signedBy: "Signed by your Night Watch signer within your allowance.",
    network: PAYMENT_NETWORK_NAME,
    transaction: receipt.transaction,
    explorerUrl: receipt.explorerUrl,
  };
}

// ---------------------------------------------------------------------------------------------
// World, paths and the edition

/** Root-first path ending at `tipId`; stops at a missing parent or a loop. */
export function storyPath(moments: WorldMoment[], tipId: string | null | undefined, limit = 32): WorldMoment[] {
  const byId = new Map(moments.map((moment) => [moment.id, moment]));
  const path: WorldMoment[] = [];
  const seen = new Set<string>();
  let id = tipId ?? null;
  while (id && !seen.has(id) && path.length < limit) {
    const moment = byId.get(id);
    if (!moment) break;
    seen.add(id);
    path.unshift(moment);
    id = moment.parentId;
  }
  return path;
}

/** Fork point choices: the release path first (newest first), then other moments, newest first. */
export function forkPointChoices(world: Pick<WorldResponse, "moments" | "defaultForkPointId">): WorldMoment[] {
  const path = storyPath(world.moments, world.defaultForkPointId);
  const onPath = new Set(path.map((moment) => moment.id));
  const rest = world.moments
    .filter((moment) => !onPath.has(moment.id))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return [...path.reverse(), ...rest];
}

export const momentLabel = (moment: Pick<WorldMoment, "title" | "makerLabel">) => `${moment.title} · ${moment.makerLabel}`;

/** Pilot titles are often the caption's opening words; show the caption once instead of twice. */
export function momentHeadline(title: string, caption: string | null | undefined): { heading: string; body: string } {
  const cleanTitle = title.trim().replace(/(?:…|\.\.\.)$/, "").trim();
  const cleanCaption = (caption ?? "").trim();
  if (cleanCaption && cleanTitle && cleanCaption.toLowerCase().startsWith(cleanTitle.toLowerCase())) return { heading: cleanCaption, body: "" };
  return { heading: title.trim() || cleanCaption, body: cleanCaption };
}

/** The maker's newest Night Watch moment, for opening the edition when no job is selected. */
export function latestNightWatchMoment(moments: WorldMoment[], makerId: string | null | undefined): WorldMoment | null {
  return moments
    .filter((moment) => moment.source === "night-watch" && (!makerId || moment.makerId === makerId))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] ?? null;
}

export type ShareRow = { address: string; claimableWei: string; claimedWei: string; claim: ClaimView | null };

/** Each frozen recipient with its latest helper claim. */
export function shareRows(edition: Pick<EditionResponse, "release" | "claims">): ShareRow[] {
  if (!edition.release) return [];
  const releaseId = edition.release.id.toLowerCase();
  return edition.release.beneficiaries.map((beneficiary) => {
    const claims = edition.claims
      .filter((claim) => claim.releaseId.toLowerCase() === releaseId && sameAddress(claim.beneficiary, beneficiary.address))
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    return { ...beneficiary, claim: claims[0] ?? null };
  });
}

export const CLAIM_STATE_LABELS: Record<ClaimView["state"], string> = {
  signed: "Signed by the helper, not sent yet",
  broadcast: "Sent to Monad testnet",
  confirmed: "Included in a block, awaiting finality",
  finalized: "Checked on-chain",
  failed: "Did not complete",
};

/** Same-origin path or a URL the page may load as an image (never a data: or script URL). */
export function displayImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

/** A link the page may render: same-origin paths and http(s) URLs only. */
export function safeHref(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}

/** Where to send someone back after Google sign-in so they land on this page. */
export function nightWatchReturnUrl(current: string): string {
  const url = new URL(current);
  url.pathname = url.pathname === "/night-watch-privy" ? "/night-watch-privy" : "/night-watch";
  url.search = "";
  url.hash = "";
  return url.href;
}

/** Lowercase hex SHA-256 of bytes, using Web Crypto (browsers and Node). */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------------------------
// Recap card

export type RecapInput = {
  worldTitle: string;
  kitVersion: string;
  momentTitle: string;
  makerName: string;
  pathMakers: string[];
  candidate: number | null;
  receipt: { amountAtomic: string | null; creditsAdded: number | null; transaction: string | null } | null;
  release: { id: string; exists: boolean; receivedWei: string } | null;
  claims: ClaimView[];
  expense: { operatorPaidUsd: string; images: number } | null;
  date: string;
};

export type RecapModel = { eyebrow: string; title: string; byline: string; lines: string[]; footer: string };

/** Text for the exportable recap card, most important first; the canvas drops lines that do not fit. */
export function recapModel(input: RecapInput): RecapModel {
  const makers = [...new Set(input.pathMakers.filter(Boolean))];
  const finalized = input.claims.filter((claim) => claim.state === "finalized");
  const lines = [
    `World: ${input.worldTitle} · kit v${input.kitVersion}`,
    makers.length ? `Made together by ${makers.length > 4 ? `${makers.slice(0, 4).join(", ")} and ${makers.length - 4} more` : makers.join(", ")}` : "",
    input.candidate ? `Night Watch prepared candidate ${candidateLetter(input.candidate)}; the maker chose to publish it` : "Published by the maker after a Night Watch",
    input.receipt?.transaction
      ? `Room top-up: ${formatUsdc(input.receipt.amountAtomic ?? TOP_UP_ATOMIC)} on ${PAYMENT_NETWORK_NAME} · +${input.receipt.creditsAdded ?? TOP_UP_CREDITS} test credits · ${shortHex(input.receipt.transaction)}`
      : "Room top-up: none needed",
    input.release?.exists
      ? `Release ${shortHex(input.release.id)} on Monad testnet · ${formatMon(input.release.receivedWei)} support received`
      : "Release: not frozen yet",
    finalized.length ? `Shares delivered and checked on-chain: ${finalized.length}` : "",
    input.expense && input.expense.images ? `Operator-paid inference: ${plural(input.expense.images, "image")}, ${formatUsd(input.expense.operatorPaidUsd)}` : "",
  ].filter(Boolean);
  return {
    eyebrow: "FORK NIGHT · THE MORNING EDITION",
    title: input.momentTitle,
    byline: `by ${input.makerName} · ${input.date}`,
    lines,
    footer: "Testnet only. Test tokens have no redemption value.",
  };
}

export function recapFileName(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  return `night-watch-${slug || "edition"}.png`;
}
