import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createDemoState, getPath, getQuote, reserveFork, exportBranch, assertLedgerConservation, validateDemoState } from "../../src/domain/index.ts";
import { extendFandomDemo } from "../../src/domain/fandom-fixtures.ts";
import { ARCHIVED_FANDOM_STORIES, FANDOM_STORIES } from "../../src/lib/fandom-stories.ts";
import { fandomImageInStyle, fandomMomentInStyle, restoreArtDirections } from "../../src/lib/fandom-art-direction.ts";
import { isApprovedArtUrl } from "../../src/lib/art.ts";
import { makeFilmPlan } from "../../src/lib/story-film.ts";
import { renderFinishedHtml } from "../../src/lib/finished-export.ts";
import { restoreLocalWorkspace } from "../../src/social/navigation.ts";

const story = FANDOM_STORIES.find(item => item.id === "malfoy-hogwarts")!;
const fixture = () => extendFandomDemo(createDemoState());

test("both visual interpretations preserve selected ancestry, captions, versions and maker credits", () => {
  const state = fixture();
  const original = JSON.stringify(state);
  for (const ending of [story.leadEnding, story.alternateEnding]) {
    const path = getPath(state, story.id, `${story.id}-${ending}`);
    for (const style of story.visualStyles!) {
      const presented = path.map(moment => fandomMomentInStyle(story.id, moment, style.id));
      assert.deepEqual(presented.map(({ panels, ...record }) => record), path.map(({ panels, ...record }) => record));
      assert.deepEqual(presented.flatMap(moment => moment.panels.map(panel => panel.caption)), path.flatMap(moment => moment.panels.map(panel => panel.caption)));
      const plan = makeFilmPlan(story.title, presented.map(moment => ({ id: moment.id, title: moment.title, maker: moment.authorId, version: moment.version, panels: moment.panels })));
      assert.equal(plan.shots.length, 4);
      assert.equal(plan.shots[3].sourceId, path.at(-1)!.id);
      for (const shot of plan.shots) {
        assert(shot.imageUrl.startsWith(style.artwork + "#"));
        assert(isApprovedArtUrl(shot.imageUrl));
      }
      assert.deepEqual(plan.shots.map(shot => shot.maker), path.flatMap(moment => moment.panels.map(() => moment.authorId)));
    }
  }
  assert.equal(JSON.stringify(state), original);
  assertLedgerConservation(state);
});

test("style selection leaves original uploads, mixed panels, other worlds and malformed URLs intact", () => {
  const uploaded = "data:image/png;base64,participant-art";
  const moment = { panels: [
    { imageUrl: "/art/malfoy-anime.webp#frame=3", caption: "A prepared scene." },
    { imageUrl: uploaded, caption: "My original drawing stays mine." },
    { imageUrl: "/art/night-city-anime.webp#frame=1", caption: "Another world." },
  ] };
  const film = fandomMomentInStyle(story.id, moment, "film");
  assert.equal(film.panels[0].imageUrl, "/art/malfoy-film.webp#frame=3");
  assert.strictEqual(film.panels[1], moment.panels[1]);
  assert.strictEqual(film.panels[2], moment.panels[2]);
  assert.equal(fandomImageInStyle("night-city-after-hours", moment.panels[0].imageUrl, "film"), moment.panels[0].imageUrl);
  for (const value of ["/art/malfoy-anime.webp#frame=6", "/art/malfoy-anime.webp?x=1#frame=0", "https://other.example/art/malfoy-anime.webp#frame=0"]) {
    assert.equal(isApprovedArtUrl(value), false);
    assert.equal(fandomImageInStyle(story.id, value, "film"), value);
  }
  assert.deepEqual(restoreArtDirections({ [story.id]: "film", "night-city-after-hours": "film", unknown: "anime" }), { [story.id]: "film" });
  for (const value of [null, [], "film", { [story.id]: { id: "film" } }, { [story.id]: "unknown" }]) assert.deepEqual(restoreArtDirections(value), {});
});

test("the new Hogwarts story preserves an older reunion save, hold and unfinished prompt", () => {
  const state = fixture();
  const oldStory = ARCHIVED_FANDOM_STORIES[0];
  const parentId = `${oldStory.id}-${oldStory.leadEnding}`;
  const quote = getQuote(state, { userId: "sam", projectId: oldStory.id, parentId, prompt: "Keep my unfinished reunion continuation.", now: Date.UTC(2026, 9, 7) });
  const held = reserveFork(state, quote, { now: quote.issuedAt });
  const prior = structuredClone(held);
  prior.projects = prior.projects.filter(project => project.id !== story.id);
  prior.moments = prior.moments.filter(moment => moment.projectId !== story.id);
  const before = JSON.stringify(prior);
  const restored = restoreLocalWorkspace({ state: prior, userId: "sam", projectId: oldStory.id, selectedId: parentId, draft: quote.prompt, operationId: `op-${quote.id}`, drafts: {} }, extendFandomDemo);
  assert.equal(JSON.stringify(prior), before);
  assert.equal(restored.projectId, oldStory.id);
  assert.equal(restored.draft, quote.prompt);
  assert.equal(restored.selectedId, parentId);
  assert.deepEqual(restored.state.moments.slice(0, prior.moments.length), prior.moments);
  for (const key of ["accounts", "operations", "ledger", "claims"] as const) assert.deepEqual(restored.state[key], prior[key]);
  assert(restored.state.projects.some(project => project.id === story.id));
  assert.strictEqual(extendFandomDemo(restored.state), restored.state);
  assertLedgerConservation(restored.state);
  validateDemoState(restored.state);
});

test("standalone exports embed the chosen visual interpretation and keep the other ending separate", () => {
  const state = fixture();
  for (const ending of [story.leadEnding, story.alternateEnding]) {
    const saved = exportBranch(state, { userId: "sam", projectId: story.id, momentId: `${story.id}-${ending}` });
    const original = JSON.stringify(saved);
    for (const style of story.visualStyles!) {
      const branch = { ...saved, moments: saved.moments.map(moment => fandomMomentInStyle(story.id, moment, style.id)) };
      const image = readFileSync(new URL(`../../public${style.artwork}`, import.meta.url));
      const embedded = `data:image/webp;base64,${image.toString("base64")}`;
      const font = { dataUrl: `data:font/woff2;base64,${readFileSync(new URL("../../public/fonts/inter-latin.woff2", import.meta.url)).toString("base64")}`, license: readFileSync(new URL("../../public/fonts/OFL.txt", import.meta.url), "utf8") };
      const html = renderFinishedHtml(branch, { [style.artwork]: embedded }, font);
      assert(html.includes(embedded));
      assert(html.includes(font.dataUrl));
      assert(html.includes("fork-night-font-license"));
      assert(html.includes("SIL Open Font License"));
      assert(html.includes("background:#faf9f5"));
      assert(!html.includes("<main><small>"));
      assert.throws(() => renderFinishedHtml(branch, { [style.artwork]: embedded }, { ...font, dataUrl: "https://example.com/font.woff2" }), /embedded reading font/);
      assert(html.includes("Prepared visual interpretation: " + style.label));
      assert(html.includes("Authored unofficial fan story"));
      const unchosen = ending === story.leadEnding ? story.alternateEnding : story.leadEnding;
      assert(!html.includes(`${story.id}-${unchosen}`));
      assert(saved.moments.every(moment => html.includes(moment.credit.name)));
    }
    assert.equal(JSON.stringify(saved), original);
  }
});
