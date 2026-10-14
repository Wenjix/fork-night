import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { PilotMoment } from "../lib/pilot.ts";
import { NIGHT_WATCH_ROOM, type WorldMoment } from "./api-types.ts";
import { NightWatchError } from "./http.ts";
import { jobEventsPath, jobFilesDir, jobPath, JOB_ID_PATTERN, type CandidateRecord, type JobRecord } from "./job-types.ts";
import { LockTimeoutError, type NightWatchStore } from "./store.ts";

/**
 * Publishing: the maker's separate, explicit approval that turns one private candidate into a
 * moment of The Midnight Signal. The Night Watch itself never calls this.
 *
 * A published moment is stored locally in the PilotMoment shape the release proof accepts: one panel
 * at `<momentId>/1.webp` with the SHA-256 of exactly the bytes served for it (WebP at the quality the
 * shared room uses), so `sceneManifest()` and `prepareRelease()` treat it like any generated moment.
 */

export const MOMENT_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const MAX_TITLE = 160;
const MAX_CAPTION = 500;
const WEBP_QUALITY = 86;

export type NightWatchMoment = {
  version: 1;
  id: string;
  room_id: string;
  parent_id: string;
  maker_id: string;
  maker_label: string;
  title: string;
  panels: { caption: string; imagePath: string; sha256: string }[];
  created_at: string;
  nightWatch: { jobId: string; kitVersion: string; candidate: number };
  /** Where the served bytes came from: the private candidate PNG this image was encoded from. */
  source: { candidateSha256: string; kitDigest: string; contentType: "image/webp" };
};

export type PublishDeps = {
  store: NightWatchStore;
  now?: () => Date;
  /** Encodes the candidate PNG for publication; defaults to WebP like the shared room's images. */
  encode?: (png: Buffer) => Promise<Buffer>;
};

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

export const momentRecordName = (id: string) => {
  if (!MOMENT_ID_PATTERN.test(id)) throw new Error("That is not a moment id.");
  return `moments/${id}`;
};

export const momentImageFile = (store: NightWatchStore, id: string) => join(store.root, "moment-files", `${id}.webp`);

