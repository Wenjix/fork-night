import test from "node:test";
import assert from "node:assert/strict";
import { planWrenScene } from "../../src/generation/wren-plan.ts";
import { kesslerSeedMoments, KESSLER_OPENING_ID, KESSLER_ROOM_ID } from "../../src/lib/kessler-room.ts";

test("a saved Wren planning result recovers without another provider call and never splits an emoji in its title", async t => {
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "offline-test-placeholder";
  t.after(() => { if (previous === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous; });
  const caption = "x".repeat(66) + "🌙 " + "The neighbors light the landing together.";
  const query = { select() { return this; }, eq() { return this; }, limit: async () => ({ data: kesslerSeedMoments(), error: null }) };
  const client = { from: () => query, rpc: async () => ({ data: { claimed: false, request: { state: "complete", result: { captions: [caption], twists: [] } } }, error: null }) };
  const request = { id: crypto.randomUUID(), room_id: KESSLER_ROOM_ID, parent_id: KESSLER_OPENING_ID, maker_id: crypto.randomUUID(), brief: "Find a light.", input_digest: "a".repeat(64) };
  const result = await planWrenScene(request as Parameters<typeof planWrenScene>[0], client as unknown as Parameters<typeof planWrenScene>[1]);
  assert.equal(result.caption, caption);
  assert.equal(result.title, "x".repeat(66) + "🌙…");
  assert.doesNotThrow(() => encodeURIComponent(result.title));
});
