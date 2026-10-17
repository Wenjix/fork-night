import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tsImport } from "tsx/esm/api";
import { BRANDS } from "../../src/lib/brands.ts";
import { layoutMoments } from "../../src/lib/map-layout.ts";
import { BLADE_RUNNER_FILM, NIGHT_SHIFT_FILM } from "../../src/lib/prepared-story-film.ts";
import { BLADE_RUNNER_RESTYLE } from "../../src/lib/prepared-restyle.ts";
import { createDemoState } from "../../src/domain/fixtures.ts";
import { extendFandomDemo } from "../../src/domain/fandom-fixtures.ts";
import { extendSocialDemo } from "../../src/social/model.ts";

const { MakerName } = await tsImport("../../src/components/maker-name.tsx", import.meta.url);
const { StoryMap } = await tsImport("../../src/components/story-map.tsx", import.meta.url);
const { PreparedFilmInvite, PreparedStoryFilm } = await tsImport("../../src/components/prepared-story-film.tsx", import.meta.url);

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
/** React 19 emits image preload hints ahead of static markup; they are not part of the component. */
const html = (element: unknown) => renderToStaticMarkup(element as never).replace(/<link rel="preload"[^>]*\/>/g, "");
const demo = () => extendFandomDemo(extendSocialDemo(createDemoState()));
/** The film components come from tsImport, which types them loosely; pass their props through as they are. */
const make = (component: unknown, props: Record<string, unknown>) => createElement(component as never, props as never);
const OWN_CSS = ["workspace.css", "prepared-story-film.css", "prepared-restyle.css", "story-film.css", "fandom-art-direction.css", "segments.css"];

test("a lone moment sits in the middle of the map, with one tier above it for the next moment", () => {
  const state = demo();
  const project = state.projects.find((item) => item.id === "paper-moon")!;
  const { nodes, width, height } = layoutMoments(state.moments.filter((item) => item.projectId === project.id), project.seedId);
  assert.equal(nodes.length, 1);
  assert.equal(width, 680);
  assert.equal(nodes[0].x, width / 2);
  assert.equal(nodes[0].y, 210, "one 180px tier above the 30px margin, where the slot goes");
  assert.ok(nodes[0].y + 145 <= height);
});

test("a small story is centred in the map and keeps equal margins; a wide one keeps its own width", () => {
  const moment = (id: string, parentId: string | null) => ({ id, parentId });
  const small = layoutMoments([moment("a", null), moment("b", "a"), moment("c", "a")], "a");
  const smallXs = small.nodes.map((node) => node.x);
  assert.equal(small.width, 680);
  assert.equal(Math.min(...smallXs) - 90, small.width - (Math.max(...smallXs) + 90), "the cards are as far from the left edge as from the right");
  const wide = layoutMoments([moment("a", null), ...["b", "c", "d", "e"].map((id) => moment(id, "a"))], "a");
  const wideXs = wide.nodes.map((node) => node.x);
  assert.equal(wide.width, 4 * 224 + 16, "four leaves are wider than the minimum, so the world keeps its own width");
  assert.equal(Math.min(...wideXs), 120, "and nothing is moved");
  for (const tree of [small, wide]) for (const node of tree.nodes) assert.ok(node.x >= 90 && node.x <= tree.width - 90, "every card stays inside the map");
  const state = demo();
  const kessler = layoutMoments(state.moments.filter((item) => item.projectId === "kessler-night-shift"), "kessler-night-shift-opening");
  const kesslerXs = kessler.nodes.map((node) => node.x);
  assert.equal(Math.min(...kesslerXs) - 90, kessler.width - (Math.max(...kesslerXs) + 90), "Kessler's two branches are centred too");
});

test("the map shows a dashed slot above a selected moment nothing is built on, and counts moments in the singular", () => {
  const state = demo();
  const paper = state.projects.find((item) => item.id === "paper-moon")!;
  const seed = state.moments.find((item) => item.id === paper.seedId)!;
  const single = html(createElement(StoryMap, { state, project: paper, selected: seed, onSelect() {} }));
  assert.match(single, /<div class="map-slot"[^>]*>.*The next moment could be yours/s);
  assert.match(single, /1 moment · no ending required/);
  const midnight = state.projects.find((item) => item.id === "midnight-signal")!;
  const start = state.moments.find((item) => item.id === midnight.seedId)!;
  const branching = html(createElement(StoryMap, { state, project: midnight, selected: start, onSelect() {} }));
  assert.doesNotMatch(branching.replace(/<div class="mobile-map">[\s\S]*$/, ""), /map-slot/, "a moment with moments built on it has no slot");
  assert.match(branching, /6 moments · no ending required/);
});

