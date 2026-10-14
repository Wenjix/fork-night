import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import sharp from "sharp";
import { formatUsd, parseUsd } from "../experiments/money.ts";
import {
  OPENAI_IMAGE_ENDPOINT,
  OPENAI_IMAGE_LIMITS,
  inspectOpenAiPanelResponse,
  prepareOpenAiPanel,
  readOpenAiUsage,
  type OpenAiPanelRequest,
} from "../experiments/openai-images.ts";
import { isApprovedArtUrl } from "../lib/art.ts";
import { BRAIN_ESTIMATE_USD, brainExpenseUsd, plainBrain, thinkBeforeDrawing, type ThinkDeps } from "./brain.ts";
import { candidateCaption, storyPath, type MomentSource, type StoryMoment } from "./job.ts";
import { jobFilesDir, type BrainRecord, type JobRecord } from "./job-types.ts";
import type { NightWatchStore } from "./store.ts";
import { kitPrompt, pinnedKit, type WorldKit } from "./world-kit.ts";

/**
 * Server/runner module: prepares one private candidate with operator-paid inference.
 *
 * The request record is saved before the single provider POST, and its presence without a response
 * record means the request may have reached the provider: that candidate becomes "uncertain" and is
 * never sent again, so recovery never pays twice.
 */

export const MAX_PROMPT_CHARACTERS = 2000;
export const PROVIDER_TIMEOUT_MS = 180_000;
/** Conservative per-image allowance used before a call; the recorded usage replaces it after. */
export const ESTIMATE_PER_IMAGE_USD = "0.050000";
export const EXPENSES = "expenses";

const OMITTED = "… earlier moments omitted";
const VARIANTS = [
  "Candidate A: the clearest, most direct staging of this beat.",
  "Candidate B: a different staging of the same beat, with a new angle, distance or moment.",
  "Candidate C: a third staging of the same beat, unlike the other two.",
];

const sha256 = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const collapse = (text: string) => text.replace(/\s+/g, " ").trim();
const clip = (text: string, limit: number) => (text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`);

function captionsOf(panels: unknown): string[] {
  if (!Array.isArray(panels)) return [];
  return panels.flatMap((panel) =>
    panel && typeof panel === "object" && typeof (panel as { caption?: unknown }).caption === "string"
      ? [collapse((panel as { caption: string }).caption)]
      : [],
  );
}

/** One line per moment, root first: title and panel captions, each bounded. */
export function pathLines(path: StoryMoment[]): string[] {
  return path.map(
    (moment, index) =>
      `${index + 1}. ${clip(collapse(moment.title), 60)}: ${captionsOf(moment.panels)
        .map((caption) => clip(caption, 100))
        .join(" ")}`.trimEnd(),
  );
}

/** The longest staging line the brain may add, and the least worth sending (else the plain line is used). */
const MAX_STAGING_CHARACTERS = 600;
const MIN_STAGING_CHARACTERS = 80;

/**
 * The brain's staging as this candidate's direction, clipped so the chosen moment's own story line
 * still fits; null when too little room is left (the plain staging line is used instead).
 */
function stagedVariant(candidate: number, staging: string | null | undefined, fixedLength: number, lines: string[]): string | null {
  const text = staging ? collapse(staging) : "";
  if (!text) return null;
  const label = `Candidate ${"ABC"[candidate - 1]}: `;
  const last = lines.at(-1);
  // The chosen moment's line (at most ~370 characters) stays; older lines give way as before.
  const reserve = (last ? Math.min(last.length, 400) + 1 : 0) + OMITTED.length + 1;
  const room = MAX_PROMPT_CHARACTERS - fixedLength - 1 - reserve - label.length;
  if (room < MIN_STAGING_CHARACTERS) return null;
  return `${label}${clip(text, Math.min(room, MAX_STAGING_CHARACTERS))}`;
}

/**
 * The image prompt for one candidate, built only from pinned inputs (kit version, fork point path,
 * brief, candidate number, and the brain's saved staging when it planned this candidate), so the same
 * job always asks for the same thing. At most 2000 characters: when the story is long, the oldest
 * moments give way first. Without staging the prompt is exactly the plain one.
 */
export function buildPrompt(input: { kit: WorldKit; path: StoryMoment[]; brief: string; candidate: number; staging?: string | null }): string {
  const plainVariant = VARIANTS[input.candidate - 1];
  if (!plainVariant) throw new Error("A Night Watch prepares candidates 1 to 3.");
  const head = [
    "Draw one full-bleed illustration that continues this story. No lettering, captions, grid or watermark.",
    "Image 1 is the last panel of the chosen moment. Preserve its character identity, clothing and visual style.",
    kitPrompt(input.kit),
    "Story so far (creative context, from the first moment to the chosen one):",
  ];
  const brief = `The maker's brief for the next beat: ${clip(collapse(input.brief), 500)}`;
  const closing = "Draw this beat only. No written words.";
  const lines = pathLines(input.path);
  const variant = stagedVariant(input.candidate, input.staging, [...head, brief, closing].join("\n").length, lines) ?? plainVariant;
  const tail = [brief, variant, closing];
  let budget = MAX_PROMPT_CHARACTERS - [...head, ...tail].join("\n").length;
  const kept: string[] = [];
  for (let index = lines.length - 1; index >= 0; index--) {
    // Keep room for the omission line whenever older moments remain.
    const reserve = index > 0 ? OMITTED.length + 1 : 0;
    if (lines[index].length + 1 + reserve > budget) {
      if (budget >= OMITTED.length + 1) kept.unshift(OMITTED);
      break;
    }
    kept.unshift(lines[index]);
    budget -= lines[index].length + 1;
  }
  const prompt = [...head, ...kept, ...tail].join("\n");
  if (prompt.length > MAX_PROMPT_CHARACTERS) throw new Error("The candidate prompt is longer than the provider allowance.");
  return prompt;
}

