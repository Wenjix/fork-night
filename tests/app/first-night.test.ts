import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import {
  FIRST_NIGHT_MOMENT_ID, FIRST_NIGHT_ROOM_ID, FIRST_NIGHT_PREFERENCES_KEY, FIRST_NIGHT_STARTERS,
  firstNightProgressKey, firstNightRoomHref, firstNightStoryFromRows, parseFirstNightStarter,
  readFirstNightJourney, recordFirstNightEntry, recordFirstNightResult, setFirstNightPreferences,
  stripFirstNightParams, subscribeFirstNightJourney,
} from "../../src/lib/first-night.ts";
import type { PilotMoment, PilotRoom } from "../../src/lib/pilot.ts";

const ACTOR_A = "20000000-0000-4000-8000-000000000001";
const ACTOR_B = "20000000-0000-4000-8000-000000000002";
const RESULT = "30000000-0000-4000-8000-000000000001";

function browser(t: TestContext, failStorage = false) {
  const values = new Map<string, string>();
  const target = Object.assign(new EventTarget(), {
    localStorage: {
      getItem(key: string) { if (failStorage) throw new Error("Unavailable"); return values.get(key) ?? null; },
      setItem(key: string, value: string) { if (failStorage) throw new Error("Unavailable"); values.set(key, value); },
    },
  });
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: target });
  t.after(() => original ? Object.defineProperty(globalThis, "window", original) : Reflect.deleteProperty(globalThis, "window"));
  return { values, target };
}

test("starter handoff allows only public presets on the exact recommended opening", () => {
  for (const starter of FIRST_NIGHT_STARTERS) {
    const href = firstNightRoomHref(starter.id);
    const parsed = parseFirstNightStarter(new URL(href, "https://fork.invalid").search);
    assert.equal(parsed?.prompt, starter.prompt);
    assert.equal(parsed?.starterId, starter.id);
    assert.equal(parsed?.roomId, FIRST_NIGHT_ROOM_ID);
    assert.equal(parsed?.momentId, FIRST_NIGHT_MOMENT_ID);
    assert.equal(href.includes(starter.prompt), starter.prompt === "");
  }
  assert.equal(parseFirstNightStarter(new URL(firstNightRoomHref("private thought"), "https://fork.invalid").search), null);
  assert(!firstNightRoomHref("private thought").includes("private"));
  const valid = new URL(firstNightRoomHref("rooftops"), "https://fork.invalid").search;
  for (const search of [
    valid.replace(FIRST_NIGHT_ROOM_ID, "midnight-signal"),
    valid.replace(FIRST_NIGHT_MOMENT_ID, RESULT),
    valid.replace("firstNight=1", "firstNight=0"),
    valid.replace("rooftops", "my-private-draft"),
    `${valid}&room=midnight-signal`, `${valid}&starter=unfold-moon`,
  ]) assert.equal(parseFirstNightStarter(search), null);
});

test("read-first links do not request a composer, while an explicit own idea does", () => {
  const expected = `/pilot?room=${FIRST_NIGHT_ROOM_ID}&moment=${FIRST_NIGHT_MOMENT_ID}`;
  for (const starter of [undefined, null, "", "unknown", "my private draft"]) {
    const href = firstNightRoomHref(starter);
    assert.equal(href, expected);
    assert.equal(parseFirstNightStarter(new URL(href, "https://fork.invalid").search), null);
  }
  assert.equal(parseFirstNightStarter(`?room=${FIRST_NIGHT_ROOM_ID}&moment=${FIRST_NIGHT_MOMENT_ID}&firstNight=1`), null);
  assert.equal(parseFirstNightStarter(new URL(firstNightRoomHref("own"), "https://fork.invalid").search)?.prompt, "");
  assert.equal(parseFirstNightStarter(new URL(firstNightRoomHref("own"), "https://fork.invalid").search)?.starterId, "own");
});

test("consuming a handoff preserves room, moment and other query values", () => {
  const params = new URLSearchParams(stripFirstNightParams(`?room=${FIRST_NIGHT_ROOM_ID}&moment=${FIRST_NIGHT_MOMENT_ID}&firstNight=1&starter=own&view=story&tag=a&tag=b`));
  assert.equal(params.get("room"), FIRST_NIGHT_ROOM_ID);
  assert.equal(params.get("moment"), FIRST_NIGHT_MOMENT_ID);
  assert.equal(params.get("view"), "story");
  assert.deepEqual(params.getAll("tag"), ["a", "b"]);
  assert.equal(params.has("firstNight"), false);
  assert.equal(params.has("starter"), false);
  assert.equal(stripFirstNightParams("?firstNight=1&starter=own"), "");
});

