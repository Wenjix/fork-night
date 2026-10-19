import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { handleResidentPlan } from "../../src/generation/resident-plan.ts";
import { assistFailure } from "../../src/generation/assist.ts";
import { parseProgressionPlan, parseProgressionReview } from "../../src/lib/wren-progression.ts";
import { WREN } from "../../src/lib/agents/wren.ts";

const plan = { openingState: "Mika holds the charged battery.", scenes: [
  { title: "Power for the Lift", caption: "Mika connects the battery and starts the service lift.", change: "The battery is spent on transport.", resultingState: "Mika is rising toward floor eighty-one." },
  { title: "Between Two Floors", caption: "Mika pries the stalled lift's doors open above the next landing.", change: "The battery cannot power the full climb.", resultingState: "Mika has an exit into the upper stairwell." },
  { title: "A Second Knock", caption: "Mika reaches Mrs. Ito's door and hears another resident calling from across the hall.", change: "The rescue encounters a second person in need.", resultingState: "Mika must choose who to reach first." },
] };
const review = { advances: true, causal: true, continuity: true, drawable: true, safe: true, note: "Each caption depicts a new action caused by the previous scene." };

test("the progression format rejects empty, duplicate, overlong and incomplete scenes", () => {
  assert.deepEqual(parseProgressionPlan(plan), plan);
  for (const bad of [null, {}, { ...plan, scenes: plan.scenes.slice(1) }, { ...plan, scenes: [plan.scenes[0], plan.scenes[0], plan.scenes[2]] },
    { ...plan, openingState: plan.scenes[0].resultingState }, { ...plan, scenes: [{ ...plan.scenes[0], caption: "x".repeat(241) }, ...plan.scenes.slice(1)] }])
    assert.throws(() => parseProgressionPlan(bad));
  assert.equal(parseProgressionReview(review).ok, true);
  assert.equal(parseProgressionReview({ ...review, advances: false, ok: true }).ok, false);
  assert.throws(() => parseProgressionReview({ ...review, causal: undefined }));
});

