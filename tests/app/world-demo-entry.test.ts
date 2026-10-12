import assert from "node:assert/strict";
import test from "node:test";
import { createWorld, ensureGuest, joinWorld, readWorld, worldClient } from "../../src/lib/world-demo/client.ts";
import { completeMakerEntry, enterAsMaker, MAKER_ENTRY_KEY } from "../../src/lib/world-demo/journey.ts";
import { TERMS_VERSION, type WorldState } from "../../src/lib/world-demo/model.ts";

const id = (n: number) => `a9000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("maker entrance uses distinct real client sessions and replays a lost join receipt", async () => {
  const originalFetch = globalThis.fetch;
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://world-demo-test.invalid";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "local-fixture-publishable-key";
  const users = new Map<string, { id: string; aud: string; role: string; is_anonymous: boolean; app_metadata: object; user_metadata: object; created_at: string }>();
  const calls: { rpc: string; actor: string; run: string }[] = [];
  let claimed = false, droppedResponse = false, signups = 0;
  const curator = { id: id(2), role: "curator" as const, label: "Demo curator" };
  const maker = { id: id(3), role: "maker" as const, label: "Mira" };
  const token = "b".repeat(64);
  const projection = (role: "curator" | "maker"): WorldState => ({ id: id(1), revision: claimed ? 1 : 0, termsVersion: TERMS_VERSION, me: role === "maker" ? maker : curator, members: claimed ? [curator, maker] : [curator], works: [], draft: null, selections: [], releases: [], invitations: role === "curator" ? [{ role: "maker", claimed, token: claimed ? null : token }] : [] });
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    assert.equal(url.origin, "https://world-demo-test.invalid", "This test must never send traffic to a real backend");
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
    const headers = new Headers(init?.headers);
    const bearer = headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
    if (url.pathname === "/auth/v1/signup") {
      const user = { id: id(20 + signups++), aud: "authenticated", role: "authenticated", is_anonymous: true, app_metadata: { provider: "anonymous", providers: ["anonymous"] }, user_metadata: {}, created_at: new Date().toISOString() };
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const access = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url")}.${Buffer.from(JSON.stringify({ sub: user.id, aud: "authenticated", role: "authenticated", exp })).toString("base64url")}.local-fixture`;
      users.set(access, user);
      return json({ access_token: access, refresh_token: `fixture-${user.id}`, token_type: "bearer", expires_in: 3600, expires_at: exp, user });
    }
    const user = users.get(bearer);
    assert(user, "Every read, join and create must carry an authenticated guest token");
    if (url.pathname === "/auth/v1/user") return json(user);
    const body = JSON.parse(String(init?.body));
    const rpc = url.pathname.split("/").at(-1)!;
    calls.push({ rpc, actor: user.id, run: body.p_run_id });
    if (rpc === "world_demo_create") {
      assert.equal(body.p_terms_version, TERMS_VERSION);
      assert.equal(user.id, id(20));
      return json(projection("curator"));
    }
    if (rpc === "world_demo_join") {
      assert.equal(user.id, id(21), "Mira must not claim her invitation with the curator's session");
      assert.equal(body.p_token, token);
      assert.equal(body.p_terms_version, TERMS_VERSION);
      claimed = true;
      if (!droppedResponse) { droppedResponse = true; return json({ code: "TEST_LOST_RESPONSE", message: "Committed, then response unavailable" }, 503); }
      return json(projection("maker"));
    }
    throw new Error(`Unexpected request ${rpc}`);
  };
  const entries = new Map<string, string>();
  const storage = { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); }, removeItem: (key: string) => { entries.delete(key); } };
  const hostClient = worldClient("curator"), makerClient = worldClient("maker");
  try {
    const ports = { newId: () => id(1), create: (run: string) => createWorld(hostClient, run), join: (run: string, invite: string) => joinWorld(makerClient, run, invite), read: async (run: string) => { await ensureGuest(makerClient); return readWorld(makerClient, run); } };
    await assert.rejects(enterAsMaker(storage, ports), /could not be reached/);
    assert.equal(JSON.parse(storage.getItem(MAKER_ENTRY_KEY)!).token, token);
    const result = await enterAsMaker(storage, ports);
    assert.equal(result.me.role, "maker");
    assert.equal(signups, 2);
    assert.deepEqual(calls.map(call => call.rpc), ["world_demo_create", "world_demo_join", "world_demo_join"]);
    assert.equal(new Set(calls.map(call => call.run)).size, 1);
    assert.notEqual(calls[0].actor, calls[1].actor);
    assert.equal(calls[1].actor, calls[2].actor);
    completeMakerEntry(storage, result.id);
    assert.equal(storage.getItem(MAKER_ENTRY_KEY), null);
  } finally {
    hostClient.auth.stopAutoRefresh(); makerClient.auth.stopAutoRefresh();
    globalThis.fetch = originalFetch;
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY; else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = previousKey;
  }
});