test("entry and confirmed results stay isolated by account and room", t => {
  const { values } = browser(t);
  recordFirstNightEntry(FIRST_NIGHT_ROOM_ID, ACTOR_A);
  assert.equal(readFirstNightJourney(FIRST_NIGHT_ROOM_ID, ACTOR_A).step, 2);
  recordFirstNightResult({ roomId: FIRST_NIGHT_ROOM_ID, actorId: ACTOR_A, kind: "moment", id: RESULT, parentId: FIRST_NIGHT_MOMENT_ID });
  assert.deepEqual(readFirstNightJourney(FIRST_NIGHT_ROOM_ID, ACTOR_A).result, { kind: "moment", id: RESULT, parentId: FIRST_NIGHT_MOMENT_ID });
  assert.equal(readFirstNightJourney(FIRST_NIGHT_ROOM_ID, ACTOR_A).step, 3);
  for (const [room, actor] of [[FIRST_NIGHT_ROOM_ID, ACTOR_B], ["midnight-signal", ACTOR_A], [FIRST_NIGHT_ROOM_ID, null]] as const) {
    assert.equal(readFirstNightJourney(room, actor).step, 1);
    assert.equal(readFirstNightJourney(room, actor).result, null);
  }
  values.set(firstNightProgressKey(FIRST_NIGHT_ROOM_ID, ACTOR_B), values.get(firstNightProgressKey(FIRST_NIGHT_ROOM_ID, ACTOR_A))!);
  assert.equal(readFirstNightJourney(FIRST_NIGHT_ROOM_ID, ACTOR_B).step, 1, "copied storage from another account is rejected");
});

test("private candidates, failures and malformed progress do not count as public contributions", t => {
  const { values } = browser(t);
  recordFirstNightEntry(FIRST_NIGHT_ROOM_ID, ACTOR_A);
  recordFirstNightResult({ roomId: FIRST_NIGHT_ROOM_ID, actorId: ACTOR_A, kind: "candidate" as "moment", id: RESULT });
  assert.equal(readFirstNightJourney(FIRST_NIGHT_ROOM_ID, ACTOR_A).step, 2);
  recordFirstNightResult({ roomId: FIRST_NIGHT_ROOM_ID, actorId: ACTOR_A, kind: "moment", id: "unsaved" });
  assert.equal(readFirstNightJourney(FIRST_NIGHT_ROOM_ID, ACTOR_A).step, 2);
  const key = firstNightProgressKey(FIRST_NIGHT_ROOM_ID, ACTOR_A);
  for (const raw of ["invalid JSON", "null", "[]", JSON.stringify({ version: 1, entered: true }), JSON.stringify({ version: 1, roomId: FIRST_NIGHT_ROOM_ID, actorId: ACTOR_A, entered: true, result: { kind: "draft", id: RESULT } })]) {
    values.set(key, raw);
    assert.equal(readFirstNightJourney(FIRST_NIGHT_ROOM_ID, ACTOR_A).step, 1);
  }
  recordFirstNightResult({ roomId: FIRST_NIGHT_ROOM_ID, actorId: ACTOR_A, kind: "idea", id: RESULT });
  assert.equal(readFirstNightJourney(FIRST_NIGHT_ROOM_ID, ACTOR_A).step, 3, "a confirmed public idea is a meaningful outcome");
});

test("preferences persist separately and repeated records publish only one change", t => {
  const { values } = browser(t);
  let changes = 0;
  const stop = subscribeFirstNightJourney(() => { changes++; });
  recordFirstNightEntry(FIRST_NIGHT_ROOM_ID, ACTOR_A);
  recordFirstNightEntry(FIRST_NIGHT_ROOM_ID, ACTOR_A);
  recordFirstNightResult({ roomId: FIRST_NIGHT_ROOM_ID, actorId: ACTOR_A, kind: "idea", id: RESULT });
  recordFirstNightResult({ roomId: FIRST_NIGHT_ROOM_ID, actorId: ACTOR_A, kind: "idea", id: RESULT });
  assert.equal(changes, 2);
  setFirstNightPreferences({ hidden: true, expanded: true });
  setFirstNightPreferences({ hidden: true });
  assert.equal(changes, 3);
  assert.deepEqual(readFirstNightJourney("midnight-signal", ACTOR_B), { step: 1, result: null, hidden: true, expanded: true });
  assert(!JSON.stringify([...values.values()]).includes("prompt"));
  stop();
  setFirstNightPreferences({ hidden: false });
  assert.equal(changes, 3);
  values.set(FIRST_NIGHT_PREFERENCES_KEY, JSON.stringify({ hidden: "yes", expanded: true }));
  assert.equal(readFirstNightJourney().hidden, false);
});

