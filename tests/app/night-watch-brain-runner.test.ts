import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { CRITIC_MODEL, PLANNER_MODEL, sumUsd, type Moderate } from "../../src/night-watch/brain.ts";
import type { CapacityAdmin } from "../../src/night-watch/capacity.ts";
import {
  BRAIN_ALLOWANCE_REFUSED,
  EXPENSES,
  brainTallyKey,
  buildPrompt,
  candidateFiles,
  generateCandidate,
  operatorLimits,
  operatorSpend,
  pathLines,
  thinkForJob,
  type CandidateOutcome,
  type ExpenseTally,
} from "../../src/night-watch/generate.ts";
import { candidateCaption, createJob, type StoryMoment } from "../../src/night-watch/job.ts";
import { jobEventsPath, jobPath, type BrainRecord, type JobRecord } from "../../src/night-watch/job-types.ts";
import { advanceJob, type RunnerDeps } from "../../src/night-watch/runner.ts";
import { newSession, sessionPath, type DelegationSession } from "../../src/night-watch/session.ts";
import { fileNightWatchStore, type NightWatchStore } from "../../src/night-watch/store.ts";
import { CURRENT_KIT, kitPrompt, pinnedKit, type WorldKit } from "../../src/night-watch/world-kit.ts";

// The brain inside the runner: it decides once, before any image request, and never re-plans.

const PUBLIC = resolve(import.meta.dirname, "../../public");
const MAKER = { id: "11111111-1111-4111-8111-111111111111", displayName: "Wenjie" };
const ROOT_ID = "10000000-0000-4000-8000-000000000001";
const START = new Date("2026-10-13T21:00:00.000Z");
const BRIEF = "Mira and the Dokkaebi find a second lighthouse that answers the first.";
const { privateKey: AUTHORIZATION_KEY } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });

const seed: StoryMoment = {
  id: ROOT_ID,
  room_id: "midnight-signal",
  parent_id: null,
  maker_id: null,
  maker_label: "Wenjie",
  title: "The lighthouse wakes",
  panels: [{ caption: "At midnight, the lighthouse blinked for the first time in years.", imageUrl: "/art/midnight-story.webp#frame=0" }],
  created_at: "2026-10-01T00:00:00.000Z",
};

const TAKES = [
  { caption: "Across the bay, a second light blinks back.", staging: "Wide shot from the cliff at night: Mira and the Dokkaebi in silhouette, the far lighthouse answering with one warm pulse across dark water.", why: "The clearest answer to the first light." },
  { caption: "Mira counts the pulses on her fingers.", staging: "Close-up on Mira's hands in the lantern glow, the far beam reflected in her eyes; the Dokkaebi leans in over her shoulder.", why: "A quiet, personal beat." },
];
const USAGE = { prompt_tokens: 1000, completion_tokens: 500, prompt_tokens_details: { cached_tokens: 200 } };

type Reply = { json?: unknown; status?: number };

function tokenRouter(replies: Record<string, Reply[]>) {
  const requests: Record<string, unknown>[] = [];
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push(body);
    const next = replies[String(body.model)]?.shift();
    if (!next) throw new Error(`unexpected call to ${String(body.model)}`);
    if (next.status && next.status !== 200) return new Response("{}", { status: next.status });
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(next.json) } }], usage: USAGE }), { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, requests };
}

