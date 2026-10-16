import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { clearVisitorIdeas, definitelyRejected, ideaDraftKey, moveVisitorIdeas, visitorActor } from "../../src/lib/pilot-rooms.ts";
import { validPilotCaptions } from "../../src/lib/pilot-format.ts";
import { isUuid } from "../../src/lib/pilot.ts";

// Exercise the room's own save, draft and URL code with fakes, without React or network calls.
async function component(path: string) {
  const source = ts.createSourceFile(path, await readFile(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  // An expression is returned parenthesised; a statement is returned as it is.
  return (pick: (node: ts.Node) => ts.Node | undefined, statement = false) => {
    let found: ts.Node | undefined;
    (function visit(node: ts.Node) {
      if (found) return;
      const hit = pick(node);
      if (hit) found = hit; else ts.forEachChild(node, visit);
    })(source);
    assert.ok(found);
    const text = found.getText(source);
    return ts.transpile(statement ? text : `(${text})`, { target: ts.ScriptTarget.ES2022 });
  };
}
const room = await component("src/components/shared-pilot.tsx");
const ideas = await component("src/components/pilot-ideas.tsx");
const named = (name: string) => (node: ts.Node) => ts.isFunctionDeclaration(node) && node.name?.text === name ? node : undefined;
const initializer = (name: string) => (node: ts.Node) => ts.isVariableDeclaration(node) && node.name.getText() === name ? node.initializer : undefined;
const effect = (includes: string, part: 0 | 1 = 0) => (node: ts.Node) =>
  ts.isCallExpression(node) && node.expression.getText() === "useEffect" && node.arguments[0].getText().includes(includes) ? node.arguments[part] : undefined;
const run = (code: string, env: Record<string, unknown>) => new Function(...Object.keys(env), `return ${code}`)(...Object.values(env));
function storage() {
  const values = new Map<string, string>();
  return { values, get length() { return values.size; }, key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}

// The shapes postgrest-js returns: a network failure or timeout has status 0 and an empty code;
// a non-JSON error body (such as a gateway page) has only a message.
type SaveResult = { error: { code?: string; message?: string } | null; data?: null; status: number };
const network: SaveResult = { error: { message: "TypeError: Failed to fetch", code: "" }, data: null, status: 0 };
const gateway: SaveResult = { error: { message: "<html>Bad gateway</html>" }, data: null, status: 502 };

test("only a 4xx or a coded PostgREST error counts as a definite rejection", () => {
  const cases: [SaveResult, boolean, string][] = [
    [{ error: { code: "22P02" }, status: 400 }, true, "invalid JSON input"],
    [{ error: { code: "P0001" }, status: 400 }, true, "a raised exception such as the idea limit"],
    [{ error: { code: "PGRST301" }, status: 401 }, true, "a refused token"],
    [{ error: {}, status: 429 }, true, "rate limited before running"],
    [{ error: { code: "PGRST002" }, status: 503 }, true, "PostgREST refused before running it"],
    [network, false, "a network failure or timeout may have committed"],
    [gateway, false, "an uncoded gateway error may have committed"],
    [{ error: { message: "unparseable" }, status: 200 }, false, "a committed save with an unreadable reply"],
    [{ error: null, status: 400 }, false, "no error"],
  ];
  for (const [result, expected, reason] of cases) assert.equal(definitelyRejected(result), expected, reason);
});

test("unsent idea drafts are keyed to the account that wrote them", () => {
  const a = ideaDraftKey("a1111111-1111-4111-8111-111111111111", "paper-moon", "m"), b = ideaDraftKey("b2222222-2222-4222-8222-222222222222", "paper-moon", "m");
  assert.notEqual(a, b);
  assert.equal(a, ideaDraftKey("a1111111-1111-4111-8111-111111111111", "paper-moon", "m"));
  assert.notEqual(a, "fork-night-pilot-idea:paper-moon:m", "the unscoped key any visitor could restore is never used");
});

const momentId = "213c57f3-007e-4aa8-bbc4-88d90083be69";
const caption = "x".repeat(79) + "\u{1F319} rises over the river";
function generating(response: unknown) {
  const store = storage(), sent: Record<string, unknown>[] = [], drafts: unknown[] = [];
  const env: Record<string, unknown> = {
    profile: { id: "p1" }, roomId: "midnight-signal", localStorage: store, setError() {},
    setDraft: (next: unknown) => { drafts.push(next); },
    pendingKey: run(room(initializer("pendingKey")), {}),
  };
  env.changeDraft = run(room(named("changeDraft")), env);
  const draft = { requestId: "70000000-0000-4000-8000-000000000001", parentId: momentId, roomId: "midnight-signal", captions: [caption], stage: "preview" };
  const generate = run(room(named("generate")), {
    ...env, client: { rpc: async (_name: string, args: Record<string, unknown>) => { sent.push(args); return response; } },
    selected: { id: momentId }, operation: undefined, wrenBusy: false, finalStates: new Set(["published", "discarded", "failed"]), enqueue: async () => {},
    draft, validPilotCaptions, definitelyRejected, setOperation() {}, crypto,
  }) as () => Promise<void>;
  const stored = () => JSON.parse(store.getItem("fork-night-pilot-draft:p1:midnight-signal") ?? "null");
  return { generate, sent, drafts, stored };
}

test("a continuation title never splits an emoji, so the save is not refused for invalid JSON", async () => {
  const h = generating(network);
  await assert.rejects(h.generate());
  const title = h.sent[0].p_title as string;
  assert.doesNotThrow(() => encodeURIComponent(title), "a lone surrogate would throw URIError");
  assert.equal([...title].length, 80);
  assert.equal(title.at(-1), "\u{DF19}", "the moon emoji is kept whole");
});

test("a definitely refused save unlocks the draft to edit or cancel, while an unknown outcome stays locked", async () => {
  const refused = generating({ error: { code: "22P02", message: "invalid input syntax for type json", details: "", hint: "" }, data: null, status: 400 });
  await assert.rejects(refused.generate(), /could not be saved\. Edit it and try again, or cancel the draft/);
  assert.equal(refused.stored().submitted, false);
  assert.equal((refused.drafts.at(-1) as { submitted: boolean }).submitted, false);
  for (const response of [network, gateway]) {
    const unknown = generating(response);
    await assert.rejects(unknown.generate(), /kept in this browser\. Reconnect and try saving it again/);
    assert.equal(unknown.stored().submitted, true, "only the same request can be retried");
  }
});

const alice = "a1111111-1111-4111-8111-111111111111", guest = "c3333333-3333-4333-8333-333333333333";
const moment = { id: momentId, room_id: "midnight-signal" };
function posting({ profile, response, store = storage() }: { profile?: { id: string }; response: unknown; store?: ReturnType<typeof storage> }) {
  const state = { draft: { requestId: "70000000-0000-4000-8000-000000000002", body: "  What if the lighthouse answers back?  " } as Record<string, unknown> | undefined, rejected: false, error: "", editing: true, joined: 0 };
  const post = run(ideas(named("post")), {
    lock: { current: false }, draft: state.draft, profile, name: "Verifier", moment, localStorage: store, ideaDraftKey, definitelyRejected,
    draftKey: ideaDraftKey(profile?.id ?? visitorActor, moment.room_id, momentId),
    onJoin: async () => { state.joined++; return { id: guest }; },
    client: { rpc: async () => response },
    setDraft: (next: Record<string, unknown> | undefined) => { state.draft = next; }, setRejected: (next: boolean) => { state.rejected = next; },
    setError: (next: string) => { state.error = next; }, setEditing: (next: boolean) => { state.editing = next; },
    setSaving() {}, setNotice() {}, setNotes() {}, merge() {}, requestAnimationFrame() {}, trigger: { current: null },
  }) as () => Promise<void>;
  return { post, store, state };
}

test("an idea refused by the room unlocks with a discard path; an unknown outcome stays locked to retry", async () => {
  const limit = posting({ profile: { id: alice }, response: { error: { code: "P0001", message: "You have reached the 30-idea limit for this pilot room" }, data: null, status: 400 } });
  await limit.post();
  assert.equal(limit.state.error, "You’ve reached the 30-idea limit for this pilot room.");
  assert.equal(limit.state.rejected, true);
  assert.equal(limit.state.draft?.submitted, false);
  assert.equal(JSON.parse(limit.store.getItem(ideaDraftKey(alice, moment.room_id, momentId))!).submitted, false);
  const unknown = posting({ profile: { id: alice }, response: network });
  await unknown.post();
  assert.match(unknown.state.error, /could not be confirmed\. Retry this same idea/);
  assert.equal(unknown.state.rejected, false);
  assert.equal(JSON.parse(unknown.store.getItem(ideaDraftKey(alice, moment.room_id, momentId))!).submitted, true);
});

test("a visitor's idea moves under the guest account it joins as when posted", async () => {
  const store = storage(), visitorKey = ideaDraftKey(visitorActor, moment.room_id, momentId);
  store.setItem(visitorKey, JSON.stringify({ requestId: "70000000-0000-4000-8000-000000000002", body: "What if the lighthouse answers back?" }));
  const h = posting({ response: network, store });
  await h.post();
  assert.equal(h.state.joined, 1);
  assert.deepEqual([...h.store.values.keys()], [ideaDraftKey(guest, moment.room_id, momentId)]);
});

// The actor is "" while the account loads, visitorActor while signed out, or the account id.
// One mounted PilotIdeas: its refs start from the actor at its first render.
function restoring(store = storage(), id = momentId, first = "") {
  const state = { draft: undefined as unknown, editing: false, rejected: false, resets: 0 };
  const lastActor = { current: first }, restoredKey = { current: "" };
  const source = ideas(effect("lastActor.current"));
  const restore = (actor: string) => run(source, {
    actor, draftKey: actor ? ideaDraftKey(actor, moment.room_id, id) : "", lastActor, restoredKey, visitorActor, moveVisitorIdeas, localStorage: store, isUuid,
    setDraft: (next: unknown) => { if (next === undefined) state.resets++; state.draft = next; }, setEditing: (next: boolean) => { state.editing = next; },
    setRejected: (next: boolean) => { state.rejected = next; }, setError() {},
  })();
  return { restore, state, store };
}
const visitorKey = ideaDraftKey(visitorActor, moment.room_id, momentId);
const visitorIdea = { requestId: "70000000-0000-4000-8000-000000000004", body: "typed before joining" };

test("signing out or switching accounts never hands one account's unsent idea to the next", () => {
  const store = storage();
  const draft = { requestId: "70000000-0000-4000-8000-000000000003", body: "Alice's unsent idea" };
  store.setItem(ideaDraftKey(alice, moment.room_id, momentId), JSON.stringify(draft));
  store.setItem(`fork-night-pilot-idea:${moment.room_id}:${momentId}`, JSON.stringify({ ...draft, body: "unattributed legacy idea" }));
  const h = restoring(store);
  h.restore("");
  h.restore(visitorActor);
  assert.equal(h.state.draft, undefined, "a visitor never restores the legacy unscoped draft");
  h.restore(alice);
  assert.deepEqual(h.state.draft, draft, "the same account gets its own idea back");
  assert.equal(h.state.editing, true);
  h.restore("");
  assert.equal(h.state.draft, undefined, "sign-out or a switch clears the open editor");
  assert.equal(h.state.editing, false);
  h.restore(guest);
  assert.equal(h.state.draft, undefined, "the next account does not receive it");
  assert.ok(h.store.getItem(ideaDraftKey(alice, moment.room_id, momentId)), "it stays saved for its own account");
});

test("a visitor's unsent idea survives a reload and carries into the account it joins as", () => {
  const store = storage();
  store.setItem(visitorKey, JSON.stringify(visitorIdea));
  const h = restoring(store);
  h.restore("");
  h.restore(visitorActor);
  assert.deepEqual(h.state.draft, visitorIdea, "restored for the signed-out visitor after a reload");
  h.restore("");
  assert.deepEqual(h.state.draft, visitorIdea, "kept while the join is loading");
  moveVisitorIdeas(store, guest); // PilotAccountProvider moves visitor ideas before the account appears
  h.restore(guest);
  assert.equal(h.state.resets, 0);
  assert.deepEqual(h.state.draft, visitorIdea);
  assert.deepEqual(JSON.parse(store.getItem(ideaDraftKey(guest, moment.room_id, momentId))!), visitorIdea);
  assert.equal(store.getItem(visitorKey), null, "it no longer waits for the next visitor");
});

test("the ideas panel never moves visitor ideas itself, so an offline-restored account adopts none", () => {
  const store = storage();
  store.setItem(visitorKey, JSON.stringify(visitorIdea));
  const h = restoring(store);
  h.restore("");
  h.restore(visitorActor); // the account could not be verified while offline, so the page acts signed out
  h.restore(alice); // the same stored account reconnects; the provider moves nothing for it
  assert.deepEqual([...store.values.keys()], [visitorKey]);
});

test("an account that finishes loading never adopts a visitor's idea", () => {
  const store = storage();
  store.setItem(visitorKey, JSON.stringify(visitorIdea));
  const h = restoring(store);
  h.restore("");
  h.restore(alice);
  assert.equal(h.state.draft, undefined);
  assert.ok(store.getItem(visitorKey));
  assert.equal(store.getItem(ideaDraftKey(alice, moment.room_id, momentId)), null);
});

test("sign-out clears only visitors' unsent ideas", () => {
  const store = storage();
  const kept = [ideaDraftKey(alice, moment.room_id, momentId), `fork-night-pilot-idea:${moment.room_id}:${momentId}`, "fork-night-pilot-draft:p1:midnight-signal"];
  for (const key of [visitorKey, ideaDraftKey(visitorActor, "paper-moon", "m2"), ...kept]) store.setItem(key, "{}");
  clearVisitorIdeas(store);
  assert.deepEqual([...store.values.keys()], kept);
});

test("a visitor's ideas on other moments move to the account it joins as and restore there", () => {
  const store = storage(), other = "11111111-1111-4111-8111-111111111111";
  const kept = { requestId: "70000000-0000-4000-8000-000000000006", body: "kept for later on moment B" };
  store.setItem(ideaDraftKey(visitorActor, moment.room_id, other), JSON.stringify(kept));
  store.setItem(visitorKey, JSON.stringify(visitorIdea));
  const onC = restoring(store);
  onC.restore("");
  onC.restore(visitorActor);
  onC.restore("");
  moveVisitorIdeas(store, guest); // PilotAccountProvider moves visitor ideas before the account appears
  onC.restore(guest);
  assert.deepEqual([...store.values.keys()].sort(), [ideaDraftKey(guest, moment.room_id, other), ideaDraftKey(guest, moment.room_id, momentId)].sort());
  const onB = restoring(store, other, guest);
  onB.restore(guest);
  assert.deepEqual(onB.state.draft, kept, "back on moment B, the account finds the idea it kept as a visitor");
  assert.equal(onB.state.editing, true);
});

test("moving visitor ideas keeps an idea the account already has on that moment", () => {
  const store = storage();
  store.setItem(visitorKey, "visitor copy");
  store.setItem(ideaDraftKey(visitorActor, "paper-moon", "m2"), "visitor idea on another room");
  store.setItem(ideaDraftKey(guest, moment.room_id, momentId), "the account's own idea");
  store.setItem("fork-night-pilot-draft:p1:midnight-signal", "{}");
  moveVisitorIdeas(store, guest);
  assert.equal(store.getItem(ideaDraftKey(guest, moment.room_id, momentId)), "the account's own idea");
  assert.equal(store.getItem(ideaDraftKey(guest, "paper-moon", "m2")), "visitor idea on another room");
  assert.deepEqual([...store.values.keys()].filter(key => key.includes(":visitor:")), []);
  assert.equal(store.getItem("fork-night-pilot-draft:p1:midnight-signal"), "{}");
});

test("an editor closed with Keep for later stays closed after a cancelled wallet sign-in", () => {
  const store = storage();
  store.setItem(visitorKey, JSON.stringify(visitorIdea));
  const h = restoring(store);
  h.restore("");
  h.restore(visitorActor);
  assert.equal(h.state.editing, true, "a kept idea opens when the page loads");
  h.state.editing = false; // Keep for later
  h.restore(""); // the wallet prompt is open
  h.restore(visitorActor); // and cancelled
  assert.equal(h.state.editing, false);
  assert.deepEqual(h.state.draft, visitorIdea);
});

test("discarding a refused idea removes it from this browser", () => {
  const store = storage(), key = ideaDraftKey(alice, moment.room_id, momentId);
  store.setItem(key, JSON.stringify({ requestId: "70000000-0000-4000-8000-000000000005", body: "refused", submitted: false }));
  const state = { draft: {} as unknown, rejected: true, editing: true };
  run(ideas(named("discard")), {
    draftKey: key, localStorage: store, setError() {}, requestAnimationFrame() {}, trigger: { current: null },
    setDraft: (next: unknown) => { state.draft = next; }, setRejected: (next: boolean) => { state.rejected = next; }, setEditing: (next: boolean) => { state.editing = next; },
  })();
  assert.equal(store.getItem(key), null);
  assert.deepEqual(state, { draft: undefined, rejected: false, editing: false });
});

test("the creator's created=1 flag greets the creator once and leaves the address", () => {
  const replaced: string[] = [];
  const notices: string[] = [];
  const window = { location: { href: "https://story.invalid/pilot?room=paper-moon&created=1" }, history: { replaceState: (_state: unknown, _title: string, url: string) => { replaced.push(url); } } };
  const block = room(node => ts.isIfStatement(node) && node.expression.getText() === 'query.get("created") === "1"' ? node : undefined, true);
  run(`() => { ${block} }`, { query: new URLSearchParams("room=paper-moon&created=1"), setNotice: (next: string) => { notices.push(next); }, window })();
  assert.deepEqual(notices, ["Your room is ready. Invite your storytellers to join."]);
  assert.deepEqual(replaced, ["https://story.invalid/pilot?room=paper-moon"]);
});

test("room polling restarts only for another room or storyteller, not for a refetched profile object", () => {
  assert.match(room(effect("pollWhileVisible(sync, 3000)", 1)), /^\(\[client, roomId, profile\?\.id\]\);?\s*$/);
});