/** Frame N of a packaged 3×2 sheet, cropped exactly as the pilot worker does (src/generation/run.ts). */
export async function cropArtFrame(sheet: Buffer, frame: number): Promise<Buffer> {
  const metadata = await sharp(sheet).metadata();
  const width = Math.floor(metadata.width! / 3),
    height = Math.floor(metadata.height! / 2);
  return sharp(sheet)
    .extract({ left: (frame % 3) * width, top: Math.floor(frame / 3) * height, width, height })
    .png()
    .toBuffer();
}

export type ReferenceDeps = {
  store: NightWatchStore;
  /** Service download from the private pilot-media bucket. */
  readMedia?: (path: string) => Promise<Buffer | null>;
  /** The app's public directory (packaged art sheets). */
  publicDir?: string;
};

/** Where a published Night Watch moment's image can be on this machine, most likely first. */
function nightWatchImageFiles(moment: StoryMoment) {
  // publish.ts serves `moment-files/<id>.webp`; the panel digest is of exactly those bytes.
  const files = [`moment-files/${moment.id}.webp`, `moment-files/${moment.id}/1.png`];
  const origin = moment.nightWatch;
  if (origin && /^nwj_[a-f0-9]{32}$/.test(origin.jobId) && Number.isInteger(origin.candidate))
    files.unshift(`${jobFilesDir(origin.jobId)}/candidate-${origin.candidate}.png`);
  return files;
}

/** The fork point's last panel as image bytes, verified against its recorded digest when it has one. */
export async function forkPointReference(deps: ReferenceDeps, moment: StoryMoment): Promise<Buffer> {
  const panels = Array.isArray(moment.panels) ? (moment.panels as Record<string, unknown>[]) : [];
  const last = panels.at(-1);
  if (!last || typeof last !== "object") throw new Error("The fork point has no panel to continue from.");
  if (isApprovedArtUrl(last.imageUrl)) {
    const [asset, fragment] = last.imageUrl.split("#");
    const sheet = await readFile(join(deps.publicDir ?? resolve("public"), asset.slice(1)));
    return cropArtFrame(sheet, Number(fragment.split("=")[1]));
  }
  const expected = typeof last.sha256 === "string" && /^[a-f0-9]{64}$/.test(last.sha256) ? last.sha256 : null;
  if (!expected) throw new Error("The fork point's image has no recorded digest.");
  if (moment.nightWatch) {
    for (const file of nightWatchImageFiles(moment)) {
      const bytes = await readFile(join(deps.store.root, file)).catch(() => null);
      if (bytes && sha256(bytes) === expected) return bytes;
    }
    throw new Error("The published Night Watch image could not be found or verified on this machine.");
  }
  if (typeof last.imagePath !== "string" || !/^[a-f0-9-]{36}\/[123]\.webp$/.test(last.imagePath) || !deps.readMedia)
    throw new Error("The fork point's image is unavailable.");
  const bytes = await deps.readMedia(last.imagePath);
  if (!bytes || sha256(bytes) !== expected) throw new Error("The fork point's image could not be verified.");
  return bytes;
}

