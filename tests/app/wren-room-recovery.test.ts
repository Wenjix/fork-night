import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { KESSLER_OPENING_ID, KESSLER_ROOM_ID } from "../../src/lib/kessler-room.ts";

const file = "src/components/shared-pilot.tsx";
const source = ts.createSourceFile(file, await readFile(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function declaration(name: string) {
  let found: ts.FunctionDeclaration | undefined;
  (function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    else ts.forEachChild(node, visit);
  })(source);
  assert.ok(found, `Missing ${name}`);
  return ts.transpile(`(${found.getText(source)})`, { target: ts.ScriptTarget.ES2022 });
}
const run = (name: string, env: Record<string, unknown>) => new Function(...Object.keys(env), `return ${declaration(name)}`)(...Object.values(env));
const actor = "16000000-0000-4000-8000-000000000001";
const operationId = "16000000-0000-4000-8000-000000000002";
const preview = { id: operationId, room_id: KESSLER_ROOM_ID, maker_id: actor, parent_id: KESSLER_OPENING_ID, status: "delivered" };
type Result = { data: typeof preview | null; error: unknown };

function recovery() {
  let finish!: (value: Result) => void;
  const result = new Promise<Result>(resolve => { finish = resolve; });
  const filters: unknown[][] = [], mutations: unknown[][] = [];
  const query = { select(value: string) { filters.push(["select", value]); return this; },
    eq(...args: unknown[]) { filters.push(args); return this; }, single: () => result };
  const env = {
    client: { from(table: string) { filters.push(["from", table]); return query; } },
    profile: { id: actor }, roomId: KESSLER_ROOM_ID,
    wrenScope: { current: { roomId: KESSLER_ROOM_ID, actorId: actor } as { roomId: string; actorId: string } | null },
    currentDraft: { current: undefined as Record<string, unknown> | undefined },
    ...Object.fromEntries(["setOperation", "setWrenOperationId", "setWrenPreviewId", "setSelectedId", "setComposing", "setView", "setDraft"].map(name => [name, (value: unknown) => { mutations.push([name, value]); }])),
  };
  return { env, filters, mutations, finish, restore: run("recoverWrenPreview", env) as (id: string) => Promise<void> };
}

test("Wren recovery queries only the current maker and room, then restores a delivered private preview", async () => {
  const h = recovery(); const waiting = h.restore(operationId); h.finish({ data: preview, error: null }); await waiting;
  assert(h.filters.some(pair => pair[0] === "maker_id" && pair[1] === actor));
  assert(h.filters.some(pair => pair[0] === "room_id" && pair[1] === KESSLER_ROOM_ID));
  assert(h.filters.some(pair => pair[0] === "id" && pair[1] === operationId));
  assert(h.mutations.some(pair => pair[0] === "setOperation" && pair[1] === preview));
  assert(h.mutations.some(pair => pair[0] === "setWrenOperationId" && pair[1] === operationId));
  assert(h.mutations.some(pair => pair[0] === "setSelectedId" && pair[1] === preview.parent_id));
  assert(!h.mutations.some(pair => pair[0] === "setDraft"));
});

test("a delayed private preview cannot enter another account, another room or an unmounted scope", async () => {
  for (const scope of [{ roomId: KESSLER_ROOM_ID, actorId: "another-maker" }, { roomId: "paper-moon", actorId: actor }, null]) {
    const h = recovery(); const waiting = h.restore(operationId); h.env.wrenScope.current = scope;
    h.finish({ data: preview, error: null }); await waiting;
    assert.deepEqual(h.mutations, [], JSON.stringify(scope));
  }
});

test("a draft written while recovery is in flight survives, and the saved preview remains available after cancel", async () => {
  const h = recovery(); const waiting = h.restore(operationId);
  const draft = { requestId: "different-draft", parentId: KESSLER_OPENING_ID, thought: "Keep my exact words", stage: "idea" };
  h.env.currentDraft.current = draft;
  h.finish({ data: preview, error: null });
  await assert.rejects(waiting, /Cancel your current draft/);
  assert.equal(h.env.currentDraft.current, draft);
  assert.deepEqual(h.mutations, [["setWrenPreviewId", operationId]]);
  h.env.currentDraft.current = undefined; h.mutations.length = 0; await h.restore(operationId);
  assert.equal(h.mutations.find(pair => pair[0] === "setOperation")?.[1], preview);
});

test("a previously terminal or unfinished operation is never restored as a fresh private preview", async () => {
  for (const status of ["published", "discarded", "failed", "draft", "queued", "dispatching", "uncertain"]) {
    const h = recovery(); const waiting = h.restore(operationId); h.finish({ data: { ...preview, status }, error: null }); await waiting;
    assert.deepEqual(h.mutations, [], status);
  }
  const h = recovery(); const waiting = h.restore(operationId); h.finish({ data: null, error: { message: "Connection lost" } });
  await assert.rejects(waiting, /private scene is saved/); assert.deepEqual(h.mutations, []);
});

function acceptance(draft: Record<string, unknown>, scope: { roomId: string; actorId: string } | null = { roomId: KESSLER_ROOM_ID, actorId: actor }) {
  const changes: unknown[][] = [], removed: string[] = [];
  const env = { draft, profile: { id: actor }, roomId: KESSLER_ROOM_ID, wrenScope: { current: scope },
    localStorage: { removeItem: (key: string) => { removed.push(key); } }, pendingKey: (maker: string, room: string) => `${maker}:${room}`,
    setDraft: (value: unknown) => { changes.push(["draft", value]); }, setComposing: (value: unknown) => { changes.push(["composing", value]); } };
  return { changes, removed, accept: run("acceptWrenRequest", env) as (id: string, originDraftId?: string) => void };
}

test("accepted Wren requests preserve distinct forks, submitted drafts and scenes already being edited", () => {
  for (const draft of [{ parentId: "other-fork", stage: "idea" }, { parentId: KESSLER_OPENING_ID, stage: "idea", submitted: true }, { parentId: KESSLER_OPENING_ID, stage: "preview" }]) {
    const h = acceptance(draft); h.accept(KESSLER_OPENING_ID); assert.deepEqual(h.changes, []); assert.deepEqual(h.removed, []);
  }
});

test("stale acceptance callbacks cannot remove a draft from a changed identity or room", () => {
  for (const scope of [{ roomId: KESSLER_ROOM_ID, actorId: "another-maker" }, { roomId: "paper-moon", actorId: actor }, null]) {
    const h = acceptance({ parentId: KESSLER_OPENING_ID, stage: "idea" }, scope); h.accept(KESSLER_OPENING_ID);
    assert.deepEqual(h.changes, []); assert.deepEqual(h.removed, []);
  }
});

test("Wren acceptance consumes only its exact originating idea draft and preserves other work on the same fork", () => {
  const originDraftId = "16000000-0000-4000-8000-000000000003";
  const origin = { requestId: originDraftId, parentId: KESSLER_OPENING_ID, stage: "idea", thought: "Original Wren brief" };
  for (const [draft, originId] of [[{ ...origin, requestId: operationId }, originDraftId], [origin, undefined]] as const) {
    const h = acceptance(draft); h.accept(KESSLER_OPENING_ID, originId);
    assert.deepEqual(h.changes, []); assert.deepEqual(h.removed, []);
  }
  const h = acceptance(origin); h.accept(KESSLER_OPENING_ID, originDraftId);
  assert.deepEqual(h.changes, [["draft", undefined], ["composing", false]]);
  assert.deepEqual(h.removed, [`${actor}:${KESSLER_ROOM_ID}`]);
});
