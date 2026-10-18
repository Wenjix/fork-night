import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tsImport } from "tsx/esm/api";

const { FeaturedStories } = await tsImport("../../src/components/featured-stories.tsx", import.meta.url);
const { featuredRooms, featuredStoryLinks, monadProof, tempoProof, guildProof } = await tsImport("../../src/lib/featured-stories.ts", import.meta.url);
const render = () => renderToStaticMarkup(createElement(FeaturedStories));
const roomRows = () => render().split('<li class="fn-featured-room">').slice(1);
const row = (title: string) => {
  const result = roomRows().find(html => html.includes(`<h3>${title}</h3>`));
  assert.ok(result, `Missing judge route for ${title}`);
  return result;
};
const primaryHref = (html: string) => {
  const match = html.match(/class="fn-featured-cta" href="([^"]+)"/);
  assert.ok(match);
  return match[1].replaceAll("&amp;", "&");
};

test("judges have four distinct room routes with the focus and action visible together", () => {
  assert.match(render(), /Choose what to explore/);
  assert.equal(roomRows().length, 4);
  for (const [title, focus, roomId, action] of [
    ["The midnight signal", "Monad releases · Privy wallets", "midnight-signal", "View Monad release"],
    ["The Uncharted Star", "Tempo · MPP agent payments", "night-shift", "See Wren’s recorded turn"],
    ["Paper Moon", "Solana · Squads guild funding", "paper-moon", "View guild funding"],
    ["Kessler Ward", "Shared branching story", "kessler-ward", "Read Kessler Ward"],
  ]) {
    const html = row(title);
    assert.ok(html.includes(focus));
    assert.ok(html.includes(action));
    assert.equal(new URL(primaryHref(html), "https://fork-night.invalid").searchParams.get("room"), roomId);
  }
  assert.doesNotMatch(render(), /Step inside|an AI maker is writing|The Night Shift|Add a scene alongside/);
});

test("each room names its stack with brand badges, and a chain badge carries its test network", () => {
  const badgeNames = (html: string) => [...html.matchAll(/<span class="fn-badge-name">([^<]*)<\/span>(?:<span class="fn-badge-version">([^<]*)<\/span>)?/g)].map(match => match[1] + (match[2] ?? ""));
  const midnight = row("The midnight signal");
  assert.deepEqual(badgeNames(midnight), ["Monad", "Privy", "Contract record"]);
  assert.match(midnight, /<span class="fn-net">Testnet<\/span>/);
  assert.match(midnight, /aria-label="Monad releases · Privy wallets"/);
  assert.deepEqual(badgeNames(row("The Uncharted Star")), ["Tempo", "MPP", "Tempo receipt"]);
  assert.match(row("The Uncharted Star"), /<span class="fn-net">Moderato testnet<\/span>/);
  assert.deepEqual(badgeNames(row("Paper Moon")), ["Solana", "Squads", "Solana receipt"]);
  assert.match(row("Paper Moon"), /<span class="fn-net">Devnet<\/span>/);
  assert.deepEqual(badgeNames(row("Kessler Ward")), ["Shared branching story"]);
});

test("historical guides retain the recorded amounts and link to their actual path, turn and receipts", () => {
  assert.equal(monadProof.makerCount, 6);
  assert.equal(monadProof.walletCount, 4);
  const midnight = row("The midnight signal");
  assert.match(midnight, /1 test MON split across 4 wallets, all claimed/);
  assert.match(midnight, /6 maker bylines/);
  assert.match(midnight, /Recorded Oct 12/);
  assert.equal(new URL(primaryHref(midnight), "https://fork-night.invalid").searchParams.get("moment"), "a386d392-f289-4b4e-a901-d6cfd827edd5");
  assert.ok(midnight.includes(monadProof.contractUrl));
  const wren = row("The Uncharted Star");
  assert.match(wren, /Recorded Oct 12/);
  assert.match(wren, /Wren paid for a room-credit top-up within its testnet allowance/);
  assert.equal(new URL(primaryHref(wren), "https://fork-night.invalid").searchParams.get("moment"), "d5f88d54-2aaa-4b8e-a454-207df7dc974e");
  assert.ok(wren.includes(tempoProof.receiptUrl));
  const moon = row("Paper Moon");
  assert.match(moon, /2 of 3 steward wallets approved funding/);
  assert.match(moon, /separate payment added 5 room credits/);
  assert.equal(new URL(primaryHref(moon), "https://fork-night.invalid").searchParams.get("view"), "treasury");
  assert.ok(moon.includes(guildProof.solanaReceiptUrl));
  assert.doesNotMatch(wren, /Squads|guild funding/);
});

test("Kessler is an open reading-and-ideas destination with its own packaged artwork", () => {
  const kessler = row("Kessler Ward");
  assert.equal(primaryHref(kessler), "/pilot?room=kessler-ward");
  assert.equal(featuredStoryLinks.kessler, "/pilot?room=kessler-ward");
  assert.match(kessler, /Open for reading and ideas/);
  assert.match(kessler, /Explore two prepared branches and leave an idea/);
  assert.match(kessler, /night-shift-neon\.webp/);
  assert.doesNotMatch(kessler, /paid|Wren|Squads|test MON|What powers this room/);
  for (const room of featuredRooms) {
    assert.ok(existsSync(new URL(`../../public${room.artwork.split("#")[0]}`, import.meta.url)), `Missing packaged artwork for ${room.title}`);
    assert.match(row(room.title), /class="story-art/);
  }
});