const clear: Moderate = async (texts) => texts.map(() => false);

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), "nw-brain-runner-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = fileNightWatchStore(root);
  const clock = { now: START };
  const now = () => clock.now;
  const created = newSession({
    makerProfileId: MAKER.id,
    roomId: "midnight-signal",
    fundingRef: "r".repeat(22),
    payTo: "0x4A6DE1347E9b2E466e5EAe6ba18dd63d7080BfdE",
    privy: { userId: "did:privy:maker", walletId: "wallet-1", walletAddress: "0x1111111111111111111111111111111111111111", signerId: "kq-1", policyId: "policy-1" },
    hours: 2,
    maxPayments: 1,
    attemptAllowance: 2,
    now: START,
  });
  const session: DelegationSession = { ...created, state: "active", confirmedAt: START.toISOString() };
  await store.write(sessionPath(session.id), session);
  const job = await createJob(store, { maker: MAKER, session, forkPoint: { id: ROOT_ID, title: seed.title, makerLabel: "Wenjie" }, brief: BRIEF, startInSeconds: 0, now: START });
  const capacity: CapacityAdmin = {
    async credits() {
      return { limit: 6, used: 0, reserved: 0, available: 6, enabled: true };
    },
    async setDeliveryLimit() {
      return true;
    },
  };
  const order: string[] = [];
  const generate = async (current: JobRecord, number: number): Promise<CandidateOutcome> => {
    order.push(`image-${number}`);
    return { state: "delivered", requested: true, capRefused: false, requestDigest: `${number}`.repeat(64), imageFile: candidateFiles(current.id, number).image, sha256: "e".repeat(64), expenseUsd: "0.014960", error: null };
  };
  const refuse = async () => {
    throw new Error("no payment expected in these tests");
  };
  const deps: RunnerDeps = {
    store,
    now,
    capacity,
    chargeRoom: false,
    generate,
    topUp: {
      privy: { signTypedData: refuse },
      authorizationKey: AUTHORIZATION_KEY,
      fundRoom: refuse as never,
      resumeAttempt: refuse as never,
      readAgentToken: async () => "A".repeat(43),
      door: async () => ({ url: `http://127.0.0.1:3005/api/x402/fund/${"r".repeat(22)}`, payTo: "0x4A6DE1347E9b2E466e5EAe6ba18dd63d7080BfdE" }),
    },
  };
  return { store, clock, job, deps, order };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

const readJob = async (store: NightWatchStore, id: string) => (await store.read<JobRecord>(jobPath(id)))!;

async function drive(f: Fixture, limit = 12) {
  const states: string[] = [];
  for (let step = 0; step < limit; step++) {
    const result = await advanceJob(f.deps, f.job.id);
    if (!result.changed) break;
    states.push(result.to);
    if (["ready", "blocked", "failed", "published"].includes(result.to)) break;
  }
  return states;
}

function plannedRecord(): BrainRecord {
  return {
    version: 1,
    state: "planned",
    message: "Kimi K3 read the room and planned 2 different takes. The safety check held back 1, which used the plain prompt.",
    planner: { model: PLANNER_MODEL, label: "Kimi K3", latencyMs: 4200, usage: null, expenseUsd: "0.005976" },
    critic: null,
    readOfTheRoom: "The first light has been answered.",
    pick: null,
    morningNote: null,
    candidates: [
      { number: 1, caption: TAKES[0].caption, staging: TAKES[0].staging, why: TAKES[0].why, check: null, plain: false },
      { number: 2, caption: candidateCaption(BRIEF), staging: null, why: "", check: null, plain: true },
    ],
    at: START.toISOString(),
  };
}

/** The real image path with a fake provider that records every prompt it is sent. */
async function realImages(f: Fixture, limits = operatorLimits({})) {
  const png = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#203050" } }).png().toBuffer();
  const prompts: string[] = [];
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    prompts.push(String((JSON.parse(String(init?.body)) as { prompt: string }).prompt));
    return new Response(JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }), { status: 200 });
  }) as typeof fetch;
  const generation = { store: f.store, fetch: fetchImpl, apiKey: "test-key", moments: async () => [seed], limits, publicDir: PUBLIC, now: () => f.clock.now };
  f.deps.generate = (job, number) => generateCandidate(generation, job, number);
  return prompts;
}

function realBrain(f: Fixture, router: ReturnType<typeof tokenRouter>, options: { limits?: ReturnType<typeof operatorLimits>; critic?: boolean } = {}) {
  const chat = { fetch: router.fetchImpl, apiKey: "tr-test-key" };
  f.deps.brain = (job) =>
    thinkForJob(
      { store: f.store, moments: async () => [seed], limits: options.limits ?? operatorLimits({}), now: () => f.clock.now, think: { planner: chat, critic: options.critic === false ? null : chat, criticChain: [{ model: CRITIC_MODEL, timeoutMs: 5_000, maxTokens: 8000 }], moderate: clear, now: () => f.clock.now } },
      job,
    );
}