/** One moment per job: the id is derived from the job id, so an interrupted publish finds its moment again. */
export function momentIdForJob(jobId: string): string {
  const hex = createHash("sha256").update(`fork-night/night-watch/moment/${jobId}`).digest("hex");
  const variant = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function clip(text: string, max: number) {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

async function writeFileAtomic(path: string, bytes: Buffer) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
}

async function toWebp(png: Buffer): Promise<Buffer> {
  const { default: sharp } = await import("sharp");
  return sharp(png).webp({ quality: WEBP_QUALITY }).toBuffer();
}

/** Resolves a candidate's saved image inside the store, refusing anything outside it. */
function candidateFile(store: NightWatchStore, jobId: string, file: string) {
  const root = resolve(store.root);
  const path = isAbsolute(file) ? resolve(file) : file.includes("/") ? resolve(root, file) : resolve(root, jobFilesDir(jobId), file);
  const inside = relative(root, path);
  if (!inside || inside.startsWith("..") || isAbsolute(inside)) {
    throw new NightWatchError(409, "candidate_missing", "That candidate's image is not in the Night Watch folder. Nothing was published.");
  }
  return path;
}

async function readCandidate(store: NightWatchStore, jobId: string, candidate: CandidateRecord): Promise<Buffer> {
  const bytes = await readFile(candidateFile(store, jobId, candidate.imageFile!)).catch(() => null);
  if (!bytes) throw new NightWatchError(409, "candidate_missing", "That candidate's image could not be read. Nothing was published.");
  if (sha256(bytes) !== candidate.sha256) {
    throw new NightWatchError(409, "candidate_changed", "That candidate's image no longer matches its saved fingerprint. Nothing was published.");
  }
  return bytes;
}

function isMoment(value: unknown, id: string): value is NightWatchMoment {
  const moment = value as NightWatchMoment | null;
  return !!moment && moment.version === 1 && moment.id === id && moment.room_id === NIGHT_WATCH_ROOM && Array.isArray(moment.panels) && moment.panels.length === 1;
}

export async function readPublishedMoment(store: NightWatchStore, id: string): Promise<NightWatchMoment | null> {
  if (!MOMENT_ID_PATTERN.test(id)) return null;
  const value = await store.read<NightWatchMoment>(momentRecordName(id));
  return isMoment(value, id) ? value : null;
}

/** Every published Night Watch moment, oldest first. */
export async function listPublishedMoments(store: NightWatchStore): Promise<NightWatchMoment[]> {
  const ids = (await store.list("moments")).filter((id) => MOMENT_ID_PATTERN.test(id));
  const moments = await Promise.all(ids.map((id) => readPublishedMoment(store, id)));
  return moments.filter((moment): moment is NightWatchMoment => !!moment).sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** A published moment's image, only when its bytes still match the published fingerprint. */
export async function readMomentImage(store: NightWatchStore, id: string): Promise<{ bytes: Buffer; contentType: string } | null> {
  const moment = await readPublishedMoment(store, id);
  if (!moment) return null;
  const bytes = await readFile(momentImageFile(store, id)).catch(() => null);
  if (!bytes || sha256(bytes) !== moment.panels[0].sha256) return null;
  return { bytes, contentType: moment.source.contentType };
}

/** The PilotMoment row the release code and `<TestnetRelease>` read. */
export function toPilotMoment(moment: NightWatchMoment): PilotMoment {
  return {
    id: moment.id,
    room_id: moment.room_id,
    parent_id: moment.parent_id,
    maker_id: moment.maker_id,
    maker_label: moment.maker_label,
    title: moment.title,
    panels: moment.panels.map((panel) => ({ caption: panel.caption, imagePath: panel.imagePath, sha256: panel.sha256 })),
    created_at: moment.created_at,
    source_kind: "openai",
    source_idea_id: null,
    source_idea_label: null,
    source_idea_body: null,
  };
}

export const momentImageUrl = (id: string) => `/api/night-watch/moments/${id}/image`;

export function nightWatchWorldMoment(moment: NightWatchMoment): WorldMoment {
  return {
    id: moment.id,
    parentId: moment.parent_id,
    makerId: moment.maker_id,
    makerLabel: moment.maker_label,
    title: moment.title,
    panels: moment.panels.map((panel) => ({ caption: panel.caption, imageUrl: momentImageUrl(moment.id), sha256: panel.sha256 })),
    createdAt: moment.created_at,
    source: "night-watch",
    nightWatch: { ...moment.nightWatch },
  };
}

/** Which candidate a job published, for the job view's `published` flags. */
export async function publishedCandidate(store: NightWatchStore, job: Pick<JobRecord, "publishedMomentId">): Promise<number | null> {
  if (!job.publishedMomentId) return null;
  return (await readPublishedMoment(store, job.publishedMomentId))?.nightWatch.candidate ?? null;
}

async function markPublished(store: NightWatchStore, jobId: string, moment: NightWatchMoment, now: () => Date) {
  let changed = false;
  await store.update<JobRecord>(jobPath(jobId), (current) => {
    if (!current) throw new NightWatchError(404, "not_found", "That Night Watch job was not found.");
    if (current.state === "published" && current.publishedMomentId === moment.id) return current;
    changed = true;
    return {
      ...current,
      state: "published",
      publishedMomentId: moment.id,
      message: `You published candidate ${moment.nightWatch.candidate} to The Midnight Signal. The other candidates stay private.`,
      updatedAt: now().toISOString(),
    };
  });
  if (changed) {
    await store.appendEvent(jobEventsPath(jobId), {
      step: "published",
      detail: `The maker published candidate ${moment.nightWatch.candidate} as moment ${moment.id}. The other candidates stay private.`,
    });
  }
}

/**
 * Publishes one delivered candidate of a ready job as a moment. Only the job's maker may publish; a
 * job publishes at most one moment, and asking again returns that same moment.
 */
export async function publishCandidate(deps: PublishDeps, maker: { id: string }, jobId: string, candidateNumber: unknown): Promise<NightWatchMoment> {
  if (typeof jobId !== "string" || !JOB_ID_PATTERN.test(jobId)) throw new NightWatchError(404, "not_found", "That Night Watch job was not found.");
  const { store } = deps;
  const now = deps.now ?? (() => new Date());
  try {
    return await store.withLock(
      `publish-${jobId}`,
      async () => {
        const job = await store.read<JobRecord>(jobPath(jobId));
        if (!job || job.makerId !== maker.id) throw new NightWatchError(404, "not_found", "That Night Watch job was not found.");
        if (job.publishedMomentId) {
          const published = await readPublishedMoment(store, job.publishedMomentId);
          if (published) return published;
        }
        const momentId = momentIdForJob(job.id);
        const interrupted = await readPublishedMoment(store, momentId);
        if (interrupted) {
          await markPublished(store, job.id, interrupted, now);
          return interrupted;
        }
        if (job.state !== "ready") throw new NightWatchError(409, "not_ready", "This Night Watch job has no candidates ready to publish.");
        if (typeof candidateNumber !== "number" || !Number.isInteger(candidateNumber)) {
          throw new NightWatchError(400, "invalid_candidate", "Choose one of the job's candidates.");
        }
        const candidate = job.candidates.find((item) => item.number === candidateNumber);
        if (!candidate || candidate.state !== "delivered" || !candidate.imageFile || !candidate.sha256) {
          throw new NightWatchError(409, "not_delivered", "That candidate was not delivered, so it cannot be published.");
        }

        const image = await (deps.encode ?? toWebp)(await readCandidate(store, job.id, candidate));
        await writeFileAtomic(momentImageFile(store, momentId), image);
        const words = candidate.caption?.trim() || job.brief?.trim() || "A Night Watch moment";
        const moment: NightWatchMoment = {
          version: 1,
          id: momentId,
          room_id: NIGHT_WATCH_ROOM,
          parent_id: job.forkPointId,
          maker_id: job.makerId,
          maker_label: job.makerLabel,
          title: clip(words, MAX_TITLE),
          panels: [{ caption: clip(words, MAX_CAPTION), imagePath: `${momentId}/1.webp`, sha256: sha256(image) }],
          created_at: now().toISOString(),
          nightWatch: { jobId: job.id, kitVersion: job.kit.version, candidate: candidate.number },
          source: { candidateSha256: candidate.sha256, kitDigest: job.kit.digest, contentType: "image/webp" },
        };
        const created = await store.create(momentRecordName(momentId), moment);
        const published = created ? moment : await readPublishedMoment(store, momentId);
        if (!published) throw new Error("The published moment could not be read back.");
        await markPublished(store, job.id, published, now);
        return published;
      },
      { waitMs: 10_000 },
    );
  } catch (error) {
    if (error instanceof LockTimeoutError) throw new NightWatchError(409, "busy", "This job is already being published. Try again in a moment.");
    throw error;
  }
}
