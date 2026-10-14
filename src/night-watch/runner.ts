import { mkdir, open, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { TOP_UP } from "../x402/ids.ts";
import type { JobState } from "./api-types.ts";
import { CapacityConflict, chargeCredit, readCredits, refundCredit, type CapacityAdmin } from "./capacity.ts";
import type { CandidateOutcome } from "./generate.ts";
import { isFinished } from "./job.ts";
import { JOB_ID_PATTERN, jobEventsPath, jobPath, type BrainRecord, type CandidateRecord, type JobRecord } from "./job-types.ts";
import {
  paymentsUsed,
  remainingAllowance,
  sessionBlock,
  sessionPath,
  updateReservation,
  type DelegationSession,
} from "./session.ts";
import type { NightWatchStore } from "./store.ts";
import { redact, resumeTopUp, runTopUp, type TopUpDeps, type TopUpResult } from "./topup.ts";

/**
 * The durable Night Watch runner. Each call to `advanceJob` performs one step of one job under the
 * job's lock and saves it, so a restarted runner continues where the last one stopped:
 *
 *   scheduled → checking → [topping_up → waiting_payment →] checking → generating → ready
 *
 * With a brain (NIGHT_WATCH_BRAIN=1), the first "generating" step only thinks: it decides the job's
 * plan once and saves it before any image request, and the next step draws candidate 1.
 *
 * blocked, failed (and the maker's own published) are final. Nothing here publishes a candidate.
 */

export const RUNNER_HEARTBEAT = "runner/heartbeat";
export const RUNNER_LOCK_FILE = "runner/instance.lock";
export const ACTIVE_STATES: readonly JobState[] = ["scheduled", "checking", "topping_up", "waiting_payment", "generating"];
const RETRY_SECONDS = 30;
const MAX_RETRIES = 5;

export type RunnerDeps = {
  store: NightWatchStore;
  now: () => Date;
  capacity: CapacityAdmin;
  /** NIGHT_WATCH_CHARGE_ROOM=1: each candidate uses one room credit (refunded if it fails). */
  chargeRoom: boolean;
  generate: (job: JobRecord, candidate: number) => Promise<CandidateOutcome>;
  /**
   * The Night Watch's brain, when on: plans the job's candidates once, before its first image request.
   * Never throws for a model failure (it returns the plain plan); a throw means the step is retried.
   */
  brain?: (job: JobRecord) => Promise<BrainRecord>;
  topUp: Omit<TopUpDeps, "store" | "now">;
  pid?: number;
};

export type StepResult = { jobId: string; from: JobState; to: JobState; changed: boolean; detail: string; error?: unknown };

type Draft = { job: JobRecord; events: { step: string; detail: string }[] };

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const shortHash = (hash: string | null) => (hash ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : "pending");
const later = (now: Date, seconds: number) => new Date(now.getTime() + seconds * 1000).toISOString();

function note(draft: Draft, step: string, detail: string) {
  draft.events.push({ step, detail });
}

function move(draft: Draft, state: JobState, message: string) {
  draft.job.state = state;
  draft.job.message = message;
}

async function readSession(deps: RunnerDeps, job: JobRecord) {
  return deps.store.read<DelegationSession>(sessionPath(job.sessionId));
}

/** Gives back a failed candidate's credit. The charge record decides, so a charge an interrupted step never saved on the job still comes back. */
async function refund(deps: RunnerDeps, draft: Draft, candidate: CandidateRecord) {
  if (candidate.refunded || (!candidate.charged && !deps.chargeRoom)) return false;
  const result = await refundCredit(deps.capacity, deps.store, { roomId: draft.job.roomId, jobId: draft.job.id, candidate: candidate.number, now: deps.now() });
  if (!result.applied && !result.already) return false;
  if (!candidate.charged) {
    candidate.charged = true;
    draft.job.capacity.charged += 1;
  }
  candidate.refunded = true;
  draft.job.capacity.refunded += 1;
  return true;
}

/** Ends the job in `state`: unstarted candidates stop (their credits come back) and an unsigned reservation is released. */
async function stop(deps: RunnerDeps, draft: Draft, state: "blocked" | "failed", message: string) {
  for (const candidate of draft.job.candidates.filter((item) => item.state === "pending")) {
    candidate.state = "failed";
    candidate.error = message;
    try {
      await refund(deps, draft, candidate);
    } catch (error) {
      note(draft, "refund_pending", `Candidate ${candidate.number}'s room credit could not be given back yet: ${(error as Error).message}`);
    }
  }
  const session = await readSession(deps, draft.job);
  for (const reservation of session?.reservations.filter((item) => item.jobId === draft.job.id && item.state === "reserved") ?? []) {
    await updateReservation(deps.store, session!.id, reservation.id, { state: "released", note: "The job stopped before signing." }, deps.now());
  }
  note(draft, state, message);
  move(draft, state, message);
}

function finish(draft: Draft) {
  const candidates = draft.job.candidates;
  const delivered = candidates.filter((item) => item.state === "delivered").length;
  if (delivered > 0) {
    const missing = candidates.length - delivered;
    const message = `${plural(delivered, "private candidate")} ready for your review${missing ? ` (${missing} could not be prepared)` : ""}. Nothing was published.`;
    note(draft, "ready", message);
    return move(draft, "ready", message);
  }
  const unsent = candidates.every((item) => item.requestDigest === null);
  const message = unsent
    ? `No image was requested: ${candidates.find((item) => item.error)?.error ?? "the Night Watch stopped."}`
    : "No candidate could be prepared. Nothing was published, and no request will be sent again for this job.";
  note(draft, unsent ? "blocked" : "failed", message);
  move(draft, unsent ? "blocked" : "failed", message);
}

async function startStep(_deps: RunnerDeps, draft: Draft) {
  note(draft, "started", "The Night Watch started and is checking the room.");
  move(draft, "checking", "Checking the room's test credits.");
}

async function checkStep(deps: RunnerDeps, draft: Draft) {
  const { job } = draft;
  const session = await readSession(deps, job);
  if (!session) return stop(deps, draft, "blocked", "The Night Watch session is missing. Nothing was signed.");
  // Revoked or expired before generation: the maker withdrew the allowance, so nothing more happens.
  const refusal = sessionBlock(session, deps.now());
  if (refusal) return stop(deps, draft, "blocked", `${refusal.message} Nothing was signed or requested.`);
  const pending = job.candidates.filter((item) => item.state === "pending");
  if (!pending.length) return finish(draft);
  const needed = deps.chargeRoom ? pending.filter((item) => !item.charged).length : pending.length;
  const credits = await readCredits(deps.capacity, job.roomId);
  job.capacity.availableAtCheck = credits.available;
  if (!credits.enabled) return stop(deps, draft, "blocked", "Generation is paused for this room right now. Nothing was signed or requested.");
  if (credits.available >= needed) {
    note(draft, "checked", `Checked room credits: ${credits.available} available, ${needed} needed`);
    return move(draft, "generating", `Preparing candidate ${pending[0].number} of ${job.attempts}.`);
  }
  note(draft, "checked", `Checked room credits: ${credits.available} of ${needed} needed`);
  if (paymentsUsed(session) < session.limits.maxPayments && remainingAllowance(session) >= BigInt(TOP_UP.atomic)) {
    return move(draft, "topping_up", "Buying one room top-up of 1.00 test USDC within your allowance.");
  }
  const short = needed - credits.available;
  return stop(deps, draft, "blocked", `The room needs ${plural(short, "more test credit")} and this Night Watch may not buy more. Nothing was signed.`);
}

function applyTopUp(deps: RunnerDeps, draft: Draft, result: TopUpResult) {
  const { job } = draft;
  if (result.reservationId) job.reservationId = result.reservationId;
  if (result.kind === "credited") {
    job.paymentRecordFile = result.recordFile ?? job.paymentRecordFile;
    note(draft, "topped_up", `Bought one room top-up: +${result.creditsAdded} test credits (Base Sepolia tx ${shortHash(result.transaction)})`);
    return move(draft, "checking", "Checking the room's test credits again after the top-up.");
  }
  if (result.kind === "waiting") {
    job.paymentRecordFile = result.recordFile ?? job.paymentRecordFile;
    if (job.state !== "waiting_payment" || job.message !== result.message) note(draft, "payment_pending", result.message);
    move(draft, "waiting_payment", result.message);
    job.runAfter = later(deps.now(), result.retryInSeconds);
    return;
  }
  return stop(deps, draft, "blocked", result.message);
}

async function topUpStep(deps: RunnerDeps, draft: Draft, resume: boolean) {
  const session = await readSession(deps, draft.job);
  if (!session) return stop(deps, draft, "blocked", "The Night Watch session is missing. Nothing was signed.");
  const topUp = { ...deps.topUp, store: deps.store, now: deps.now };
  const result = resume ? await resumeTopUp(topUp, draft.job, session) : await runTopUp(topUp, draft.job, session);
  return applyTopUp(deps, draft, result);
}

/** Saves the brain's decision on the job; a kept take's caption becomes that candidate's caption. */
function applyBrain(job: JobRecord, record: BrainRecord) {
  job.brain = record;
  for (const plan of record.candidates) {
    const candidate = job.candidates.find((item) => item.number === plan.number);
    if (candidate && !plan.plain) candidate.caption = plan.caption;
  }
}

async function generateStep(deps: RunnerDeps, draft: Draft) {
  const { job } = draft;
  const session = await readSession(deps, job);
  const refusal = session ? sessionBlock(session, deps.now()) : { code: "missing", message: "The Night Watch session is missing." };
  const started = job.candidates.some((item) => item.state !== "pending");
  if (refusal && !started) return stop(deps, draft, "blocked", `${refusal.message} No image was requested.`);
  if (refusal && refusal.code !== "expired") {
    // Revoked mid-way: finish what was already requested, start nothing new.
    for (const candidate of job.candidates.filter((item) => item.state === "pending")) {
      candidate.state = "failed";
      candidate.error = `Stopped: ${refusal.message} No request was sent.`;
      await refund(deps, draft, candidate);
    }
    return finish(draft);
  }
  if (deps.brain && job.brain === undefined) {
    const untouched = job.candidates.every((item) => item.state === "pending" && item.requestDigest === null);
    if (!untouched) {
      // An image may already have been requested from the plain prompt: never plan after that.
      job.brain = null;
    } else {
      const record = await deps.brain(job);
      applyBrain(job, record);
      note(draft, "brain", record.message);
      // Saved now, before any image request; the next step draws candidate 1.
      return move(draft, "generating", `Preparing candidate ${job.candidates[0]?.number ?? 1} of ${job.attempts}.`);
    }
  }
  const candidate = job.candidates.find((item) => item.state === "pending" || item.state === "requested");
  if (!candidate) return finish(draft);
  if (deps.chargeRoom && !candidate.charged) {
    const charge = await chargeCredit(deps.capacity, deps.store, { roomId: job.roomId, jobId: job.id, candidate: candidate.number, now: deps.now() });
    if (charge.short) {
      note(draft, "credits_changed", "The room's test credits changed before this candidate; checking again.");
      return move(draft, "checking", "Checking the room's test credits again.");
    }
    candidate.charged = true;
    job.capacity.charged += 1;
  }
  const result = await deps.generate(job, candidate.number);
  candidate.state = result.state;
  candidate.requestDigest = result.requestDigest ?? candidate.requestDigest;
  candidate.imageFile = result.imageFile;
  candidate.sha256 = result.sha256;
  candidate.expenseUsd = result.expenseUsd;
  candidate.error = result.error;
  const label = `candidate ${candidate.number} of ${job.attempts}`;
  if (result.state === "delivered") {
    note(draft, "prepared", `Prepared ${label}${result.expenseUsd ? ` (operator-paid inference ≈ $${Number(result.expenseUsd).toFixed(3)})` : ""}`);
  } else if (result.state === "uncertain") {
    note(draft, "uncertain", `The result of ${label} is unknown: ${result.error ?? "the request was interrupted."}`);
  } else {
    const refunded = await refund(deps, draft, candidate);
    note(draft, "candidate_failed", `Could not prepare ${label}: ${result.error ?? "no image was returned."}${refunded ? " Its room credit was given back." : ""}`);
  }
  const next = job.candidates.find((item) => item.state === "pending" || item.state === "requested");
  if (!next) return finish(draft);
  move(draft, "generating", `Preparing candidate ${next.number} of ${job.attempts}.`);
}

/** Only bounded, authored messages reach the maker; everything else is logged by the runner. */
function safeMessage(error: unknown) {
  const message = error instanceof Error ? redact(error.message) : "";
  return /^[A-Za-z][A-Za-z0-9 .,;:'’()$/…-]{1,239}$/.test(message) ? message : "an unexpected error";
}

async function commit(deps: RunnerDeps, draft: Draft) {
  const at = deps.now().toISOString();
  draft.job.updatedAt = at;
  await deps.store.update<JobRecord>(jobPath(draft.job.id), (current) => ({
    ...draft.job,
    // Publishing is the maker's own action and may land while a step runs.
    publishedMomentId: current?.publishedMomentId ?? draft.job.publishedMomentId,
    state: current?.state === "published" ? "published" : draft.job.state,
  }));
  for (const event of draft.events) await deps.store.appendEvent(jobEventsPath(draft.job.id), { at, ...event });
}

async function trailingRetries(store: NightWatchStore, jobId: string) {
  const events = await store.readEvents(jobEventsPath(jobId));
  let count = 0;
  for (let index = events.length - 1; index >= 0 && events[index].step === "retry"; index--) count++;
  return count;
}

/** One step of one job, under the job's own lock (not the job document's), saved before returning. */
export async function advanceJob(deps: RunnerDeps, jobId: string): Promise<StepResult> {
  if (!JOB_ID_PATTERN.test(jobId)) throw new Error("That is not a Night Watch job id.");
  return deps.store.withLock(`job-${jobId}`, async () => {
    const saved = await deps.store.read<JobRecord>(jobPath(jobId));
    if (!saved) throw new Error("That Night Watch job does not exist.");
    const unchanged = { jobId, from: saved.state, to: saved.state, changed: false, detail: "" };
    if (isFinished(saved.state) || Date.parse(saved.runAfter) > deps.now().getTime()) return unchanged;
    const draft: Draft = { job: structuredClone(saved), events: [] };
    try {
      switch (saved.state) {
        case "scheduled":
          await startStep(deps, draft);
          break;
        case "checking":
          await checkStep(deps, draft);
          break;
        case "topping_up":
          await topUpStep(deps, draft, false);
          break;
        case "waiting_payment":
          await topUpStep(deps, draft, true);
          break;
        case "generating":
          await generateStep(deps, draft);
          break;
        default:
          return unchanged;
      }
    } catch (error) {
      const reason = safeMessage(error);
      const retry: Draft = { job: structuredClone(saved), events: [] };
      const retries = await trailingRetries(deps.store, jobId);
      const moneyInFlight = saved.state === "topping_up" || saved.state === "waiting_payment";
      if (retries + 1 >= MAX_RETRIES && !moneyInFlight && !(error instanceof CapacityConflict)) {
        await stop(deps, retry, "failed", `The Night Watch stopped after repeated errors (${reason}). Nothing was published.`).catch(() => move(retry, "failed", `The Night Watch stopped after repeated errors (${reason}).`));
      } else {
        note(retry, "retry", `Will try again shortly: ${reason}`);
        retry.job.message = `Waiting to try again: ${reason}`;
        retry.job.runAfter = later(deps.now(), RETRY_SECONDS);
      }
      await commit(deps, retry);
      return { jobId, from: saved.state, to: retry.job.state, changed: true, detail: `retry: ${reason}`, error };
    }
    await commit(deps, draft);
    const detail = draft.events.map((event) => event.detail).join(" · ") || draft.job.message;
    return { jobId, from: saved.state, to: draft.job.state, changed: true, detail };
  });
}

export async function writeHeartbeat(store: NightWatchStore, now: Date, pid = process.pid) {
  await store.write(RUNNER_HEARTBEAT, { at: now.toISOString(), pid });
}

/** One runner pass: heartbeat, then one step for every due job, oldest first. */
export async function runDueJobs(deps: RunnerDeps): Promise<StepResult[]> {
  await writeHeartbeat(deps.store, deps.now(), deps.pid ?? process.pid);
  const due: JobRecord[] = [];
  for (const name of await deps.store.list("jobs")) {
    if (!JOB_ID_PATTERN.test(name)) continue;
    const job = await deps.store.read<JobRecord>(jobPath(name));
    if (job && ACTIVE_STATES.includes(job.state) && Date.parse(job.runAfter) <= deps.now().getTime()) due.push(job);
  }
  const results: StepResult[] = [];
  for (const job of due.sort((a, b) => a.runAfter.localeCompare(b.runAfter))) {
    try {
      results.push(await advanceJob(deps, job.id));
    } catch (error) {
      results.push({ jobId: job.id, from: job.state, to: job.state, changed: false, detail: `skipped: ${safeMessage(error)}` });
    }
  }
  return results;
}

export class RunnerLocked extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunnerLocked";
  }
}

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** One runner per store: refuses while another live process holds the lock; clears a dead holder's lock. */
export async function acquireRunnerLock(root: string, pid = process.pid): Promise<() => Promise<void>> {
  const path = join(root, RUNNER_LOCK_FILE);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(path, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify({ pid, at: new Date().toISOString() }));
      } finally {
        await handle.close();
      }
      return async () => {
        const holder = await readFile(path, "utf8").then((text) => JSON.parse(text) as { pid?: number }).catch(() => null);
        if (holder?.pid === pid) await rm(path, { force: true });
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const holder = await readFile(path, "utf8").then((text) => JSON.parse(text) as { pid?: number }).catch(() => null);
      if (holder && Number.isSafeInteger(holder.pid) && alive(holder.pid!))
        throw new RunnerLocked(`Another Night Watch runner is running (pid ${holder.pid}). Stop it first, or remove ${path} if that process is not a runner.`);
      await rm(path, { force: true });
    }
  }
  throw new RunnerLocked(`Could not take the Night Watch runner lock at ${path}.`);
}