test("the brain decides once, before any image request, and its captions become the candidates'", async (t) => {
  const f = await fixture(t);
  let thinks = 0;
  f.deps.brain = async () => {
    thinks++;
    f.order.push("brain");
    return plannedRecord();
  };
  assert.deepEqual(await drive(f), ["checking", "generating", "generating", "generating", "ready"]);
  assert.equal(thinks, 1);
  assert.deepEqual(f.order, ["brain", "image-1", "image-2"], "the plan precedes every image request");
  const job = await readJob(f.store, f.job.id);
  assert.equal(job.brain?.state, "planned");
  assert.deepEqual(job.candidates.map((candidate) => candidate.caption), [TAKES[0].caption, candidateCaption(BRIEF)]);
  const events = await f.store.readEvents(jobEventsPath(f.job.id));
  assert.deepEqual(events.filter((event) => event.step === "brain").map((event) => event.detail), [plannedRecord().message]);
});

test("a restarted runner never plans the same job again", async (t) => {
  const f = await fixture(t);
  let first = 0;
  f.deps.brain = async () => (first++, plannedRecord());
  // scheduled → checking → generating → (the brain decides; saved).
  assert.deepEqual(await drive(f, 3), ["checking", "generating", "generating"]);
  assert.equal(first, 1);
  const saved = await readJob(f.store, f.job.id);
  assert.equal(saved.brain?.at, START.toISOString());

  // The next step crashes on its image request; a restarted runner (new deps) continues.
  let crashes = 0;
  const generate = f.deps.generate;
  f.deps.generate = async (job, number) => {
    if (crashes++ === 0) throw new Error("Simulated crash before anything was saved");
    return generate(job, number);
  };
  assert.deepEqual(await drive(f, 1), ["generating"]);
  let second = 0;
  f.deps = { ...f.deps, brain: async () => (second++, plannedRecord()) };
  f.clock.now = new Date(START.getTime() + 60_000);
  assert.deepEqual(await drive(f), ["generating", "ready"]);
  assert.equal(second, 0, "never planned again");
  assert.equal((await readJob(f.store, f.job.id)).brain?.at, START.toISOString());
});

test("with the brain off nothing changes: no calls, no brain on the job", async (t) => {
  const f = await fixture(t);
  assert.equal(f.deps.brain, undefined);
  assert.deepEqual(await drive(f), ["checking", "generating", "generating", "ready"]);
  const job = await readJob(f.store, f.job.id);
  assert.equal(Object.hasOwn(job, "brain"), false);
  assert.deepEqual(job.candidates.map((candidate) => candidate.caption), [candidateCaption(BRIEF), candidateCaption(BRIEF)]);
  assert.ok(!(await f.store.readEvents(jobEventsPath(f.job.id))).some((event) => event.step === "brain"));
});

test("a job that already sent an image request is never planned", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await drive(f, 3), ["checking", "generating", "generating"], "candidate 1 drawn with the brain off");
  let thinks = 0;
  f.deps.brain = async () => (thinks++, plannedRecord());
  assert.deepEqual(await drive(f), ["ready"]);
  assert.equal(thinks, 0);
  assert.equal((await readJob(f.store, f.job.id)).brain, null, "decided: no brain for this job");
});

test("a brain that fails still draws every candidate, with exactly the plain prompts", async (t) => {
  const f = await fixture(t);
  const prompts = await realImages(f);
  const router = tokenRouter({ [PLANNER_MODEL]: [{ status: 500 }], [CRITIC_MODEL]: [] });
  realBrain(f, router);
  assert.deepEqual(await drive(f), ["checking", "generating", "generating", "generating", "ready"]);
  const job = await readJob(f.store, f.job.id);
  assert.equal(job.brain?.state, "plain");
  assert.equal(job.brain?.message, "Kimi K3 answered with HTTP 500. The night used the plain prompts.");
  assert.deepEqual(job.candidates.map((candidate) => candidate.state), ["delivered", "delivered"]);
  assert.deepEqual(prompts, [1, 2].map((candidate) => buildPrompt({ kit: pinnedKit(job.kit), path: [seed], brief: BRIEF, candidate })));
});

