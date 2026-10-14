import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { TRANSFER_WITH_AUTHORIZATION_TYPES } from "../../src/privy/policy.ts";
import { PrivyApiError } from "../../src/privy/rest.ts";
import { BASE_SEPOLIA, TESTNET_USDC, explorerUrl } from "../../src/x402/ids.ts";
import type { FundingSummary, fundRoom, resumeAttempt } from "../../src/x402/payer.ts";
import { chargePath, type CapacityAdmin, type ChargeRecord } from "../../src/night-watch/capacity.ts";
import { candidateFiles, generateCandidate, operatorLimits, type CandidateOutcome } from "../../src/night-watch/generate.ts";
import { createJob, createJobForRequest, jobResponse, type StoryMoment } from "../../src/night-watch/job.ts";
import { jobEventsPath, jobPath, type JobRecord } from "../../src/night-watch/job-types.ts";
import { RUNNER_HEARTBEAT, RunnerLocked, acquireRunnerLock, advanceJob, runDueJobs, type RunnerDeps } from "../../src/night-watch/runner.ts";
import { newSession, sessionPath, sessionSummary, type DelegationSession } from "../../src/night-watch/session.ts";
import { fileNightWatchStore, type NightWatchStore } from "../../src/night-watch/store.ts";
import { runTopUp } from "../../src/night-watch/topup.ts";

const PUBLIC = resolve(import.meta.dirname, "../../public");
const MAKER = { id: "11111111-1111-4111-8111-111111111111", displayName: "Wenjie" };
const WALLET = "0x1111111111111111111111111111111111111111";
const PAY_TO = "0x4A6DE1347E9b2E466e5EAe6ba18dd63d7080BfdE";
const ROOT_ID = "10000000-0000-4000-8000-000000000001";
const TX = `0x${"ab".repeat(32)}`;
const NONCE = `0x${"12".repeat(32)}`;
const START = new Date("2026-10-13T21:00:00.000Z");
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

type Fixture = Awaited<ReturnType<typeof fixture>>;

