import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createDemoState, deliverFork, exportBranch, getPath, getQuote, publishFork, reserveFork, validateDemoState, assertLedgerConservation } from "../../src/domain/index.ts";
import { extendFandomDemo } from "../../src/domain/fandom-fixtures.ts";
import { extendSocialDemo, listPublicProjects, createSocialState } from "../../src/social/model.ts";
import { restoreLocalWorkspace } from "../../src/social/navigation.ts";
import { FANDOM_STORIES, showcaseProjects } from "../../src/lib/fandom-stories.ts";
import { artAssetUrl, artPosition, isApprovedArtUrl } from "../../src/lib/art.ts";
import { makeFilmPlan } from "../../src/lib/story-film.ts";
import { renderFinishedHtml } from "../../src/lib/finished-export.ts";

const now = Date.UTC(2026, 9, 7, 20);
const fixture = () => extendFandomDemo(extendSocialDemo(createDemoState()));

test("saved moments accept one through three panels and reject empty or excessive sequences", () => {
  for (const count of [1, 2, 3]) {
    const state = createDemoState();
    const panel = state.moments[0].panels[0];
    state.moments[0].panels = Array.from({ length: count }, () => ({ ...panel }));
    validateDemoState(JSON.parse(JSON.stringify(state)));
  }
  for (const count of [0, 4]) {
    const state = createDemoState();
    const panel = state.moments[0].panels[0];
    state.moments[0].panels = Array.from({ length: count }, () => ({ ...panel }));
    assert.throws(() => validateDemoState(state), /state.moments\[0\].panels/);
  }
});

test("fandom extension restores an existing held operation and draft without replacing saved work", () => {
  const old = extendSocialDemo(createDemoState());
  const quote = getQuote(old, { userId: "priya", projectId: "midnight-signal", parentId: "signal", prompt: "My unfinished lighthouse direction.", now });
  const held = reserveFork(old, quote, { now });
  const original = JSON.stringify(held);
  const restored = restoreLocalWorkspace({ state: held, userId: "priya", projectId: "midnight-signal", selectedId: "signal", draft: quote.prompt, operationId: `op-${quote.id}`, drafts: {} }, state => extendFandomDemo(extendSocialDemo(state)));
  assert.equal(JSON.stringify(held), original);
  assert.deepEqual(restored.state.moments.slice(0, held.moments.length), held.moments);
  for (const key of ["accounts", "operations", "ledger", "memberships", "claims"] as const) assert.deepEqual(restored.state[key], held[key]);
  assert.equal(restored.operationId, `op-${quote.id}`);
  assert.equal(restored.draft, quote.prompt);
  assert.equal(restored.selectedId, "signal");
  assert.strictEqual(extendFandomDemo(restored.state), restored.state);
  const changed = structuredClone(restored.state);
  changed.moments.find(moment => moment.projectId === "malfoid-unsent-owl")!.title = "My saved opening title";
  assert.strictEqual(extendFandomDemo(changed), changed);
  assert.equal(changed.moments.find(moment => moment.projectId === "malfoid-unsent-owl")!.title, "My saved opening title");
  const finished = publishFork(deliverFork(restored.state, restored.operationId!), restored.operationId!, "A credited continuation.", { now: now + 1 });
  assertLedgerConservation(finished);
  validateDemoState(JSON.parse(JSON.stringify(finished)));
});

test("discovery curates three fandoms and one generic example while retaining originals and access boundaries", () => {
  const state = fixture();
  const social = createSocialState();
  const discovered = showcaseProjects(listPublicProjects(social, state));
  assert.deepEqual(discovered.map(project => project.id), ["night-city-after-hours", "malfoy-hogwarts", "blade-runner-memory", "moon-bus"]);
  assert(state.projects.some(project => project.id === "midnight-signal"), "Older saved stories remain addressable.");
  const original = { ...state.projects.find(project => project.id === "moon-bus")!, id: "my-own-world", title: "My own world", seedId: "my-own-world-opening" };
  state.projects.push(original);
  const source = state.moments.find(moment => moment.id === "moon-bus-seed")!;
  state.moments.push({ ...source, id: original.seedId, projectId: original.id });
  validateDemoState(state);
  assert(showcaseProjects(listPublicProjects(social, state)).some(project => project.id === original.id));
  assert(showcaseProjects(listPublicProjects(social, state)).every(project => project.visibility === "open"));
});

