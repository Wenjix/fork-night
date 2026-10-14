import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/supabase/database.types.ts";
import { dispatchGeneration, type GenerationGateway } from "../../src/generation/dispatch.ts";
import { reconcileGeneration, recoverableReceipt } from "../../src/generation/reconcile.ts";
import { digest } from "../../src/experiments/storage.ts";
import { maintainClaim, executionEnvironment } from "../../src/generation/execution.ts";
const operationId = "71000000-0000-4000-8000-000000000001";
const client = () => createClient<Database>("https://outbox.invalid", "fake-service", { auth: { persistSession: false, autoRefreshToken: false } });

test("accepted runs with lost acknowledgements retry the same operation, version and environment", async t => {
  let leased = false, ackFails = true;
  const enqueues: unknown[] = [], acknowledgements: any[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    if (String(url).endsWith("pilot_lease_dispatch")) {
      if (leased) return Response.json(null);
      leased = true; return Response.json({ operation_id: operationId });
    }
    assert(String(url).endsWith("pilot_ack_dispatch"));
    acknowledgements.push(body);
    return ackFails ? Response.json({ code: "fixture" }, { status: 503 }) : Response.json(true);
  });
  const gateway: GenerationGateway = {
    enqueue: async (...args) => { enqueues.push(args); return { id: "run-same" }; },
    status: async () => "QUEUED",
  };
  const options = { client: client(), gateway, environment: "PRODUCTION" };
  assert.equal(await dispatchGeneration(operationId, 1, options), "pending-check");
  assert.equal(await dispatchGeneration(operationId, 1, options), "already-saved");
  assert.equal(enqueues.length, 1, "a duplicate tick cannot steal a live enqueue lease");
  leased = false; ackFails = false;
  assert.equal(await dispatchGeneration(operationId, 1, options), "queued");
  assert.deepEqual(enqueues[0], enqueues[1]);
  assert.equal(acknowledgements[0].p_run_id, acknowledgements[1].p_run_id);
  assert.notEqual(acknowledgements[0].p_token, acknowledgements[1].p_token);
});

test("receipt recovery requires matching stored evidence and settled or recoverable usage", () => {
  const saved = { inputDigest: "input", clientRequestId: `pilot-${operationId}-panel-1`, status: 200, body: JSON.stringify({ usage: { input_tokens: 11, input_tokens_details: { text_tokens: 1, image_tokens: 10 }, output_tokens: 100, total_tokens: 111 } }) };
  const bytes = Buffer.from(JSON.stringify(saved));
  const panel = { operation_id: operationId, panel_number: 1, input_digest: "input", response_digest: digest(bytes), expense_known: false } as Parameters<typeof recoverableReceipt>[0];
  assert.equal(recoverableReceipt(panel, bytes), true);
  assert.equal(recoverableReceipt(panel, null), false);
  assert.equal(recoverableReceipt(panel, Buffer.from("tampered")), false);
  assert.equal(recoverableReceipt({ ...panel, response_digest: null }, Buffer.from(JSON.stringify({ ...saved, clientRequestId: "wrong" }))), false);
  const unknown = Buffer.from(JSON.stringify({ ...saved, status: 0, body: "" }));
  assert.equal(recoverableReceipt({ ...panel, response_digest: null }, unknown), false);
  assert.equal(recoverableReceipt({ ...panel, response_digest: null, expense_known: true }, unknown), true, "an audited expense can settle a definitive failure, without purchasing the panel again");
});

test("status outages and absent receipts retain holds; dry run cannot mutate or enqueue", async t => {
  let receipt: Buffer | null = null, outage = false;
  const mutations: any[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    const address = String(url);
    if (init?.method === "PATCH" || init?.method === "POST") {
      const body = JSON.parse(String(init.body)); mutations.push({ address, body });
      if (address.includes("pilot_reconcile_execution")) return Response.json(body.p_recover ? "pending" : "review");
      return new Response(null, { status: 204 });
    }
    if (address.includes("/pilot_job_dispatches")) return Response.json([{ operation_id: operationId, dispatch_version: 1, environment: "PRODUCTION", run_id: "run-existing", state: "running" }]);
    if (address.includes("/pilot_panel_accounting")) return Response.json([{ operation_id: operationId, panel_number: 1, input_digest: "a", expense_known: false }]);
    if (address.includes("/storage/")) return receipt ? new Response(new Uint8Array(receipt)) : Response.json({ statusCode: "404", error: "not_found" }, { status: 404 });
    throw new Error(address);
  });
  const gateway: GenerationGateway = { enqueue: async () => { throw new Error("Reconciliation must not buy or enqueue this unresolved work"); }, status: async () => { if (outage) throw new Error("No status"); return "CRASHED"; } };
  const options = { client: client(), gateway, environment: "PRODUCTION" };
  assert.equal((await reconcileGeneration({ ...options, dryRun: true })).checked[0].result, "would-review");
  assert.equal(mutations.length, 0);
  assert.equal((await reconcileGeneration(options)).checked[0].result, "review");
  const reviewed = mutations.find(row => row.address.includes("pilot_reconcile_execution"));
  assert.deepEqual(reviewed.body, { p_operation_id: operationId, p_version: 1, p_run_id: "run-existing", p_status: "CRASHED", p_recover: false });
  mutations.length = 0; outage = true;
  assert.equal((await reconcileGeneration(options)).checked[0].result, "check-unavailable");
  assert(!mutations.some(row => row.address.includes("pilot_reconcile_execution")), "status errors are never terminal evidence");
  assert(mutations.every(row => !("held_micro" in row.body)), "holds stay untouched");
});

test("heartbeat failure is sticky and environment mismatches cannot reach execution", async t => {
  const env = process.env.PILOT_EXECUTION_ENV;
  process.env.PILOT_EXECUTION_ENV = "PRODUCTION";
  t.after(() => { if (env === undefined) delete process.env.PILOT_EXECUTION_ENV; else process.env.PILOT_EXECUTION_ENV = env; });
  assert.throws(() => executionEnvironment("DEVELOPMENT"));
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json(false); });
  const heartbeat = maintainClaim(client(), { p_operation_id: operationId, p_claim_token: operationId, p_environment: "PRODUCTION", p_run_id: "run-old", p_version: 1 });
  try { await assert.rejects(heartbeat.check()); await assert.rejects(heartbeat.check()); assert.equal(calls, 1); }
  finally { heartbeat.stop(); }
});
