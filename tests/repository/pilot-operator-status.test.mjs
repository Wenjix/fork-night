import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { checkPilotGeneration } from "../../scripts/check-pilot-generation.mjs";

test("operator diagnostics read existing tester jobs without submitting work or printing private captions", async t => {
  const urls = [];
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(String(input)); urls.push(url);
    assert.equal(init?.method ?? "GET", "GET");
    assert.equal(url.hostname, "status.invalid");
    if (url.pathname === "/rest/v1/pilot_profiles") {
      assert.equal(url.searchParams.get("display_name"), "ilike.tester");
      return Response.json([{ id: "guest-one", display_name: "tester" }, { id: "guest-two", display_name: "tester" }]);
    }
    assert.equal(url.pathname, "/rest/v1/pilot_operations");
    assert.equal(url.searchParams.get("room_id"), "eq.midnight-signal");
    assert.equal(url.searchParams.get("maker_id"), "in.(guest-one,guest-two)");
    assert.doesNotMatch(url.searchParams.get("select"), /prompt|claim_token|input_digest/);
    return Response.json([{ id: "saved-operation", maker_id: "guest-one", status: "queued", charged_units: 0,
      requested_captions: ["PRIVATE FIRST CAPTION", "PRIVATE SECOND CAPTION", "PRIVATE THIRD CAPTION"],
      created_at: "2026-10-11T12:00:00Z", published_moment_id: null,
      pilot_jobs: { state: "queued", panel_count: 3, updated_at: "2026-10-11T12:01:00Z" } }]);
  });
  const client = createClient("https://status.invalid", "local-test-key", { auth: { persistSession: false, autoRefreshToken: false } });
  const result = await checkPilotGeneration(client, "midnight-signal", "tester");
  assert.equal(result.matchingGuestAccounts, 2);
  assert.equal(result.requests[0].panelsRequested, 3);
  assert.equal(result.requests[0].job.state, "queued");
  assert.equal(result.requests[0].roomCreditsUsed, 0);
  assert.equal(urls.length, 2);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|local-test-key/);
});

test("no matching guest is distinguished from an existing guest with no saved requests", async t => {
  let guests = [], operationReads = 0;
  t.mock.method(globalThis, "fetch", async input => {
    const url = new URL(String(input));
    if (url.pathname === "/rest/v1/pilot_profiles") return Response.json(guests);
    operationReads++;
    return Response.json([]);
  });
  const client = createClient("https://status.invalid", "local-test-key", { auth: { persistSession: false, autoRefreshToken: false } });
  const missing = await checkPilotGeneration(client, "midnight-signal", "tester");
  assert.equal(missing.matchingGuestAccounts, 0);
  assert.match(missing.message, /No guest profile/);
  assert.equal(operationReads, 0);
  guests = [{ id: "guest-one", display_name: "Tester" }];
  const existing = await checkPilotGeneration(client, "midnight-signal", "tester");
  assert.equal(existing.matchingGuestAccounts, 1);
  assert.deepEqual(existing.requests, []);
  assert.equal(operationReads, 1);
});

test("display-name searches ignore case but escape wildcard characters", async t => {
  t.mock.method(globalThis, "fetch", async input => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.get("display_name"), "ilike.Te\\_st\\%er");
    return Response.json([]);
  });
  const client = createClient("https://status.invalid", "local-test-key", { auth: { persistSession: false, autoRefreshToken: false } });
  const result = await checkPilotGeneration(client, "midnight-signal", " Te_st%er ");
  assert.equal(result.matchingGuestAccounts, 0);
});
