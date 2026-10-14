import assert from "node:assert/strict";
import test from "node:test";
import { handleRoomActivity } from "../../src/generation/activity.ts";

test("room activity returns scoped counts without disclosing private jobs", async t => {
  const original = { ...process.env };
  t.after(() => { process.env = original; });
  Object.assign(process.env, { NEXT_PUBLIC_SUPABASE_URL: "https://activity.invalid", SUPABASE_SECRET_KEY: "server-test-key" });
  let open = true, failCounts = false;
  const queries: URL[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input)); queries.push(url);
    assert.equal(url.hostname, "activity.invalid");
    if (url.pathname === "/rest/v1/pilot_rooms") return Response.json(open ? { is_open: true } : { is_open: false });
    assert.equal(url.pathname, "/rest/v1/pilot_jobs");
    assert.equal(init?.method, "HEAD", "Counting activity must not fetch private rows");
    assert.equal(url.searchParams.get("pilot_operations.room_id"), "eq.midnight-signal");
    assert.equal(url.searchParams.get("pilot_operations.charged_units"), "eq.0");
    assert.doesNotMatch(url.searchParams.get("select")!, /prompt|panels|claim_token|maker_id/);
    if (failCounts) return new Response(null, { status: 403 });
    const count = url.searchParams.get("state") === "eq.queued" ? 2 : 1;
    if (url.searchParams.get("state") === "eq.running") assert.match(url.searchParams.get("updated_at")!, /^gt\./);
    if (url.searchParams.has("or")) assert.match(url.searchParams.get("or")!, /state.eq.uncertain,and\(state.eq.running,updated_at.lte\./);
    return new Response(null, { headers: { "content-range": `*/${count}` } });
  });
  const request = () => new Request("http://localhost:3005/api/pilot/activity?room=midnight-signal");
  await t.test("invalid room queries cannot reach the database", async () => {
    const invalid = await handleRoomActivity(new Request("http://localhost:3005/api/pilot/activity"));
    assert.equal(invalid.status, 400);
    assert.equal(invalid.headers.get("vercel-cdn-cache-control"), null, "errors are never shared from the CDN");
    assert.equal(queries.length, 0);
  });
  await t.test("a public open room gets counts and no private metadata", async () => {
    const response = await handleRoomActivity(request());
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("vercel-cdn-cache-control"), "max-age=5", "viewers share totals for a few seconds");
    assert.deepEqual(await response.json(), { queued_requests: 2, generating_requests: 1, checking_requests: 1 });
    assert.equal(queries.length, 4);
  });
  await t.test("closed rooms never query their jobs", async () => {
    open = false; queries.length = 0;
    assert.equal((await handleRoomActivity(request())).status, 404);
    assert.equal(queries.length, 1);
  });
  await t.test("a failed count is unavailable rather than a fabricated idle room", async () => {
    open = true; failCounts = true;
    const failed = await handleRoomActivity(request());
    assert.equal(failed.status, 503);
    assert.equal(failed.headers.get("vercel-cdn-cache-control"), null);
  });
});
