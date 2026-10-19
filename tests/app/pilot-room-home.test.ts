import assert from "node:assert/strict";
import { test } from "node:test";
import { returningRooms, roomHomeSummary } from "../../src/lib/pilot-room-home.ts";
import { kesslerSeedMoments, KESSLER_BEAT_IDS } from "../../src/lib/kessler-room.ts";
import { visitKey, visitSnapshot } from "../../src/lib/pilot-social.ts";
import type { Tables } from "../../src/lib/supabase/database.types.ts";

const room: Tables<"pilot_rooms"> = { id: "kessler-ward", title: "Kessler Ward", description: "A blackout.", is_open: true, is_listed: true, template_id: null, template_version: null, revision: 0, funding_policy: "closed", owner_id: null };
const story = kesslerSeedMoments();
const selected = KESSLER_BEAT_IDS["floor-forty"], tip = KESSLER_BEAT_IDS["dawn-81"];

test("new visitors have no invented unread work; joined rooms remain discoverable", () => {
  assert.deepEqual(returningRooms([room], [], () => null), []);
  const joined = returningRooms([room], [room], () => null);
  assert.equal(joined.length, 1);
  const summary = roomHomeSummary(joined[0], story);
  assert.equal(summary.hasNew, false);
  assert.equal(summary.newCount, undefined);
  assert.equal(summary.resumeHref, "/pilot?room=kessler-ward");
});

test("returning rooms deduplicate, retain unlisted memberships and bound history requests", () => {
  const rooms = Array.from({ length: 12 }, (_, i) => ({ ...room, id: `room-${i}` }));
  const unlisted = { ...room, id: "unlisted", is_listed: false };
  const read = (key: string) => key === visitKey("room-8") ? JSON.stringify(visitSnapshot(story, selected, tip)) : null;
  const candidates = returningRooms(rooms, [unlisted, ...rooms], read);
  assert.equal(candidates.length, 6);
  assert.equal(candidates[0].room.id, "room-8");
  assert.ok(candidates.some(item => item.room.id === "unlisted"));
  assert.equal(new Set(candidates.map(item => item.room.id)).size, candidates.length);
  assert.deepEqual(returningRooms([room], [], () => { throw new Error("Storage blocked"); }), []);
});

test("new scenes come from the saved baseline without marking them read", () => {
  const before = story.filter(moment => ![tip, KESSLER_BEAT_IDS.chain].includes(moment.id));
  const visit = visitSnapshot(before, selected);
  const original = structuredClone(visit);
  const summary = roomHomeSummary({ room, visit }, story);
  assert.equal(summary.newCount, 2);
  assert.equal(summary.hasNew, true);
  assert.ok([tip, KESSLER_BEAT_IDS.chain].includes(summary.latest!.id));
  assert.deepEqual(visit, original);
  assert.equal(roomHomeSummary({ room, visit: visitSnapshot(story, selected, tip) }, story).newCount, 0);
});

test("Continue reading keeps its branch endpoint independently of the new scene link", () => {
  const summary = roomHomeSummary({ room, visit: visitSnapshot(story, selected, tip) }, story);
  const url = new URL(summary.resumeHref, "https://fork-night.invalid");
  assert.equal(url.searchParams.get("moment"), selected);
  assert.equal(url.searchParams.get("tip"), tip);
  assert.equal(new URL(summary.latestHref, url).searchParams.get("moment"), summary.latest!.id);
  for (const invalidTip of [KESSLER_BEAT_IDS["window-81"], "35000000-0000-4000-8000-000000000999"]) {
    const fallback = roomHomeSummary({ room, visit: { ...visitSnapshot(story, selected), lastTipId: invalidTip } }, story);
    assert.equal(new URL(fallback.resumeHref, url).searchParams.get("tip"), selected);
  }
});

test("truncated histories and foreign-room scenes never produce misleading exact counts", () => {
  const many = Array.from({ length: 501 }, (_, index) => ({ ...story[0], id: `35000000-0000-4000-8000-${String(index).padStart(12, "0")}` }));
  const visit = visitSnapshot(story, selected, tip);
  const summary = roomHomeSummary({ room, visit }, many);
  assert.equal(summary.hasNew, true);
  assert.equal(summary.newCount, undefined);
  assert.equal(summary.resumeHref, "/pilot?room=kessler-ward");
  const foreign = roomHomeSummary({ room, visit }, story.map(moment => ({ ...moment, room_id: "elsewhere" })));
  assert.equal(foreign.hasNew, false);
  assert.equal(foreign.latest, undefined);
});
