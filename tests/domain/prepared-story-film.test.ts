import test from "node:test";
import assert from "node:assert/strict";
import { BLADE_RUNNER_FILM as film } from "../../src/lib/prepared-story-film.ts";
import { fandomStory } from "../../src/lib/fandom-stories.ts";
import { createDemoState } from "../../src/domain/fixtures.ts";
import { extendFandomDemo } from "../../src/domain/fandom-fixtures.ts";
import { extendSocialDemo } from "../../src/social/model.ts";

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
