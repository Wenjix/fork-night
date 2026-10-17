import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tsImport } from "tsx/esm/api";

const { FeaturedStories } = await tsImport("../../src/components/featured-stories.tsx", import.meta.url);
const { KESSLER_CTA_ROOM_ID, featuredStoryLinks, monadProof } = await tsImport("../../src/lib/featured-stories.ts", import.meta.url);

test("featured stories keep recorded Monad counts and invite readers to the live Kessler room", () => {
  const html = renderToStaticMarkup(createElement(FeaturedStories));
  assert.match(html, /Two stories with testnet receipts/);
  assert.match(html, /read Kessler Ward and leave an idea/);
  assert.equal(monadProof.makerCount, 6);
  assert.equal(monadProof.walletCount, 4);
  assert.match(html, /● 6 makers · story complete/);
  assert.match(html, /1 test MON split across 4 wallets, all claimed/);
  assert.doesNotMatch(html, /8 makers/);
  assert.equal(KESSLER_CTA_ROOM_ID, "kessler-ward");
  assert.equal(featuredStoryLinks.kessler, "/pilot?room=kessler-ward");
  const kessler = html.slice(html.indexOf('<article class="fn-featured-card fn-featured-kessler">'));
  assert.match(kessler, /href="\/pilot\?room=kessler-ward"/);
  assert.match(kessler, /Explore the two prepared branches and leave an idea/);
  assert.match(kessler, /Read Kessler Ward/);
  assert.doesNotMatch(kessler, /Add a scene|alongside people and Wren|What powers this room/);
});

test("the renamed harbor story identifies Wren's payment as historical proof from its own room", () => {
  const html = renderToStaticMarkup(createElement(FeaturedStories));
  assert.match(html, /The Uncharted Star/);
  assert.equal(featuredStoryLinks.nightShift, "/pilot?room=night-shift");
  assert.match(html, /Wren’s recorded turn · Oct 12/);
  assert.match(html, /Wren, an AI maker, ran low and paid for more credits itself/);
  assert.match(html, /Guild funding · recorded in Paper moon/);
  assert.doesNotMatch(html, /The Night Shift|an AI maker is writing|Two stories running tonight|SOLANA · SQUADS/);
});
