import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DEFAULT_SUPPORT_MON, MAX_SUPPORT_WEI, ORIGINAL_ART_SHA256, prepareRelease, sceneManifest, supportAmount } from "../../src/lib/onchain/model.ts";
import type { PilotMoment } from "../../src/lib/pilot.ts";

const curator = "0x0000000000000000000000000000000000000001";
const root: PilotMoment = { id: "10000000-0000-4000-8000-000000000001", parent_id: null, room_id: "midnight-signal", maker_id: null,
  maker_label: "Room starter", title: "An opening", panels: [{ caption: "The lighthouse returns.", imageUrl: "/art/midnight-story.webp#frame=0" }],
  created_at: "2026-10-10T12:00:00Z", source_kind: "fixture", source_idea_id: null, source_idea_label: null, source_idea_body: null };

test("release manifests bind ordered ancestry and shipped media bytes while excluding private ideas", async () => {
  const hash = createHash("sha256").update(await readFile("public/art/midnight-story.webp")).digest("hex");
  assert.equal(hash, ORIGINAL_ART_SHA256);
  const next = { ...root, id: "10000000-0000-4000-8000-000000000002", parent_id: root.id, maker_id: "20000000-0000-4000-8000-000000000001", source_idea_body: "Private planning detail" };
  const sibling = { ...next, id: "10000000-0000-4000-8000-000000000003" };
  const prepared = prepareRelease([sibling, next, root], "midnight-signal", next.id, curator);
  assert.equal(prepared.scenes.length, 2);
  assert.equal(prepared.scenes[1].parentId, prepared.scenes[0].id);
  assert.equal(JSON.stringify(prepared.manifest).includes("Private planning detail"), false);
  assert.equal(prepared.manifest.scenes[0].panels[0].sha256, hash);
  assert.notEqual(prepareRelease([root, { ...next, title: "Changed" }], "midnight-signal", next.id, curator).hash, prepared.hash);
});

test("fandom rooms, missing ancestry and cycles cannot become a payout manifest", () => {
  assert.throws(() => prepareRelease([root], "fan-room", root.id, curator), /original/);
  assert.throws(() => prepareRelease([{ ...root, parent_id: "missing" }], "midnight-signal", root.id, curator), /unavailable/);
  assert.throws(() => prepareRelease([{ ...root, parent_id: root.id }], "midnight-signal", root.id, curator), /invalid/);
  assert.throws(() => sceneManifest({ ...root, panels: [{ caption: "Fan scene", imageUrl: "/art/malfoy-anime.webp#frame=0" }] }), /outside the original/);
});

test("support amount preserves exact wei and rejects malformed or unbounded requests", () => {
  assert.equal(supportAmount("0.000000000000000001"), 1n);
  assert.equal(supportAmount(DEFAULT_SUPPORT_MON), 10n ** 18n);
  assert.equal(supportAmount("10"), MAX_SUPPORT_WEI);
  for (const amount of ["0", "-1", "1e3", "1,2", "11", "10.000000000000000001", "300", "0.0000000000000000001"]) assert.throws(() => supportAmount(amount));
});