test("planned captions and staging reach the image request; a take sent back stays plain", async (t) => {
  const f = await fixture(t);
  const prompts = await realImages(f);
  const review = { checks: [{ candidate: 1, ok: true, note: "Fits the world." }, { candidate: 2, ok: false, breaksRule: true, note: "Asks for a sign with words on it." }], pick: 1, morningNote: "Start with the wide one." };
  const router = tokenRouter({ [PLANNER_MODEL]: [{ json: { readOfTheRoom: "The first light has been answered.", candidates: TAKES } }], [CRITIC_MODEL]: [{ json: review }] });
  realBrain(f, router);
  assert.deepEqual(await drive(f), ["checking", "generating", "generating", "generating", "ready"]);
  const job = await readJob(f.store, f.job.id);
  assert.equal(job.brain?.state, "planned");
  assert.equal(job.brain?.pick, 1);
  assert.deepEqual(job.candidates.map((candidate) => candidate.caption), [TAKES[0].caption, candidateCaption(BRIEF)]);
  assert.equal(prompts.length, 2);
  assert.ok(prompts[0].includes(`Candidate A: ${TAKES[0].staging}`), "take 1's staging is its direction");
  assert.ok(!prompts[0].includes("Candidate A: the clearest, most direct staging"), "not the plain line");
  assert.ok(prompts[0].includes(`The maker's brief for the next beat: ${BRIEF}`), "the brief stays");
  assert.ok(prompts[0].length <= 2000);
  assert.equal(prompts[1], buildPrompt({ kit: pinnedKit(job.kit), path: [seed], brief: BRIEF, candidate: 2 }), "take 2 went back to plain, byte for byte");
  assert.deepEqual(router.requests.map((request) => request.model), [PLANNER_MODEL, CRITIC_MODEL], "two calls, once");
});

test("brain spend is booked in the operator tally and counts toward both caps", async (t) => {
  const f = await fixture(t);
  await realImages(f, operatorLimits({ NIGHT_WATCH_MAX_JOB_USD: "0.10" }));
  const router = tokenRouter({ [PLANNER_MODEL]: [{ json: { readOfTheRoom: "The first light has been answered.", candidates: TAKES } }], [CRITIC_MODEL]: [{ json: { checks: [], pick: 1, morningNote: "Two takes tonight." } }] });
  realBrain(f, router, { limits: operatorLimits({ NIGHT_WATCH_MAX_JOB_USD: "0.10" }) });
  await drive(f);
  const job = await readJob(f.store, f.job.id);
  const tally = (await f.store.read<ExpenseTally>(EXPENSES))!;
  const entry = tally.entries[brainTallyKey(f.job.id)];
  assert.deepEqual({ ...entry, at: undefined }, { jobId: f.job.id, candidate: 0, usd: sumUsd([job.brain?.planner?.expenseUsd, job.brain?.critic?.expenseUsd]), basis: "usage", kind: "brain", at: undefined });
  assert.ok(Number(entry.usd) > 0);
  // Two $0.05 image estimates alone fit a $0.10 job cap; with the brain's spend the second does not.
  assert.deepEqual(job.candidates.map((candidate) => candidate.state), ["delivered", "failed"]);
  assert.equal(job.candidates[1].error, "This job's operator-paid inference would pass its $0.100000 limit, so no image request was sent.");
  const spend = await operatorSpend(f.store);
  assert.equal(spend.totalUsd, (Number(entry.usd) + 0.05).toFixed(6));

  // A total allowance with no room for the brain: plain, and TokenRouter is never asked.
  const g = await fixture(t);
  await realImages(g);
  const silent = tokenRouter({});
  realBrain(g, silent, { limits: operatorLimits({ NIGHT_WATCH_MAX_TOTAL_USD: "0.05" }) });
  await drive(g);
  const plain = await readJob(g.store, g.job.id);
  assert.equal(plain.brain?.state, "plain");
  assert.equal(plain.brain?.message, BRAIN_ALLOWANCE_REFUSED);
  assert.equal(silent.requests.length, 0);
  assert.equal((await g.store.read<ExpenseTally>(EXPENSES))?.entries[brainTallyKey(g.job.id)], undefined);
});

