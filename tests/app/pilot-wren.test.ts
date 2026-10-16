import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { parseWrenIntent, wrenView, type WrenRequest } from "../../src/generation/wren-types.ts";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/supabase/database.types.ts";
import { handleWrenRequest } from "../../src/generation/wren-api.ts";
import { planWrenScene } from "../../src/generation/wren-plan.ts";
import { preparePrivateWren } from "../../src/generation/wren.ts";
import { dispatchWrenRequest, type WrenGateway } from "../../src/generation/wren-dispatch.ts";
import { reconcileWrenRequests } from "../../src/generation/wren-reconcile.ts";

const requestId = "90000000-0000-4000-8000-000000000001";
const parentId = "90000000-0000-4000-8000-000000000002";
const actor = "90000000-0000-4000-8000-000000000003";
const intent = { requestId, parentId, roomId: "kessler-ward", brief: "  Mika asks a neighbor for help.  " };
const operationId = "90000000-0000-4000-8000-000000000004";
const row = (): WrenRequest => ({ id: requestId, maker_id: actor, room_id: "kessler-ward", parent_id: parentId,
  brief: intent.brief.trim(), input_digest: "a".repeat(64), environment: "PRODUCTION", state: "planning", plan: null,
  operation_id: null, claim_token: null, lease_until: null, run_id: null, dispatch_version: 1, dispatch_token: null,
  dispatch_until: null, next_check_at: "2026-10-15T00:00:00Z", message: "Preparing your private next scene.", error_code: null,
  created_at: "2026-10-15T00:00:00Z", updated_at: "2026-10-15T00:00:00Z" });
const db = () => createClient<Database>("https://wren.invalid", "fake-service", { auth: { persistSession: false, autoRefreshToken: false } });
function configure(t: TestContext) {
  const original = { ...process.env };
  Object.assign(process.env, { NEXT_PUBLIC_SUPABASE_URL: "https://wren.invalid", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "fake-public",
    SUPABASE_SECRET_KEY: "fake-service", OPENAI_API_KEY: "fake-provider", PILOT_EXECUTION_ENV: "PRODUCTION" });
  t.after(() => { process.env = original; });
}

test("Wren pins a bounded private request to the shared Kessler room", () => {
  assert.deepEqual(parseWrenIntent(intent), { ...intent, brief: "Mika asks a neighbor for help." });
  for (const value of [null, [], { ...intent, roomId: "night-shift" }, { ...intent, parentId: "not-a-moment" },
    { ...intent, requestId: "bad" }, { ...intent, brief: " " }, { ...intent, brief: "a".repeat(501) }, { ...intent, makerId: actor }, { ...intent, publish: true }]) {
    assert.equal(parseWrenIntent(value), null);
  }
});

test("request projections never expose worker leases, plans or requester credentials", () => {
  const request = { id: requestId, maker_id: actor, room_id: "kessler-ward", parent_id: parentId, state: "funding", operation_id: null,
    brief: "My private brief", plan: { title: "Private", caption: "Private" }, claim_token: "secret-claim", run_id: "run-private", input_digest: "digest",
    message: "Waiting for the saved top-up.", created_at: "2026-10-15T00:00:00Z", updated_at: "2026-10-15T00:00:00Z" } as WrenRequest;
  const view = wrenView(request);
  assert.deepEqual(Object.keys(view), ["id", "state", "roomId", "parentId", "operationId", "message", "createdAt", "updatedAt"]);
  assert(!JSON.stringify(view).includes("secret-claim"));
  assert(!JSON.stringify(view).includes("Private"));
});

