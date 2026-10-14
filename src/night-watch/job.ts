import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OPENAI_IMAGE_MODEL } from "../experiments/openai-images.ts";
import { isUuid, pilotPath, type PilotMoment } from "../lib/pilot.ts";
import type { Database } from "../lib/supabase/database.types.ts";
import {
  NIGHT_WATCH_ROOM,
  type CandidateView,
  type CreateJobRequest,
  type JobEvent,
  type JobResponse,
  type JobState,
  type JobSummary,
  type PaymentView,
  type SessionView,
} from "./api-types.ts";
import { brainView } from "./brain.ts";
import { NightWatchError } from "./http.ts";
import { JOB_ID_PATTERN, jobEventsPath, jobPath, type CandidateRecord, type JobRecord } from "./job-types.ts";
import { SESSION_ID_PATTERN, sessionBlock, sessionPath, sessionSummary, type DelegationSession } from "./session.ts";
import { fileNightWatchStore, type NightWatchStore } from "./store.ts";
import { kitPin } from "./world-kit.ts";

/**
 * Night Watch jobs: creation (with the maker's checks), the maker's view, and the story moments a
 * job can continue from. Nothing here signs, pays or calls the image provider.
 */

/** Type-checked against the generator's model, without loading the image code into routes. */
export const NIGHT_WATCH_IMAGE_MODEL: typeof OPENAI_IMAGE_MODEL = "gpt-image-2.5-flare-2026-09-08";
export const MAX_BRIEF_CHARACTERS = 500;
export const MAX_CAPTION_CHARACTERS = 160;
export const MAX_START_SECONDS = 3600;
/** A continuation adds one moment, and a story path holds at most 13. */
export const MAX_FORK_POINT_DEPTH = 12;

export const TERMINAL_STATES: readonly JobState[] = ["ready", "blocked", "failed", "published"];
export const isFinished = (state: JobState) => TERMINAL_STATES.includes(state);

export type Maker = { id: string; displayName: string };
export type ForkPoint = JobRecord["forkPoint"];

/** A moment a job can continue from: a shared pilot moment or a published Night Watch moment. */
export type StoryMoment = Pick<
  PilotMoment,
  "id" | "room_id" | "parent_id" | "maker_id" | "maker_label" | "title" | "panels" | "created_at"
> & { nightWatch?: { jobId: string; kitVersion: string; candidate: number } | null };

export type MomentSource = (roomId: string) => Promise<StoryMoment[]>;

export function newJobId() {
  return `nwj_${randomUUID().replace(/-/g, "")}`;
}

const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

