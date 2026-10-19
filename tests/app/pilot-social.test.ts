import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parsePilotVisit,
  pathUpdates,
  readingPath,
  recapWindow,
  visitSnapshot,
  pilotMomentLink,
} from "../../src/lib/pilot-social.ts";
import type { PilotMoment } from "../../src/lib/pilot.ts";

const moments: PilotMoment[] = Array.from({ length: 13 }, (_, i) => ({
  id: `10000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
  parent_id: i
    ? `10000000-0000-4000-8000-${String(i).padStart(12, "0")}`
    : null,
  room_id: "room",
  title: `Moment ${i}`,
  maker_id: null,
  maker_label: "Maker",
  panels: [],
  source_kind: "fixture",
  source_idea_id: null,
  source_idea_label: null,
  source_idea_body: null,
  created_at: "2026-10-03T00:00:00Z",
}));
test("first visit has no fabricated new markers; return at D identifies E and F", () => {
  assert.equal(pathUpdates(moments.slice(0, 6), null).newIds.size, 0);
  const baseline = visitSnapshot(moments.slice(0, 4), moments[3].id);
  const result = pathUpdates(moments.slice(0, 6), baseline);
  assert.deepEqual(
    [...result.newIds],
    moments.slice(4, 6).map((m) => m.id),
  );
  assert.equal(result.lastMomentId, moments[3].id);
  assert.equal(baseline.knownIds.length, 4);
});
test("new siblings do not inflate the selected path count", () => {
  const sibling = { ...moments[6], parent_id: moments[2].id };
  const path = readingPath(
    [...moments.slice(0, 6), sibling],
    "room",
    moments[5].id,
    moments[3].id,
  );
  assert.equal(path.length, 6);
  assert.equal(
    pathUpdates(path, visitSnapshot(moments.slice(0, 6), sibling.id)).newIds
      .size,
    0,
  );
});
test("visit records retain a branch endpoint without invalidating legacy progress", () => {
  const legacy = visitSnapshot(moments, moments[3].id);
  assert.deepEqual(parsePilotVisit(JSON.stringify(legacy)), legacy);
  const saved = visitSnapshot(moments, moments[3].id, moments[8].id);
  assert.equal(parsePilotVisit(JSON.stringify(saved))?.lastTipId, moments[8].id);
  assert.deepEqual(parsePilotVisit(JSON.stringify({ ...legacy, lastTipId: "invalid" })), legacy);
  assert.equal(visitSnapshot(moments, moments[3].id, "missing").lastTipId, undefined);
});
test("ancestor inspection retains later context; another branch establishes its own path", () => {
  assert.equal(
    readingPath(moments, "room", moments[5].id, moments[1].id).length,
    6,
  );
  const sibling = { ...moments[12], parent_id: moments[0].id };
  assert.deepEqual(
    readingPath(
      [...moments.slice(0, 6), sibling],
      "room",
      moments[5].id,
      sibling.id,
    ).map((m) => m.id),
    [moments[0].id, sibling.id],
  );
});
test("thirteen-moment recap is bounded, can reveal early selection, and fully expands", () => {
  assert.deepEqual(
    recapWindow(moments, moments[12].id).moments,
    moments.slice(7),
  );
  assert.equal(
    recapWindow(moments, moments[1].id).moments[0].id,
    moments[1].id,
  );
  assert.equal(recapWindow(moments, moments[12].id, true).moments.length, 13);
  assert.equal(
    recapWindow(moments.slice(0, 1), moments[0].id).moments.length,
    1,
  );
});
test("corrupt or oversized visit records degrade to a first visit", () => {
  assert.equal(parsePilotVisit("{"), null);
  assert.equal(
    parsePilotVisit(
      JSON.stringify({ version: 1, knownIds: ["bad"], lastMomentId: null }),
    ),
    null,
  );
  assert.equal(
    parsePilotVisit(
      JSON.stringify({
        version: 1,
        knownIds: Array(501).fill(moments[0].id),
        lastMomentId: null,
      }),
    ),
    null,
  );
  const visit = visitSnapshot(moments, moments[12].id);
  assert.deepEqual(parsePilotVisit(JSON.stringify(visit)), visit);
});
test("shared links name a published moment and encode room values", () => {
  const url = new URL(
    pilotMomentLink("http://localhost:3000", "a & b", moments[5].id),
  );
  assert.equal(url.pathname, "/pilot");
  assert.equal(url.searchParams.get("room"), "a & b");
  assert.equal(url.searchParams.get("moment"), moments[5].id);
});
