import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { FANDOM_STORIES } from "../../src/lib/fandom-stories.ts";
import { KESSLER_BEAT_IDS, kesslerSeedMoments } from "../../src/lib/kessler-room.ts";
import { makerKey, prepareRelease, sceneManifest } from "../../src/lib/onchain/model.ts";
import { registrationReason, walletBylines } from "../../src/lib/onchain/journey.ts";
import { curator, prepared as midnight } from "./release-fixtures.ts";

const story = FANDOM_STORIES.find(story => story.id === "kessler-night-shift")!;
const ids = new Map(Object.entries(KESSLER_BEAT_IDS));
const kesslerMoments = kesslerSeedMoments();

test("Kessler releases bind its actual two shipped art sheets and one declared prepared-work identity", async () => {
  const result = prepareRelease(kesslerMoments, "kessler-ward", ids.get(story.leadEnding)!, curator);
  assert.equal(result.scenes.length, 6);
  assert.equal(new Set(result.scenes.map(scene => scene.makerId)).size, 1);
  assert.equal(result.scenes[0].makerId, makerKey(null));
  assert.deepEqual(result.manifest.scenes[0].provenance, { kind: "authored-sample", payoutIdentity: "declared-prepared-work" });
  for (const scene of result.manifest.scenes) for (const panel of scene.panels) {
    const filename = panel.imageUrl!.split("#")[0];
    const actual = createHash("sha256").update(await readFile(`public${filename}`)).digest("hex");
    assert.equal(panel.sha256, actual);
  }
  assert.notEqual(result.projectId, midnight.projectId);
});

test("Midnight Signal keeps its exact pre-Kessler manifest and frozen release identity", () => {
  assert.equal(midnight.hash, "0x051f287daffcf0666683b2b5e3af7b1d6b0eff5dcd00a90d71db5a6768feb733");
  assert.equal(midnight.id, "0x1ab8ae324df27ad3997b7547de6264c2abdadd22c85a2c8c64461433e207e105");
});

test("Kessler rejects another room's prepared artwork and retains real guest media commitments", () => {
  const root = kesslerMoments[0];
  assert.throws(() => sceneManifest({ ...root, panels: [{ caption: "Other room", imageUrl: "/art/midnight-story.webp#frame=0" }] }), /outside/);
  const guest = { ...root, id: "30000000-0000-4000-8000-000000000020", parent_id: root.id,
    maker_id: "20000000-0000-4000-8000-000000000001", maker_label: "Actual guest", source_kind: "openai",
    panels: [{ caption: "A new contribution", imagePath: "30000000-0000-4000-8000-000000000020/1.webp", sha256: "a".repeat(64) }] };
  const result = prepareRelease([root, guest], "kessler-ward", guest.id, curator);
  assert.equal(result.manifest.scenes[1].makerId, guest.maker_id);
  assert.equal(result.manifest.scenes[1].panels[0].sha256, "a".repeat(64));
  assert.notEqual(result.scenes[0].makerId, result.scenes[1].makerId);
});

test("a prepared sample wallet is identified as prepared work rather than a fictional collaborator", () => {
  const prepared = prepareRelease(kesslerMoments, "kessler-ward", ids.get(story.leadEnding)!, curator);
  const snapshot = { block: 1, curator, root: prepared.scenes[0].id, termsMatch: true,
    scenes: prepared.scenes.map(scene => ({ id: scene.id, maker: curator, registered: true, matches: true })),
    release: { exists: false, received: 0n, paid: 0n, beneficiaries: [] } };
  assert.deepEqual(walletBylines(prepared, snapshot, curator), ["Prepared Kessler Ward story"]);
});

test("registration prerequisites name prepared work honestly", () => {
  const prepared = prepareRelease(kesslerMoments, "kessler-ward", ids.get(story.leadEnding)!, curator);
  const snapshot = { block: 1, curator, root: prepared.scenes[0].id, termsMatch: true,
    scenes: prepared.scenes.map(scene => ({ id: scene.id, maker: curator, registered: false, matches: true })),
    release: { exists: false, received: 0n, paid: 0n, beneficiaries: [] } };
  assert.equal(registrationReason({ prepared, snapshot, index: 1, account: curator, accepted: true, busy: false, pending: false }),
    "Register Prepared Kessler Ward story’s scene first.");
});
