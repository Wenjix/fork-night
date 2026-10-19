import assert from "node:assert/strict";
import test from "node:test";
import { kesslerSeedMoments, KESSLER_BEAT_IDS, KESSLER_OPENING_ID, KESSLER_ROOM_ID } from "../../src/lib/kessler-room.ts";
import { KESSLER_FILMS } from "../../src/lib/room-film.ts";
import { featuredPaths, followsPath, kesslerEntryView, overviewMap, overviewPaths, parseFollowedPaths, sharedReadingTip, toggleFollowedPath } from "../../src/lib/room-overview.ts";
import type { PilotMoment } from "../../src/lib/pilot.ts";

function liftStory() {
  const moments = kesslerSeedMoments();
  const film = KESSLER_FILMS.find(item => item.id === "lift")!;
  let parent = KESSLER_BEAT_IDS["floor-forty"];
  for (const shot of film.shots.slice(2)) {
    moments.push({ ...moments[0], id: shot.sourceId, parent_id: parent, title: shot.title, maker_label: shot.maker, panels: [shot.panel], created_at: "2026-10-18T10:00:00Z" });
    parent = shot.sourceId;
  }
  return moments;
}
function extra(moment: PilotMoment, index: number): PilotMoment {
  return { ...moment, id: `25000000-0000-4000-8000-${String(index).padStart(12, "0")}`, parent_id: moment.id, title: `Extra path ${index}`, maker_label: `Maker ${index}`, created_at: `2026-10-19T10:${String(index).padStart(2, "0")}:00Z` };
}

test("the Kessler overview summarizes actual leaf paths and preserves both forks", () => {
  const paths = overviewPaths(liftStory());
  assert.deepEqual(featuredPaths(paths).map(path => path.title), ["The rooftops", "The neighbors", "The service lift"]);
  const { nodes: map } = overviewMap(paths);
  const floor = map.find(node => node.id === KESSLER_BEAT_IDS["floor-forty"])!;
  assert.equal(floor.parent, KESSLER_OPENING_ID);
  assert.equal(floor.terminal, false);
  for (const route of ["neighbors", "lift"]) assert.equal(map.find(node => node.terminal && node.route === route)?.parent, floor.id);
  assert.equal(map.find(node => node.terminal && node.route === "rooftops")?.parent, KESSLER_OPENING_ID);
  assert.equal(paths.find(path => path.route === "lift")?.makers, "Burkes + Wren (AI agent)");
});

test("twelve real leaves remain discoverable behind three grouped previews", () => {
  const moments = liftStory();
  const original = overviewPaths(moments);
  original.forEach((path, group) => { for (let i = 1; i <= 4; i++) moments.push(extra(path.scenes.at(-1)!, group * 4 + i)); });
  const paths = overviewPaths(moments);
  assert.equal(paths.length, 12);
  assert.equal(featuredPaths(paths).length, 3);
  const { nodes: map } = overviewMap(paths);
  const groups = map.filter(node => node.terminal);
  assert.equal(groups.length, 3);
  assert.deepEqual(groups.map(node => node.paths.length), [4, 4, 4]);
  assert.equal(new Set(groups.flatMap(node => node.paths.map(path => path.id))).size, 12);
  for (const group of groups) assert.equal(overviewMap(paths, group.id).nodes.filter(node => node.terminal).length, 4);
});

test("nested forks stay clear of previews and remain reachable by opening their group", () => {
  const moments = liftStory();
  const root = moments.find(moment => moment.id === KESSLER_BEAT_IDS["window-81"])!;
  const a = extra(root, 1), b = extra(root, 2);
  const c = extra(b, 3), d = extra(b, 4);
  const e = extra(d, 5), f = extra(d, 6);
  const paths = overviewPaths([...moments, a, b, c, d, e, f]);
  const { nodes: map } = overviewMap(paths, root.id);
  const terminals = map.filter(node => node.terminal);
  assert.equal(new Set(terminals.flatMap(node => node.paths.map(path => path.id))).size, 4);
  assert.ok(terminals.length <= 4);
  for (const fork of map.filter(node => !node.terminal)) {
    assert.ok(fork.y >= Math.max(...terminals.map(node => node.y + 33)) + 8, "Fork controls need space below the preview cards");
  }
  const group = terminals.find(node => node.id === d.id)!;
  assert.deepEqual(group.paths.map(path => path.id).sort(), [e.id, f.id].sort());
  assert.equal(group.parent, b.id, "Grouping preserves the actual fork ancestry");
  assert.deepEqual(overviewMap(paths, group.id).nodes.filter(node => node.terminal).map(node => node.id).sort(), [e.id, f.id].sort());
});

