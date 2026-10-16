import test from "node:test";
import assert from "node:assert/strict";
import { parseWrenView, readWrenIntent, readWrenOrigin, wrenFinished, wrenIntentKey } from "../../src/lib/wren-request-recovery.ts";
const actor = "20000000-0000-4000-8000-000000000001", other = "20000000-0000-4000-8000-000000000002";
const intent = { requestId: crypto.randomUUID(), roomId: "kessler-ward", parentId: "15000000-0000-4000-8000-000000000001", brief: "Mika finds help." };
test("lost Wren submissions recover exact identity-scoped input without leaking into another storyteller", () => {
  const values = new Map([[wrenIntentKey(actor), JSON.stringify(intent)]]);
  const storage = { getItem: (key: string) => values.get(key) ?? null };
  assert.deepEqual(readWrenIntent(storage, actor), intent);
  assert.equal(readWrenIntent(storage, other), null);
  const originDraftId = crypto.randomUUID();
  values.set(wrenIntentKey(actor), JSON.stringify({ version: 1, intent, originDraftId }));
  assert.deepEqual(readWrenIntent(storage, actor), intent);
  assert.equal(readWrenOrigin(storage, actor), originDraftId);
  assert.equal(readWrenOrigin(storage, other), undefined);
  values.set(wrenIntentKey(actor), JSON.stringify({ ...intent, parentId: "wrong" }));
  assert.equal(readWrenIntent(storage, actor), null);
  assert.equal(readWrenIntent({ getItem() { throw new Error("Unavailable"); } }, actor), null);
});
test("only validated own-room status can select a saved operation and ready stays pending human publication", () => {
  const status = { id: intent.requestId, roomId: intent.roomId, parentId: intent.parentId, state: "ready", operationId: crypto.randomUUID(), message: "Your preview is ready.", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  assert.deepEqual(parseWrenView(status), status);
  assert.equal(wrenFinished(parseWrenView(status)!), false);
  for (const state of ["published", "discarded", "blocked", "failed"]) assert.equal(wrenFinished(parseWrenView({ ...status, state })!), true);
  for (const patch of [{ roomId: "night-shift" }, { state: "unknown" }, { operationId: "bad" }, { parentId: "bad" }, { createdAt: "bad" }]) assert.equal(parseWrenView({ ...status, ...patch }), null);
});
