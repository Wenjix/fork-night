import { test } from "node:test";
import assert from "node:assert/strict";
import { kesslerSeedMoments, KESSLER_BEAT_IDS, KESSLER_ROOM_ID } from "../../src/lib/kessler-room.ts";
import { pilotPath } from "../../src/lib/pilot.ts";
import { KESSLER_FILMS, filmSceneCount, matchingRoomFilm, roomFilmHref, roomFilmShots, selectedFilmShots, storyboardPlan, suggestedFilmShots } from "../../src/lib/room-film.ts";

test("switching films replaces both the film and source branch in a shareable URL", () => {
  const previous = "https://fork-night.vercel.app/pilot?room=kessler-ward&film=rooftops&moment=old-tip#kessler-films";
  for (const film of KESSLER_FILMS) {
    const next = new URL(roomFilmHref(previous, film));
    assert.equal(next.searchParams.get("film"), film.id);
    assert.equal(next.searchParams.get("moment"), film.tipId);
    assert.equal(next.searchParams.get("room"), KESSLER_ROOM_ID);
    assert.equal(next.hash, "");
  }
});

test("a film counts only selected source scenes and counts a two-panel scene once", () => {
  const shots = roomFilmShots(pilotPath(kesslerSeedMoments(), KESSLER_ROOM_ID, KESSLER_BEAT_IDS["dawn-81"]));
  assert.equal(shots[0].sourceId, shots[1].sourceId);
  assert.equal(filmSceneCount(selectedFilmShots(shots, [shots[0].id, shots[1].id, shots[3].id])), 2);
  assert.equal(filmSceneCount([]), 0);
  assert.equal(filmSceneCount(KESSLER_FILMS[0].shots), 6);
});

test("a six-scene path with a two-panel opening budgets panels independently", () => {
  const path = pilotPath(kesslerSeedMoments(), KESSLER_ROOM_ID, KESSLER_BEAT_IDS["dawn-81"]);
  const shots = roomFilmShots(path);
  assert.equal(path.length, 6);
  assert.equal(shots.length, 7);
  const ids = suggestedFilmShots(shots, path.at(-1)!.id);
  const selected = selectedFilmShots(shots, ids);
  assert.equal(selected.length, 6);
  assert.equal(matchingRoomFilm(selected)?.id, "neighbors");
  assert.equal(selected[0].panelIndex, 0);
});

test("selection keeps ancestry order even when panels are checked in reverse", () => {
  const shots = roomFilmShots(pilotPath(kesslerSeedMoments(), KESSLER_ROOM_ID, KESSLER_BEAT_IDS["window-81"]));
  const selected = selectedFilmShots(shots, [shots[5].id, shots[0].id, shots[3].id]);
  assert.deepEqual(selected.map(s => s.id), [shots[0].id, shots[3].id, shots[5].id]);
});

test("unknown, duplicated, empty and over-limit selections cannot become films", () => {
  const shots = roomFilmShots(pilotPath(kesslerSeedMoments(), KESSLER_ROOM_ID, KESSLER_BEAT_IDS["window-81"]));
  for (const ids of [[], ["other-branch:0"], [shots[0].id, shots[0].id], shots.map(s => s.id)]) {
    assert.throws(() => selectedFilmShots(shots, ids), /between one and six/);
  }
});

test("changed captions or artwork never reuse a finished film as though it were a new cut", () => {
  const original = structuredClone(KESSLER_FILMS[0].shots);
  assert.equal(matchingRoomFilm(original)?.id, "lift");
  const captionEdit = structuredClone(original);
  captionEdit[0].panel.caption += " A different ending.";
  assert.equal(matchingRoomFilm(captionEdit), undefined);
  const imageEdit = structuredClone(original);
  imageEdit[2].panel.sha256 = "a".repeat(64);
  assert.equal(matchingRoomFilm(imageEdit), undefined);
  assert.equal(matchingRoomFilm(original.slice(1)), undefined);
  assert.equal(matchingRoomFilm([...original].reverse()), undefined);
});

test("a new branch suggests at most six distinct events, including its opening and end", () => {
  const source = KESSLER_FILMS[0].shots[0];
  const shots = Array.from({ length: 12 }, (_, i) => ({ ...source, id: `event-${i}:0`, sourceId: `event-${i}`, panelIndex: 0 }));
  const ids = suggestedFilmShots(shots, "new-tip");
  assert.equal(ids.length, 6);
  assert.equal(new Set(ids).size, 6);
  assert.equal(ids[0], shots[0].id);
  assert.equal(ids.at(-1), shots.at(-1)!.id);
});

test("a storyboard preserves source attribution and uses exactly three seconds per chosen panel", () => {
  const shots = KESSLER_FILMS[0].shots;
  const plan = storyboardPlan("Lift", shots, shots.map(s => s.image!));
  assert.equal(plan.secondsPerShot * plan.shots.length, 18);
  assert.deepEqual(plan.shots.map(s => s.maker), ["Prepared story", "Prepared story", "Burkes", "Wren (AI agent)", "Wren (AI agent)", "Wren (AI agent)"]);
  assert.deepEqual(plan.shots.map(s => s.sourceId), shots.map(s => s.sourceId));
  assert.throws(() => storyboardPlan("Lift", shots, []), /incomplete/);
});

test("opening a film edit snapshots the source captions", () => {
  const path = pilotPath(kesslerSeedMoments(), KESSLER_ROOM_ID, KESSLER_BEAT_IDS["dawn-81"]);
  const shots = roomFilmShots(path);
  const before = shots[0].panel.caption;
  (path[0].panels as { caption: string }[])[0].caption = "Changed after this edit opened";
  assert.equal(shots[0].panel.caption, before);
});