async function fixture(t: { after: (fn: () => Promise<void>) => void }, options: { limit: number; maxPayments?: number; attempts?: number; chargeRoom?: boolean } = { limit: 6 }) {
  const root = await mkdtemp(join(tmpdir(), "nw-runner-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = fileNightWatchStore(root);
  const clock = { now: START };
  const now = () => clock.now;
  const created = newSession({
    makerProfileId: MAKER.id,
    roomId: "midnight-signal",
    fundingRef: "r".repeat(22),
    payTo: PAY_TO,
    privy: { userId: "did:privy:maker", walletId: "wallet-1", walletAddress: WALLET, signerId: "kq-1", policyId: "policy-1" },
    hours: 2,
    maxPayments: options.maxPayments ?? 1,
    attemptAllowance: options.attempts ?? 2,
    now: START,
  });
  const session: DelegationSession = { ...created, state: "active", confirmedAt: START.toISOString() };
  await store.write(sessionPath(session.id), session);
  const job = await createJob(store, {
    maker: MAKER,
    session,
    forkPoint: { id: ROOT_ID, title: seed.title, makerLabel: "Wenjie" },
    brief: "Mira and the Dokkaebi find a second lighthouse that answers the first.",
    startInSeconds: 0,
    now: START,
  });

  const room = { limit: options.limit, used: 0, enabled: true, updates: 0 };
  const capacity: CapacityAdmin = {
    async credits() {
      return { limit: room.limit, used: room.used, reserved: 0, available: Math.max(0, room.limit - room.used), enabled: room.enabled };
    },
    async setDeliveryLimit(_room, expected, next) {
      if (room.limit !== expected) return false;
      room.limit = next;
      room.updates++;
      return true;
    },
  };
  const calls = { sign: 0, fund: 0, resume: 0, generate: 0 };
  const privy = {
    signBehaviour: "sign" as "sign" | "deny",
    async signTypedData() {
      calls.sign++;
      if (privy.signBehaviour === "deny") throw new PrivyApiError(403, { error: "Policy denied this request" }, "/v1/wallets/wallet-1/rpc");
      return `0x${"cd".repeat(65)}`;
    },
  };
  const payer = {
    outcome: "credited" as "credited" | "pending" | "refused",
    beforeSigning: async () => {},
    resumeOutcome: "credited" as "credited" | "pending",
  };
  const recordDir = join(root, "payments");
  const fakeFund = (async (options: Parameters<typeof fundRoom>[0]): Promise<FundingSummary> => {
    calls.fund++;
    const base = { network: BASE_SEPOLIA, transaction: null, explorerUrl: null, credits: null } as const;
    if (payer.outcome === "refused") return { ...base, status: 409, outcome: "refused", message: "The room refused to take a payment. Nothing was signed.", recordFile: null };
    await payer.beforeSigning();
    const seconds = Math.floor(clock.now.getTime() / 1000);
    if (options.network !== BASE_SEPOLIA) throw new Error("unexpected network");
    await options.signer.signTypedData({
      domain: { name: "USDC", version: "2", chainId: 84532, verifyingContract: TESTNET_USDC[BASE_SEPOLIA] as `0x${string}` },
      types: { TransferWithAuthorization: TRANSFER_WITH_AUTHORIZATION_TYPES.TransferWithAuthorization },
      primaryType: "TransferWithAuthorization",
      message: { from: WALLET, to: PAY_TO, value: 1_000_000n, validAfter: 0n, validBefore: BigInt(seconds + 120), nonce: NONCE },
    });
    const recordFile = join(options.recordDir, "attempt.json");
    await mkdir(options.recordDir, { recursive: true });
    const credited = payer.outcome === "credited";
    await writeFile(recordFile, JSON.stringify({
      version: 1, url: options.url, network: BASE_SEPOLIA, header: "signed-header", payer: WALLET, evmNonce: NONCE,
      validBefore: String(seconds + 120), createdAt: clock.now.toISOString(), state: credited ? "credited" : "pending", sends: 1,
      response: credited ? { status: "credited", added: 5, transaction: TX } : { status: "pending" },
    }));
    if (!credited) return { ...base, status: 202, outcome: "pending", message: "The payment is pending.", recordFile };
    room.limit += 5;
    return { status: 200, outcome: "credited", network: BASE_SEPOLIA, transaction: TX, explorerUrl: explorerUrl(BASE_SEPOLIA, TX), credits: { added: 5, replayed: false, room: null }, message: "Credited.", recordFile };
  }) as typeof fundRoom;
  const fakeResume = (async (recordFile: string): Promise<FundingSummary> => {
    calls.resume++;
    if (payer.resumeOutcome === "pending")
      return { status: 202, outcome: "pending", network: BASE_SEPOLIA, transaction: null, explorerUrl: null, credits: null, message: "Still pending.", recordFile };
    room.limit += 5;
    return { status: 200, outcome: "credited", network: BASE_SEPOLIA, transaction: TX, explorerUrl: explorerUrl(BASE_SEPOLIA, TX), credits: { added: 5, replayed: false, room: null }, message: "Credited.", recordFile };
  }) as typeof resumeAttempt;

  const generated: Record<number, CandidateOutcome["state"]> = {};
  const generate = async (current: JobRecord, number: number): Promise<CandidateOutcome> => {
    calls.generate++;
    const state = generated[number] ?? "delivered";
    return {
      state,
      requested: state !== "failed",
      capRefused: false,
      requestDigest: `${number}`.repeat(64),
      imageFile: state === "delivered" ? candidateFiles(current.id, number).image : null,
      sha256: state === "delivered" ? "e".repeat(64) : null,
      expenseUsd: state === "delivered" ? "0.014960" : null,
      error: state === "delivered" ? null : "The provider did not return an image (provider_error).",
    };
  };
  const deps: RunnerDeps = {
    store,
    now,
    capacity,
    chargeRoom: options.chargeRoom ?? false,
    generate,
    topUp: {
      privy,
      authorizationKey: AUTHORIZATION_KEY,
      fundRoom: fakeFund,
      resumeAttempt: fakeResume,
      readAgentToken: async () => "A".repeat(43),
      door: async () => ({ url: `http://127.0.0.1:3005/api/x402/fund/${"r".repeat(22)}`, payTo: PAY_TO }),
    },
  };
  return { root, store, clock, session, job, room, calls, privy, payer, generated, deps, recordDir };
}

async function readJob(store: NightWatchStore, id: string) {
  return (await store.read<JobRecord>(jobPath(id)))!;
}

async function readSession(f: Fixture) {
  return (await f.store.read<DelegationSession>(sessionPath(f.session.id)))!;
}

/** Advances until the job is final or waiting for later; returns the states it passed through. */
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

async function details(store: NightWatchStore, id: string) {
  return (await store.readEvents(jobEventsPath(id))).map((event) => String(event.detail));
}

test("enough room credits: no payment, every candidate prepared, nothing published", async (t) => {
  const f = await fixture(t, { limit: 6 });
  assert.deepEqual(await drive(f), ["checking", "generating", "generating", "ready"]);
  assert.deepEqual([f.calls.fund, f.calls.sign, f.calls.generate], [0, 0, 2]);
  const job = await readJob(f.store, f.job.id);
  assert.equal(job.message, "2 private candidates ready for your review. Nothing was published.");
  assert.equal(job.capacity.availableAtCheck, 6);
  assert.equal(job.publishedMomentId, null);
  const events = await details(f.store, f.job.id);
  assert.ok(events.includes("Checked room credits: 6 available, 2 needed"));
  assert.ok(events.some((event) => event.startsWith("Prepared candidate 1 of 2")));
  assert.ok(events.some((event) => event.startsWith("Prepared candidate 2 of 2")));
  assert.equal(f.room.updates, 0, "without the flag the room is only read");
});

test("short on credits: one Privy-signed top-up, credited, then the candidates", async (t) => {
  const f = await fixture(t, { limit: 1 });
  assert.deepEqual(await drive(f), ["checking", "topping_up", "checking", "generating", "generating", "ready"]);
  assert.deepEqual([f.calls.fund, f.calls.sign, f.calls.resume], [1, 1, 0]);
  const session = await readSession(f);
  assert.equal(session.reservations.length, 1);
  assert.equal(session.reservations[0].state, "settled");
  assert.equal(session.reservations[0].transaction, TX);
  assert.match(session.reservations[0].note ?? "", new RegExp(`nonce=${NONCE}`));
  const events = await details(f.store, f.job.id);
  assert.ok(events.includes("Checked room credits: 1 of 2 needed"));
  assert.ok(events.some((event) => /^Bought one room top-up: \+5 test credits \(Base Sepolia tx 0xabababab/.test(event)));
  const view = await jobResponse(f.store, await readJob(f.store, f.job.id), sessionSummary(session, f.clock.now) as never);
  assert.equal(view.job.receipt?.transaction, TX);
  assert.equal(view.job.receipt?.explorerUrl, `https://sepolia.basescan.org/tx/${TX}`);
  assert.equal(view.job.receipt?.payer, WALLET);
  assert.equal(view.job.receipt?.creditsAdded, 5);
  assert.equal(view.job.payment?.state, "settled");
  assert.equal(view.job.expense.images, 2);
  assert.equal(view.job.expense.operatorPaidUsd, "0.029920");
  assert.deepEqual(view.job.candidates.map((candidate) => candidate.imagePath), [1, 2].map((n) => `/api/night-watch/jobs/${f.job.id}/candidates/${n}`));
});

test("a pending payment waits and is re-sent, never signed again", async (t) => {
  const f = await fixture(t, { limit: 0 });
  f.payer.outcome = "pending";
  f.payer.resumeOutcome = "pending";
  assert.deepEqual(await drive(f), ["checking", "topping_up", "waiting_payment"]);
  let job = await readJob(f.store, f.job.id);
  assert.ok(job.paymentRecordFile?.endsWith("attempt.json"));
  assert.equal((await readSession(f)).reservations[0].state, "signed");
  assert.equal((await advanceJob(f.deps, f.job.id)).changed, false, "not due before its retry time");

  f.clock.now = new Date(START.getTime() + 15_000);
  await advanceJob(f.deps, f.job.id);
  job = await readJob(f.store, f.job.id);
  assert.equal(job.state, "waiting_payment");
  assert.deepEqual([f.calls.fund, f.calls.sign, f.calls.resume], [1, 1, 1]);

  // Even if the job is pushed back to topping_up, a signed reservation is resumed, not re-signed.
  const resumed = await runTopUp({ ...f.deps.topUp, store: f.store, now: () => f.clock.now }, { ...job, state: "topping_up" }, await readSession(f));
  assert.equal(resumed.kind, "waiting");
  assert.deepEqual([f.calls.fund, f.calls.sign, f.calls.resume], [1, 1, 2]);

  f.payer.resumeOutcome = "credited";
  f.clock.now = new Date(START.getTime() + 30_000);
  const states = await drive(f);
  assert.deepEqual(states, ["checking", "generating", "generating", "ready"]);
  assert.deepEqual([f.calls.fund, f.calls.sign, f.calls.resume], [1, 1, 3]);
  assert.equal((await readSession(f)).reservations[0].state, "settled");
});

test("a refused top-up releases the reservation and blocks the job", async (t) => {
  const f = await fixture(t, { limit: 0 });
  f.payer.outcome = "refused";
  assert.deepEqual(await drive(f), ["checking", "topping_up", "blocked"]);
  assert.equal(f.calls.sign, 0);
  const session = await readSession(f);
  assert.equal(session.reservations[0].state, "released");
  const job = await readJob(f.store, f.job.id);
  assert.match(job.message, /refused to take a payment\. Nothing was signed\./);
  assert.ok(job.candidates.every((candidate) => candidate.state === "failed"));
  assert.equal(f.calls.generate, 0);
});

test("a Privy policy refusal releases the reservation and blocks the job", async (t) => {
  const f = await fixture(t, { limit: 0 });
  f.privy.signBehaviour = "deny";
  assert.deepEqual(await drive(f), ["checking", "topping_up", "blocked"]);
  assert.equal(f.calls.sign, 1);
  assert.equal((await readSession(f)).reservations[0].state, "released");
  assert.match((await readJob(f.store, f.job.id)).message, /^Privy refused the signature: .*Nothing was paid\.$/);
});

test("a revoked or expired session blocks the job without signing", async (t) => {
  const revoked = await fixture(t, { limit: 0 });
  await revoked.store.write(sessionPath(revoked.session.id), { ...revoked.session, state: "revoked", revokedAt: START.toISOString() });
  assert.deepEqual(await drive(revoked), ["checking", "blocked"]);
  assert.match((await readJob(revoked.store, revoked.job.id)).message, /revoked/);
  assert.deepEqual([revoked.calls.fund, revoked.calls.sign, revoked.calls.generate], [0, 0, 0]);

  const expired = await fixture(t, { limit: 6 });
  expired.clock.now = new Date(START.getTime() + 3 * 3_600_000);
  assert.deepEqual(await drive(expired), ["checking", "blocked"]);
  assert.match((await readJob(expired.store, expired.job.id)).message, /expired/);
  assert.equal(expired.calls.generate, 0, "no payment needed, but the maker's allowance ended before generation");

  // Revoked after the reservation but before Privy is asked: the signer refuses and nothing is signed.
  const late = await fixture(t, { limit: 0 });
  late.payer.beforeSigning = async () => {
    await late.store.update<DelegationSession>(sessionPath(late.session.id), (current) => ({ ...current!, state: "revoked", revokedAt: START.toISOString() }));
  };
  assert.deepEqual(await drive(late), ["checking", "topping_up", "blocked"]);
  assert.equal(late.calls.sign, 0);
  assert.equal((await readSession(late)).reservations[0].state, "released");
  assert.match((await readJob(late.store, late.job.id)).message, /signer refused: The maker revoked this Night Watch allowance\./);
});

test("an interruption after the request record leaves that candidate uncertain and never calls the provider again", async (t) => {
  const f = await fixture(t, { limit: 6 });
  const png = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#203050" } }).png().toBuffer();
  const provider: string[] = [];
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    provider.push(String((init?.headers as Record<string, string>)["X-Client-Request-Id"]));
    return new Response(JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }), { status: 200 });
  }) as typeof fetch;
  // The first response record fails to save, as if the runner died right after the provider answered.
  let crashed = false;
  const store: NightWatchStore = {
    ...f.store,
    async write(name, value) {
      if (!crashed && name.endsWith("candidate-1.response")) {
        crashed = true;
        throw new Error("Simulated crash before the response was saved");
      }
      return f.store.write(name, value);
    },
  };
  const generation = { store, fetch: fetchImpl, apiKey: "test-key", moments: async () => [seed], limits: operatorLimits({}), publicDir: PUBLIC, now: () => f.clock.now };
  f.deps.store = store;
  f.deps.generate = (job, number) => generateCandidate(generation, job, number);

  assert.deepEqual(await drive(f, 3), ["checking", "generating", "generating"]);
  let job = await readJob(f.store, f.job.id);
  assert.match(job.message, /^Waiting to try again: Simulated crash/);
  assert.equal(provider.length, 1);

  f.clock.now = new Date(START.getTime() + 60_000);
  const states = await drive(f);
  assert.deepEqual(states, ["generating", "ready"]);
  job = await readJob(f.store, f.job.id);
  assert.deepEqual(job.candidates.map((candidate) => candidate.state), ["uncertain", "delivered"]);
  assert.deepEqual(provider, [`nw-${f.job.id.slice(4, 12)}-1`, `nw-${f.job.id.slice(4, 12)}-2`], "candidate 1 was sent exactly once");
  assert.match(job.message, /^1 private candidate ready for your review \(1 could not be prepared\)/);
});

