import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { CapacityConflict, chargeCredit, chargePath, refundCredit, type CapacityAdmin, type ChargeRecord } from "../../src/night-watch/capacity.ts";
import {
  EXPENSES,
  buildPrompt,
  candidateFiles,
  forkPointReference,
  generateCandidate,
  operatorLimits,
  type ExpenseTally,
  type GenerationDeps,
} from "../../src/night-watch/generate.ts";
import { candidateCaption, type StoryMoment } from "../../src/night-watch/job.ts";
import type { JobRecord } from "../../src/night-watch/job-types.ts";
import { fileNightWatchStore, type NightWatchStore } from "../../src/night-watch/store.ts";
import { CURRENT_KIT, kitPin } from "../../src/night-watch/world-kit.ts";

const PUBLIC = resolve(import.meta.dirname, "../../public");
const ROOT_ID = "10000000-0000-4000-8000-000000000001";
const CHILD_ID = "20000000-0000-4000-8000-000000000002";
const JOB_ID = `nwj_${"a".repeat(32)}`;
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

async function tempStore(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), "nw-generate-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return fileNightWatchStore(root);
}

const seed: StoryMoment = {
  id: ROOT_ID,
  room_id: "midnight-signal",
  parent_id: null,
  maker_id: null,
  maker_label: "Wenjie",
  title: "The lighthouse wakes",
  panels: [
    { caption: "At midnight, the lighthouse blinked for the first time in years.", imageUrl: "/art/midnight-story.webp#frame=0" },
    { caption: "Mira found a note beneath the lamp: someone out there was waiting.", imageUrl: "/art/midnight-story.webp#frame=1" },
  ],
  created_at: "2026-10-01T00:00:00.000Z",
};

function job(overrides: Partial<JobRecord> = {}): JobRecord {
  const brief = "Mira and the Dokkaebi find a second lighthouse that answers the first.";
  return {
    version: 1,
    id: JOB_ID,
    makerId: "maker-1",
    makerLabel: "Wenjie",
    sessionId: `nws_${"b".repeat(32)}`,
    roomId: "midnight-signal",
    forkPointId: ROOT_ID,
    forkPoint: { id: ROOT_ID, title: seed.title, makerLabel: "Wenjie" },
    brief,
    attempts: 2,
    kit: kitPin(),
    state: "generating",
    message: "",
    createdAt: "2026-10-13T20:00:00.000Z",
    runAfter: "2026-10-13T20:00:00.000Z",
    updatedAt: "2026-10-13T20:00:00.000Z",
    capacity: { neededCredits: 2, availableAtCheck: 4, charged: 0, refunded: 0 },
    reservationId: null,
    paymentRecordFile: null,
    candidates: [1, 2].map((number) => ({
      number,
      state: "pending" as const,
      caption: candidateCaption(brief),
      requestDigest: null,
      imageFile: null,
      sha256: null,
      expenseUsd: null,
      error: null,
      charged: false,
      refunded: false,
    })),
    publishedMomentId: null,
    ...overrides,
  };
}

const USAGE = {
  input_tokens: 1000,
  input_tokens_details: { text_tokens: 400, image_tokens: 600 },
  output_tokens: 272,
  output_tokens_details: { text_tokens: 0, image_tokens: 272 },
  total_tokens: 1272,
};

let pngCache: Buffer | null = null;
async function providerPng() {
  pngCache ??= await sharp({ create: { width: 1024, height: 1024, channels: 3, background: { r: 18, g: 30, b: 80 } } }).png().toBuffer();
  return pngCache;
}