test("Wren API verifies identity, rejects forged fields and distinguishes uncertain saves", async t => {
  configure(t);
  const calls: { path: string; body: any; authorization: string | null }[] = [];
  let mode = "okay";
  t.mock.method(globalThis, "fetch", async (input: unknown, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ path, body, authorization: new Headers(init?.headers).get("authorization") });
    if (path.endsWith("/auth/v1/user")) return Response.json({ id: actor, aud: "authenticated" });
    if (path.endsWith("pilot_request_wren")) return mode === "unknown" ? Response.json({ code: "gateway" }, { status: 503 })
      : mode === "quota" ? Response.json({ code: "P0001", message: "Wren allowance exhausted" }, { status: 400 }) : Response.json(row());
    if (path.endsWith("pilot_lease_wren_dispatch")) return Response.json(true);
    if (path.endsWith("pilot_ack_wren_dispatch")) return Response.json(true);
    if (path.endsWith("pilot_refresh_wren_request")) return mode === "unknown" ? Response.json({ code: "gateway" }, { status: 503 })
      : mode === "missing" ? Response.json({ code: "P0001", message: "That private request is unavailable" }, { status: 400 }) : Response.json(row());
    throw new Error(path);
  });
  const enqueued: unknown[] = [];
  const gateway: WrenGateway = { enqueue: async (...args) => { enqueued.push(args); return { id: "run-wren" }; }, status: async () => "QUEUED" };
  const post = (body: unknown = intent, token = true) => new Request("https://app.invalid/api/pilot/wren", { method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer judge-token" } : {}) }, body: JSON.stringify(body) });
  assert.equal((await handleWrenRequest(post({}, false), { gateway })).status, 401);
  assert.equal(calls.length, 0);
  assert.equal((await handleWrenRequest(post({ ...intent, makerId: "forged" }), { gateway })).status, 400);
  assert(!calls.some(call => call.path.includes("pilot_request_wren")));
  assert.equal((await handleWrenRequest(post(), { gateway })).status, 202);
  assert.deepEqual(enqueued, [[requestId, 1, "PRODUCTION"]]);
  assert.deepEqual(calls.find(call => call.path.endsWith("pilot_request_wren"))?.body,
    { p_request_id: requestId, p_room_id: "kessler-ward", p_parent_id: parentId, p_brief: intent.brief.trim() });
  assert(!JSON.stringify(enqueued).includes("judge-token"));
  mode = "quota";
  const rejected = await handleWrenRequest(post(), { gateway });
  assert.equal(rejected.status, 409); assert.equal((await rejected.json()).rejected, true);
  mode = "unknown";
  const uncertain = await handleWrenRequest(post(), { gateway });
  assert.equal(uncertain.status, 503); assert.equal((await uncertain.json()).rejected, undefined);
  const get = () => new Request(`https://app.invalid/api/pilot/wren?requestId=${requestId}`, { headers: { Authorization: "Bearer judge-token" } });
  assert.equal((await handleWrenRequest(get())).status, 503);
  mode = "missing";
  assert.equal((await handleWrenRequest(get())).status, 404);
  assert.equal(enqueued.length, 1);
});

test("a saved Wren plan replays without another paid helper call; ambiguous plans stay consumed", async t => {
  configure(t);
  let state = "complete", providerCalls = 0;
  t.mock.method(globalThis, "fetch", async (input: unknown) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("pilot_moments")) return Response.json([{ id: parentId, parent_id: null, room_id: "kessler-ward", title: "A landing", panels: [{ caption: "Mika reaches a landing.", imageUrl: "/art/night-shift-neon.webp#frame=0" }] }]);
    if (path.endsWith("pilot_claim_assist")) return Response.json({ claimed: false, request: { id: requestId, state, result: { captions: ["A neighbor opens the door."], twists: [] } } });
    providerCalls++; throw new Error("A replay cannot reach a provider");
  });
  assert.deepEqual(await planWrenScene(row(), db()), { title: "A neighbor opens the door.", caption: "A neighbor opens the door." });
  for (state of ["pending", "failed"]) await assert.rejects(planWrenScene(row(), db()), /will not purchase that call again/);
  assert.equal(providerCalls, 0);
});

test("one metered planning call saves bounded output and failure never retries the provider", async t => {
  configure(t);
  const calls: { path: string; body: any }[] = [];
  let malformed = false;
  t.mock.method(globalThis, "fetch", async (input: unknown, init?: RequestInit) => {
    const path = new URL(String(input)).pathname, body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ path, body });
    if (path.endsWith("pilot_moments")) return Response.json([{ id: parentId, parent_id: null, room_id: "kessler-ward", title: "A landing", panels: [{ caption: "Mika reaches a landing.", imageUrl: "/art/night-shift-neon.webp#frame=0" }] }]);
    if (path.endsWith("pilot_claim_assist")) return Response.json({ claimed: true, request: { id: requestId, state: "pending", result: null } });
    if (path.endsWith("chat/completions")) return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ captions: malformed ? [] : ["A neighbor opens the door."], twists: [] }) } }], usage: { completion_tokens: 30 } }, { headers: { "x-request-id": "provider-fixture" } });
    if (path.endsWith("pilot_assist_requests")) return Response.json({ id: requestId });
    throw new Error(path);
  });
  await planWrenScene(row(), db());
  const provider = calls.find(call => call.path.endsWith("chat/completions"));
  assert.equal(provider?.body.max_completion_tokens, 1200);
  assert(provider?.body.messages[1].content.includes("Mika reaches a landing."));
  assert(calls.some(call => call.body?.provider_request_id === "provider-fixture" && call.body.state === "complete"));
  malformed = true;
  await assert.rejects(planWrenScene(row(), db()), /No image was requested/);
  assert.equal(calls.filter(call => call.path.endsWith("chat/completions")).length, 2);
  assert(calls.some(call => call.body?.state === "failed"));
});