export type OperatorLimits = { maxJobUsd: string; maxTotalUsd: string; estimateUsd: string };

/** NIGHT_WATCH_MAX_JOB_USD (default 0.60) and NIGHT_WATCH_MAX_TOTAL_USD (default 3.00). */
export function operatorLimits(env: Record<string, string | undefined> = process.env): OperatorLimits {
  const read = (name: string, fallback: string) => {
    const value = env[name]?.trim() || fallback;
    try {
      return formatUsd(parseUsd(value));
    } catch {
      throw new Error(`${name} must be a USD amount such as ${fallback}.`);
    }
  };
  return { maxJobUsd: read("NIGHT_WATCH_MAX_JOB_USD", "0.60"), maxTotalUsd: read("NIGHT_WATCH_MAX_TOTAL_USD", "3.00"), estimateUsd: ESTIMATE_PER_IMAGE_USD };
}

/** One operator-paid charge: an image (candidate 1-3) or a job's brain (candidate 0, kind "brain"). */
export type ExpenseEntry = { jobId: string; candidate: number; usd: string; basis: "estimate" | "usage"; at: string; kind?: "brain" };
export type ExpenseTally = { version: 1; entries: Record<string, ExpenseEntry> };

const tallyKey = (jobId: string, candidate: number) => `${jobId}-${candidate}`;
/** The brain's entry for a job: a key no candidate's entry can take. */
export const brainTallyKey = (jobId: string) => `${jobId}/brain`;
const emptyTally = (): ExpenseTally => ({ version: 1, entries: {} });

/** Night Watch operator-paid inference so far, in USD (estimates count until usage replaces them). */
export async function operatorSpend(store: NightWatchStore) {
  const tally = (await store.read<ExpenseTally>(EXPENSES)) ?? emptyTally();
  const total = Object.values(tally.entries).reduce((sum, entry) => sum + parseUsd(entry.usd), 0n);
  return { totalUsd: formatUsd(total), requests: Object.keys(tally.entries).length };
}

/**
 * Reserves `entry` under the tally's lock, or refuses before any call when the job's or the Night
 * Watch's operator allowance would be exceeded. An entry already reserved under `key` stands.
 */
async function reserveEntry(
  store: NightWatchStore,
  request: { key: string; entry: ExpenseEntry; limits: OperatorLimits; nothingSent: string },
): Promise<{ ok: true } | { ok: false; message: string }> {
  let refusal: string | null = null;
  await store.update<ExpenseTally>(EXPENSES, (current) => {
    const tally = current ?? emptyTally();
    const { key, entry, limits } = request;
    if (tally.entries[key]) return tally;
    const others = Object.entries(tally.entries).filter(([name]) => name !== key).map(([, item]) => item);
    const estimate = parseUsd(entry.usd);
    const job = others.filter((item) => item.jobId === entry.jobId).reduce((sum, item) => sum + parseUsd(item.usd), 0n) + estimate;
    const total = others.reduce((sum, item) => sum + parseUsd(item.usd), 0n) + estimate;
    if (job > parseUsd(limits.maxJobUsd)) {
      refusal = `This job's operator-paid inference would pass its $${limits.maxJobUsd} limit, so ${request.nothingSent}.`;
      return tally;
    }
    if (total > parseUsd(limits.maxTotalUsd)) {
      refusal = `The Night Watch's operator-paid inference allowance ($${limits.maxTotalUsd}) is used up, so ${request.nothingSent}.`;
      return tally;
    }
    return { ...tally, entries: { ...tally.entries, [key]: entry } };
  });
  return refusal ? { ok: false, message: refusal } : { ok: true };
}

