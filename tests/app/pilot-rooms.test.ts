import assert from "node:assert/strict";
import test from "node:test";
import { createPilotRoom } from "../../src/generation/rooms.ts";
import { parseRoomIntent, roomLink, newPublications } from "../../src/lib/pilot-rooms.ts";
import { googleReturnUrl } from "../../src/lib/supabase/onboarding.ts";
import type { PilotMoment } from "../../src/lib/pilot.ts";
const intent = { requestId: "70000000-0000-4000-8000-000000000001", templateId: "paper-moon", templateVersion: 1, title: "Our paper moon" };

test("room intent rejects bad inputs and invitation never carries private route state", () => {
  assert.deepEqual(parseRoomIntent(intent), intent);
  for (const value of [{ ...intent, title: " " }, { ...intent, templateVersion: 0 }, { ...intent, requestId: "fake" }, { ...intent, templateId: "../elsewhere" }, { ...intent, title: "a".repeat(81) }]) assert.equal(parseRoomIntent(value), null);
  assert.equal(roomLink("https://story.invalid/pilot?moment=secret&view=treasury#draft", "room-123"), "https://story.invalid/pilot?room=room-123");
  assert.throws(() => roomLink("https://story.invalid", "a&b"));
  assert.equal(googleReturnUrl("https://story.invalid/pilot?create=1&secret=draft"), "https://story.invalid/pilot?create=1&onboarding=1");
  assert(!googleReturnUrl("https://story.invalid/pilot?create=evil").includes("create="));
});

test("publication notices baseline once, include off-path siblings, and exclude own publication", () => {
  const rows = [
    { id: "root", parent_id: null, maker_id: null },
    { id: "a", parent_id: "root", maker_id: "alice" },
    { id: "b", parent_id: "root", maker_id: "bob" },
    { id: "c", parent_id: "root", maker_id: "cara" },
  ] as PilotMoment[];
  assert.deepEqual(newPublications(null, rows, "alice"), []);
  assert.deepEqual(newPublications(new Set(["root"]), rows, "alice").map(row => row.id), ["b", "c"]);
  assert.deepEqual(newPublications(new Set(rows.map(row => row.id)), rows), []);
});

test("room API verifies bearer identity and forwards only the idempotent template inputs", async t => {
  const env = { ...process.env };
  Object.assign(process.env, { NEXT_PUBLIC_SUPABASE_URL: "https://rooms.invalid", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public-test" });
  t.after(() => { process.env = env; });
  const calls: { url: string; body: any }[] = [];
  let mode = "okay";
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    if (String(url).includes("/auth/v1/user")) return Response.json({ id: "actor", aud: "authenticated" });
    assert(String(url).endsWith("/rpc/pilot_create_room"));
    if (mode === "unknown") return Response.json({ message: "gateway unavailable" }, { status: 503 });
    if (mode === "quota") return Response.json({ code: "P0001", message: "All demo rooms have been created." }, { status: 400 });
    return Response.json({ roomId: "room-123", momentId: "root" });
  });
  const request = (body: unknown = intent, authorized = true) => new Request("https://story.invalid/api/pilot/rooms", {
    method: "POST", headers: { "Content-Type": "application/json", ...(authorized ? { Authorization: "Bearer user-test" } : {}) }, body: JSON.stringify(body),
  });
  assert.equal((await createPilotRoom(request(intent, false))).status, 401);
  assert.equal((await createPilotRoom(request({ ...intent, ownerId: "another", credits: 999 }))).status, 400);
  assert.equal(calls.length, 0);
  for (let i = 0; i < 2; i++) assert.equal((await createPilotRoom(request())).status, 201);
  assert.deepEqual(calls.filter(call => call.body).map(call => call.body), [0, 1].map(() => ({ p_request_id: intent.requestId, p_template_id: intent.templateId, p_template_version: 1, p_title: intent.title })));
  mode = "quota";
  const rejected = await createPilotRoom(request());
  assert.equal(rejected.status, 409); assert.equal((await rejected.json()).rejected, true);
  mode = "unknown";
  const uncertain = await createPilotRoom(request());
  assert.equal(uncertain.status, 503); assert.equal((await uncertain.json()).rejected, undefined, "an ambiguous write cannot abandon its request ID");
});
