import { test } from "node:test";
import assert from "node:assert/strict";
import { handleLocalRefill } from "../../src/generation/local-refill.ts";

test("local refill requires local opt-in, same-origin intent and a verified guest", async t => {
  const original = { ...process.env };
  t.after(() => { process.env = original; });
  Object.assign(process.env, {
    PILOT_LOCAL_CONTROLS: "1",
    NEXT_PUBLIC_SUPABASE_URL: "https://test.invalid",
    SUPABASE_SECRET_KEY: "test-secret",
  });
  delete process.env.VERCEL;
  const actor = "95000000-0000-4000-8000-000000000001";
  const requestId = "95000000-0000-4000-8000-000000000002";
  let verified = true;
  const calls: { url: string; body: unknown }[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
    if (url.endsWith("/auth/v1/user")) return verified
      ? Response.json({ id: actor, aud: "authenticated", role: "authenticated" })
      : Response.json({ message: "Invalid session" }, { status: 401 });
    if (url.endsWith("/rpc/pilot_refill_room")) return Response.json({ added: 5, replayed: false });
    throw new Error("Unexpected destination: " + url);
  });
  const request = (headers: Record<string, string> = {}, url = "http://127.0.0.1:43117/api/pilot/local-refill", body: unknown = { requestId, roomId: "midnight-signal", actor: "forged-actor", credits: 500 }) => new Request(url, {
    method: "POST",
    headers: { origin: "http://127.0.0.1:43117", "sec-fetch-site": "same-origin", "x-fork-night-local": "1", authorization: "Bearer user-token", ...headers },
    body: JSON.stringify(body),
  });

  await t.test("public, cross-origin, forwarded and disabled requests cannot touch the database", async () => {
    for (const req of [
      request({}, "https://public.example/api/pilot/local-refill"),
      request({ origin: "https://evil.example" }),
      request({ "sec-fetch-site": "cross-site" }),
      request({ "x-fork-night-local": "" }),
      request({ host: "evil.example" }),
      request({ host: "127.0.0.1:9999" }),
      request({ "x-forwarded-for": "203.0.113.1" }),
    ]) assert.equal((await handleLocalRefill(req)).status, 404);
    process.env.PILOT_LOCAL_CONTROLS = "0";
    assert.equal((await handleLocalRefill(request())).status, 404);
    process.env.PILOT_LOCAL_CONTROLS = "1";
    process.env.VERCEL = "1";
    assert.equal((await handleLocalRefill(request())).status, 404);
    delete process.env.VERCEL;
    assert.equal(calls.length, 0);
  });
  await t.test("invalid requests and invalid guests cannot mutate credits", async () => {
    assert.equal((await handleLocalRefill(request({ authorization: "" }))).status, 401);
    assert.equal((await handleLocalRefill(request({}, undefined, null))).status, 400);
    assert.equal((await handleLocalRefill(request({}, undefined, { roomId: "room", requestId: "invalid" }))).status, 400);
    assert.equal((await handleLocalRefill(request({ "content-length": "2048" }))).status, 413);
    assert.equal(calls.length, 0);
    verified = false;
    assert.equal((await handleLocalRefill(request())).status, 401);
    assert.equal(calls.length, 1);
    assert(!calls.some(call => call.url.includes("/rpc/")));
  });
  await t.test("refill uses the verified identity, fixed server amount and stable request ID", async () => {
    verified = true;
    const response = await handleLocalRefill(request({ host: "127.0.0.1:43117", "x-forwarded-for": "127.0.0.1" }, "http://localhost:43117/api/pilot/local-refill"));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { added: 5, replayed: false });
    assert.deepEqual(calls.at(-1)?.body, { p_actor: actor, p_room_id: "midnight-signal", p_request_id: requestId });
    assert(calls.every(call => call.url.startsWith("https://test.invalid/")));
  });
});