test("an agent is marked with the words AI agent in a chip, the same way wherever a name appears", () => {
  const agent = html(createElement(MakerName, { name: "Wren (AI agent)", agent: true }));
  assert.match(agent, /^Wren<span class="fn-badge agent-mark"/);
  assert.match(agent, /<span class="fn-badge-name">AI agent<\/span>/);
  assert.doesNotMatch(agent, /\(AI agent\)/);
  assert.equal(html(createElement(MakerName, { name: "Sam" })), "Sam");
  const state = demo();
  const kessler = state.projects.find((item) => item.id === "kessler-night-shift")!;
  const wren = state.users.find((item) => item.agent)!;
  const card = state.moments.find((item) => item.projectId === kessler.id && item.authorId === wren.id)!;
  const map = html(createElement(StoryMap, { state, project: kessler, selected: card, onSelect() {} }));
  assert.match(map, /Wren<span class="fn-badge agent-mark"/);
  assert.doesNotMatch(map, /agent-chip/);
});

test("the film invitation is a section plate with the poster as its mount, and the same words", () => {
  for (const film of [BLADE_RUNNER_FILM, NIGHT_SHIFT_FILM]) {
    const invite = html(make(PreparedFilmInvite, { film, onOpen() {} }));
    assert.match(invite, /class="[^"]*fn-section-plate fn-film-plate[^"]*"[^>]*data-tone="lavender"/);
    assert.match(invite, new RegExp(`<span class="fn-plate-mount" aria-hidden="true"><img src="${film.poster}"`));
    assert.match(invite, /<h2 class="fn-plate-heading">See this story come to life\.<\/h2>/);
    assert.ok(invite.includes(film.invite));
    assert.match(invite, /<span>Images <svg[^>]*aria-hidden="true"[^>]*>.*?<\/svg><span class="sr-only"> to <\/span>video<\/span>/s, "the arrow is drawn for sight and read as the word to");
    assert.doesNotMatch(invite, /→/);
  }
});

test("the film page names its models and provider as badges beside the same words", () => {
  for (const film of [BLADE_RUNNER_FILM, NIGHT_SHIFT_FILM]) {
    const page = html(make(PreparedStoryFilm, { film }));
    for (const name of [film.imageModel, film.videoModel, film.provider]) assert.ok(page.includes(`<span class="fn-badge-name">${name}</span>`), `${name} is a badge`);
    assert.match(page, /aria-label="Image model and provider"/);
    assert.match(page, /aria-label="Video model and provider"/);
    assert.ok(page.includes(`<span>${film.duration} seconds</span>`), "the clip length stays a plain line");
    assert.ok(page.includes(film.disclosure), "the disclosure stays a visible sentence");
    assert.doesNotMatch(page, /fn-film-badge/);
  }
  for (const id of [BLADE_RUNNER_FILM.brands, NIGHT_SHIFT_FILM.brands, BLADE_RUNNER_RESTYLE.brands].flatMap((brands) => Object.values(brands))) assert.ok(id in BRANDS, `${id} is a registered brand`);
  assert.equal(BRANDS[BLADE_RUNNER_FILM.brands.provider].kind, "provider");
  assert.equal(BRANDS[BLADE_RUNNER_FILM.brands.videoModel].kind, "model");
});