test("each fandom has two complete credited four-panel paths and six bounded illustration frames", () => {
  const state = fixture();
  for (const story of FANDOM_STORIES) {
    const paths = [story.leadEnding, story.alternateEnding].map(tip => getPath(state, story.id, `${story.id}-${tip}`));
    assert.equal(paths[0][0].id, paths[1][0].id);
    assert.equal(paths[0].length, 3);
    assert.equal(paths[1].length, 3);
    assert.notEqual(paths[0][1].id, paths[1][1].id);
    for (const path of paths) {
      assert.equal(new Set(path.map(moment => moment.authorId)).size, 3);
      const plan = makeFilmPlan(story.title, path.map(moment => ({ id: moment.id, title: moment.title, maker: state.users.find(user => user.id === moment.authorId)!.name, version: moment.version, panels: moment.panels })));
      assert.equal(plan.shots.length, 4);
      assert.equal(plan.shots[0].sourceId, `${story.id}-opening`);
      assert.equal(plan.shots[3].sourceId, path[2].id);
      for (const shot of plan.shots) {
        assert(isApprovedArtUrl(shot.imageUrl));
        assert.equal(artAssetUrl(shot.imageUrl), story.artwork);
        assert(shot.caption.length > 50);
      }
    }
    assert.equal(new Set(state.moments.filter(moment => moment.projectId === story.id).flatMap(moment => moment.panels.map(panel => panel.imageUrl)).filter(url => artAssetUrl(url) === story.artwork)).size, 6);
    assert.equal(artPosition(`${story.artwork}#frame=5`), "100% 100%");
    for (const wrong of [`${story.artwork}#frame=6`, `${story.artwork}?tracking=1#frame=0`, `https://example.com${story.artwork}#frame=0`, `${story.artwork}#frame=0&x=1`, "/art/not-a-fandom.webp#frame=0"]) assert.equal(isApprovedArtUrl(wrong), false);
  }
});

test("prepared fandom delivery and publication keep the selected illustration and character context", () => {
  for (const story of FANDOM_STORIES) {
    const state = fixture();
    const parentId = `${story.id}-${story.alternateEnding}`;
    const quote = getQuote(state, { userId: "jules", projectId: story.id, parentId, prompt: "Keep this branch's character choices and add another small consequence.", now });
    const held = reserveFork(state, quote, { now });
    const delivered = deliverFork(held, `op-${quote.id}`);
    const candidate = delivered.operations.at(-1)!.candidate!;
    const parent = state.moments.find(moment => moment.id === parentId)!;
    assert.equal(candidate.panels[0].imageUrl, parent.panels.at(-1)!.imageUrl);
    assert.equal(artAssetUrl(candidate.panels[0].imageUrl), story.artwork);
    assert(candidate.storyContext.startsWith(parent.storyContext));
    assert(!candidate.storyContext.includes("above the water"));
    assert.equal(candidate.provider, "deterministic-fixture");
    const published = publishFork(delivered, `op-${quote.id}`, "Another choice, built on this ending.", { now: now + 1 });
    assertLedgerConservation(published);
    validateDemoState(published);
    const work = published.moments.at(-1)!;
    assert.equal(work.projectId, story.id);
    assert.equal(work.parentId, parentId);
    assert.equal(work.authorId, "jules");
    assert.equal(work.panels[0].imageUrl, parent.panels.at(-1)!.imageUrl);
  }
});

test("fandom story export contains its actual packaged art, chosen ancestry and maker credits", () => {
  const state = fixture();
  for (const story of FANDOM_STORIES) {
    const branch = exportBranch(state, { userId: "sam", projectId: story.id, momentId: `${story.id}-${story.leadEnding}` });
    const image = readFileSync(new URL(`../../public${story.artwork}`, import.meta.url));
    const embedded = `data:image/webp;base64,${image.toString("base64")}`;
    const html = renderFinishedHtml(branch, { [story.artwork]: embedded });
    assert(html.includes(embedded));
    assert(html.includes(story.title));
    assert(html.includes("Authored unofficial fan story"));
    assert(html.includes("Sam, Priya, Jules") || branch.moments.every(moment => html.includes(moment.credit.name)));
    assert(!html.includes(`${story.id}-${story.alternateEnding}`));
    assert(html.includes('id="fork-night-manifest"'));
  }
});