test("Wren's planner authenticates, shares durable quotas and reviews only its saved plan", async t => {
  const env = { ...process.env };
  Object.assign(process.env, { NEXT_PUBLIC_SUPABASE_URL: "https://test.invalid", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-public", SUPABASE_SECRET_KEY: "test-secret", OPENAI_API_KEY: "test-openai" });
  t.after(() => { process.env = env; });
  const parent = randomUUID(), planId = randomUUID(), reviewId = randomUUID(), brief = "Continue beyond the completed battery handoff.";
  let actor: string = WREN.profileId;
  let quota = false, failure = false, invalid = false;
  const rows = new Map<string, any>(), providerCalls: any[] = [];
  const lastCaption = "Kenji hands Mika a charged battery, its glow promising a race against time to reach Mrs. Ito on floor eighty-one before her insulin runs out.";
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input), body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    if (url.includes("/auth/v1/user")) return Response.json({ id: actor, aud: "authenticated", role: "authenticated" });
    if (url.includes("/rest/v1/pilot_moments")) return Response.json([{ id: parent, parent_id: null, room_id: "kessler-ward", title: "The handoff", panels: [{ caption: lastCaption, imageUrl: "/art/night-shift-neon.webp#frame=0" }] }]);
    if (url.includes("/rpc/pilot_claim_assist")) {
      assert.equal(body.p_kind, "shape"); assert.equal(body.p_actor, WREN.profileId);
      if (quota) return Response.json({ code: "P0001", message: "Allowance exhausted" }, { status: 400 });
      const old = rows.get(body.p_request_id);
      if (old) {
        if (old.input_digest !== body.p_digest) return Response.json({ code: "P0001", message: "Different inputs" }, { status: 400 });
        return Response.json({ claimed: false, request: old });
      }
      const row = { id: body.p_request_id, state: "pending", result: null, input_digest: body.p_digest };
      rows.set(row.id, row); return Response.json({ claimed: true, request: row });
    }
    if (url.includes("/rest/v1/pilot_assist_requests")) {
      const query = new URL(url).searchParams, id = query.get("id")?.slice(3) ?? "", row = rows.get(id);
      if (init?.method === "PATCH") {
        assert.equal(query.get("state"), "eq.pending");
        if (!row || row.state !== "pending") return Response.json(null);
        Object.assign(row, body); return Response.json({ id });
      }
      assert.equal(query.get("maker_id"), `eq.${WREN.profileId}`); assert.equal(query.get("parent_id"), `eq.${parent}`);
      return Response.json(row ?? null);
    }
    if (url === "https://api.openai.com/v1/chat/completions") {
      providerCalls.push(body);
      if (failure) return Response.json({ error: "fixture" }, { status: 500 });
      const reviewing = body.response_format.json_schema.name === "resident_progression_review";
      return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(invalid ? {} : reviewing ? review : plan) } }], usage: { prompt_tokens: 100, completion_tokens: 100 } }, { headers: { "x-request-id": "fixture-provider" } });
    }
    throw Error("Unexpected test destination: " + url);
  });
  async function run(body: any = {}, auth = true) {
    try { return await handleResidentPlan(new Request("https://app.invalid/api/pilot/agent-plan", { method: "POST", headers: { "Content-Type": "application/json", ...(auth ? { Authorization: "Bearer test-wren" } : {}) },
      body: JSON.stringify({ requestId: planId, roomId: "kessler-ward", parentId: parent, brief, phase: "plan", ...body }) })); }
    catch (error) { return assistFailure(error); }
  }
  await t.test("auth, identity, input and allowance failures make no model calls", async () => {
    assert.equal((await run({}, false)).status, 401);
    actor = randomUUID(); assert.equal((await run()).status, 403); actor = WREN.profileId;
    assert.equal((await run({ extra: "x".repeat(5000) })).status, 413);
    assert.equal((await run({ roomId: "paper-moon" })).status, 400);
    quota = true; assert.equal((await run()).status, 409); quota = false;
    assert.equal(providerCalls.length, 0);
  });
  await t.test("the full ancestry and pinned model produce a durable plan with no truncation of the stakes", async () => {
    const response = await run(); assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { plan });
    assert.equal(providerCalls.length, 1); const payload = providerCalls[0];
    assert.equal(payload.model, "gpt-4.1-mini-2025-04-14"); assert.equal(payload.max_completion_tokens, 2200);
    assert.equal(payload.response_format.json_schema.strict, true);
    assert.equal(JSON.parse(payload.messages[1].content).story[0].captions[0], lastCaption);
    assert.equal(rows.get(planId).state, "complete");
    assert.deepEqual(await (await run()).json(), { plan }); assert.equal(providerCalls.length, 1);
  });
  await t.test("critique requires a different ID and the exact saved plan and brief", async () => {
    const input = { requestId: reviewId, phase: "review", planRequestId: planId };
    assert.equal((await run({ ...input, requestId: planId })).status, 400);
    assert.equal((await run({ ...input, planRequestId: randomUUID() })).status, 409);
    assert.equal((await run({ ...input, brief: "Different story" })).status, 409);
    assert.equal(providerCalls.length, 1);
    const response = await run({ ...input, plan: { injected: "ignored" } });
    assert.deepEqual(await response.json(), { review: { ...review, ok: true } });
    assert.equal(providerCalls.length, 2); assert.equal(providerCalls[1].max_completion_tokens, 800);
    assert.deepEqual(JSON.parse(providerCalls[1].messages[1].content).plan, plan);
    assert.equal(rows.get(reviewId).input_digest, createHash("sha256").update(JSON.stringify({ version: 1, phase: "review", brief, planRequestId: planId })).digest("hex"));
    assert.equal((await run(input)).status, 200); assert.equal(providerCalls.length, 2);
  });
  await t.test("malformed and failed responses consume their call; retry never buys another", async () => {
    for (const fail of [true, false]) {
      const id = randomUUID(), before = providerCalls.length; failure = fail; invalid = !fail;
      assert.equal((await run({ requestId: id })).status, 503); assert.equal(rows.get(id).state, "failed");
      assert.equal((await run({ requestId: id })).status, 409); assert.equal(providerCalls.length, before + 1);
    }
  });
});
