import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tsImport } from "tsx/esm/api";

const { AppHeader } = await tsImport("../../src/components/app-header.tsx", import.meta.url);
const { FirstNightGuide } = await tsImport("../../src/components/first-night-guide.tsx", import.meta.url);
const { BuiltWith, FeaturedStories } = await tsImport("../../src/components/featured-stories.tsx", import.meta.url);
const { RoomPeek } = await tsImport("../../src/components/room-peek.tsx", import.meta.url);
const { builtWith, featuredStoryLinks } = await tsImport("../../src/lib/featured-stories.ts", import.meta.url);
const { createDemoState } = await tsImport("../../src/domain/fixtures.ts", import.meta.url);

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
/** React 19 emits image preload hints ahead of static markup; they are not part of the page. */
const html = (element: unknown) => renderToStaticMarkup(element as never).replace(/<link rel="preload"[^>]*\/>/g, "");
/** The declarations of the first rule whose selector is exactly `selector`, inside `css` (a whole sheet or one block). */
const rule = (css: string, selector: string) => css.match(new RegExp(`(?:^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
/** The text inside the media query that opens with `opening`. */
function block(css: string, opening: string) {
  const start = css.indexOf(opening);
  assert.ok(start >= 0, opening);
  for (let index = start + opening.length, depth = 1; index < css.length; index++) {
    if (css[index] === "{") depth++;
    else if (css[index] === "}" && --depth === 0) return css.slice(start + opening.length, index);
  }
  throw new Error("unbalanced braces");
}

test("the guide takes the page's surface, and Hide is its last cell with its words", () => {
  const paper = html(createElement(FirstNightGuide, { actorId: null }));
  assert.match(paper, /<section class="fn-first-guide"[^>]*data-tone="paper"/);
  assert.match(html(createElement(FirstNightGuide, { actorId: null, tone: "night" })), /<section class="fn-first-guide"[^>]*data-tone="night"/);
  assert.doesNotMatch(paper, /fn-first-guide-heading/, "Hide no longer rides in the heading column");
  assert.match(paper, /<button class="fn-first-guide-hide" type="button" aria-label="Hide first-night guide"><svg[^>]*aria-hidden="true"[^>]*>.*<\/svg><span>Hide guide<\/span><\/button><\/section>$/);
});

test("the header hands its page's surface to the default guide, and the agent pages are navy", () => {
  const guideTone = (props: object) => html(createElement(AppHeader, { current: "lobby", ...props })).match(/<section class="fn-first-guide"[^>]*data-tone="(\w+)"/)?.[1];
  assert.equal(guideTone({}), "paper");
  assert.equal(guideTone({ current: "agents" }), "night");
  assert.equal(guideTone({ current: "agents", tone: "paper" }), "paper");
  assert.equal(guideTone({ tone: "night" }), "night");
});

test("the guide's night tone uses the root night palette, and paper stays the cream card", () => {
  const css = read("src/app/first-night.css");
  const night = rule(css, '.fn-first-guide[data-tone="night"]');
  for (const token of ["--night-ink", "--night-muted", "--night-panel", "--night-line", "--night-yellow", "--ink-on-yellow"])
    assert.ok(night.includes(`var(${token})`), `${token} should feed the night guide`);
  assert.match(rule(css, ".fn-first-guide,\n.fn-first-invitation,\n.fn-first-guide-reopen"), /--fn-first-paper: #faf7ef;/);
  // The guide's own controls outrank the app's `.social-app button` default, so it reads the same on every page.
  assert.match(css, /\.fn-first-guide \.fn-first-guide-hide \{/);
  assert.match(css, /\.fn-first-guide \.fn-first-guide-toggle \{/);
  assert.match(block(css, "@media (max-width: 760px) {"), /\.fn-first-guide:not\(\[data-compact="true"\]\) > \.fn-first-guide-details \{ display: none; \}/,
    "before the page is live a phone shows the full form as one row, the height of the compact bar");
});

test("on a phone the five links are one scrolling row that fades whichever edge has more", () => {
  const css = read("src/app/navigation.css");
  const phone = block(css, "@media (max-width: 640px) {");
  const track = rule(phone, ".fn-primary-nav");
  assert.match(track, /overflow-x: auto;/);
  assert.match(track, /scrollbar-width: none;/);
  assert.match(phone, /\.fn-primary-nav::-webkit-scrollbar \{ display: none; \}/);
  for (const edge of ["end", "start", "both"]) {
    const fade = rule(phone, `.fn-primary-nav[data-fade="${edge}"]`);
    assert.match(fade, /-webkit-mask-image: linear-gradient/, `${edge}: Safari's form`);
    assert.match(fade, /\n\s*mask-image: linear-gradient/, `${edge}: the standard form`);
  }
  assert.match(rule(phone, ".fn-header .fn-primary-nav a:focus-visible"), /outline-offset: -3px;/, "the ring stays inside the track, so the scroller never clips it");
  assert.match(read("src/components/app-header.tsx"), /ref=\{watchNavigation\}/);
  assert.match(css, /font: 700 36px\/1 var\(--font-hand\);/, "the wordmark reads the one handwriting token");
});

