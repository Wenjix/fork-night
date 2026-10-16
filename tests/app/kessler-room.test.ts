import test from "node:test";
import assert from "node:assert/strict";
import { KESSLER_OPENING_ID, KESSLER_ROOM_ID, kesslerSeedMoments } from "../../src/lib/kessler-room.ts";
import { pilotPath } from "../../src/lib/pilot.ts";
import { FANDOM_STORIES } from "../../src/lib/fandom-stories.ts";

test("shared Kessler preserves every authored beat and both ancestries without invented creators or expenses", () => {
  const story = FANDOM_STORIES.find(story => story.id === "kessler-night-shift")!;
  const moments = kesslerSeedMoments();
  assert.equal(story.title, "Kessler Ward");
  assert.equal(moments.length, 11);
  assert.equal(moments[0].id, KESSLER_OPENING_ID);
  assert.deepEqual(kesslerSeedMoments(), moments);
  for (const [index, moment] of moments.entries()) {
    const beat = story.beats[index];
    assert.equal(moment.room_id, KESSLER_ROOM_ID);
    assert.equal(moment.maker_id, null);
    assert.equal(moment.maker_label, "Prepared story");
    assert.equal(moment.source_kind, "fixture");
    assert.equal(moment.title, beat.title);
    assert.deepEqual(moment.panels, beat.frames.map((frame, i) => ({ imageUrl: `${beat.artwork ?? story.artwork}#frame=${frame}`, caption: beat.captions[i] })));
    const path = pilotPath(moments, KESSLER_ROOM_ID, moment.id);
    assert.equal(path[0].id, KESSLER_OPENING_ID);
    assert.equal(path.at(-1)!.id, moment.id);
  }
  assert.equal(pilotPath(moments, KESSLER_ROOM_ID, moments[5].id).length, 6);
  assert.equal(pilotPath(moments, KESSLER_ROOM_ID, moments[10].id).length, 6);
  assert.equal(new Set(moments.map(moment => moment.id)).size, 11);
});
