import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { runOpenAiContinuation } from "../../src/experiments/openai-live.ts";
import type { LiveContinuationInput, PanelTransport } from "../../src/experiments/openai-live.ts";

const usage = { input_tokens: 150, input_tokens_details: { text_tokens: 100, image_tokens: 50 }, output_tokens: 200, total_tokens: 350 };
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "fork-night-openai-"));
  const original = await sharp({ create: { width: 512, height: 512, channels: 3, background: "#37215d" } }).png().toBuffer();
  const png = await sharp(original).resize(1024).png().toBuffer();
  const input: LiveContinuationInput = { attemptId: "live-test", original, context: "An original keeper finds a radio.", prompt: "A paper whale escapes.", captions: ["The signal moved.", "The sea answered."] };
  const response = { status: 200, requestId: "req_test", body: JSON.stringify({ data: [{ b64_json: png.toString("base64") }], usage }) };
  return { directory, input, response, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

test("two real-adapter calls carry original + saved panel, and re-entry restores images without dispatch", async () => {
  const f = await fixture();
  try {
    let calls = 0;
    const transport: PanelTransport = async (request) => {
      calls++;
      assert.equal(request.body.images.length, calls);
      return f.response;
    };
    const options = { directory: f.directory, apiKey: "test-only", transport };
    const first = await runOpenAiContinuation(f.input, options);
    assert.equal(first.status, "complete");
    assert.equal(first.expense.calculatedExpenseUsd, "0.013800");
    assert.equal(first.guestChargeUsd, "0.000000");
    await rm(join(f.directory, f.input.attemptId, "panel-1.png"));
    const recovered = await runOpenAiContinuation(f.input, options);
    assert.equal(recovered.status, "complete");
    assert.equal(calls, 2);
    assert.ok((await readFile(join(f.directory, f.input.attemptId, "panel-1.png"))).length);
    await assert.rejects(runOpenAiContinuation({ ...f.input, prompt: "Different" }, options), /different inputs/);
  } finally { await f.cleanup(); }
});

test("lost reply retains allowance and blocks other attempts without sending again", async () => {
  const f = await fixture();
  try {
    let calls = 0;
    const options = { directory: f.directory, apiKey: "test-only", transport: async () => { calls++; throw new Error("Network lost after acceptance"); } };
    const first = await runOpenAiContinuation(f.input, options);
    assert.equal(first.status, "stopped");
    assert.equal(first.expense.unresolvedAllowanceUsd, "1.000000");
    await runOpenAiContinuation(f.input, options);
    const other = await runOpenAiContinuation({ ...f.input, attemptId: "another" }, options);
    assert.match(other.stoppedReason!, /unresolved/);
    assert.equal(calls, 1);
  } finally { await f.cleanup(); }
});

test("hosted accounting handoff prevents local spending but preserves saved-result recovery", async () => {
  const f = await fixture();
  try {
    let calls = 0;
    const options = { directory: f.directory, apiKey: "test-only", transport: async () => { calls++; return f.response; } };
    await runOpenAiContinuation(f.input, options);
    await writeFile(join(f.directory, "hosted-ledger.json"), JSON.stringify({ authority: "shared-pilot" }));
    const recovered = await runOpenAiContinuation(f.input, options);
    assert.equal(recovered.status, "complete");
    const another = await runOpenAiContinuation({ ...f.input, attemptId: "after-handoff" }, options);
    assert.match(another.stoppedReason!, /budget now belongs to the shared pilot/);
    assert.equal(calls, 2);
  } finally { await f.cleanup(); }
});

test("invalid panel records provider expense but cannot become a delivery", async () => {
  const f = await fixture();
  try {
    let calls = 0;
    const result = await runOpenAiContinuation(f.input, { directory: f.directory, apiKey: "test-only", transport: async () => {
      calls++; return { ...f.response, body: JSON.stringify({ data: [], usage }) };
    } });
    assert.equal(result.status, "stopped");
    assert.equal(result.expense.calculatedExpenseUsd, "0.006900");
    assert.equal(result.guestChargeUsd, "0.000000");
    assert.equal(calls, 1);
  } finally { await f.cleanup(); }
});

test("missing usage preserves valid panel and stops the next paid request", async () => {
  const f = await fixture();
  try {
    let calls = 0;
    const raw = JSON.parse(f.response.body); delete raw.usage;
    const result = await runOpenAiContinuation(f.input, { directory: f.directory, apiKey: "test-only", transport: async () => { calls++; return { ...f.response, body: JSON.stringify(raw) }; } });
    assert.equal(result.panels.length, 1);
    assert.equal(result.expense.unresolvedAllowanceUsd, "1.000000");
    assert.equal(calls, 1);
  } finally { await f.cleanup(); }
});

test("concurrent attempts share one exclusion lock and immutable response receipts", async () => {
  const f = await fixture();
  try {
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const first = runOpenAiContinuation(f.input, { directory: f.directory, apiKey: "test-only", transport: async () => { entered(); await wait; return f.response; } });
    await started;
    try { await assert.rejects(runOpenAiContinuation({ ...f.input, attemptId: "parallel" }, { directory: f.directory, apiKey: "test-only" }), /locked/); }
    finally { release(); }
    await first;
    await writeFile(join(f.directory, f.input.attemptId, "panel-1-response.json"), "{}");
    await assert.rejects(runOpenAiContinuation(f.input, { directory: f.directory, apiKey: "test-only", transport: async () => { throw new Error("Must not dispatch"); } }), /integrity/);
  } finally { await f.cleanup(); }
});

test("moderation and quota errors preserve stable codes and never retry automatically", async () => {
  for (const code of ["moderation_blocked", "insufficient_quota"]) {
    const f = await fixture();
    try {
      let calls = 0;
      const options = { directory: f.directory, apiKey: "test-only", transport: async () => { calls++; return { status: 400, requestId: "req_error", body: JSON.stringify({ error: { type: "image_generation_user_error", code } }) }; } };
      const result = await runOpenAiContinuation(f.input, options);
      await runOpenAiContinuation(f.input, options);
      assert.equal(result.receipts["live-test-panel-1"]!.errorCode, code);
      assert.equal(calls, 1);
      assert.equal(result.expense.unresolvedAllowanceUsd, "1.000000");
    } finally { await f.cleanup(); }
  }
});

test("request count and unexpected measured expense stop further dispatch", async () => {
  const f = await fixture();
  try {
    let calls = 0;
    const options = { directory: f.directory, apiKey: "test-only", transport: async () => { calls++; return f.response; } };
    for (let attempt = 0; attempt < 5; attempt++) await runOpenAiContinuation({ ...f.input, attemptId: `attempt-${attempt}` }, options);
    const blocked = await runOpenAiContinuation({ ...f.input, attemptId: "one-too-many" }, options);
    assert.match(blocked.stoppedReason!, /limit/);
    assert.equal(calls, 10);
  } finally { await f.cleanup(); }
  const high = await fixture();
  try {
    let calls = 0;
    const raw = JSON.parse(high.response.body);
    raw.usage = { input_tokens: 200000, input_tokens_details: { text_tokens: 200000, image_tokens: 0 }, output_tokens: 200, total_tokens: 200200 };
    const result = await runOpenAiContinuation(high.input, { directory: high.directory, apiKey: "test-only", transport: async () => { calls++; return { ...high.response, body: JSON.stringify(raw) }; } });
    assert.match(result.stoppedReason!, /exceeded/);
    assert.equal(calls, 1);
  } finally { await high.cleanup(); }
});