test("wide forks page through every actual branch at both root and expanded scopes", () => {
  for (const scopeId of [KESSLER_OPENING_ID, KESSLER_BEAT_IDS["window-81"]]) {
    const story = liftStory();
    const root = story.find(scene => scene.id === scopeId)!;
    const children = Array.from({ length: 9 }, (_, index) => extra(root, index + 1));
    const paths = overviewPaths([...(scopeId === KESSLER_OPENING_ID ? [root] : story), ...children]);
    const first = overviewMap(paths, scopeId);
    assert.equal(first.pageCount, 3);
    const seen: string[] = [];
    for (let page = 0; page < first.pageCount; page++) {
      const view = overviewMap(paths, scopeId, page);
      const leaves = view.nodes.filter(node => node.terminal);
      assert.ok(leaves.length <= view.pageSize);
      assert.ok(leaves.every(node => node.parent === scopeId));
      seen.push(...leaves.map(node => node.id));
    }
    assert.deepEqual(seen, children.map(scene => scene.id), "paging reveals all children once, in stable order");
    assert.equal(overviewMap(paths, scopeId, 999).page, first.pageCount - 1);
    assert.equal(overviewMap(paths, scopeId, -1).page, 0);
  }
});

test("following survives continuations and unfollowing one fork keeps its siblings", () => {
  const moments = liftStory();
  const initial = overviewPaths(moments);
  const roof = initial.find(path => path.route === "rooftops")!;
  moments.push(extra(roof.scenes.at(-1)!, 1), extra(roof.scenes.at(-1)!, 2));
  const paths = overviewPaths(moments);
  const children = paths.filter(path => path.route === "rooftops");
  assert.ok(children.every(path => followsPath([roof.id], path)));
  const followed = toggleFollowedPath([roof.id], children[0], paths);
  assert.equal(followsPath(followed, children[0]), false);
  assert.equal(followsPath(followed, children[1]), true);
  let all: string[] = [];
  for (const path of paths) all = toggleFollowedPath(all, path, paths);
  assert.equal(all.length, 4, "following is not capped at three");
  assert.deepEqual(parseFollowedPaths(JSON.stringify([...all, all[0], "invalid"])), all);
  assert.deepEqual(parseFollowedPaths("not json"), []);
});

test("incomplete and unrelated ancestry cannot invent overview paths", () => {
  const moments = liftStory();
  const orphan = { ...moments[0], id: "25000000-0000-4000-8000-000000000001", parent_id: "25000000-0000-4000-8000-000000000099" };
  assert.equal(overviewPaths([...moments, orphan]).length, 3);
  assert.equal(overviewPaths([{ ...moments[0], room_id: "other" }]).length, 0);
});

test("bare room arrival opens the overview while explicit destinations keep their flow", () => {
  assert.equal(kesslerEntryView("?room=kessler-ward", ""), "overview");
  for (const key of ["moment", "film", "firstNight", "starter", "onboarding"]) assert.equal(kesslerEntryView(`?${key}=value`, ""), "read");
  assert.equal(kesslerEntryView("", "#kessler-contributions"), "read");
  assert.equal(kesslerEntryView("?view=map", ""), "map");
  assert.equal(kesslerEntryView("?view=read", ""), "read");
});

test("a branch beginning can be reloaded without losing its tip or accepting an unrelated tip", () => {
  const moments = liftStory();
  const roof = KESSLER_BEAT_IDS["window-81"];
  assert.equal(sharedReadingTip(moments, KESSLER_ROOM_ID, KESSLER_OPENING_ID, roof), roof);
  assert.equal(sharedReadingTip(moments, KESSLER_ROOM_ID, KESSLER_BEAT_IDS.stairs, roof), KESSLER_BEAT_IDS.stairs);
  assert.equal(sharedReadingTip(moments, KESSLER_ROOM_ID, KESSLER_OPENING_ID, "missing"), KESSLER_OPENING_ID);
});
