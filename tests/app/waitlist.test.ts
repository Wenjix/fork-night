import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tsImport } from "tsx/esm/api";
import { normalizeWaitlistEmail, signupUrl, WAITLIST_CONSENT_VERSION } from "../../src/lib/waitlist.ts";
import { handleWaitlist, saveWaitlistEntry } from "../../src/server/waitlist.ts";

const { WaitlistForm } = await tsImport("../../src/components/waitlist-form.tsx", import.meta.url);

const request = (data: unknown, headers?: HeadersInit) => new Request("https://fork-night-waitlist.example.workers.dev/api/waitlist", {
  method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(data),
});

test("signup URLs require a configured public HTTPS origin", () => {
  assert.equal(signupUrl({}), null);
  for (const url of ["http://fork-night-waitlist.example.workers.dev", "https://localhost", "https://127.0.0.1", "https://192.168.1.5", "https://device.local", "https://a.localhost", "https://[::1]", "https://user:password@example.com", "https://example.com/path", "https://example.com?redirect=bad"]) {
    assert.equal(signupUrl({ FORK_NIGHT_PUBLIC_URL: url }), null, url);
  }
  assert.equal(signupUrl({ FORK_NIGHT_PUBLIC_URL: "https://fork-night-waitlist.example.workers.dev" }), "https://fork-night-waitlist.example.workers.dev/signup?source=demo");
  assert.equal(signupUrl({ VERCEL: "1", VERCEL_PROJECT_PRODUCTION_URL: "old-host.vercel.app" }), null);
});

test("a native submit before hydration cannot put the address in the URL", () => {
  const html = renderToStaticMarkup(createElement(WaitlistForm, { source: "demo", configured: true }));
  const email = html.match(/<input[^>]*id="waitlist-email"[^>]*>/)![0];
  assert.doesNotMatch(email, /\sname=/);
  assert.match(email, /autoComplete="email"/i);
});

test("emails are normalized without removing plus tags", () => {
  assert.equal(normalizeWaitlistEmail("  Maker+Boat@Example.COM "), "maker+boat@example.com");
  for (const email of [null, "a", "a@", "a@b", "a b@example.com", "a@ex_ample.com", ".a@example.com", "a..b@example.com", "x".repeat(65) + "@example.com", "a@example.com\nBcc: x@example.com"]) assert.equal(normalizeWaitlistEmail(email), null);
});

test("signup acknowledges only durable saves and retries preserve one normalized address", async () => {
  const saved = new Map<string, object>();
  const save = async (entry: { email: string; source: string; consent_version: string }) => { if (!saved.has(entry.email)) saved.set(entry.email, entry); };
  for (const email of ["Maker@Example.com", " maker@example.com "]) {
    const response = await handleWaitlist(request({ email, source: "demo", consent: true }), { save });
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true });
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.equal(saved.size, 1);
  assert.deepEqual(saved.get("maker@example.com"), { email: "maker@example.com", source: "demo", consent_version: WAITLIST_CONSENT_VERSION });
});

test("invalid input, missing consent, bot fields and cross-site requests never reach storage", async () => {
  let calls = 0; const save = async () => { calls++; };
  for (const data of [null, [], {}, { email: "wrong", consent: true }, { email: "a@example.com" }, { email: "a@example.com", consent: true, website: "bot" }, { email: "x".repeat(3000), consent: true }]) {
    assert.equal((await handleWaitlist(request(data), { save })).status, 400);
  }
  assert.equal((await handleWaitlist(request({ email: "a@example.com", consent: true }, { "sec-fetch-site": "cross-site" }), { save })).status, 403);
  assert.equal((await handleWaitlist(request({}, { "content-type": "text/plain" }), { save })).status, 415);
  assert.equal(calls, 0);
});

test("a failed save reports failure without disclosing address or upstream details", async () => {
  const response = await handleWaitlist(request({ email: "private@example.com", consent: true }), { save: async () => { throw new Error("secret-token and private@example.com"); } });
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /private@example|secret-token/);
});

test("the storage transport uses a server secret, ignores duplicates and rejects upstream failure", async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalServerUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SECRET_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test-project.supabase.co";
  delete process.env.SUPABASE_URL;
  process.env.SUPABASE_SECRET_KEY = "sb_secret_test-only";
  const entry = { email: "maker@example.com", source: "demo" as const, consent_version: WAITLIST_CONSENT_VERSION };
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(String(url), "https://test-project.supabase.co/rest/v1/waitlist_signups?on_conflict=email");
      assert.equal(options?.method, "POST");
      const headers = new Headers(options?.headers);
      assert.equal(headers.get("apikey"), "sb_secret_test-only");
      assert.equal(headers.get("authorization"), null);
      assert.match(headers.get("prefer")!, /ignore-duplicates/);
      assert.deepEqual(JSON.parse(options?.body as string), entry);
      return new Response(null, { status: 201 });
    };
    await saveWaitlistEntry(entry);
    // A deployment can supply runtime-only settings without any NEXT_PUBLIC build value.
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_URL = "https://test-project.supabase.co";
    await saveWaitlistEntry(entry);
    globalThis.fetch = async () => new Response(null, { status: 500 });
    await assert.rejects(saveWaitlistEntry(entry), /unavailable/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    if (originalServerUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = originalServerUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = originalKey;
  }
});
