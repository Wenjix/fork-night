import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { idempotencyKeys } from "@trigger.dev/sdk";
import worker, { enqueueRecovery } from "../../workers/recovery-timer/worker.mjs";

const timestamp = Date.parse("2026-10-13T23:00:00.000Z");
const tick = { cron: "* * * * *", scheduledTime: timestamp };
const env = { PILOT_TIMER_ENABLED: "1", PILOT_EXECUTION_ENV: "PRODUCTION", TRIGGER_SECRET_KEY: "tr_prod_sk_FIXTURE" };
const instant = { now: () => timestamp + 20_000, sleep: async () => {} };

test("the Cloudflare timer stays inert while disabled and rejects wrong environments or credentials before enqueue", async () => {
  let calls = 0;
  const dependencies = { ...instant, fetchImpl: async () => { calls++; throw new Error("unexpected request"); } };
  assert.deepEqual(await enqueueRecovery(tick, {}, dependencies), { state: "disabled" });
  for (const changed of [{ PILOT_EXECUTION_ENV: "DEVELOPMENT" }, { TRIGGER_SECRET_KEY: "tr_dev_sk_fixture" },
    { TRIGGER_SECRET_KEY: "tr_prod_sk_fixture\r\nother: secret" }, { TRIGGER_SECRET_KEY: "" }]) {
    await assert.rejects(enqueueRecovery(tick, { ...env, ...changed }, dependencies));
  }
  await assert.rejects(enqueueRecovery({ ...tick, cron: "0 * * * *" }, env, dependencies), /invalid-tick/);
  assert.equal(calls, 0);
});

test("minute notifications use the fixed authenticated Trigger endpoint and an explicitly global SDK-compatible identity", async () => {
  let sent;
  const result = await enqueueRecovery(tick, env, { ...instant, fetchImpl: async (url, init) => {
    sent = JSON.parse(init.body);
    assert.equal(url, "https://api.trigger.dev/api/v1/tasks/fork-night-reconcile/trigger");
    assert.equal(init.method, "POST");
    assert.equal(init.redirect, "manual");
    assert.equal(init.headers.Authorization, `Bearer ${env.TRIGGER_SECRET_KEY}`);
    assert(init.signal instanceof AbortSignal);
    return Response.json({ id: "run_fixture" });
  } });
  assert.equal(result.state, "accepted");
  assert.equal(result.runId, "run_fixture");
  assert.deepEqual(sent.payload, { source: "cloudflare-cron", environment: "PRODUCTION", scheduledAt: "2026-10-13T23:00:00.000Z" });
  assert.equal(sent.options.idempotencyKey, await idempotencyKeys.create(sent.options.idempotencyKeyOptions.key, { scope: "global" }));
  assert.equal(sent.options.idempotencyKeyOptions.scope, "global");
  assert.equal(sent.options.ttl, "5m");
  assert.equal(sent.options.maxAttempts, 1);
  assert.equal(sent.options.queue, undefined);
  assert.equal(sent.options.concurrencyKey, undefined);
  assert.equal(JSON.stringify(sent).includes(env.TRIGGER_SECRET_KEY), false);
});

test("a lost accepted response and duplicate minute notifications reuse one run; a later tick can catch missed work", async () => {
  const accepted = new Map();
  const requests = [];
  let loseFirstReply = true;
  const fetchImpl = async (_url, init) => {
    requests.push(init.body);
    const { options } = JSON.parse(init.body);
    if (!accepted.has(options.idempotencyKey)) accepted.set(options.idempotencyKey, `run_${accepted.size + 1}`);
    if (loseFirstReply) { loseFirstReply = false; throw new Error("lost acknowledgement"); }
    return Response.json({ id: accepted.get(options.idempotencyKey) });
  };
  const first = await enqueueRecovery(tick, env, { ...instant, fetchImpl });
  const duplicate = await enqueueRecovery({ ...tick, scheduledTime: timestamp + 1 }, env, { ...instant, fetchImpl });
  assert.equal(first.runId, duplicate.runId);
  assert.equal(first.attempts, 2);
  assert.equal(accepted.size, 1);
  assert.equal(new Set(requests).size, 1);
  await enqueueRecovery({ ...tick, scheduledTime: timestamp + 180_000 }, env, { ...instant, now: () => timestamp + 180_000, fetchImpl });
  assert.equal(accepted.size, 2, "a new clock tick checks all due work, without replaying missing historical ticks");
});