test("the header, guide, page, footer and preview strip share one gutter", () => {
  assert.match(rule(read("src/app/navigation.css"), ".fn-header"), /padding: var\(--space-3\) var\(--gutter\);/);
  assert.match(rule(read("src/app/first-night.css"), ".fn-first-header-guide"), /padding: var\(--space-3\) var\(--gutter\) 0;/);
  const social = read("src/app/social.css");
  assert.match(rule(social, ".social-main"), /padding: 26px var\(--gutter\) 45px;/);
  assert.match(rule(social, ".social-footer"), /padding: 22px var\(--gutter\);/);
  assert.match(rule(social, ".social-demo-strip"), /padding: var\(--space-1\) var\(--gutter\);/);
  assert.doesNotMatch(rule(social, ".spaces-page"), /margin: 0 auto/, "My spaces keeps its narrower column on the gutter instead of centring it");
});

test("the preview strip is one look in both tones, with a 44px help button", () => {
  const social = read("src/app/social.css");
  const strip = rule(social, ".social-demo-strip");
  assert.match(strip, /background: color-mix\(in srgb, currentColor 7%, transparent\);/);
  assert.match(strip, /font-size: var\(--text-sm\);/);
  assert.match(rule(social, ".social-demo-strip button"), /min-height: var\(--control-h\);/);
  assert.doesNotMatch(social, /\.social-paper \.social-demo-strip/, "paper takes the same rule, not a second skin");
  assert.doesNotMatch(read("src/app/first-night.css"), /social-demo-strip/, "the lobby-only override is gone");
});