/** Reserves one image request's estimate (see reserveEntry). */
export async function reserveExpense(
  store: NightWatchStore,
  request: { jobId: string; candidate: number; limits: OperatorLimits; now: Date },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const entry: ExpenseEntry = { jobId: request.jobId, candidate: request.candidate, usd: request.limits.estimateUsd, basis: "estimate", at: request.now.toISOString() };
  return reserveEntry(store, { key: tallyKey(request.jobId, request.candidate), entry, limits: request.limits, nothingSent: "no image request was sent" });
}

/** Reserves a job's brain estimate; brain spend counts toward the same per-job and total caps as images. */
export async function reserveBrainExpense(
  store: NightWatchStore,
  request: { jobId: string; limits: OperatorLimits; now: Date },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const entry: ExpenseEntry = { jobId: request.jobId, candidate: 0, usd: BRAIN_ESTIMATE_USD, basis: "estimate", at: request.now.toISOString(), kind: "brain" };
  return reserveEntry(store, { key: brainTallyKey(request.jobId), entry, limits: request.limits, nothingSent: "the brain was not asked" });
}

/** Replaces a job's brain estimate with what its calls cost. */
export async function settleBrainExpense(store: NightWatchStore, jobId: string, usd: string, now: Date) {
  await store.update<ExpenseTally>(EXPENSES, (current) => {
    const tally = current ?? emptyTally();
    const entry: ExpenseEntry = { jobId, candidate: 0, usd, basis: "usage", at: now.toISOString(), kind: "brain" };
    return { ...tally, entries: { ...tally.entries, [brainTallyKey(jobId)]: entry } };
  });
}

async function settleExpense(store: NightWatchStore, jobId: string, candidate: number, usd: string | null, now: Date) {
  if (!usd) return;
  await store.update<ExpenseTally>(EXPENSES, (current) => {
    const tally = current ?? emptyTally();
    return {
      ...tally,
      entries: { ...tally.entries, [tallyKey(jobId, candidate)]: { jobId, candidate, usd, basis: "usage", at: now.toISOString() } },
    };
  });
}

export type ProviderReply = { status: number; requestId: string | null; body: string };

/** Exactly one POST: no retries or redirects, bounded body, 180-second timeout. */
export async function sendPanel(fetchImpl: typeof fetch, request: OpenAiPanelRequest, apiKey: string): Promise<ProviderReply> {
  const response = await fetchImpl(request.endpoint, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "X-Client-Request-Id": request.clientRequestId },
    body: JSON.stringify(request.body),
  });
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (response.body) {
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > OPENAI_IMAGE_LIMITS.maxResponseBytes) throw new Error("The provider's reply is larger than allowed.");
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }
  return { status: response.status, requestId: response.headers.get("x-request-id"), body: Buffer.concat(chunks).toString("utf8") };
}

export type RequestRecord = {
  version: 1;
  jobId: string;
  candidate: number;
  clientRequestId: string;
  inputDigest: string;
  endpoint: string;
  model: string;
  size: string;
  quality: string;
  prompt: string;
  references: OpenAiPanelRequest["references"];
  forkPointId: string;
  kit: JobRecord["kit"];
  createdAt: string;
};

export type ResponseRecord = {
  version: 1;
  jobId: string;
  candidate: number;
  clientRequestId: string;
  inputDigest: string;
  status: number;
  requestId: string | null;
  elapsedMs: number;
  bodyDigest: string;
  usage: unknown;
  expenseUsd: string | null;
  errorCode: string | null;
  imageSha256: string | null;
  receivedAt: string;
};

export type CandidateOutcome = {
  state: "delivered" | "failed" | "uncertain";
  /** A provider request was (or may have been) made for this candidate. */
  requested: boolean;
  /** Refused by the operator allowance before any request. */
  capRefused: boolean;
  requestDigest: string | null;
  imageFile: string | null;
  sha256: string | null;
  expenseUsd: string | null;
  error: string | null;
};

export type GenerationDeps = ReferenceDeps & {
  fetch: typeof fetch;
  apiKey: string | null;
  moments: MomentSource;
  limits: OperatorLimits;
  now: () => Date;
};

export const candidateFiles = (jobId: string, candidate: number) => {
  const base = `${jobFilesDir(jobId)}/candidate-${candidate}`;
  return { request: `${base}.request`, response: `${base}.response`, image: `${base}.png` };
};

async function writePrivateFile(path: string, bytes: Buffer) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

