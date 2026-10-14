import test from "node:test";
import assert from "node:assert/strict";
import { BLADE_RUNNER_FILM as film } from "../../src/lib/prepared-story-film.ts";
import { fandomStory } from "../../src/lib/fandom-stories.ts";
import { createDemoState } from "../../src/domain/fixtures.ts";
import { extendFandomDemo } from "../../src/domain/fandom-fixtures.ts";
import { extendSocialDemo } from "../../src/social/model.ts";
import { getPath, validateDemoState } from "../../src/domain/index.ts";
import { artAssetUrl, isApprovedArtUrl } from "../../src/lib/art.ts";
import { readFileSync } from "node:fs";
import sharp from "sharp";

test("the prepared motion example references exactly the four lead-path images in request order", () => {
  const story = fandomStory(film.projectId)!;
  assert.deepEqual(film.images.map(image => image.frame), [0, 1, 2, 3]);
  assert.deepEqual(film.images.map(image => image.authorId), ["jules", "jules", "priya", "sam"]);
  assert.deepEqual(film.images.map(image => image.caption), [
    ...story.beats.find(beat => beat.id === "opening")!.captions,
    ...story.beats.find(beat => beat.id === "greenhouse")!.captions,
    ...story.beats.find(beat => beat.id === story.leadEnding)!.captions,
  ]);
  assert(film.images.every(image => /^\/film-demo\/blade-runner-image-[0-3]\.webp$/.test(image.src)));
  assert.equal(film.duration, 12);
  assert.equal(film.preparedOn, "2026-10-07");
});

test("editing the local room never relabels the prepared film as the edited path", () => {
  const state = extendFandomDemo(extendSocialDemo(createDemoState()));
  const before = structuredClone(film);
  const opening = state.moments.find(moment => moment.id === `${film.projectId}-opening`)!;
  opening.title = "A different memory";
  opening.panels[0].caption = "My new story has a different beginning.";
  state.moments.find(moment => moment.id === `${film.projectId}-something-living`)!.version++;
  assert.deepEqual(film, before);
  assert.notEqual(film.images[0].caption, opening.panels[0].caption);
});

test("a third fork lays out the film's four scenes and its last scene is the way into the film", async () => {
  const state = extendFandomDemo(extendSocialDemo(createDemoState()));
  const path = getPath(state, film.projectId, film.lastSceneId);
  assert.deepEqual(path.map(moment => moment.id), ["opening", "film-scene-1", "film-scene-2", "film-scene-3", "film-scene-4"].map(id => `${film.projectId}-${id}`));
  const scenes = path.slice(1);
  assert.deepEqual(scenes.map(moment => moment.panels.length), [1, 1, 1, 1]);
  assert.deepEqual(scenes.map(moment => moment.panels[0].caption), film.images.map(image => image.caption));
  assert.deepEqual(scenes.map(moment => moment.authorId), film.images.map(image => image.authorId));
  assert(scenes.every(moment => isApprovedArtUrl(moment.panels[0].imageUrl) && artAssetUrl(moment.panels[0].imageUrl) === "/art/blade-runner-film.webp"));
  assert.deepEqual(scenes.map(moment => moment.panels[0].imageUrl.split("=")[1]), ["0", "1", "2", "3"]);
  const children = state.moments.filter(moment => moment.parentId === `${film.projectId}-opening`).map(moment => moment.id);
  assert.equal(children.length, 3, "the opening now has three forks");
  // Each sheet frame is the downscaled film reference it claims to be.
  const sheet = readFileSync(new URL("../../public/art/blade-runner-film.webp", import.meta.url));
  for (const image of film.images) {
    const tile = await sharp(sheet).extract({ left: (image.frame % 3) * 512, top: Math.floor(image.frame / 3) * 512, width: 512, height: 512 }).resize(16, 16).raw().toBuffer();
    const source = await sharp(readFileSync(new URL(`../../public${image.src}`, import.meta.url))).resize(16, 16).raw().toBuffer();
    const difference = tile.reduce((sum, value, index) => sum + Math.abs(value - source[index]), 0) / tile.length;
    assert(difference < 8, `frame ${image.frame} matches its film image (${difference.toFixed(1)})`);
  }
});

test("a browser that saved the room before the film fork gains it without changing saved work", () => {
  const fresh = extendFandomDemo(extendSocialDemo(createDemoState()));
  const old = structuredClone(fresh);
  old.moments = old.moments.filter(moment => !moment.id.startsWith(`${film.projectId}-film-scene-`));
  old.moments.find(moment => moment.id === `${film.projectId}-greenhouse`)!.title = "My saved title";
  validateDemoState(old);
  const upgraded = extendFandomDemo(old);
  assert.deepEqual(upgraded.moments.slice(0, old.moments.length), old.moments);
  assert.deepEqual(upgraded.moments.slice(old.moments.length).map(moment => moment.id), [1, 2, 3, 4].map(n => `${film.projectId}-film-scene-${n}`));
  assert.strictEqual(extendFandomDemo(upgraded), upgraded);
});

test("the Night Shift film follows its lead path, people and Wren, and every prepared file exists", async () => {
  const { NIGHT_SHIFT_FILM, PREPARED_FILMS, BLADE_RUNNER_FILM } = await import("../../src/lib/prepared-story-film.ts");
  const { existsSync } = await import("node:fs");
  assert.deepEqual(Object.keys(PREPARED_FILMS).sort(), [BLADE_RUNNER_FILM.projectId, NIGHT_SHIFT_FILM.projectId].sort());
  assert.equal(NIGHT_SHIFT_FILM.lastSceneId, "kessler-night-shift-dawn-81");
  assert.deepEqual(NIGHT_SHIFT_FILM.images.map(image => image.title), ["Lights out in Kessler Ward", "Eighty-one floors", "Hand to hand", "Dawn on eighty-one"]);
  assert.deepEqual(NIGHT_SHIFT_FILM.images.map(image => image.authorId), ["sam", "jules", "sam", "wren"]);
  for (const film of Object.values(PREPARED_FILMS))
    for (const file of [film.poster, film.captions, ...film.images.map(image => image.src), film.video])
      assert(existsSync(new URL(`../../public${file}`, import.meta.url)), file);
  assert.match(NIGHT_SHIFT_FILM.disclosure, /Original story/);
});