test("the paper page never shadows the root night tokens the header and guide read", () => {
  const social = read("src/app/social.css");
  assert.doesNotMatch(social, /^\s*--night(-[a-z]+)?:/m, "social.css declares no night token");
  assert.match(rule(social, ".social-app"), /--social-line: var\(--night-line\);/);
  assert.match(rule(social, ".social-paper"), /--social-line: #ddd7e4;[\s\S]*--social-muted: #675d7c;/);
  assert.match(rule(social, ".social-app"), /--social-purple: var\(--night-violet\);[\s\S]*--social-yellow: var\(--night-yellow\);[\s\S]*--hand: var\(--font-hand\);/);
});

test("the lobby hero keeps the size it renders at, whatever sheet loads last", () => {
  const hero = rule(read("src/app/first-night.css"), ".fn-first-hero-copy h1");
  assert.match(hero, /font-size: clamp\(36px, 3vw, 44px\);/);
  assert.match(read("src/app/social.css"), /:where\(\.social-app\) h1 \{\s*font-size: var\(--text-page\);/);
});

test("the starting ideas are one divided list, not a card per option", () => {
  const css = read("src/app/first-night.css");
  const starter = rule(css, ".fn-first-starter");
  assert.doesNotMatch(starter, /border-radius/);
  assert.doesNotMatch(starter, /border: 1px solid/);
  assert.match(starter, /border-bottom: 1px solid var\(--fn-first-line\);/);
  assert.match(starter, /min-height: 56px;/);
  assert.match(rule(css, ".fn-first-starters"), /border-top: 1px solid var\(--fn-first-line\);/);
});

test("the built-with row names six tools, each linking to the page that shows it, and chains keep their network word", () => {
  assert.deepEqual(builtWith.map((item: { brand: string }) => item.brand), ["monad", "tempo", "solana", "privy", "kimi", "hunyuan"]);
  const row = html(createElement(BuiltWith));
  assert.match(row, /<ul class="fn-badges" aria-label="Built with">/);
  assert.deepEqual([...row.matchAll(/<span class="fn-badge-name">([^<]*)<\/span>(?:<span class="fn-badge-version">([^<]*)<\/span>)?/g)].map(match => match[1] + (match[2] ?? "")), ["Monad", "Tempo", "Solana", "Privy", "Kimi K3", "Hunyuan"]);
  assert.deepEqual([...row.matchAll(/<a class="fn-badge"[^>]*href="([^"]+)"/g)].map(match => match[1].replaceAll("&amp;", "&")),
    ["/night-watch-privy", "/tempo", featuredStoryLinks.paperMoonGuild, "/night-watch-privy", "/kimi", "/hunyuan"]);
  assert.deepEqual([...row.matchAll(/<span class="fn-net">([^<]*)<\/span>/g)].map(match => match[1]), ["Testnet", "Moderato testnet", "Devnet"]);
  assert.doesNotMatch(row, /target=|opens in a new tab/, "these are links inside the product");
  // The row sits beside the featured rooms, so their own markup is unchanged.
  assert.doesNotMatch(html(createElement(FeaturedStories)), /Built with|fn-built-with/);
});

test("a featured room opens as a whole row, with the receipt linking separately above it", () => {
  const css = read("src/app/featured-stories.css");
  assert.match(rule(css, ".fn-featured-room"), /position: relative;/);
  assert.match(css, /\.fn-featured-stories \.fn-featured-cta::after \{ content: ""; position: absolute; inset: 0; \}/);
  assert.match(rule(css, ".fn-featured-actions a.fn-badge"), /position: relative;[\s\S]*z-index: 1;/);
  assert.match(rule(css, ".fn-featured-stories .fn-featured-copy h3"), /font-size: 18px;/);
  assert.match(block(css, "@media (max-width: 540px) {"), /\.fn-featured-copy \{ display: contents; \}/, "on a phone the badges run the full width, so none cuts its name short");
});

test("room entries share one surface, border, radius and a hover on the whole card", () => {
  const social = read("src/app/social.css");
  const shared = rule(social, ".room-card,\n.project-tile,\n.space-entry");
  assert.match(shared, /border: 1px solid var\(--social-line\);/);
  assert.match(shared, /border-radius: var\(--radius-lg\);/);
  assert.match(shared, /background: var\(--night-panel\);/);
  assert.match(rule(social, ".room-card:hover,\n.project-tile:hover,\n.space-entry:hover"), /border-color: var\(--night-edge\);/);
  assert.match(rule(social, ".room-card h2"), /font-size: var\(--text-card\);/);
});

test("segmented controls and note buttons are 44px targets on phones and touch screens", () => {
  const css = read("src/app/social.css");
  const touch = block(css, "@media (max-width: 760px), (pointer: coarse) {");
  assert.match(rule(touch, ".social-segments button,\n  .social-segments a"), /min-height: var\(--control-h\);/);
  assert.match(touch, /\.note-pin,\s*\.social-icon-button \{\s*min-width: var\(--control-h\);\s*min-height: var\(--control-h\);/);
});

test("the Save with Google link keeps 12px words, a bigger hit area, and a 44px menu action on touch screens", () => {
  const css = read("src/app/header-account.css");
  assert.match(rule(css, ".fn-header .fn-account-save-google"), /font-size: var\(--text-xs\);/);
  assert.match(css, /\.fn-header \.fn-account-save-google::after \{ content: ""; position: absolute; inset: -2px -12px -14px; \}/);
  const touch = block(css, "@media (pointer: coarse) {");
  assert.match(touch, /\.fn-header \.fn-account-save-google \{ display: none; \}/);
  assert.match(touch, /\.fn-header \.fn-account-save-google-menu \{ display: block; \}/);
});

test("the peek panel leads with its title and keeps its words in a chip, not a label above", () => {
  const demo = createDemoState();
  const project = demo.projects[0];
  const panel = html(createElement(RoomPeek, { project, demo, onEnter: () => undefined }));
  assert.ok(panel.indexOf(`<h2>${project.title}</h2>`) > 0);
  assert.ok(panel.indexOf("<h2>") < panel.indexOf("A look inside"), "the heading comes first");
  assert.match(panel, /<span class="fn-badge room-peek-chip"[^>]*>.*<span class="fn-badge-name">A look inside<\/span><\/span>/);
});

test("the stylesheets leave no text under 12px, and the dead desk and shell blocks are gone", () => {
  for (const sheet of ["first-night", "header-account", "navigation", "featured-stories", "social", "desk"])
    assert.doesNotMatch(read(`src/app/${sheet}.css`), /font-size: *(?:[0-9]|1[01])px/, `${sheet}.css has text under 12px`);
  const social = read("src/app/social.css");
  for (const dead of [".desk-page", ".desk-heading", ".desk-guide", ".desk-how-it-works", ".desk-drafts", ".desk-footnote", ".draft-status", ".social-live-link", ".app-shell .brand", ".app-shell .app-header"])
    assert.ok(!social.includes(dead), `${dead} is dead and should be gone`);
});