const safeCode = (value: unknown) => (typeof value === "string" && /^[a-z0-9_.-]{1,100}$/i.test(value) ? value : null);

function parseBody(body: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(body);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function usageExpense(raw: Record<string, unknown> | null): string | null {
  try {
    return readOpenAiUsage(raw?.usage).calculatedExpenseUsd;
  } catch {
    return null;
  }
}

const outcome = (fields: Partial<CandidateOutcome> & Pick<CandidateOutcome, "state">): CandidateOutcome => ({
  requested: false,
  capRefused: false,
  requestDigest: null,
  imageFile: null,
  sha256: null,
  expenseUsd: null,
  error: null,
  ...fields,
});

/** Picks up a candidate whose request was already saved. Never sends anything. */
async function recover(deps: GenerationDeps, jobId: string, candidate: number, request: RequestRecord): Promise<CandidateOutcome> {
  const files = candidateFiles(jobId, candidate);
  const response = await deps.store.read<ResponseRecord>(files.response);
  if (!response || response.inputDigest !== request.inputDigest) {
    return outcome({
      state: "uncertain",
      requested: true,
      requestDigest: request.inputDigest,
      error: "A request was sent before an interruption. Its result is unknown, and it will not be sent again.",
    });
  }
  if (response.imageSha256) {
    const bytes = await readFile(join(deps.store.root, files.image)).catch(() => null);
    if (bytes && sha256(bytes) === response.imageSha256) {
      return outcome({
        state: "delivered",
        requested: true,
        requestDigest: request.inputDigest,
        imageFile: files.image,
        sha256: response.imageSha256,
        expenseUsd: response.expenseUsd,
      });
    }
    return outcome({
      state: "failed",
      requested: true,
      requestDigest: request.inputDigest,
      expenseUsd: response.expenseUsd,
      error: "The image arrived but was not saved before an interruption. No new request was sent.",
    });
  }
  return outcome({
    state: response.status === 0 ? "uncertain" : "failed",
    requested: true,
    requestDigest: request.inputDigest,
    expenseUsd: response.expenseUsd,
    error: response.status === 0 ? "The provider did not answer. It will not be asked again for this candidate." : `The provider did not return an image (${response.errorCode ?? "provider_error"}).`,
  });
}

/**
 * Prepares candidate `candidate` of a job: one provider request at most, ever. Returns the outcome
 * for the runner to record; throws only before anything was saved or sent (safe to retry).
 */
export async function generateCandidate(deps: GenerationDeps, job: JobRecord, candidate: number): Promise<CandidateOutcome> {
  const files = candidateFiles(job.id, candidate);
  const saved = await deps.store.read<RequestRecord>(files.request);
  if (saved) return recover(deps, job.id, candidate, saved);

  if (!deps.apiKey) return outcome({ state: "failed", error: "Image generation is not configured on this machine, so no request was sent." });
  const path = storyPath(await deps.moments(job.roomId), job.roomId, job.forkPointId);
  const reference = await forkPointReference(deps, path.at(-1)!);
  // The brain's staging for this candidate, saved on the job before any request; plain otherwise.
  const staging = job.brain?.candidates.find((plan) => plan.number === candidate && !plan.plain)?.staging ?? null;
  const prompt = buildPrompt({ kit: pinnedKit(job.kit), path, brief: job.brief, candidate, staging });
  const request = await prepareOpenAiPanel({
    clientRequestId: `nw-${job.id.slice(4, 12)}-${candidate}`,
    panelNumber: 1,
    prompt,
    references: [{ bytes: reference, role: "original" }],
  });

  const allowance = await reserveExpense(deps.store, { jobId: job.id, candidate, limits: deps.limits, now: deps.now() });
  if (!allowance.ok) return outcome({ state: "failed", capRefused: true, error: allowance.message });

  const record: RequestRecord = {
    version: 1,
    jobId: job.id,
    candidate,
    clientRequestId: request.clientRequestId,
    inputDigest: request.inputDigest,
    endpoint: request.endpoint,
    model: request.body.model,
    size: request.body.size,
    quality: request.body.quality,
    prompt: request.body.prompt,
    references: request.references,
    forkPointId: job.forkPointId,
    kit: job.kit,
    createdAt: deps.now().toISOString(),
  };
  // The durable intent precedes the network boundary; from here this candidate is never re-sent.
  await deps.store.write(files.request, record);

  const started = performance.now();
  let reply: ProviderReply;
  try {
    reply = await sendPanel(deps.fetch, request, deps.apiKey);
  } catch {
    reply = { status: 0, requestId: null, body: "" };
  }
  const raw = parseBody(reply.body);
  const expenseUsd = usageExpense(raw);
  let png: Buffer | null = null;
  let imageSha256: string | null = null;
  let errorCode: string | null = null;
  if (reply.status >= 200 && reply.status < 300) {
    try {
      const inspected = await inspectOpenAiPanelResponse(raw);
      png = inspected.png;
      imageSha256 = inspected.sha256;
    } catch {
      errorCode = "invalid_provider_output";
    }
  } else {
    errorCode = reply.status === 0 ? "provider_unreachable" : safeCode((raw?.error as { code?: unknown } | undefined)?.code) ?? "provider_error";
  }
  const response: ResponseRecord = {
    version: 1,
    jobId: job.id,
    candidate,
    clientRequestId: request.clientRequestId,
    inputDigest: request.inputDigest,
    status: reply.status,
    requestId: reply.requestId,
    elapsedMs: Math.round(performance.now() - started),
    bodyDigest: sha256(reply.body),
    usage: raw?.usage ?? null,
    expenseUsd,
    errorCode,
    imageSha256,
    receivedAt: deps.now().toISOString(),
  };
  await deps.store.write(files.response, response);
  await settleExpense(deps.store, job.id, candidate, expenseUsd, deps.now());
  if (png && imageSha256) {
    await writePrivateFile(join(deps.store.root, files.image), png);
    return outcome({ state: "delivered", requested: true, requestDigest: request.inputDigest, imageFile: files.image, sha256: imageSha256, expenseUsd });
  }
  return recover(deps, job.id, candidate, record);
}

export const BRAIN_ALLOWANCE_REFUSED = "The operator's inference allowance had no room for the brain tonight; the night used the plain prompts.";
export const BRAIN_ALREADY_ASKED = "An earlier brain run for this night was interrupted, so the night used the plain prompts.";
export const BRAIN_AFTER_REQUEST = "An image was already requested before the brain could plan, so the night used the plain prompts.";

export type BrainJobDeps = {
  store: NightWatchStore;
  moments: MomentSource;
  limits: OperatorLimits;
  now: () => Date;
  think: ThinkDeps;
};

/**
 * Decides one job's brain before its first image request: reads the story, reserves the brain's
 * estimate against the operator allowance, thinks (never throws past this point), then books what
 * the calls cost. A refused allowance yields the plain record; a story that cannot be read throws
 * before anything is reserved, so the runner retries the step like any other.
 */
export async function thinkForJob(deps: BrainJobDeps, job: JobRecord): Promise<BrainRecord> {
  const plainCaption = candidateCaption(job.brief);
  const plain = (message: string) => plainBrain({ attempts: job.attempts, plainCaption }, message, deps.now());
  // A booked entry means an earlier run already asked (and may have paid); it is never asked twice.
  const tally = await deps.store.read<ExpenseTally>(EXPENSES);
  if (tally?.entries[brainTallyKey(job.id)]) return plain(BRAIN_ALREADY_ASKED);
  // The job record can lag the request file on disk: a saved image request means drawing has begun.
  for (const candidate of job.candidates) {
    if (await deps.store.read(candidateFiles(job.id, candidate.number).request)) return plain(BRAIN_AFTER_REQUEST);
  }
  const path = storyPath(await deps.moments(job.roomId), job.roomId, job.forkPointId);
  const allowance = await reserveBrainExpense(deps.store, { jobId: job.id, limits: deps.limits, now: deps.now() });
  if (!allowance.ok) return plainBrain({ attempts: job.attempts, plainCaption }, BRAIN_ALLOWANCE_REFUSED, deps.now());
  const record = await thinkBeforeDrawing(deps.think, {
    kit: pinnedKit(job.kit),
    pathLines: pathLines(path),
    forkPointTitle: job.forkPoint.title,
    brief: job.brief,
    attempts: job.attempts,
    plainCaption,
  });
  await settleBrainExpense(deps.store, job.id, brainExpenseUsd(record), deps.now());
  return record;
}
