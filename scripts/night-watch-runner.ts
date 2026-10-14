// The local Night Watch runner: a separate process that keeps working after the browser closes.
// Testnet only. It advances due jobs one step at a time, every 3 seconds, and never prints secrets.
//
//   NIGHT_WATCH_CHARGE_ROOM=1 node --env-file-if-exists=.env.local scripts/night-watch-runner.ts [--once]
//
// NIGHT_WATCH_CHARGE_ROOM=1 makes each candidate use one Midnight Signal room credit (given back if
// it fails). NIGHT_WATCH_MAX_JOB_USD / NIGHT_WATCH_MAX_TOTAL_USD cap operator-paid inference
// (defaults 0.60 / 3.00). NIGHT_WATCH_DOOR_ORIGIN is the local x402 door (default http://127.0.0.1:3005).
// NIGHT_WATCH_BRAIN=1 lets the brain plan each job before drawing (Kimi K3 via TokenRouter, needs
// TOKENROUTER_API_KEY, plus OPENAI_API_KEY for the safety check); Kimi K3 then checks its own plan
// unless NIGHT_WATCH_CRITIC=0. Brain spend counts toward the same operator-paid allowance.
import { resolve } from "node:path";
import { pilotAdmin } from "../src/generation/client.ts";
import { readStored } from "../src/generation/storage.ts";
import { createPrivyRest } from "../src/privy/rest.ts";
import { readAgentToken } from "../src/x402/config.ts";
import { fundRoom, resumeAttempt } from "../src/x402/payer.ts";
import { supabaseReceiptStore } from "../src/x402/store.ts";
import { NIGHT_WATCH_ROOM } from "../src/night-watch/api-types.ts";
import { brainSettings, openAiModeration, type ChatDeps } from "../src/night-watch/brain.ts";
import { roomChargeEnabled, supabaseCapacity } from "../src/night-watch/capacity.ts";
import { generateCandidate, operatorLimits, operatorSpend, thinkForJob } from "../src/night-watch/generate.ts";
import { combinedMoments, storeMoments, supabaseMoments } from "../src/night-watch/job.ts";
import { authorizationKey, privyCredentials } from "../src/night-watch/privy-setup.ts";
import { acquireRunnerLock, runDueJobs, RunnerLocked, writeHeartbeat, type RunnerDeps } from "../src/night-watch/runner.ts";
import { fileNightWatchStore } from "../src/night-watch/store.ts";
import { baseSepoliaAuthorizationState, fundingDoor, reconciledFromReceipts, redact } from "../src/night-watch/topup.ts";

const INTERVAL_MS = 3_000;
const once = process.argv.includes("--once");
const stamp = () => new Date().toLocaleTimeString("en-GB", { hour12: false });
const say = (line: string) => console.log(`${stamp()} ${redact(line)}`);

const store = fileNightWatchStore();
let release: (() => Promise<void>) | null = null;
try {
  release = await acquireRunnerLock(store.root);
} catch (error) {
  console.error(error instanceof RunnerLocked ? error.message : `Could not start the Night Watch runner: ${(error as Error).message}`);
  process.exit(2);
}

let stopping = false;
let wake: (() => void) | null = null;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    say(`${signal}: finishing the current step, then stopping.`);
    wake?.();
  });
}

async function deps(): Promise<RunnerDeps> {
  const admin = pilotAdmin();
  const credentials = privyCredentials();
  const key = await authorizationKey(store).catch(() => null);
  const limits = operatorLimits();
  const moments = combinedMoments(supabaseMoments(admin), storeMoments(store));
  const generation = {
    store,
    fetch: globalThis.fetch,
    apiKey: process.env.OPENAI_API_KEY?.trim() || null,
    moments,
    limits,
    readMedia: (path: string) => readStored(admin, "pilot-media", path),
    publicDir: resolve("public"),
    now: () => new Date(),
  };
  const spend = await operatorSpend(store);
  const settings = brainSettings();
  const critic = process.env.NIGHT_WATCH_CRITIC !== "0";
  const brainOff = !settings.runnerEnabled
    ? "NIGHT_WATCH_BRAIN is not 1"
    : !settings.apiKey
      ? "no TOKENROUTER_API_KEY"
      : !settings.moderationKey
        ? "no OPENAI_API_KEY for the safety check"
        : null;
  const chat: ChatDeps | null = brainOff ? null : { fetch: globalThis.fetch, apiKey: settings.apiKey! };
  const brain = chat
    ? (job: Parameters<typeof thinkForJob>[1]) =>
        thinkForJob(
          {
            store,
            moments,
            limits,
            now: () => new Date(),
            think: { planner: chat, critic: critic ? chat : null, moderate: openAiModeration(globalThis.fetch, settings.moderationKey!), now: () => new Date() },
          },
          job,
        )
    : undefined;
  say(
    [
      `Night Watch runner pid ${process.pid}; store ${store.root}.`,
      `Room credit charge: ${roomChargeEnabled() ? "on (NIGHT_WATCH_CHARGE_ROOM=1)" : "off (read only)"}.`,
      `Privy signer: ${credentials && key ? "ready" : "not set up (top-ups will be refused)"}.`,
      `Image generation: ${generation.apiKey ? "configured" : "not configured"}; operator-paid allowance $${limits.maxJobUsd} per job, $${limits.maxTotalUsd} total ($${spend.totalUsd} used).`,
      brainOff
        ? `Brain: off (${brainOff}).`
        : `Brain: on (Kimi K3 plans${critic ? " and checks its own plan" : "; no second check (NIGHT_WATCH_CRITIC=0)"}, at low reasoning effort, via TokenRouter).`,
    ].join(" "),
  );
  return {
    store,
    now: () => new Date(),
    capacity: supabaseCapacity(admin),
    chargeRoom: roomChargeEnabled(),
    generate: (job, candidate) => generateCandidate(generation, job, candidate),
    brain,
    topUp: {
      privy: credentials ? createPrivyRest(credentials) : null,
      authorizationKey: key?.privateKey ?? null,
      fundRoom,
      resumeAttempt,
      readAgentToken: () => readAgentToken(),
      door: fundingDoor(),
      reconciled: reconciledFromReceipts(supabaseReceiptStore(admin), NIGHT_WATCH_ROOM),
      authorizationUsed: baseSepoliaAuthorizationState(),
    },
  };
}

// A step can wait minutes on the image provider; the page still sees a live runner meanwhile.
const heartbeat = setInterval(() => {
  writeHeartbeat(store, new Date()).catch(() => undefined);
}, 5_000);

try {
  const runner = await deps();
  let failures = 0;
  while (!stopping) {
    // One bad pass (a full disk, an unreadable record) must not stop the night's work.
    try {
      const results = await runDueJobs(runner);
      failures = 0;
      for (const result of results.filter((item) => item.changed || item.detail)) {
        say(`${result.jobId.slice(0, 12)} ${result.from} → ${result.to}: ${result.detail}`);
        if (result.error) console.error(`  ${redact(result.error instanceof Error ? result.error.message : String(result.error))}`);
      }
    } catch (error) {
      failures += 1;
      console.error(`A runner pass failed (${failures} in a row); trying again: ${redact((error as Error).message)}`);
      if (once) throw error;
    }
    if (once) break;
    await new Promise<void>((done) => {
      const timer = setTimeout(done, INTERVAL_MS);
      wake = () => {
        clearTimeout(timer);
        done();
      };
    });
  }
} catch (error) {
  console.error(`The Night Watch runner stopped: ${redact((error as Error).message)}`);
  process.exitCode = 1;
} finally {
  clearInterval(heartbeat);
  await release?.();
}
