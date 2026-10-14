import assert from "node:assert/strict";
import test from "node:test";
import { parseReconcileTick } from "../../src/generation/reconcile-tick.ts";
import { readRecoveryTimer, recoveryCheckpoint, recoveryRunOutput } from "../../scripts/recovery-timer-readiness.ts";

test("the recovery task accepts only the fixed Production clock payload", () => {
  const tick = { source: "cloudflare-cron", environment: "PRODUCTION", scheduledAt: "2026-10-13T23:00:00.000Z" };
  assert.deepEqual(parseReconcileTick(tick), tick);
  for (const invalid of [{}, null, [], { ...tick, source: "browser" }, { ...tick, environment: "DEVELOPMENT" },
    { ...tick, roomId: "paper-moon" }, { ...tick, scheduledAt: "2026-02-30T23:00:00.000Z" },
    { ...tick, scheduledAt: "2026-10-13T23:00:10.000Z" }, { ...tick, scheduledAt: "invalid" }])
    assert.throws(() => parseReconcileTick(invalid), /Invalid recovery tick/);
});

test("Cloudflare readiness reads only the fixed Worker and omits credentials and unrelated bindings", async () => {
  const env = { CLOUDFLARE_ACCOUNT_ID: "a".repeat(32), CLOUDFLARE_API_TOKEN: "OPERATOR_SECRET" };
  const bindings = [{ name: "PILOT_EXECUTION_ENV", type: "plain_text", text: "PRODUCTION" },
    { name: "PILOT_TIMER_ENABLED", type: "plain_text", text: "1" }, { name: "TRIGGER_SECRET_KEY", type: "secret_text" },
    { name: "UNRELATED", type: "plain_text", text: "PRIVATE_VALUE" }];
  const fetchImpl: typeof fetch = async (url, init) => {
    assert(String(url).startsWith(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/fork-night-recovery-timer/`));
    assert.equal(init?.method, "GET");
    assert.equal(init?.redirect, "error");
    const result = String(url).endsWith("/schedules") ? { schedules: [{ cron: "* * * * *" }] }
      : String(url).endsWith("/settings") ? { bindings } : { enabled: false, previews_enabled: false };
    return Response.json({ success: true, result });
  };
  const report = await readRecoveryTimer(env, fetchImpl);
  assert.equal(report.verified, true);
  assert.equal(report.configurationMatches, true);
  assert.equal(JSON.stringify(report).includes("SECRET"), false);
  assert.equal(JSON.stringify(report).includes("PRIVATE_VALUE"), false);
  bindings[1].text = "0";
  assert.equal((await readRecoveryTimer(env, fetchImpl)).configurationMatches, false);
  bindings[1].text = "1"; bindings[0].text = "DEVELOPMENT";
  assert.equal((await readRecoveryTimer(env, fetchImpl)).configurationMatches, false);
});

test("unavailable timer configuration remains unverified, without echoing the upstream failure", async () => {
  assert.equal((await readRecoveryTimer({}, async () => { throw new Error("unexpected network"); })).verified, false);
  const report = await readRecoveryTimer({ CLOUDFLARE_ACCOUNT_ID: "a".repeat(32), CLOUDFLARE_API_TOKEN: "PRIVATE_KEY" },
    async () => new Response("PRIVATE_KEY and upstream details", { status: 403 }));
  assert.equal(report.verified, false);
  assert.equal(JSON.stringify(report).includes("PRIVATE_KEY"), false);
});

test("disabled completions, stale checkpoints and unavailable job checks cannot masquerade as successful recovery", () => {
  const now = Date.parse("2026-10-13T23:00:00Z");
  assert.equal(recoveryCheckpoint({ generation: { environment: "PRODUCTION", lastReconcileAt: new Date(now - 60_000).toISOString() } }, now).fresh, true);
  for (const time of [now - 180_001, now + 1000])
    assert.equal(recoveryCheckpoint({ generation: { environment: "PRODUCTION", lastReconcileAt: new Date(time).toISOString() } }, now).fresh, false);
  assert.equal(recoveryCheckpoint({}, now).fresh, false);
  assert.equal(recoveryRunOutput({ enabled: false }).recoveryExecuted, false);
  assert.equal(recoveryRunOutput({ environment: "PRODUCTION", dryRun: true, checked: [] }).recoveryExecuted, false);
  assert.deepEqual(recoveryRunOutput({ environment: "PRODUCTION", dryRun: false, checked: [{ result: "check-unavailable" }] }),
    { recoveryExecuted: true, checkedDispatches: 1, unavailableChecks: 1 });
});