function clip(text: string, limit: number) {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > limit / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, "")}…`;
}

/**
 * The caption a candidate would publish with: the brief's first sentence, bounded. Deterministic.
 * Candidates share it (they stage the same beat differently), so a published caption reads cleanly.
 */
export function candidateCaption(brief: string) {
  const text = collapse(brief);
  const sentence = /^(.+?[.!?])(\s|$)/.exec(text)?.[1] ?? text;
  return clip(sentence, MAX_CAPTION_CHARACTERS);
}

function pendingCandidate(brief: string, number: number): CandidateRecord {
  return {
    number,
    state: "pending",
    caption: candidateCaption(brief),
    requestDigest: null,
    imageFile: null,
    sha256: null,
    expenseUsd: null,
    error: null,
    charged: false,
    refunded: false,
  };
}

export async function readJob(store: NightWatchStore, id: string) {
  if (!JOB_ID_PATTERN.test(id)) return null;
  return store.read<JobRecord>(jobPath(id));
}

export async function allJobs(store: NightWatchStore): Promise<JobRecord[]> {
  const jobs: JobRecord[] = [];
  for (const name of await store.list("jobs")) {
    if (!JOB_ID_PATTERN.test(name)) continue;
    const job = await store.read<JobRecord>(jobPath(name));
    if (job) jobs.push(job);
  }
  return jobs;
}

export function jobSummary(job: JobRecord): JobSummary {
  const { id, state, sessionId, forkPointId, createdAt, runAfter, updatedAt, message } = job;
  return { id, state, sessionId, forkPointId, createdAt, runAfter, updatedAt, message };
}

/** The maker's jobs, newest first. */
export async function listJobs(store: NightWatchStore, makerId: string): Promise<JobSummary[]> {
  return (await allJobs(store))
    .filter((job) => job.makerId === makerId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(jobSummary);
}

export type CreateJobInput = {
  maker: Maker;
  session: DelegationSession;
  forkPoint: ForkPoint;
  brief: string;
  startInSeconds: number;
  now: Date;
};

/** Validates the maker's request and saves a scheduled job. One unfinished job per session. */
export async function createJob(store: NightWatchStore, input: CreateJobInput): Promise<JobRecord> {
  const { maker, session, now } = input;
  if (session.makerProfileId !== maker.id) throw new NightWatchError(404, "missing_session", "That Night Watch session does not exist.");
  if (session.roomId !== NIGHT_WATCH_ROOM) throw new NightWatchError(409, "wrong_room", "This Night Watch session is for another room.");
  const block = sessionBlock(session, now);
  if (block) throw new NightWatchError(409, block.code, block.message);
  const brief = typeof input.brief === "string" ? input.brief.trim() : "";
  if (!brief || brief.length > MAX_BRIEF_CHARACTERS)
    throw new NightWatchError(400, "invalid_brief", `Write a brief of 1 to ${MAX_BRIEF_CHARACTERS} characters.`);
  const start = input.startInSeconds;
  if (!Number.isInteger(start) || start < 0 || start > MAX_START_SECONDS)
    throw new NightWatchError(400, "invalid_start", "Choose a start within the next hour (0 to 3600 seconds).");
  if (!input.forkPoint?.id) throw new NightWatchError(404, "missing_fork_point", "That fork point is not in this room.");
  const attempts = session.limits.attemptAllowance;
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 3)
    throw new NightWatchError(409, "invalid_allowance", "This Night Watch session has no candidate attempts.");

  return store.withLock(`session-jobs-${session.id}`, async () => {
    const open = (await allJobs(store)).find((job) => job.sessionId === session.id && !isFinished(job.state));
    if (open) throw new NightWatchError(409, "job_in_progress", "This Night Watch already has a job in progress. Wait for it or revoke the session.");
    const at = now.toISOString();
    const runAfter = new Date(now.getTime() + start * 1000).toISOString();
    const job: JobRecord = {
      version: 1,
      id: newJobId(),
      makerId: maker.id,
      makerLabel: maker.displayName,
      sessionId: session.id,
      roomId: session.roomId,
      forkPointId: input.forkPoint.id,
      forkPoint: { id: input.forkPoint.id, title: input.forkPoint.title, makerLabel: input.forkPoint.makerLabel },
      brief,
      attempts,
      kit: kitPin(),
      state: "scheduled",
      message: start > 0 ? "Scheduled. The Night Watch starts after its start time." : "Scheduled. The Night Watch starts shortly.",
      createdAt: at,
      runAfter,
      updatedAt: at,
      capacity: { neededCredits: attempts, availableAtCheck: null, charged: 0, refunded: 0 },
      reservationId: null,
      paymentRecordFile: null,
      candidates: Array.from({ length: attempts }, (_, index) => pendingCandidate(brief, index + 1)),
      publishedMomentId: null,
    };
    if (!(await store.create(jobPath(job.id), job))) throw new NightWatchError(409, "job_exists", "That job already exists.");
    await store.appendEvent(jobEventsPath(job.id), {
      at,
      step: "scheduled",
      detail: `Scheduled ${attempts} private candidate${attempts === 1 ? "" : "s"} continuing “${clip(input.forkPoint.title, 60)}”.`,
    });
    return job;
  });
}

const sumUsd = (values: string[]) => {
  const micro = values.reduce((total, value) => {
    const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(value);
    return match ? total + BigInt(match[1]) * 1_000_000n + BigInt((match[2] ?? "").padEnd(6, "0")) : total;
  }, 0n);
  return `${micro / 1_000_000n}.${(micro % 1_000_000n).toString().padStart(6, "0")}`;
};

/** The maker's view of one job, in the API contract's shape. */
export async function jobResponse(store: NightWatchStore, job: JobRecord, session: SessionView | null): Promise<JobResponse> {
  const events: JobEvent[] = (await store.readEvents(jobEventsPath(job.id))).map((event) => ({
    at: String(event.at ?? ""),
    step: String(event.step ?? ""),
    detail: String(event.detail ?? ""),
  }));
  const payment: PaymentView | null =
    (job.reservationId && session?.payments.find((item) => item.id === job.reservationId)) ||
    session?.payments.filter((item) => item.jobId === job.id).at(-1) ||
    null;
  let publishedCandidate: number | null = null;
  if (job.publishedMomentId && /^[a-z0-9-]{1,64}$/i.test(job.publishedMomentId)) {
    const moment = await store.read<StoryMoment>(`moments/${job.publishedMomentId}`).catch(() => null);
    publishedCandidate = moment?.nightWatch?.candidate ?? null;
  }
  const candidates: CandidateView[] = job.candidates.map((candidate) => ({
    number: candidate.number,
    state: candidate.state === "requested" ? "pending" : candidate.state,
    caption: candidate.caption,
    imagePath: candidate.state === "delivered" ? `/api/night-watch/jobs/${job.id}/candidates/${candidate.number}` : null,
    sha256: candidate.state === "delivered" ? candidate.sha256 : null,
    expenseUsd: candidate.expenseUsd,
    published: publishedCandidate === candidate.number,
  }));
  const settled = payment?.state === "settled" ? payment : null;
  return {
    job: {
      ...jobSummary(job),
      brief: job.brief,
      attempts: job.attempts,
      kit: job.kit,
      forkPoint: job.forkPoint,
      capacity: job.capacity,
      payment,
      receipt: settled
        ? {
            network: "eip155:84532",
            transaction: settled.transaction,
            explorerUrl: settled.explorerUrl,
            creditsAdded: settled.creditsAdded,
            roomId: job.roomId,
            amountAtomic: settled.amountAtomic,
            payer: session?.walletAddress ?? null,
          }
        : null,
      expense: {
        operatorPaidUsd: sumUsd(job.candidates.flatMap((candidate) => (candidate.expenseUsd ? [candidate.expenseUsd] : []))),
        model: NIGHT_WATCH_IMAGE_MODEL,
        images: job.candidates.filter((candidate) => candidate.state === "delivered").length,
      },
      candidates,
      events,
      publishedMomentId: job.publishedMomentId,
      brain: brainView(job.brain),
    },
  };
}

/** Moments in a room from the shared pilot (service read). */
export function supabaseMoments(client: SupabaseClient<Database>): MomentSource {
  return async (roomId) => {
    const result = await client.from("pilot_moments").select("*").eq("room_id", roomId).limit(500);
    if (result.error) throw new NightWatchError(503, "moments_unavailable", "The story could not be read right now.");
    return result.data;
  };
}

/** Night Watch moments the maker published on this machine (`moments/<id>.json`). */
export function storeMoments(store: NightWatchStore): MomentSource {
  return async (roomId) => {
    const moments: StoryMoment[] = [];
    for (const name of await store.list("moments")) {
      if (!isUuid(name)) continue;
      const moment = await store.read<StoryMoment>(`moments/${name}`);
      if (moment?.room_id === roomId && moment.id === name) moments.push(moment);
    }
    return moments;
  };
}

export function combinedMoments(...sources: MomentSource[]): MomentSource {
  return async (roomId) => (await Promise.all(sources.map((source) => source(roomId)))).flat();
}

/** Root → moment, at most 13 moments; throws when the path is broken or too long. */
export function storyPath(moments: StoryMoment[], roomId: string, momentId: string): StoryMoment[] {
  // pilotPath reads only id, room_id and parent_id, which both kinds of moment carry.
  return pilotPath(moments as PilotMoment[], roomId, momentId) as StoryMoment[];
}

/** The fork point a job pins, refusing unknown moments and paths too deep to continue. */
export async function resolveForkPoint(moments: MomentSource, roomId: string, forkPointId: unknown): Promise<ForkPoint> {
  if (!isUuid(forkPointId)) throw new NightWatchError(404, "missing_fork_point", "That fork point is not in this room.");
  const all = await moments(roomId);
  const moment = all.find((item) => item.id === forkPointId && item.room_id === roomId);
  if (!moment) throw new NightWatchError(404, "missing_fork_point", "That fork point is not in this room.");
  let path: StoryMoment[];
  try {
    path = storyPath(all, roomId, moment.id);
  } catch {
    throw new NightWatchError(409, "broken_path", "Part of the story before this fork point is unavailable.");
  }
  if (path.length > MAX_FORK_POINT_DEPTH)
    throw new NightWatchError(409, "path_too_long", "This fork point is too deep to continue; a story path holds at most 13 moments.");
  return { id: moment.id, title: moment.title, makerLabel: moment.maker_label };
}

/** sessionSummary's state is "expired" or the stored state, which is exactly SessionView's. */
export const sessionViewOf = (session: DelegationSession, now: Date) => sessionSummary(session, now) as SessionView;

async function sessionView(store: NightWatchStore, sessionId: string, now: Date): Promise<SessionView | null> {
  if (!SESSION_ID_PATTERN.test(sessionId)) return null;
  const session = await store.read<DelegationSession>(sessionPath(sessionId));
  return session ? sessionViewOf(session, now) : null;
}

/** A job the maker owns, or a 404 that does not reveal whether it exists. */
export async function makerJob(store: NightWatchStore, makerId: string, id: string) {
  const job = await readJob(store, id);
  if (!job || job.makerId !== makerId) throw new NightWatchError(404, "missing_job", "That Night Watch job does not exist.");
  return job;
}

export type JobRouteDeps = {
  store?: NightWatchStore;
  admin?: SupabaseClient<Database>;
  maker?: (token: string) => Promise<Maker>;
  moments?: MomentSource;
  now?: () => Date;
};

async function routeDeps(deps: JobRouteDeps) {
  const store = deps.store ?? fileNightWatchStore();
  let admin = deps.admin;
  const client = async () => {
    if (!admin) admin = (await import("../generation/client.ts")).pilotAdmin();
    return admin;
  };
  return {
    store,
    now: deps.now ?? (() => new Date()),
    // The same check as the session routes: a saved (Google) account, verified with the service role.
    maker: deps.maker ?? (async (token: string) => (await import("./maker.ts")).authenticateMaker(token)),
    moments: deps.moments ?? (async (roomId: string) => combinedMoments(supabaseMoments(await client()), storeMoments(store))(roomId)),
  };
}

/** POST /api/night-watch/jobs */
export async function createJobForRequest(token: string, body: Partial<CreateJobRequest>, deps: JobRouteDeps = {}): Promise<JobResponse> {
  const { store, now, maker: makerOf, moments } = await routeDeps(deps);
  const maker = await makerOf(token);
  if (typeof body.sessionId !== "string" || !SESSION_ID_PATTERN.test(body.sessionId))
    throw new NightWatchError(404, "missing_session", "That Night Watch session does not exist.");
  const session = await store.read<DelegationSession>(sessionPath(body.sessionId));
  if (!session || session.makerProfileId !== maker.id) throw new NightWatchError(404, "missing_session", "That Night Watch session does not exist.");
  const forkPoint = await resolveForkPoint(moments, NIGHT_WATCH_ROOM, body.forkPointId);
  const at = now();
  const job = await createJob(store, {
    maker,
    session,
    forkPoint,
    brief: typeof body.brief === "string" ? body.brief : "",
    startInSeconds: typeof body.startInSeconds === "number" ? body.startInSeconds : Number.NaN,
    now: at,
  });
  return jobResponse(store, job, sessionViewOf(session, at));
}

/** GET /api/night-watch/jobs/[id] */
export async function jobForRequest(token: string, id: string, deps: JobRouteDeps = {}): Promise<JobResponse> {
  const { store, now, maker: makerOf } = await routeDeps(deps);
  const maker = await makerOf(token);
  const job = await makerJob(store, maker.id, id);
  return jobResponse(store, job, await sessionView(store, job.sessionId, now()));
}

/** GET /api/night-watch/jobs/[id]/candidates/[n]: a delivered candidate's verified PNG bytes, for its maker only. */
export async function candidateImageForRequest(token: string, id: string, number: string, deps: JobRouteDeps = {}): Promise<Buffer> {
  const { store, maker: makerOf } = await routeDeps(deps);
  const maker = await makerOf(token);
  const job = await makerJob(store, maker.id, id);
  const candidate = /^[1-3]$/.test(number) ? job.candidates.find((item) => item.number === Number(number)) : undefined;
  const missing = () => new NightWatchError(404, "missing_candidate", "That candidate is not ready.");
  if (!candidate || candidate.state !== "delivered" || !candidate.imageFile || !candidate.sha256) throw missing();
  if (!/^job-files\/nwj_[a-f0-9]{32}\/candidate-[1-3]\.png$/.test(candidate.imageFile)) throw missing();
  const bytes = await readFile(join(store.root, candidate.imageFile)).catch(() => null);
  if (!bytes || createHash("sha256").update(bytes).digest("hex") !== candidate.sha256) throw missing();
  return bytes;
}