type FetchCall = { url: string; init: RequestInit };
function fakeProvider(reply: "image" | "moderation" | "throw" = "image") {
  const calls: FetchCall[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    if (reply === "throw") throw new TypeError("fetch failed");
    if (reply === "moderation")
      return new Response(JSON.stringify({ error: { code: "moderation_blocked", message: "Blocked." } }), { status: 400, headers: { "x-request-id": "req_2" } });
    const png = await providerPng();
    return new Response(JSON.stringify({ data: [{ b64_json: png.toString("base64") }], usage: USAGE }), { status: 200, headers: { "x-request-id": "req_1" } });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

function deps(store: NightWatchStore, fetchImpl: typeof fetch, overrides: Partial<GenerationDeps> = {}): GenerationDeps {
  return {
    store,
    fetch: fetchImpl,
    apiKey: "test-key",
    moments: async () => [seed],
    limits: operatorLimits({}),
    publicDir: PUBLIC,
    now: () => new Date("2026-10-13T21:00:00.000Z"),
    ...overrides,
  };
}

test("the prompt is deterministic, pinned to the kit, and at most 2000 characters", () => {
  const path = [seed];
  const first = buildPrompt({ kit: CURRENT_KIT, path, brief: job().brief, candidate: 2 });
  assert.equal(first, buildPrompt({ kit: CURRENT_KIT, path, brief: job().brief, candidate: 2 }));
  assert.ok(first.length <= 2000);
  assert.match(first, /World: The Midnight Signal\./);
  assert.match(first, /No written words, letters, signs or logos/);
  assert.match(first, /1\. The lighthouse wakes: At midnight/);
  assert.match(first, /second lighthouse that answers the first/);
  assert.match(first, /Candidate B: a different staging of the same beat/);
  assert.ok(first.endsWith("Draw this beat only. No written words."));
  assert.notEqual(first, buildPrompt({ kit: CURRENT_KIT, path, brief: job().brief, candidate: 1 }));

  const long: StoryMoment[] = Array.from({ length: 13 }, (_, index) => ({
    ...seed,
    id: `${index}`,
    title: `Moment ${index + 1} ${"of the long night ".repeat(5)}`,
    panels: [{ caption: `Caption ${index + 1} ${"with a great deal of detail ".repeat(8)}`, imageUrl: "/art/midnight-story.webp#frame=0" }],
  }));
  const bounded = buildPrompt({ kit: CURRENT_KIT, path: long, brief: "b".repeat(500), candidate: 3 });
  assert.ok(bounded.length <= 2000, `prompt is ${bounded.length} characters`);
  assert.match(bounded, /… earlier moments omitted/);
  assert.match(bounded, /13\. Moment 13/);
  assert.match(bounded, /Candidate C/);
});

test("captions come from the brief's first sentence and stay within 160 characters", () => {
  assert.equal(candidateCaption("  The boat returns.  It carries a reply. "), "The boat returns.");
  const caption = candidateCaption("word ".repeat(80));
  assert.ok(caption.length <= 160 && caption.endsWith("…"));
});

test("fork point references: packaged frames are cropped, stored panels are verified", async (t) => {
  const store = await tempStore(t);
  const frame = await forkPointReference({ store, publicDir: PUBLIC }, seed);
  const metadata = await sharp(frame).metadata();
  assert.equal(metadata.format, "png");
  assert.equal(metadata.width, 512);
  assert.equal(metadata.height, 512);

  const media = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#123456" } }).webp().toBuffer();
  const stored: StoryMoment = { ...seed, id: CHILD_ID, parent_id: ROOT_ID, panels: [{ caption: "x", imagePath: `${CHILD_ID}/1.webp`, sha256: sha(media) }] };
  const reads: string[] = [];
  const readMedia = async (path: string) => (reads.push(path), media);
  assert.deepEqual(await forkPointReference({ store, readMedia }, stored), media);
  assert.deepEqual(reads, [`${CHILD_ID}/1.webp`]);
  await assert.rejects(forkPointReference({ store, readMedia: async () => Buffer.from("tampered") }, stored), /could not be verified/);

  const published: StoryMoment = {
    ...stored,
    id: "30000000-0000-4000-8000-000000000003",
    panels: [{ caption: "x", imagePath: "30000000-0000-4000-8000-000000000003/1.webp", sha256: sha(media) }],
    nightWatch: { jobId: JOB_ID, kitVersion: "1", candidate: 1 },
  };
  await assert.rejects(forkPointReference({ store }, published), /could not be found or verified/);
  await mkdir(join(store.root, "moment-files"), { recursive: true });
  await writeFile(join(store.root, "moment-files", `${published.id}.webp`), media);
  assert.deepEqual(await forkPointReference({ store }, published), media);
});

test("a candidate: request saved first (no image bytes), one POST, response without base64, private PNG", async (t) => {
  const store = await tempStore(t);
  const provider = fakeProvider();
  const result = await generateCandidate(deps(store, provider.fetchImpl), job(), 1);
  assert.equal(result.state, "delivered");
  assert.equal(result.expenseUsd, "0.014960");
  assert.equal(provider.calls.length, 1);
  const headers = provider.calls[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer test-key");
  assert.equal(headers["X-Client-Request-Id"], `nw-${"a".repeat(8)}-1`);
  assert.equal(provider.calls[0].url, "https://api.openai.com/v1/images/edits");
  assert.equal(provider.calls[0].init.redirect, "error");

  const files = candidateFiles(JOB_ID, 1);
  const requestText = await readFile(join(store.root, `${files.request}.json`), "utf8");
  assert.doesNotMatch(requestText, /base64|data:image/);
  const request = JSON.parse(requestText);
  assert.equal(request.inputDigest, result.requestDigest);
  assert.equal(request.references.length, 1);
  assert.equal(request.model, "gpt-image-2.5-flare-2026-09-08");
  const responseText = await readFile(join(store.root, `${files.response}.json`), "utf8");
  assert.doesNotMatch(responseText, /b64_json/);
  assert.deepEqual(JSON.parse(responseText).usage, USAGE);

  const png = await readFile(join(store.root, files.image));
  assert.equal(sha(png), result.sha256);
  assert.equal((await stat(join(store.root, files.image))).mode & 0o777, 0o600);
  assert.equal(result.imageFile, files.image);
  const tally = await store.read<ExpenseTally>(EXPENSES);
  assert.deepEqual(
    Object.values(tally!.entries).map(({ usd, basis }) => ({ usd, basis })),
    [{ usd: "0.014960", basis: "usage" }],
  );

  // Asking again only reads what was saved.
  const again = await generateCandidate(deps(store, provider.fetchImpl), job(), 1);
  assert.equal(again.state, "delivered");
  assert.equal(provider.calls.length, 1);
});

test("a saved request without a response is uncertain and is never sent again", async (t) => {
  const store = await tempStore(t);
  const provider = fakeProvider();
  await store.write(candidateFiles(JOB_ID, 2).request, { version: 1, inputDigest: "f".repeat(64) });
  const result = await generateCandidate(deps(store, provider.fetchImpl), job(), 2);
  assert.equal(result.state, "uncertain");
  assert.equal(result.requested, true);
  assert.equal(provider.calls.length, 0);
});

test("provider refusals fail the candidate; a lost connection is uncertain and never retried", async (t) => {
  const store = await tempStore(t);
  const refused = fakeProvider("moderation");
  const failed = await generateCandidate(deps(store, refused.fetchImpl), job(), 1);
  assert.equal(failed.state, "failed");
  assert.match(failed.error ?? "", /moderation_blocked/);
  assert.equal(refused.calls.length, 1);

  const lost = fakeProvider("throw");
  const unknown = await generateCandidate(deps(store, lost.fetchImpl), job(), 2);
  assert.equal(unknown.state, "uncertain");
  assert.equal((await generateCandidate(deps(store, lost.fetchImpl), job(), 2)).state, "uncertain");
  assert.equal(lost.calls.length, 1);
  const tally = await store.read<ExpenseTally>(EXPENSES);
  assert.equal(tally!.entries[`${JOB_ID}-2`].basis, "estimate", "an unknown expense keeps its estimate");
});

test("the operator allowance refuses before any request", async (t) => {
  const store = await tempStore(t);
  const provider = fakeProvider();
  const perJob = await generateCandidate(deps(store, provider.fetchImpl, { limits: operatorLimits({ NIGHT_WATCH_MAX_JOB_USD: "0.04" }) }), job(), 1);
  assert.equal(perJob.state, "failed");
  assert.equal(perJob.capRefused, true);
  assert.match(perJob.error ?? "", /operator-paid inference would pass its \$0\.040000 limit/);
  assert.equal(provider.calls.length, 0);
  assert.equal(await store.read(candidateFiles(JOB_ID, 1).request), null);

  await store.write(EXPENSES, {
    version: 1,
    entries: { other: { jobId: `nwj_${"c".repeat(32)}`, candidate: 1, usd: "2.980000", basis: "usage", at: "2026-10-13T00:00:00.000Z" } },
  });
  const total = await generateCandidate(deps(store, provider.fetchImpl), job(), 1);
  assert.equal(total.capRefused, true);
  assert.match(total.error ?? "", /allowance \(\$3\.000000\) is used up/);
  assert.equal(provider.calls.length, 0);
  assert.throws(() => operatorLimits({ NIGHT_WATCH_MAX_TOTAL_USD: "three" }), /NIGHT_WATCH_MAX_TOTAL_USD/);
});

function fakeCapacity(start: { limit: number; used?: number; conflicts?: number }) {
  const state = { limit: start.limit, used: start.used ?? 0, conflicts: start.conflicts ?? 0, updates: 0 };
  const admin: CapacityAdmin = {
    async credits() {
      return { limit: state.limit, used: state.used, reserved: 0, available: Math.max(0, state.limit - state.used), enabled: true };
    },
    async setDeliveryLimit(_room, expected, next) {
      if (state.conflicts > 0) {
        state.conflicts--;
        state.limit += 5; // another writer (a top-up) moved the limit first
        return false;
      }
      if (state.limit !== expected) return false;
      state.limit = next;
      state.updates++;
      return true;
    },
  };
  return { state, admin };
}

test("room charges are recorded before the update, applied once, and refunded once", async (t) => {
  const store = await tempStore(t);
  const { state, admin } = fakeCapacity({ limit: 4 });
  const request = { roomId: "midnight-signal", jobId: JOB_ID, candidate: 1, now: new Date("2026-10-13T21:00:00.000Z") };
  const charged = await chargeCredit(admin, store, request);
  assert.equal(charged.applied, true);
  assert.equal(state.limit, 3);
  const again = await chargeCredit(admin, store, request);
  assert.deepEqual([again.applied, again.already], [false, true]);
  assert.equal(state.limit, 3);
  const record = await store.read<ChargeRecord>(chargePath(JOB_ID, 1));
  assert.deepEqual([record!.charge!.state, record!.charge!.before, record!.charge!.after], ["applied", 4, 3]);

  assert.equal((await refundCredit(admin, store, request)).applied, true);
  assert.equal(state.limit, 4);
  assert.equal((await refundCredit(admin, store, request)).already, true);
  assert.equal(state.limit, 4);
  assert.equal((await refundCredit(admin, store, { ...request, candidate: 2 })).applied, false, "nothing charged, nothing refunded");
});

test("room charges retry a concurrent change up to three times, and an interrupted charge is never applied twice", async (t) => {
  const store = await tempStore(t);
  const busy = fakeCapacity({ limit: 4, conflicts: 2 });
  const request = { roomId: "midnight-signal", jobId: JOB_ID, candidate: 1, now: new Date() };
  assert.equal((await chargeCredit(busy.admin, store, request)).applied, true);
  assert.equal(busy.state.limit, 13, "4 + two concurrent top-ups of 5, minus this charge");

  const stuck = fakeCapacity({ limit: 4, conflicts: 3 });
  await assert.rejects(chargeCredit(stuck.admin, store, { ...request, candidate: 2 }), CapacityConflict);
  assert.equal((await store.read<ChargeRecord>(chargePath(JOB_ID, 2)))!.charge!.state, "abandoned");

  const interrupted = fakeCapacity({ limit: 9 });
  await store.write(chargePath(JOB_ID, 3), {
    version: 1, jobId: JOB_ID, roomId: "midnight-signal", candidate: 3,
    charge: { state: "intent", before: 10, after: 9, at: "2026-10-13T21:00:00.000Z" }, refund: null,
  });
  assert.equal((await chargeCredit(interrupted.admin, store, { ...request, candidate: 3 })).applied, true);
  assert.equal(interrupted.state.limit, 9);
  assert.equal(interrupted.state.updates, 0, "the interrupted update had applied; it is not applied again");

  const unapplied = fakeCapacity({ limit: 10 });
  await store.write(chargePath(JOB_ID, 4), {
    version: 1, jobId: JOB_ID, roomId: "midnight-signal", candidate: 4,
    charge: { state: "intent", before: 10, after: 9, at: "2026-10-13T21:00:00.000Z" }, refund: null,
  });
  assert.equal((await chargeCredit(unapplied.admin, store, { ...request, candidate: 4 })).applied, true);
  assert.equal(unapplied.state.limit, 9);

  const empty = fakeCapacity({ limit: 2, used: 2 });
  const short = await chargeCredit(empty.admin, store, { ...request, candidate: 5 });
  assert.deepEqual([short.applied, short.short], [false, true]);
  assert.equal(empty.state.limit, 2);
});
