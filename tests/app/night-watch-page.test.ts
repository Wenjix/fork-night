import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tsImport } from "tsx/esm/api";
import type { IdentityResponse, WorldResponse } from "../../src/night-watch/api-types.ts";

// The Night Watch pages as the server sends them: the hosted explainer, the app's frame before mount, Act 1's
// read states and images, and the ERC-8004 card after a failed refresh. Layout is checked in the browser; the
// stylesheet test only pins the rules those checks rely on.
const { NightWatchPageContent } = await tsImport("../../src/components/night-watch/night-watch-page.tsx", import.meta.url);
const { NightWatchApp } = await tsImport("../../src/components/night-watch/night-watch-app.tsx", import.meta.url);
const { WorldPanel } = await tsImport("../../src/components/night-watch/world-panel.tsx", import.meta.url);
const { AgentCard, IdentityCard } = await tsImport("../../src/components/night-watch/identity-card.tsx", import.meta.url);
const { KIMI_VIDEO } = await tsImport("../../src/lib/kimi-article.ts", import.meta.url);

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("the hosted explainer links the recorded demo and the project README", async (t) => {
  // Hosted: local controls are off, so the page renders the explainer without reading request headers.
  const saved = process.env.PILOT_LOCAL_CONTROLS;
  delete process.env.PILOT_LOCAL_CONTROLS;
  t.after(() => {
    if (saved === undefined) delete process.env.PILOT_LOCAL_CONTROLS;
    else process.env.PILOT_LOCAL_CONTROLS = saved;
  });
  assert.equal(KIMI_VIDEO.href, "https://youtu.be/EH01ky2c0XM");
  for (const privyDemo of [false, true]) {
    const html = renderToStaticMarkup(await NightWatchPageContent({ privyDemo }));
    assert.match(html, new RegExp(`See <a href="${escape(KIMI_VIDEO.href)}" target="_blank" rel="noreferrer">the recorded demo</a> and `
      + `<a href="https://github\\.com/Wenjix/fork-night#readme" target="_blank" rel="noreferrer">the project README</a>\\.`));
    assert.doesNotMatch(html, /class="nw-account-slot"|Checking sign-in/, "no account code on the hosted page");
    assert.doesNotMatch(text(html), /real money|mainnet|audited|funded credits|patron paid/i);
  }
});

test("before mount the frame holds the signed-out controls, disabled, so the header keeps its size", () => {
  for (const privyDemo of [false, true]) {
    const html = renderToStaticMarkup(React.createElement(NightWatchApp, { privyDemo }));
    const header = html.slice(html.indexOf('<header class="fn-header">'), html.indexOf("</header>"));
    assert.match(header, /<div class="fn-header-actions"><span class="nw-account-slot"><div class="nw-header-identity"><div class="nw-signin nw-signin-compact">/);
    const buttons = header.match(/<button[^>]*>/g) ?? [];
    assert.equal(buttons.length, 2, "Google and wallet sign-in");
    for (const button of buttons) assert.match(button, /disabled=""/);
    assert.match(header, /<span class="nw-visually-hidden" role="status">Checking sign-in…<\/span>/);
    assert.match(html, /<main class="nw-main"><section class="nw-hero" aria-labelledby="nw-title">[\s\S]*<\/section><p class="nw-opening" role="status">Opening the Night Watch…<\/p><\/main>/);
  }
});

const moment = (id: string, parentId: string | null, title: string, caption: string, imageUrl: string) => ({
  id, parentId, makerId: null, makerLabel: "Wenjie", title, panels: [{ caption, imageUrl }], createdAt: "2026-10-13T22:00:00.000Z", source: "pilot" as const,
});
const WORLD: WorldResponse = {
  room: { id: "room", title: "The Midnight Signal", description: "A shared story that grows by forks." },
  kit: {
    id: "midnight-signal", version: "1", digest: "a".repeat(64), title: "The Midnight Signal", creator: "Wenjie · world creator", disclosure: "The opening artwork was AI-assisted.",
    lore: [], style: [], rules: [], starters: [], participation: [],
    references: [{ label: "The lighthouse wakes", imageUrl: "/api/night-watch/art/0" }, { label: "The light answers", imageUrl: "/api/night-watch/art/2" }],
  },
  moments: [
    moment("m1", null, "The midnight signal", "At midnight, the lighthouse blinked for the first time in years.", "/api/night-watch/art/0"),
    moment("m2", "m1", "Mira unfolds the note", "Mira unfolds the note into a tiny paper boat that glows gold.", "/api/night-watch/art/1"),
  ],
  friendContribution: null,
  defaultForkPointId: "m2",
  credits: null,
};
const world = (props: Record<string, unknown>) => renderToStaticMarkup(React.createElement(WorldPanel, {
  world: null, error: "", reading: false, forkPointId: "", signedIn: false, onChooseForkPoint() {}, onRetry() {}, ...props,
}));