test("storage events refresh other mounted guides, while unrelated keys are ignored", t => {
  const { target } = browser(t);
  let changes = 0;
  const stop = subscribeFirstNightJourney(() => { changes++; });
  target.dispatchEvent(Object.assign(new Event("storage"), { key: "something-else" }));
  assert.equal(changes, 0);
  target.dispatchEvent(Object.assign(new Event("storage"), { key: firstNightProgressKey(FIRST_NIGHT_ROOM_ID, ACTOR_A) }));
  target.dispatchEvent(Object.assign(new Event("storage"), { key: null }));
  assert.equal(changes, 2);
  stop();
});

test("a blocked browser store keeps an in-memory journey and presentation state", t => {
  browser(t, true);
  recordFirstNightEntry(FIRST_NIGHT_ROOM_ID, ACTOR_A);
  setFirstNightPreferences({ expanded: true });
  assert.equal(readFirstNightJourney(FIRST_NIGHT_ROOM_ID, ACTOR_A).step, 2);
  recordFirstNightResult({ roomId: FIRST_NIGHT_ROOM_ID, actorId: ACTOR_A, kind: "moment", id: RESULT });
  assert.equal(readFirstNightJourney(FIRST_NIGHT_ROOM_ID, ACTOR_A).step, 3);
  assert.equal(readFirstNightJourney(FIRST_NIGHT_ROOM_ID, ACTOR_A).expanded, true);
  assert.equal(readFirstNightJourney(FIRST_NIGHT_ROOM_ID, ACTOR_B).step, 1);
});

test("server rendering and browser writes without a browser are safe", () => {
  assert.equal(typeof window, "undefined");
  assert.doesNotThrow(() => recordFirstNightEntry(FIRST_NIGHT_ROOM_ID, null));
  assert.doesNotThrow(() => setFirstNightPreferences({ hidden: true }));
  assert.deepEqual(readFirstNightJourney(), { step: 1, result: null, hidden: false, expanded: false });
});

test("recommendation validation requires the published matching room and usable opening", () => {
  const room: PilotRoom = { id: FIRST_NIGHT_ROOM_ID, title: "Paper moon", description: "Every window shows a different possible tomorrow.", is_open: true, is_listed: true, template_id: null, template_version: null, revision: 0, funding_policy: "closed", owner_id: null };
  const moment: PilotMoment = { id: FIRST_NIGHT_MOMENT_ID, room_id: FIRST_NIGHT_ROOM_ID, title: "A moon made of paper", panels: [{ caption: "A paper moon caught in the branches.", imageUrl: "/art/midnight-story.webp#frame=3" }], maker_label: "Room starter", maker_id: null, parent_id: null, source_kind: "fixture", created_at: "2026-10-14T00:00:00Z", source_idea_body: null, source_idea_id: null, source_idea_label: null };
  assert.equal(firstNightStoryFromRows(room, moment)?.panels.length, 1);
  for (const [nextRoom, nextMoment] of [
    [null, moment], [room, null], [{ ...room, id: "foreign-room" }, moment], [{ ...room, is_open: false }, moment],
    [room, { ...moment, id: RESULT }], [room, { ...moment, room_id: "foreign-room" }], [room, { ...moment, parent_id: RESULT }],
    [room, { ...moment, panels: [] }], [room, { ...moment, panels: [{ caption: " ", imageUrl: "/art/midnight-story.webp#frame=3" }] }],
    [room, { ...moment, panels: [{ caption: "A moon", imageUrl: "https://unapproved.invalid/image" }] }],
  ] as const) assert.equal(firstNightStoryFromRows(nextRoom, nextMoment as PilotMoment | null), null);
});


test("previous Paper Moon invitations keep their own prompts and cannot borrow Kessler presets", () => {
  const base = "?room=paper-moon&moment=10000000-0000-4000-8000-000000000002&firstNight=1&starter=";
  assert.match(parseFirstNightStarter(`${base}follow-window`)!.prompt, /paper moon has vanished/);
  assert.equal(parseFirstNightStarter(`${base}follow-window`)!.roomId, "paper-moon");
  assert.equal(parseFirstNightStarter(`${base}rooftops`), null);
});
