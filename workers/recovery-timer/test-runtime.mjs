import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

test("the packaged Worker retries one scheduled enqueue and refuses redirects with fixture-only outbound traffic", async t => {
  const config = JSON.parse(await readFile(new URL("./wrangler.jsonc", import.meta.url), "utf8"));
  const requests = [];
  const destinations = [];
  const accepted = new Map();
  let loseAnswer = true;
  let redirect = false;
  const runtime = new Miniflare(convertV4MiniflareOptions({
    name: config.name, modules: true,
    scriptPath: fileURLToPath(new URL("./worker.mjs", import.meta.url)),
    compatibilityDate: config.compatibility_date,
    bindings: { ...config.vars, PILOT_TIMER_ENABLED: "1", TRIGGER_SECRET_KEY: "tr_prod_sk_RUNTIME_FIXTURE" },
    outboundService: async request => {
      // Every outbound request is intercepted; this test cannot reach Trigger or a provider.
      destinations.push(request.url);
      assert.equal(request.url, "https://api.trigger.dev/api/v1/tasks/fork-night-reconcile/trigger");
      assert.equal(request.method, "POST");
      assert.equal(request.headers.get("authorization"), "Bearer tr_prod_sk_RUNTIME_FIXTURE");
      const body = await request.json();
      requests.push(body);
      if (redirect) return new Response(null, { status: 307, headers: { Location: "https://unexpected.invalid/redirect" } });
      const key = body.options.idempotencyKey;
      if (!accepted.has(key)) accepted.set(key, `run_${accepted.size + 1}`);
      if (loseAnswer) { loseAnswer = false; return new Response(null, { status: 503 }); }
      return Response.json({ id: accepted.get(key) });
    },
  }));
  t.after(() => runtime.dispose());
  const timer = await runtime.getWorker();
  const scheduledTime = new Date(Math.floor(Date.now() / 60_000) * 60_000);
  const first = await timer.scheduled({ cron: "* * * * *", scheduledTime });
  assert.equal(first.outcome, "ok");
  assert.equal(requests.length, 2);
  const again = await timer.scheduled({ cron: "* * * * *", scheduledTime });
  assert.equal(again.outcome, "ok");
  assert.equal(accepted.size, 1);
  assert.deepEqual(requests[0], requests[1]);
  assert.deepEqual(requests[0], requests[2]);
  assert.equal((await runtime.dispatchFetch("http://timer.invalid/", { method: "POST" })).status, 404);
  assert.equal(requests.length, 3);
  redirect = true;
  const refused = await timer.scheduled({ cron: "* * * * *", scheduledTime });
  assert.equal(refused.outcome, "exception");
  assert.equal(requests.length, 4, "a redirect is refused without a retry");
  assert.equal(destinations.length, 4, "no request follows the redirect destination");
  assert(destinations.every(url => url === "https://api.trigger.dev/api/v1/tasks/fork-night-reconcile/trigger"));
  assert.equal(accepted.size, 1);
});
