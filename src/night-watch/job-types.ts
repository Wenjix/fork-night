import type { JobState } from "./api-types.ts";

/**
 * The durable record of one Night Watch job, stored at `jobs/<id>` in the Night Watch store.
 * The runner advances it one step at a time and saves after every step, so a restart resumes.
 */

export const JOB_ID_PATTERN = /^nwj_[a-f0-9]{32}$/;

export type CandidateState = "pending" | "requested" | "delivered" | "failed" | "uncertain";

export type CandidateRecord = {
  number: number;
  state: CandidateState;
  caption: string;
  /** Saved before the provider call; its presence without a response means "never call again". */
  requestDigest: string | null;
  imageFile: string | null;
  sha256: string | null;
  expenseUsd: string | null;
  error: string | null;
  /** Credit charge bookkeeping when NIGHT_WATCH_CHARGE_ROOM=1. */
  charged: boolean;
  refunded: boolean;
};

export type JobRecord = {
  version: 1;
  id: string;
  makerId: string;
  makerLabel: string;
  sessionId: string;
  roomId: string;
  forkPointId: string;
  forkPoint: { id: string; title: string; makerLabel: string };
  brief: string;
  attempts: number;
  kit: { id: string; version: string; digest: string };
  state: JobState;
  message: string;
  createdAt: string;
  runAfter: string;
  updatedAt: string;
  capacity: { neededCredits: number; availableAtCheck: number | null; charged: number; refunded: number };
  /** The session reservation that pays for this job's top-up, if any. */
  reservationId: string | null;
  /** The x402 payer's saved attempt for a pending payment (resume, never re-sign). */
  paymentRecordFile: string | null;
  candidates: CandidateRecord[];
  publishedMomentId: string | null;
  /**
   * The brain's plan, saved before the first image request so a restart never re-plans a job that
   * already drew. Absent on jobs from before the brain; `undefined` means "not decided yet".
   */
  brain?: BrainRecord | null;
};

/** One TokenRouter call the brain made, as recorded for receipts and the operator allowance. */
export type BrainCallRecord = {
  model: string;
  label: string;
  latencyMs: number | null;
  usage: { promptTokens: number; completionTokens: number; reasoningTokens: number; cachedTokens: number } | null;
  expenseUsd: string;
};

export type BrainCandidatePlan = {
  number: number;
  caption: string;
  /** Private image direction for this candidate; null means the plain staging line is used. */
  staging: string | null;
  why: string;
  check: { ok: boolean; note: string } | null;
  plain: boolean;
};

export type BrainRecord = {
  version: 1;
  state: "planned" | "plain";
  message: string;
  planner: BrainCallRecord | null;
  /** The checker that answered; null when none did (or the check was off). */
  critic: BrainCallRecord | null;
  /** Checkers that failed before one answered, in order, with any reply's cost. */
  criticFailures?: { label: string; reason: string; call: BrainCallRecord | null }[];
  readOfTheRoom: string | null;
  pick: number | null;
  morningNote: string | null;
  candidates: BrainCandidatePlan[];
  at: string;
};

export const jobPath = (id: string) => {
  if (!JOB_ID_PATTERN.test(id)) throw new Error("That is not a Night Watch job id.");
  return `jobs/${id}`;
};

/** Event log name for a job (append-only JSON lines). */
export const jobEventsPath = (id: string) => `${jobPath(id)}-events`;

/** Directory (relative to the store root) for a job's private files. */
export const jobFilesDir = (id: string) => `job-files/${id}`;