test("with the charge flag each candidate uses one room credit, once, and a failed one is refunded", async (t) => {
  const f = await fixture(t, { limit: 3, chargeRoom: true });
  f.generated[2] = "failed";
  assert.deepEqual(await drive(f), ["checking", "generating", "generating", "ready"]);
  assert.equal(f.room.limit, 2, "3 - 2 charges + 1 refund");
  const job = await readJob(f.store, f.job.id);
  assert.deepEqual(job.capacity, { neededCredits: 2, availableAtCheck: 3, charged: 2, refunded: 1 });
  assert.deepEqual(job.candidates.map((candidate) => [candidate.state, candidate.charged, candidate.refunded]), [
    ["delivered", true, false],
    ["failed", true, true],
  ]);
  const first = await f.store.read<ChargeRecord>(chargePath(f.job.id, 1));
  const second = await f.store.read<ChargeRecord>(chargePath(f.job.id, 2));
  assert.deepEqual([first!.charge!.state, first!.refund], ["applied", null]);
  assert.deepEqual([second!.charge!.state, second!.refund!.state], ["applied", "applied"]);
  assert.equal(f.room.updates, 3);
  assert.ok((await details(f.store, f.job.id)).some((event) => event.endsWith("Its room credit was given back.")));
});

test("the operator allowance refuses before any provider call, and charged credits come back", async (t) => {
  const f = await fixture(t, { limit: 3, chargeRoom: true });
  const provider: string[] = [];
  const fetchImpl = (async () => {
    provider.push("called");
    throw new Error("must not be called");
  }) as typeof fetch;
  const generation = { store: f.store, fetch: fetchImpl, apiKey: "test-key", moments: async () => [seed], limits: operatorLimits({ NIGHT_WATCH_MAX_JOB_USD: "0.01" }), publicDir: PUBLIC, now: () => f.clock.now };
  f.deps.generate = (job, number) => generateCandidate(generation, job, number);
  assert.deepEqual(await drive(f), ["checking", "generating", "generating", "blocked"]);
  assert.equal(provider.length, 0);
  const job = await readJob(f.store, f.job.id);
  assert.match(job.message, /^No image was requested: This job's operator-paid inference would pass its \$0\.010000 limit/);
  assert.equal(f.room.limit, 3, "both charges were refunded");
});

test("the runner writes a heartbeat, advances only due jobs, and refuses a second runner", async (t) => {
  const f = await fixture(t, { limit: 6 });
  const later = await createJob(f.store, {
    maker: MAKER,
    session: { ...f.session, id: `nws_${"9".repeat(32)}` },
    forkPoint: { id: ROOT_ID, title: seed.title, makerLabel: "Wenjie" },
    brief: "Later.",
    startInSeconds: 600,
    now: START,
  });
  const results = await runDueJobs(f.deps);
  assert.deepEqual(results.map((result) => [result.jobId, result.to]), [[f.job.id, "checking"]]);
  assert.equal((await readJob(f.store, later.id)).state, "scheduled");
  assert.deepEqual(await f.store.read(RUNNER_HEARTBEAT), { at: START.toISOString(), pid: process.pid });

  const release = await acquireRunnerLock(f.root);
  await assert.rejects(acquireRunnerLock(f.root), RunnerLocked);
  await release();
  const again = await acquireRunnerLock(f.root);
  await again();
  await mkdir(join(f.root, "runner"), { recursive: true });
  await writeFile(join(f.root, "runner", "instance.lock"), JSON.stringify({ pid: 2_147_483_000, at: START.toISOString() }));
  const stale = await acquireRunnerLock(f.root);
  assert.equal(JSON.parse(await readFile(join(f.root, "runner", "instance.lock"), "utf8")).pid, process.pid);
  await stale();
});

test("job creation: the maker's own active session, a valid brief and fork point, one unfinished job per session", async (t) => {
  const f = await fixture(t, { limit: 6 });
  const routeDeps = { store: f.store, now: () => f.clock.now, maker: async () => MAKER, moments: async () => [seed] };
  const body = { sessionId: f.session.id, forkPointId: ROOT_ID, brief: "Another beat.", startInSeconds: 60 };
  await assert.rejects(createJobForRequest("token", body, routeDeps), { status: 409, code: "job_in_progress" });
  await f.store.update<JobRecord>(jobPath(f.job.id), (current) => ({ ...current!, state: "ready" }));
  const created = await createJobForRequest("token", body, routeDeps);
  assert.equal(created.job.state, "scheduled");
  assert.equal(created.job.runAfter, new Date(START.getTime() + 60_000).toISOString());
  assert.equal(created.job.attempts, 2);
  assert.equal(created.job.candidates.length, 2);
  assert.equal(created.job.events.length, 1);

  await f.store.update<JobRecord>(jobPath(created.job.id), (current) => ({ ...current!, state: "failed" }));
  const stranger = { ...routeDeps, maker: async () => ({ id: "22222222-2222-4222-8222-222222222222", displayName: "Someone" }) };
  await assert.rejects(createJobForRequest("token", body, stranger), { status: 404, code: "missing_session" });
  await assert.rejects(createJobForRequest("token", { ...body, brief: " " }, routeDeps), { status: 400, code: "invalid_brief" });
  await assert.rejects(createJobForRequest("token", { ...body, startInSeconds: 3601 }, routeDeps), { status: 400, code: "invalid_start" });
  await assert.rejects(createJobForRequest("token", { ...body, forkPointId: "30000000-0000-4000-8000-000000000003" }, routeDeps), { status: 404 });
  await f.store.write(sessionPath(f.session.id), { ...f.session, state: "revoked" });
  await assert.rejects(createJobForRequest("token", body, routeDeps), { status: 409, code: "revoked" });
});

test("job routes are local only, need a bearer token, and load nothing heavy before the gate", async (t) => {
  const saved = { controls: process.env.PILOT_LOCAL_CONTROLS, vercel: process.env.VERCEL };
  t.after(() => {
    if (saved.controls === undefined) delete process.env.PILOT_LOCAL_CONTROLS;
    else process.env.PILOT_LOCAL_CONTROLS = saved.controls;
    if (saved.vercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = saved.vercel;
  });
  delete process.env.VERCEL;
  const loaded: string[] = [];
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (!specifier.startsWith("@/")) return next(specifier, context);
      loaded.push(specifier);
      return next(new URL(`../../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    },
  });
  t.after(() => hooks.deregister());
  const jobs = await import("../../src/app/api/night-watch/jobs/route.ts");
  const one = await import("../../src/app/api/night-watch/jobs/[id]/route.ts");
  const image = await import("../../src/app/api/night-watch/jobs/[id]/candidates/[n]/route.ts");
  for (const module of [jobs, one, image]) assert.equal(module.runtime, "nodejs");
  const id = `nwj_${"a".repeat(32)}`;
  const calls: [string, (request: Request) => Promise<Response>][] = [
    ["/api/night-watch/jobs", (request) => jobs.POST(request)],
    [`/api/night-watch/jobs/${id}`, (request) => one.GET(request, { params: Promise.resolve({ id }) })],
    [`/api/night-watch/jobs/${id}/candidates/1`, (request) => image.GET(request, { params: Promise.resolve({ id, n: "1" }) })],
  ];
  const request = (path: string, origin = "http://127.0.0.1:3005", headers: Record<string, string> = {}) => {
    const url = new URL(path, origin);
    return new Request(url, { method: path.endsWith("/jobs") ? "POST" : "GET", headers: { host: url.host, ...headers } });
  };
  for (const [path, call] of calls) {
    delete process.env.PILOT_LOCAL_CONTROLS;
    let response = await call(request(path));
    assert.equal(response.status, 404, path);
    assert.deepEqual(await response.json(), { error: "Not found." });
    process.env.PILOT_LOCAL_CONTROLS = "1";
    response = await call(request(path, "http://night-watch.example"));
    assert.equal(response.status, 404, `${path} from a non-loopback host`);
    response = await call(request(path));
    assert.equal(response.status, 401, `${path} without a bearer token`);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await response.json()).code, "sign_in");
  }
  assert.ok(!loaded.includes("@/night-watch/job"), "the job module loads only after the gate and the bearer check");
});

test("a crash after a credited top-up reuses that top-up instead of buying another", async (t) => {
  const f = await fixture(t, { limit: 0 });
  f.payer.outcome = "credited";
  assert.deepEqual(await drive(f), ["checking", "topping_up", "checking", "generating", "generating", "ready"]);
  assert.deepEqual([f.calls.fund, f.calls.sign], [1, 1]);
  // Simulate the crash: the session says settled, but the job never recorded the reservation.
  const job = await readJob(f.store, f.job.id);
  const result = await runTopUp({ ...f.deps.topUp, store: f.store, now: () => f.clock.now }, { ...job, state: "topping_up", reservationId: null }, await readSession(f));
  assert.equal(result.kind, "credited");
  assert.deepEqual([f.calls.fund, f.calls.sign], [1, 1], "nothing new was signed or sent");
  assert.equal((await readSession(f)).reservations.length, 1);
});