test("the room's skin sits on one wrapper that holds the toolbar, the preview band, the story and the footer", () => {
  const source = read("src/components/fork-night.tsx");
  const order = ["<StoryRoomShell active={inProject} skin={roomSkin}>", 'className="story-room-toolbar"', 'className="demo-strip"', '<main id="story-workspace" tabIndex={-1}>', 'className="app-footer"', "</StoryRoomShell>"];
  const at = order.map((text) => source.indexOf(text));
  assert.ok(at.every((index) => index >= 0), "every band is present");
  assert.deepEqual([...at].sort((a, b) => a - b), at, "in that order");
  assert.doesNotMatch(source, /<main[^>]*data-room-theme/, "the story area no longer wears the skin by itself");
  assert.match(source, /data-room-theme=\{skin\}/);
  assert.match(source, /accessible\s*\? fanStory\?\.theme\s*: roomTheme\(/, "an open room keeps its own theme; a room that is not available takes the skin of the room asked for");
});

test("the room's bands share one gutter, and the phone toolbar no longer forces the action onto a full row", () => {
  const globals = strip(read("src/app/globals.css"));
  const workspace = strip(read("src/app/workspace.css"));
  const rule = (css: string, selector: string) => css.split("}").find((block) => block.split("{")[0].trim() === selector) ?? "";
  for (const selector of [".project-heading", ".workspace-toolbar", ".demo-strip", ".app-footer", ".preview-explanation", ".save-warning"]) assert.match(rule(globals, selector), /var\(--gutter\)/, `${selector} uses --gutter`);
  for (const selector of [".story-room-toolbar", ".map-description", ".map-controls"]) assert.match(rule(workspace, selector), /var\(--gutter\)/, `${selector} uses --gutter`);
  assert.match(strip(read("src/app/prepared-story-film.css")), /\.fn-film-plate\.fn-section-plate \{[^}]*var\(--gutter\)/);
  assert.doesNotMatch(workspace, /flex-basis: 100%/);
  assert.match(globals, /\.balance-button \{[^}]*min-height: var\(--control-h\)/);
  assert.doesNotMatch(globals, /\.balance-button > svg \{\s*display: none/, "the balance chip keeps its icon on a phone");
});

test("selection and keyboard focus are drawn differently, and the connectors reach 3:1", () => {
  const workspace = strip(read("src/app/workspace.css"));
  const selected = workspace.match(/\.moment-card\.selected \{([^}]*)\}/)?.[1] ?? "";
  assert.match(selected, /box-shadow: inset 0 0 0 1px var\(--accent\)/);
  assert.match(selected, /background: var\(--accent-soft\)/);
  assert.doesNotMatch(selected, /outline/);
  assert.match(workspace, /\.story-room \.moment-card:focus-visible \{[^}]*outline: 3px solid var\(--ink\);[^}]*outline-offset: 5px/);
  const map = read("src/components/story-map.tsx");
  assert.doesNotMatch(map, /var\(--line-strong\)/);
  assert.match(map, /"var\(--edge\)"/);
});

test("one segmented control carries every view switch, with a pressed state that is not colour alone", () => {
  const css = strip(read("src/app/segments.css"));
  assert.match(css, /\[aria-pressed="true"\] \{[^}]*box-shadow: inset 0 0 0 1px var\(--accent\)/);
  assert.match(css, /:focus-visible \{[^}]*outline: 3px solid var\(--focus-ring\)/);
  assert.match(css, /grid-auto-columns: minmax\(0, 1fr\)/, "equal cells on a phone");
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /pointer: coarse/);
  const source = read("src/components/fork-night.tsx");
  assert.match(source, /<div className="fn-segments" role="group" aria-label="Story view">/);
  assert.match(source, /<button key=\{id\} type="button" aria-pressed=\{pressed\}/, "every view button states whether it is on");
  const icons = [...source.matchAll(/\{ id: "(?:map|read|video|images-to-video)"[^}]*icon: (\w+), pressed/g)].map((match) => match[1]);
  assert.equal(new Set(icons).size, icons.length, "each view has its own icon");
  assert.equal(icons.length, 4);
});

test("the local-room styles use none of the refused devices, and no retired class is left behind", () => {
  for (const file of OWN_CSS) {
    const css = strip(read(`src/app/${file}`));
    assert.doesNotMatch(css, /box-shadow:[^;}]*\b-?[1-9]\d*px\s+-?[1-9]\d*px\s+0(?:px)?[\s;]/, `${file}: no hard offset shadow`);
    assert.doesNotMatch(css, /border-(?:left|right)(?:-width)?:\s*(?:[2-9]|\d{2,})px/, `${file}: no thick side border`);
    assert.doesNotMatch(css, /background-clip:\s*text/, `${file}: no gradient text`);
  }
  const retired = [".view-switch", ".demo-badge", ".version-label", ".seed-label", ".kessler-shared-invitation", ".project-fandom-note", ".join-symbol", ".header-spacer", ".fn-film-invite", ".fn-film-badge", ".restyle-styles", ".restyle-model", "agent-chip"];
  const files = [...OWN_CSS.map((file) => `src/app/${file}`), "src/app/globals.css", "src/components/fork-night.tsx", "src/components/story-map.tsx", "src/components/prepared-story-film.tsx", "src/components/prepared-restyle.tsx"];
  for (const file of files) for (const name of retired) assert.ok(!read(file).includes(name), `${file} still mentions ${name}`);
});
