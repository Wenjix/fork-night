import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { FIRST_NIGHT_MOMENT_ID, FIRST_NIGHT_ROOM_ID, FIRST_NIGHT_STARTERS, firstNightRoomHref, parseFirstNightStarter, stripFirstNightParams } from "../../src/lib/first-night.ts";
import { pilotPath } from "../../src/lib/pilot.ts";
import { definitelyRejected, ideaDraftKey } from "../../src/lib/pilot-rooms.ts";

// Exercise the actual component's handoff and confirmation boundaries without
// signing in, contacting the database, or starting generation.
async function declarations(file: string) {
  const source = ts.createSourceFile(file, await readFile(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return (name: string) => {
    let declaration: ts.FunctionDeclaration | undefined;
    (function visit(node: ts.Node) {
      if (ts.isFunctionDeclaration(node) && node.name?.text === name) declaration = node;
      else ts.forEachChild(node, visit);
    })(source);
    assert.ok(declaration, `Missing ${name}`);
    return ts.transpile(`(${declaration.getText(source)})`, { target: ts.ScriptTarget.ES2022 });
  };
}
const shared = await declarations("src/components/shared-pilot.tsx");
const ideas = await declarations("src/components/pilot-ideas.tsx");
const run = (source: string, env: Record<string, unknown>) => new Function(...Object.keys(env), `return ${source}`)(...Object.values(env));
const actor = "10000000-0000-4000-8000-000000000010";
const resultId = "10000000-0000-4000-8000-000000000011";
const root = { id: FIRST_NIGHT_MOMENT_ID, room_id: FIRST_NIGHT_ROOM_ID, parent_id: null };

function storage() {
  const values = new Map<string, string>();
  return { values, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}

function handoff(patch: Record<string, unknown> = {}, starter: string | null = "rooftops") {
  const initial = new URL(firstNightRoomHref(starter), "https://fork-night.invalid");
  initial.searchParams.set("view", "read"); initial.hash = "#opening";
  const notices: string[] = [], drafts: unknown[] = [], starts: unknown[][] = [], replacements: string[] = [], selections: unknown[] = [];
  let location = initial;
  const window = {
    get location() { return location; },
    history: { state: { preserved: true }, replaceState: (_state: unknown, _title: string, url: string) => { replacements.push(url); location = new URL(url, initial); } },
  };
  const store = storage();
  const env = {
    firstNightStarter: parseFirstNightStarter(initial.search), account: { loading: false }, busy: false, releaseBusy: false, wrenBusy: false, wrenPreviewId: undefined,
    roomId: FIRST_NIGHT_ROOM_ID, loadedRoom: FIRST_NIGHT_ROOM_ID, profileLoadedFor: actor, actorId: actor, profile: { id: actor },
    recoveryScope: { roomId: FIRST_NIGHT_ROOM_ID, actorId: actor }, moments: [root], selected: root,
    draft: undefined, hasActive: false, mutation: { current: false }, parseFirstNightStarter, stripFirstNightParams,
    window, setNotice: (notice: string) => { notices.push(notice); }, select: (...args: unknown[]) => { selections.push(args); },
    setFirstNightStarter() {}, setDraft: (draft: unknown) => { drafts.push(draft); },
    setInspectingSource() {}, setOperation() {}, setComposing() {}, setView() {}, setError() {},
    localStorage: store, pendingKey: (id: string, room: string) => `${id}:${room}`, crypto, pilotPath,
    requestAnimationFrame() {}, taskHeading: { current: null }, ...patch,
  };
  const start = run(shared("start"), env);
  const apply = run(shared("applyFirstNightStarter"), { ...env, start: (...args: unknown[]) => { starts.push(args); return start(...args); } });
  return { apply, start, env, notices, drafts, starts, replacements, selections, store, get location() { return location; } };
}

test("a recognized invitation opens the normal private editor once with editable thought and no captions", () => {
  const h = handoff();
  h.apply(); h.apply();
  assert.equal(h.starts.length, 1);
  const draft = h.drafts[0] as Record<string, unknown>;
  assert.equal(draft.parentId, FIRST_NIGHT_MOMENT_ID);
  assert.equal(draft.roomId, FIRST_NIGHT_ROOM_ID);
  assert.equal(draft.thought, "");
  assert.equal(draft.thoughtPlaceholder, FIRST_NIGHT_STARTERS[0].prompt);
  assert.equal(draft.stage, "idea");
  assert.deepEqual(draft.captions, []);
  assert.equal(draft.submitted, undefined);
  assert.equal(h.store.values.size, 1, "the ordinary actor-scoped draft is retained");
  assert.equal(h.location.searchParams.get("firstNight"), null);
  assert.equal(h.location.searchParams.get("starter"), null);
  assert.equal(h.location.searchParams.get("moment"), FIRST_NIGHT_MOMENT_ID);
  assert.equal(h.location.searchParams.get("room"), FIRST_NIGHT_ROOM_ID);
  assert.equal(h.location.searchParams.get("view"), "read");
  assert.equal(h.location.hash, "#opening");
});

test("bring your own idea opens a blank thought against the requested source", () => {
  const h = handoff({}, "own"); h.apply();
  assert.equal((h.drafts[0] as Record<string, unknown>).thought, "");
  assert.equal((h.drafts[0] as Record<string, unknown>).parentId, FIRST_NIGHT_MOMENT_ID);
});

test("a reading invitation selects the opening without starting a continuation", () => {
  const h = handoff({}, null); h.apply();
  assert.equal(h.starts.length, 0); assert.equal(h.drafts.length, 0);
  assert.equal(h.selections.length, 0, "the existing shared-moment loader handles reading links");
  assert.equal(h.location.searchParams.get("moment"), FIRST_NIGHT_MOMENT_ID);
  assert.equal(h.location.searchParams.get("firstNight"), null);
});

test("an invitation waits for matching account and room recovery before touching saved work", () => {
  for (const patch of [
    { account: { loading: true } }, { busy: true }, { releaseBusy: true },
    { profileLoadedFor: undefined }, { profileLoadedFor: "another-account" },
    { profile: { id: "another-account" } }, { recoveryScope: undefined },
    { recoveryScope: { roomId: FIRST_NIGHT_ROOM_ID, actorId: "another-account" } },
    { loadedRoom: "another-room" }, { roomId: "another-room" },
  ]) {
    const h = handoff(patch); h.apply();
    assert.equal(h.starts.length, 0); assert.equal(h.replacements.length, 0);
  }
});

test("existing unsent, submitted and active or delivered work survive an invitation", () => {
  for (const patch of [{ draft: { thought: "Keep my words" } }, { draft: { submitted: true } }, { hasActive: true }, { mutation: { current: true } }]) {
    const h = handoff(patch); h.apply();
    assert.equal(h.drafts.length, 0); assert.equal(h.starts.length, 0); assert.equal(h.selections.length, 0);
    assert.match(h.notices[0], /earlier continuation is still here/);
    assert.equal(h.replacements.length, 1, "handled invitations do not retry later without another click");
  }
});

test("a missing requested source never starts against a fallback moment", () => {
  const h = handoff({ moments: [{ ...root, id: resultId }], selected: { ...root, id: resultId } }); h.apply();
  assert.equal(h.starts.length, 0); assert.equal(h.selections.length, 0);
  assert.match(h.notices[0], /opening for this invitation is unavailable/);
  assert.equal(h.replacements.length, 1);
});

test("guide reading stays in the current room and never reloads an unsigned draft", () => {
  for (const patch of [{ draft: { thought: "Unsigned visitor thought" }, profile: undefined, profileLoadedFor: null, actorId: null, recoveryScope: { roomId: FIRST_NIGHT_ROOM_ID, actorId: null } }, { hasActive: true }]) {
    const h = handoff(patch);
    run(shared("readFirstNightOpening"), h.env)();
    assert.equal(h.selections.length, 0);
    assert.equal(h.replacements.length, 0);
    assert.equal(h.drafts.length, 0);
    assert.match(h.notices.at(-1)!, /current continuation is still here/);
  }
  const h = handoff();
  run(shared("readFirstNightOpening"), h.env)();
  assert.deepEqual(h.selections, [[FIRST_NIGHT_MOMENT_ID, true]]);
  assert.equal(h.replacements.length, 0, "reading is in-place, without URL navigation or reload");
});

test("all guide room actions wait for current actor recovery, and Make reopens existing words", () => {
  for (const name of ["readFirstNightOpening", "makeFirstNightContinuation", "followFirstNightResult"]) {
    const h = handoff({ recoveryScope: undefined });
    run(shared(name), { ...h.env, firstNightJourney: { result: { kind: "moment", id: resultId } }, start: h.start })();
    assert.equal(h.selections.length, 0); assert.equal(h.drafts.length, 0);
  }
  const h = handoff({ draft: { thought: "My in-memory idea" } });
  run(shared("makeFirstNightContinuation"), { ...h.env, start: h.start })();
  assert.equal(h.drafts.length, 0, "the existing start path does not replace an unfinished thought");
  assert.match(h.notices.at(-1)!, /earlier continuation is still here/);
  assert.equal(h.replacements.length, 0);
});

function publishing(response: unknown) {
  const records: unknown[] = [], operations: unknown[] = [];
  const publish = run(shared("publishMoment"), {
    client: { rpc: async () => response }, profile: { id: actor }, roomId: FIRST_NIGHT_ROOM_ID,
    operation: { id: resultId, status: "delivered" }, recordFirstNightResult: (value: unknown) => { records.push(value); },
    setOperation: (value: unknown) => { operations.push(value); }, setMoments() {}, select() {}, setDraft() {}, setComposing() {},
  });
  return { publish, records, operations };
}

test("guide completion follows only a confirmed public moment belonging to this maker and room", async () => {
  const moment = { id: resultId, room_id: FIRST_NIGHT_ROOM_ID, maker_id: actor, parent_id: FIRST_NIGHT_MOMENT_ID };
  const good = publishing({ error: null, data: moment }); await good.publish();
  assert.deepEqual(good.records, [{ roomId: FIRST_NIGHT_ROOM_ID, actorId: actor, kind: "moment", id: resultId, parentId: FIRST_NIGHT_MOMENT_ID }]);
  for (const response of [{ error: { message: "unknown outcome" } }, { error: null, data: null }, { error: null, data: { ...moment, maker_id: "another-maker" } }, { error: null, data: { ...moment, room_id: "another-room" } }]) {
    const h = publishing(response); await assert.rejects(h.publish(), /Publication could not be confirmed/);
    assert.equal(h.records.length, 0); assert.equal(h.operations.length, 0);
  }
});

function posting(response: unknown, visitor = false) {
  const records: unknown[] = [], store = storage(), errors: string[] = [];
  const post = run(ideas("post"), {
    lock: { current: false }, draft: { requestId: resultId, body: "What if the moon unfolds?" }, profile: visitor ? undefined : { id: actor },
    onJoin: async () => ({ id: actor }), name: "Storyteller", moment: { ...root }, draftKey: "visitor-draft", ideaDraftKey,
    localStorage: store, client: { rpc: async () => response }, definitelyRejected,
    onSaved: (value: unknown) => { records.push(value); }, setSaving() {}, setRejected() {}, setNotice() {}, setDraft() {}, setNotes() {}, setEditing() {},
    setError: (value: string) => { errors.push(value); }, requestAnimationFrame() {}, trigger: { current: null },
  });
  return { post, records, errors };
}

test("the lightweight path reports only the server-confirmed idea and its actual joined maker", async () => {
  const idea = { id: resultId, room_id: FIRST_NIGHT_ROOM_ID, moment_id: FIRST_NIGHT_MOMENT_ID, maker_id: actor };
  const good = posting({ error: null, data: idea }, true); await good.post();
  assert.deepEqual(good.records, [idea]);
  for (const response of [
    { error: { code: "", message: "connection lost" }, status: 0, data: null },
    { error: null, data: null },
    { error: null, data: { ...idea, maker_id: "another-maker" } },
    { error: null, data: { ...idea, moment_id: resultId } },
  ]) {
    const h = posting(response); await h.post();
    assert.equal(h.records.length, 0); assert.match(h.errors.at(-1)!, /could not be confirmed/);
  }
});

test("the header join action opens the join dialog when the selected path cannot take another continuation", () => {
  const fullPath = Array.from({ length: 13 }, (_, index) => ({ id: `moment-${index}`, room_id: FIRST_NIGHT_ROOM_ID, parent_id: index ? `moment-${index - 1}` : null }));
  const calls: string[] = [];
  const env = {
    selected: fullPath[12], moments: fullPath, roomId: FIRST_NIGHT_ROOM_ID, busy: false, releaseBusy: false, wrenBusy: false, wrenPreviewId: undefined,
    account: { loading: false }, draft: undefined, hasActive: false, operation: undefined, pilotPath,
    setJoinOpen: (open: boolean) => calls.push(`join:${open}`), setView: (view: string) => calls.push(`view:${view}`),
    select() { calls.push("select"); }, setComposing() { calls.push("compose"); }, start() { calls.push("start"); },
    setFocusNameEntry: (focus: boolean) => calls.push(`focus:${focus}`),
  };
  run(shared("focusStorytellerName"), env)();
  assert.deepEqual(calls, ["join:false", "view:read", "join:true"]);
  calls.length = 0;
  run(shared("focusStorytellerName"), { ...env, selected: fullPath[3] })();
  assert.deepEqual(calls, ["join:false", "view:read", "start", "focus:true"]);
});
