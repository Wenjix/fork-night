import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { inspectOpenAiPanelResponse, prepareOpenAiPanel, readOpenAiUsage } from "../../src/experiments/openai-images.ts";

const image = (size = 1024) => sharp({ create: { width: size, height: size, channels: 3, background: "#6038d4" } }).png().toBuffer();
const usage = { input_tokens: 150, input_tokens_details: { text_tokens: 100, image_tokens: 50 }, output_tokens: 200, total_tokens: 350 };

test("OpenAI preparation includes actual bounded raster bytes and requires a saved first panel for the second", async () => {
  const bytes = await image(64);
  const request = await prepareOpenAiPanel({ clientRequestId: "test-panel-1", panelNumber: 1, prompt: "An original character opens a door.", references: [{ bytes, role: "original" }] });
  assert.equal(request.body.n, 1);
  assert.equal(request.body.quality, "low");
  const decoded = Buffer.from(request.body.images[0]!.image_url.split(",")[1]!, "base64");
  assert.equal((await sharp(decoded).metadata()).width, 64);
  await assert.rejects(prepareOpenAiPanel({ clientRequestId: "test-panel-2", panelNumber: 2, prompt: "The door opens.", references: [{ bytes, role: "original" }] }), /saved preceding panel/);
  const second = await prepareOpenAiPanel({ clientRequestId: "test-panel-2", panelNumber: 2, prompt: "The door opens.", references: [{ bytes, role: "original" }, { bytes: await image(), role: "previous-panel" }] });
  assert.equal(second.body.images.length, 2);
  assert.notEqual(second.inputDigest, request.inputDigest);
});

test("OpenAI price uses exact uncached input/image rates and reconciles usage", () => {
  assert.equal(readOpenAiUsage(usage).calculatedExpenseUsd, "0.006900");
  assert.throws(() => readOpenAiUsage({ ...usage, input_tokens: 151 }), /reconcile/);
  assert.throws(() => readOpenAiUsage({ ...usage, output_tokens: -1 }), /token count/);
  const withText = { ...usage, output_tokens_details: { text_tokens: 50, image_tokens: 150 } };
  assert.equal(readOpenAiUsage(withText).calculatedExpenseUsd, "0.005400");
});

test("a complete PNG with unknown usage is preserved with unresolved expense, never zero", async () => {
  const png = await image();
  const result = await inspectOpenAiPanelResponse({ data: [{ b64_json: png.toString("base64") }] });
  assert.deepEqual(result.png, png);
  assert.equal(result.calculatedExpenseUsd, null);
  assert.equal(result.expenseStatus, "unresolved");
  const priced = await inspectOpenAiPanelResponse({ data: [{ b64_json: png.toString("base64") }], usage });
  assert.equal(priced.calculatedExpenseUsd, "0.006900");
});

test("truncated, wrong-size and multiple outputs cannot become a valid panel", async () => {
  const png = await image();
  await assert.rejects(inspectOpenAiPanelResponse({ data: [{ b64_json: png.subarray(0, 60).toString("base64") }], usage }));
  await assert.rejects(inspectOpenAiPanelResponse({ data: [{ b64_json: (await image(64)).toString("base64") }], usage }), /1024/);
  await assert.rejects(inspectOpenAiPanelResponse({ data: [{ b64_json: png.toString("base64") }, { b64_json: png.toString("base64") }], usage }), /exactly one/);
});