test("enqueue retries are bounded; authentication, redirect and rate-limit responses wait for the next minute", async () => {
  for (const status of [400, 401, 403, 404, 429, 301, 302, 303, 307, 308, 500, 503]) {
    let calls = 0;
    await assert.rejects(enqueueRecovery(tick, env, { ...instant, fetchImpl: async () => {
      calls++; return new Response("PRIVATE_UPSTREAM_BODY", { status });
    } }), error => error.message === `enqueue-http-${status}`);
    assert.equal(calls, status >= 500 ? 2 : 1);
  }
  let calls = 0;
  await assert.rejects(enqueueRecovery(tick, env, { ...instant, fetchImpl: async () => {
    calls++; throw new DOMException("PRIVATE_NETWORK_ERROR", "TimeoutError");
  } }), /enqueue-unavailable/);
  assert.equal(calls, 2);
});

test("a malformed or oversized acknowledgement cannot be reported as a successful enqueue or disclose its body", async () => {
  for (const body of ["PRIVATE_INVALID_JSON", JSON.stringify({ id: "PRIVATE_SECRET" }), JSON.stringify({ id: "run_ok", extra: "x".repeat(8200) })]) {
    let calls = 0;
    await assert.rejects(enqueueRecovery(tick, env, { ...instant, fetchImpl: async () => {
      calls++; return new Response(body);
    } }), /invalid-acknowledgement/);
    assert.equal(calls, 2);
  }
});

test("old and future timer deliveries cannot accumulate a backlog of recovery runs", async () => {
  for (const time of [timestamp - 300_001, timestamp + 60_001]) {
    const result = await enqueueRecovery({ ...tick, scheduledTime: time }, env, { now: () => timestamp,
      fetchImpl: async () => { throw new Error("No stale tick may enqueue"); } });
    assert.deepEqual(result, { state: "skipped", reason: "stale-tick" });
  }
});

test("the actual scheduled handler awaits acceptance; HTTP access never dispatches and failures log only safe codes", async t => {
  const logs = [];
  t.mock.method(console, "log", value => logs.push(value));
  t.mock.method(console, "error", value => logs.push(value));
  let accept;
  t.mock.method(globalThis, "fetch", async () => new Promise(resolve => { accept = resolve; }));
  const controller = { ...tick, scheduledTime: Math.floor(Date.now() / 60_000) * 60_000 };
  let completed = false;
  const pending = worker.scheduled(controller, env).then(() => { completed = true; });
  while (!accept) await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal(completed, false);
  accept(Response.json({ id: "run_handler" }));
  await pending;
  assert.equal(JSON.parse(logs[0]).runId, "run_handler");
  t.mock.method(globalThis, "fetch", async () => new Response("PRIVATE_PROVIDER_BODY", { status: 401 }));
  await assert.rejects(worker.scheduled(controller, env), /enqueue-http-401/);
  assert.deepEqual(JSON.parse(logs[1]), { event: "recovery-timer", state: "failed", code: "enqueue-http-401" });
  assert.equal(logs.join("").includes("PRIVATE_"), false);
  assert.equal(logs.join("").includes(env.TRIGGER_SECRET_KEY), false);
  const response = await worker.fetch(new Request("https://timer.invalid/", { method: "POST" }), env);
  assert.equal(response.status, 404);
});

test("the timer has one minute cron, starts disabled, and its deploy config exposes no public URL or provider secret", async () => {
  const config = JSON.parse(await readFile(new URL("../../workers/recovery-timer/wrangler.jsonc", import.meta.url), "utf8"));
  assert.deepEqual(config.triggers.crons, ["* * * * *"]);
  assert.equal(config.vars.PILOT_TIMER_ENABLED, "0");
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.routes, []);
  assert.deepEqual(config.secrets.required, ["TRIGGER_SECRET_KEY"]);
});
