import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { firstNightRoomHref, parseFirstNightStarter, stripFirstNightParams } from "../../src/lib/first-night.ts";
import { kesslerSeedMoments, KESSLER_BEAT_IDS, KESSLER_ROOM_ID } from "../../src/lib/kessler-room.ts";
import { pilotPath } from "../../src/lib/pilot.ts";
import * as roomFilm from "../../src/lib/room-film.ts";

// Run the component's actual navigation handlers against a browser history model.
const file = "src/components/room-film-studio.tsx";
const source = ts.createSourceFile(file, await readFile(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = new Map<string, string>();
(function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name) {
    declarations.set(node.name.text, ts.transpile(`(${node.getText(source)})`, { target: ts.ScriptTarget.ES2022 }));
  }
  ts.forEachChild(node, visit);
})(source);

const readerId = KESSLER_BEAT_IDS["dawn-81"];
const otherId = KESSLER_BEAT_IDS["window-81"];
function studio(href = `https://fork-night.invalid/pilot?room=kessler-ward&moment=${readerId}&view=read#pilot-story-reader`) {
  let location = new URL(href);
  const state = { view: "closed", filmId: "", readerId: location.searchParams.get("moment"), error: "", edit: undefined as { tipId: string } | undefined };
  const reads: unknown[][] = [];
  const history = {
    state: { preserved: true } as unknown,
    replaceState(next: unknown, _title: string, href: string | URL) { this.state = next; location = new URL(href, location); },
  };
  const window = { get location() { return location; }, history };
  const moments = kesslerSeedMoments();
  const env = {
    ...roomFilm, pilotPath, moments, currentPath: pilotPath(moments, KESSLER_ROOM_ID, readerId),
    window, document: { getElementById: () => null }, job: { current: null }, compact: false, focusWorkspace() {},
    setFilmId: (id: string) => { state.filmId = id; }, setView: (view: string) => { state.view = view; },
    setError: (error: string) => { state.error = error; }, setEdit: (edit: { tipId: string }) => { state.edit = edit; },
    onRead: (id: string, trace?: boolean) => { state.readerId = id; reads.push([id, trace]); },
  };
  function handler(name: string) {
    const declaration = declarations.get(name);
    assert.ok(declaration, `Missing ${name}`);
    return new Function(...Object.keys(env), `return ${declaration}`)(...Object.values(env));
  }
  return { state, reads, window, watch: handler("watch"), choose: handler("choose"), close: handler("close"), readSource: handler("readSource") };
}

test("switching and closing films preserves the reader's reload target and browser history state", () => {
  const h = studio();
  const initial = h.window.location.href;
  const historyState = h.window.history.state;
  for (const film of roomFilm.KESSLER_FILMS) {
    h.watch(film.id);
    assert.equal(h.state.filmId, film.id);
    assert.equal(h.state.view, "watch");
    assert.equal(h.window.location.searchParams.get("film"), film.id);
    assert.equal(h.window.location.searchParams.get("moment"), readerId);
    assert.equal(h.state.readerId, readerId);
  }
  h.close();
  assert.equal(h.state.view, "closed");
  assert.equal(h.window.location.href, initial);
  assert.equal(h.window.history.state, historyState);
  assert.deepEqual(h.reads, []);
});

test("opening an invited film leaves its pending First Night starter valid", () => {
  const initial = new URL(firstNightRoomHref("rooftops"), "https://fork-night.invalid");
  initial.searchParams.set("film", "neighbors");
  initial.searchParams.append("tag", "one"); initial.searchParams.append("tag", "two");
  initial.hash = "#opening";
  const invitation = parseFirstNightStarter(initial.search);
  assert.ok(invitation);
  const h = studio(initial.href);
  h.watch("neighbors");
  h.watch("lift");
  assert.deepEqual(parseFirstNightStarter(h.window.location.search), invitation);
  assert.deepEqual(h.window.location.searchParams.getAll("tag"), ["one", "two"]);
  assert.equal(h.window.location.hash, "#opening");
  assert.deepEqual(h.reads, []);
});

test("watching and editing a film do not invent a story target for a room-only URL", () => {
  const initial = "https://fork-night.invalid/pilot?room=kessler-ward";
  const h = studio(initial);
  h.watch("rooftops");
  assert.equal(h.window.location.searchParams.has("moment"), false);
  h.choose(otherId);
  assert.equal(h.state.error, "");
  assert.equal(h.state.edit?.tipId, otherId);
  h.close();
  assert.equal(h.window.location.href, initial);
});

test("choosing another film branch clears playback without changing the story being read", () => {
  const h = studio();
  const initial = h.window.location.href;
  h.watch("lift");
  h.choose(otherId);
  assert.equal(h.state.error, "");
  assert.equal(h.state.view, "choose");
  assert.equal(h.state.edit?.tipId, otherId);
  assert.equal(h.state.readerId, readerId);
  assert.equal(h.window.location.href, initial);
  h.close();
  assert.equal(h.window.location.href, initial);
  assert.deepEqual(h.reads, []);
});

test("closing a film keeps current URL changes and never restores an already consumed invitation", () => {
  const h = studio(new URL(firstNightRoomHref("own"), "https://fork-night.invalid").href);
  h.watch("rooftops");
  const consumed = new URL(h.window.location.href);
  consumed.search = stripFirstNightParams(consumed.search);
  consumed.searchParams.set("view", "trace");
  h.window.history.replaceState(h.window.history.state, "", consumed);
  h.close();
  assert.equal(h.window.location.searchParams.has("firstNight"), false);
  assert.equal(h.window.location.searchParams.has("starter"), false);
  assert.equal(h.window.location.searchParams.has("film"), false);
  assert.equal(h.window.location.searchParams.get("view"), "trace");
});

test("reading a film source intentionally moves both the reader and its URL", () => {
  const h = studio();
  const historyState = h.window.history.state;
  h.watch("rooftops");
  h.readSource(otherId, true);
  assert.deepEqual(h.reads, [[otherId, true]]);
  assert.equal(h.state.readerId, otherId);
  assert.equal(h.state.view, "closed");
  assert.equal(h.window.location.searchParams.get("moment"), otherId);
  assert.equal(h.window.location.searchParams.has("film"), false);
  assert.equal(h.window.location.searchParams.get("view"), "read");
  assert.equal(h.window.history.state, historyState);
});