// The prompt as it was before the brain, kept here to prove plain prompts did not change.
const OMITTED = "… earlier moments omitted";
const VARIANTS = [
  "Candidate A: the clearest, most direct staging of this beat.",
  "Candidate B: a different staging of the same beat, with a new angle, distance or moment.",
  "Candidate C: a third staging of the same beat, unlike the other two.",
];
const collapse = (text: string) => text.replace(/\s+/g, " ").trim();
const clip = (text: string, limit: number) => (text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`);
function legacyBuildPrompt(input: { kit: WorldKit; path: StoryMoment[]; brief: string; candidate: number }) {
  const head = [
    "Draw one full-bleed illustration that continues this story. No lettering, captions, grid or watermark.",
    "Image 1 is the last panel of the chosen moment. Preserve its character identity, clothing and visual style.",
    kitPrompt(input.kit),
    "Story so far (creative context, from the first moment to the chosen one):",
  ];
  const tail = [`The maker's brief for the next beat: ${clip(collapse(input.brief), 500)}`, VARIANTS[input.candidate - 1], "Draw this beat only. No written words."];
  let budget = 2000 - [...head, ...tail].join("\n").length;
  const lines = pathLines(input.path);
  const kept: string[] = [];
  for (let index = lines.length - 1; index >= 0; index--) {
    const reserve = index > 0 ? OMITTED.length + 1 : 0;
    if (lines[index].length + 1 + reserve > budget) {
      if (budget >= OMITTED.length + 1) kept.unshift(OMITTED);
      break;
    }
    kept.unshift(lines[index]);
    budget -= lines[index].length + 1;
  }
  return [...head, ...kept, ...tail].join("\n");
}

function storyOf(length: number, words = 12): StoryMoment[] {
  return Array.from({ length }, (_, index) => ({
    ...seed,
    id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    parent_id: index ? `10000000-0000-4000-8000-${String(index).padStart(12, "0")}` : null,
    title: `Moment ${index + 1} of the long night by the harbor`,
    panels: Array.from({ length: 3 }, (__, panel) => ({ caption: `Panel ${panel + 1}: ${"the light crosses the water ".repeat(words).trim()}` })),
  }));
}

test("prompts: plain stays byte for byte; staging is clipped so the chosen moment still fits", () => {
  const longBrief = `${"Mira follows the answering light along the harbor wall ".repeat(10)}`.slice(0, 500);
  for (const path of [[seed], storyOf(3, 2), storyOf(12), storyOf(30, 1)]) {
    for (const brief of [BRIEF, longBrief]) {
      for (const candidate of [1, 2, 3]) {
        const input = { kit: CURRENT_KIT, path, brief, candidate };
        const legacy = legacyBuildPrompt(input);
        assert.equal(buildPrompt(input), legacy);
        assert.equal(buildPrompt({ ...input, staging: null }), legacy);
        assert.equal(buildPrompt({ ...input, staging: "   " }), legacy, "blank staging is plain");
      }
    }
  }
  const staging = `Low angle from the water at night: ${"the small boat, the oars, the lamp, the second lighthouse ahead, ".repeat(12)}`;
  const short = buildPrompt({ kit: CURRENT_KIT, path: storyOf(12), brief: BRIEF, candidate: 2, staging });
  assert.ok(short.length <= 2000);
  const line = short.split("\n").find((item) => item.startsWith("Candidate B: "))!;
  assert.ok(line.length - "Candidate B: ".length <= 600, "staging is at most 600 characters");
  assert.ok(short.includes(pathLines(storyOf(12)).at(-1)!), "the chosen moment's own line is kept");

  const tight = buildPrompt({ kit: CURRENT_KIT, path: storyOf(12), brief: longBrief, candidate: 3, staging });
  assert.ok(tight.length <= 2000);
  assert.ok(tight.includes(pathLines(storyOf(12)).at(-1)!), "still kept with a 500-character brief");
  assert.match(tight, /\nCandidate C: Low angle from the water at night: [^\n]*…\n/, "clipped to the room left");

  // A kit whose own guidance leaves no room: the plain staging line is used instead.
  const wordy: WorldKit = { ...CURRENT_KIT, rules: [...CURRENT_KIT.rules, "x".repeat(420)] };
  const crowded = buildPrompt({ kit: wordy, path: storyOf(12), brief: longBrief, candidate: 1, staging });
  assert.ok(crowded.includes(VARIANTS[0]));
  assert.ok(!crowded.includes("Low angle from the water"));
  assert.ok(crowded.length <= 2000);
});