test("funding must resolve before ordinary requester-owned generation; Wren never publishes", async t => {
  configure(t);
  let claimed = true, funding = "pending", plans = 0, dispatched = 0;
  const writes: { path: string; body: any }[] = [];
  t.mock.method(globalThis, "fetch", async (input: unknown, init?: RequestInit) => {
    const path = new URL(String(input)).pathname, body = JSON.parse(String(init?.body));
    writes.push({ path, body });
    if (path.endsWith("pilot_claim_wren_request")) return Response.json(claimed ? row() : null);
    if (path.endsWith("pilot_save_wren_plan")) return Response.json({ ...row(), state: "funding", plan: body.p_plan });
    if (path.endsWith("pilot_finish_wren_request")) return Response.json({ ...row(), state: body.p_state });
    if (path.endsWith("pilot_admit_wren")) return Response.json({ operation_id: operationId, dispatch_version: 1 });
    throw new Error("Unexpected write: " + path);
  });
  const options = { client: db(), plan: async () => { plans++; return { title: "The next landing", caption: "A neighbor opens the door." }; },
    fund: async () => ({ state: funding as "pending" | "ready", message: "Checking the saved payment." }),
    dispatch: async () => { dispatched++; return "queued" as const; } };
  const execution = { environment: "PRODUCTION", runId: "run-one", dispatchVersion: 1 };
  assert.equal((await preparePrivateWren(requestId, execution, undefined, options)).state, "funding");
  assert.equal(dispatched, 0); assert(!writes.some(write => write.path.endsWith("pilot_admit_wren")));
  funding = "ready";
  assert.equal((await preparePrivateWren(requestId, execution, undefined, options)).operationId, operationId);
  assert.equal(dispatched, 1);
  claimed = false;
  assert.equal((await preparePrivateWren(requestId, execution, undefined, options)).state, "already-claimed-or-finished");
  assert.equal(plans, 2); assert(!writes.some(write => /pilot_publish|pilot_refill_room/.test(write.path)));
});

test("Wren lost dispatch acknowledgements reuse the same identity and recovery outages buy nothing", async t => {
  configure(t);
  let due = false, runOutage = false;
  const enqueues: unknown[] = [], mutations: unknown[] = [];
  t.mock.method(globalThis, "fetch", async (input: unknown, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("pilot_wren_requests")) return Response.json([{ ...row(), run_id: "run-existing" }]);
    mutations.push(path);
    if (path.endsWith("pilot_lease_wren_dispatch")) { due = !due; return Response.json(due); }
    if (path.endsWith("pilot_ack_wren_dispatch")) return Response.json({ code: "lost-ack" }, { status: 503 });
    throw new Error(path);
  });
  const gateway: WrenGateway = { enqueue: async (...args) => { enqueues.push(args); return { id: "run-same" }; }, status: async () => { if (runOutage) throw new Error("status offline"); return "COMPLETED"; } };
  const options = { client: db(), environment: "PRODUCTION", gateway };
  assert.equal(await dispatchWrenRequest(requestId, 1, options), "pending-check");
  assert.equal(await dispatchWrenRequest(requestId, 1, options), "already-saved");
  assert.equal(await dispatchWrenRequest(requestId, 1, options), "pending-check");
  assert.deepEqual(enqueues[0], enqueues[1]);
  mutations.length = 0;
  assert.equal((await reconcileWrenRequests({ ...options, dryRun: true })).checked[0].result, "would-resume");
  assert.equal(mutations.length, 0);
  runOutage = true;
  assert.equal((await reconcileWrenRequests(options)).checked[0].result, "check-unavailable");
  assert.equal(mutations.length, 0);
});
