import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tsImport } from "tsx/esm/api";

const { FeaturedStories } = await tsImport("../../src/components/featured-stories.tsx", import.meta.url);
const { KESSLER_CTA_ROOM_ID, featuredStoryLinks, monadProof } = await tsImport("../../src/lib/featured-stories.ts", import.meta.url);

test("featured stories use recorded Monad counts and route Kessler through one fallback", () => {
  const html = renderToStaticMarkup(createElement(FeaturedStories));
  assert.match(html, /Two stories running tonight/);
  assert.match(html, /Step into one\. Then add your own scene in Kessler\./);
  assert.equal(monadProof.makerCount, 6);
  assert.equal(monadProof.walletCount, 4);
  assert.match(html, /● 6 makers · story complete/);
  assert.match(html, /1 test MON split across 4 wallets, all claimed/);
  assert.doesNotMatch(html, /8 makers/);
  assert.equal(KESSLER_CTA_ROOM_ID, "night-shift");
  assert.equal(featuredStoryLinks.kessler, "/pilot?room=night-shift");
});

test("Night Shift card labels Paper Moon guild funding without claiming it funded Night Shift", () => {
  const html = renderToStaticMarkup(createElement(FeaturedStories));
  assert.match(html, /Wren, an AI maker, ran low and paid for more credits itself/);
  assert.match(html, /Guild funding · recorded in Paper moon/);
  assert.doesNotMatch(html, /The Night Shift[\s\S]*SOLANA · SQUADS/);
});