test("a failed world read offers Try again, which stays in place while the retry reads", () => {
  const message = "The local Night Watch server did not answer. Check that the app is still running.";
  assert.match(world({ error: message }), new RegExp(`<p role="alert" class="nw-error">${escape(message)}</p><button type="button" class="button secondary nw-retry">Try again</button>`));
  assert.match(world({ error: message, reading: true }),
    /<p role="status" class="nw-quiet">Reading the world…<\/p><button type="button" class="button secondary nw-retry" aria-disabled="true">Try again<\/button>/);
  const first = world({ reading: true });
  assert.match(first, /Reading the world…/);
  assert.doesNotMatch(first, /Try again|role="alert"/);
  // Both branches render the same focusable section and the same polite status, so a successful retry can move
  // focus to Act 1 and say so instead of leaving focus on <body>.
  for (const html of [world({ error: message }), world({ world: WORLD })]) {
    assert.match(html, /^<section tabindex="-1" id="world" class="nw-act" aria-labelledby="world-title">/);
    assert.match(html, /<\/h2>[\s\S]*?<p class="nw-visually-hidden" role="status"><\/p>/);
  }
});

test("Act 1 images whose caption is shown beside them are not read twice", () => {
  const html = world({ world: WORLD, forkPointId: "m2" });
  const images = html.match(/<img[^>]*>/g) ?? [];
  assert.equal(images.length, 4, "two kit references and two moments");
  for (const image of images) assert.match(image, /alt=""/);
  for (const label of ["The lighthouse wakes", "The light answers"]) assert.match(html, new RegExp(`<span>${label}</span>`));
  assert.match(html, /<h4 title="The midnight signal">The midnight signal<\/h4>/);
  assert.match(html, /<p class="nw-moment-caption">At midnight, the lighthouse blinked for the first time in years\.<\/p>/);
});

const IDENTITY: IdentityResponse = {
  registered: true,
  chainId: 10143,
  registry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
  agentId: "42",
  owner: null,
  agentURI: null,
  card: { name: "Night Watch", description: "A testnet companion.", steward: "Wenjie", service: "http://127.0.0.1:3005/night-watch", kitVersion: "midnight-signal@1", capabilities: [], evidence: [] },
  transaction: null,
  explorerUrl: null,
  note: "",
};

test("a failed identity refresh is shown on the card, which keeps the last read", () => {
  const failed = renderToStaticMarkup(React.createElement(AgentCard, { identity: IDENTITY, titleId: "agent-card", error: "The identity registry did not answer." }));
  assert.match(failed, /<\/h3>[\s\S]*<p role="alert" class="nw-error">The identity registry did not answer\.<\/p><p class="nw-agent-card-byline">/);
  assert.match(text(failed), /Registered on Monad testnet as agent #42/);
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(AgentCard, { identity: IDENTITY, titleId: "agent-card" })), /role="alert"/);
  // With no identity yet, AgentCard draws the same card and top row with the reading line or the first error.
  // night-watch-focus.test.ts checks that IdentityCard always returns AgentCard, which keeps the refresh button.
  const empty = renderToStaticMarkup(React.createElement(AgentCard, { identity: null, titleId: "agent-card" }));
  assert.match(empty, /^<section class="nw-card nw-agent-card" aria-labelledby="agent-card"><div class="nw-agent-card-top">/);
  assert.match(empty, /<p role="status" class="nw-quiet">Reading the identity registry…<\/p><\/section>$/);
  assert.match(renderToStaticMarkup(React.createElement(AgentCard, { identity: null, titleId: "agent-card", error: "Sign in first." })),
    /<p role="alert" class="nw-error">Sign in first\.<\/p><\/section>$/);
  // While a read is in flight the refresh button is busy but stays focusable (aria-disabled, not disabled).
  const reading = renderToStaticMarkup(React.createElement(IdentityCard, { api: { identity: () => new Promise(() => {}) } }));
  assert.match(reading, /^<section class="nw-card nw-agent-card"/);
  const refresh = reading.match(/<button[^>]*aria-label="Read the identity again"[^>]*>[\s\S]*?<\/button>/)?.[0] ?? "";
  assert.match(refresh, /aria-disabled="true"/);
  assert.doesNotMatch(refresh, /\sdisabled=""/);
  assert.match(refresh, /class="lucide lucide-refresh-cw nw-spin"/);
});

test("the night page keeps its last margin, the hero art covers its sign, and Privy step numbers stay whole", () => {
  const css = read("src/app/night-watch/night-watch.css");
  assert.match(css, /\.night-watch \{[^}]*display: flow-root;/, "the last plate's margin stays on the night background");
  assert.match(css, /\.nw-room-sign > \.story-art \{[^}]*container-type: size;/);
  assert.match(css, /\.nw-room-sign > \.story-art > \.story-art-frame \{[^}]*width: max\(100cqw, 100cqh\);[^}]*left: min\(0px, 50cqw - 50cqh\);/);
  assert.match(css, /\.nw-account-slot \{ display: contents; \}/);
  assert.match(read("src/app/night-watch-privy/privy-demo.css"), /\.nw-privy-flow a::before \{[^}]*flex: none; white-space: nowrap;/);
});
