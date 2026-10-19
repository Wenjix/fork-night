import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tsImport } from "tsx/esm/api";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/supabase/database.types.ts";
import { config, curator, moments } from "./release-fixtures.ts";

const { PilotArtwork } = await tsImport("../../src/components/pilot-artwork.tsx", import.meta.url);
const { PilotRoomFunding } = await tsImport("../../src/components/guild-funding.tsx", import.meta.url);
const { RoomNetworkPlate } = await tsImport("../../src/components/room-network-plate.tsx", import.meta.url);
const { TestnetRelease } = await tsImport("../../src/components/testnet-release.tsx", import.meta.url);
const { WalletSignInDialog } = await tsImport("../../src/components/pilot-wallet-signin.tsx", import.meta.url);
const { GoogleButton, PrivyMark } = await tsImport("../../src/components/auth-branding.tsx", import.meta.url);
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
/** React 19 emits image preload hints ahead of static markup; they are not part of the page. */
const html = (element: unknown) => renderToStaticMarkup(element as never).replace(/<link rel="preload"[^>]*\/>/g, "");
const client = {} as SupabaseClient<Database>;
const panel = (caption: string) => ({ caption, imageUrl: "/art/midnight-story.webp#frame=1" });

test("a moment with one panel shows no pager; several panels page through", () => {
  const one = html(createElement(PilotArtwork, { client, title: "One", maker: "Tester", panels: [panel("A radio crackles.")] }));
  assert.doesNotMatch(one, /Panel 1 of 1|Previous panel|Next panel|pilot-panel-pager/);
  const two = html(createElement(PilotArtwork, { client, title: "Two", maker: "Tester", panels: [panel("A radio crackles."), panel("The tide turns.")] }));
  assert.match(two, /Panel 1 of 2/);
  assert.match(two, /aria-label="Previous panel"/);
  assert.match(two, /aria-label="Next panel"/);
});

function renderRelease(roomId: string) {
  const saved = { address: process.env.NEXT_PUBLIC_MONAD_RELEASE_ADDRESS, curator: process.env.NEXT_PUBLIC_MONAD_CURATOR_ADDRESS };
  process.env.NEXT_PUBLIC_MONAD_RELEASE_ADDRESS = config.address;
  process.env.NEXT_PUBLIC_MONAD_CURATOR_ADDRESS = curator;
  try {
    return html(createElement(TestnetRelease, { roomId, moments, tipId: moments.at(-1)!.id, onChoosePath: () => {} }));
  } finally {
    for (const [key, value] of [["NEXT_PUBLIC_MONAD_RELEASE_ADDRESS", saved.address], ["NEXT_PUBLIC_MONAD_CURATOR_ADDRESS", saved.curator]]) {
      if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
    }
  }
}

test("the release card names its chain with a badge that carries the test network, and signs in with Google's own button", () => {
  const card = renderRelease("midnight-signal");
  assert.match(card, /<ul class="fn-badges pilot-release-badges" aria-label="Release network">/);
  assert.match(card, /<span class="fn-badge-name">Monad<\/span>/);
  assert.match(card, /<span class="fn-net">Testnet<\/span>/);
  assert.match(card, /<button[^>]*class="pilot-google-button\b[^"]*"[^>]*>[\s\S]*?Sign in with Google<\/span><\/button>/);
  assert.doesNotMatch(card, /button primary[^>]*>Sign in with Google/);
  // The terms and the makers open like every other expander, and the test-MON disclosure stays a visible sentence.
  assert.match(card, /<details class="fn-disclosure pilot-release-details"><summary class="fn-disclosure-summary">/);
  assert.match(card, /Test MON has no redemption value\./);
  assert.match(card, /then Lock <svg[\s\S]*?<\/svg> Support <svg[\s\S]*?<\/svg> Claim/);
});

test("every chain a room shows is a badge with its test network beside it, and its currency stays in words", () => {
  const plate = (roomId: string) => html(createElement(RoomNetworkPlate, { roomId }));
  const midnight = plate("midnight-signal");
  assert.match(midnight, /<span class="fn-badge-name">Monad<\/span>/);
  assert.match(midnight, /<span class="fn-net">Testnet<\/span>/);
  assert.match(midnight, /test MON/);
  assert.match(plate("night-shift"), /<span class="fn-net">Moderato testnet<\/span>/);
  assert.match(plate("night-shift"), /test pathUSD/);
  const strip = html(createElement(PilotRoomFunding, { roomId: "paper-moon", loadedRoom: "paper-moon", creditsAvailable: 30 }));
  const summary = strip.match(/<summary[\s\S]*?<\/summary>/)?.[0] ?? "";
  assert.match(summary, /<span class="fn-badge-name">Solana<\/span>/, "the collapsed strip names its chain");
  assert.match(summary, /<span class="fn-net">Devnet<\/span>/);
  assert.match(summary, /fn-disclosure-chevron/, "and opens with the shared expander's chevron");
  assert.match(strip, /Base[\s\S]*<span class="fn-net">Sepolia<\/span>/);
});

test("the wallet dialog keeps its chain headings and footnote as words and adds the marks beside them", () => {
  const dialog = html(createElement(WalletSignInDialog, { wallets: [
    { id: "meta", name: "MetaMask", chain: "ethereum", provider: { request: async () => [] } },
    { id: "other", name: "Coinbase Wallet", chain: "ethereum", provider: { request: async () => [] } },
  ], busy: false, selected: "", error: "", onSelect: () => {}, onClose: () => {} }));
  assert.match(dialog, /<h3><span class="fn-badge"[^>]*>[\s\S]*?<span class="fn-badge-name">Monad testnet<\/span><\/span><\/h3>/);
  assert.match(dialog, /<h3><span class="fn-badge"[^>]*>[\s\S]*?<span class="fn-badge-name">Solana devnet<\/span><\/span><\/h3>/);
  assert.match(dialog, /Story releases and payouts currently use Monad testnet\. A Solana sign-in keeps its own storyteller account\./);
  assert.equal([...dialog.matchAll(/<button type="button" class="pilot-wallet-choice"/g)].length, 2);
  assert.match(dialog, /<span class="pilot-wallet-name">MetaMask<\/span>/);
  assert.match(dialog, /<span class="pilot-wallet-name">Coinbase Wallet<\/span>/);
});

test("Google and Privy sit on the shared brand tile", () => {
  const google = html(createElement(GoogleButton, { type: "button" }, "Continue with Google"));
  assert.match(google, /<span class="fn-badge-tile"[^>]*aria-hidden="true"[^>]*><img src="\/brands\/google-g\.png"/);
  const privy = html(createElement(PrivyMark));
  assert.match(privy, /class="fn-badge pilot-privy-mark"/);
  assert.match(privy, /<img src="\/brands\/privy-symbol-black\.svg"/);
  assert.match(privy, /<span class="fn-badge-name">Privy<\/span>/);
});

test("the room theme is known on first render and sits on a wrapper that holds the header and the guide", () => {
  const source = read("src/components/shared-pilot.tsx");
  assert.match(source, /const \[linkedRoom\] = useState\(\(\) => typeof window === "undefined" \? null : new URLSearchParams\(window\.location\.search\)\.get\("room"\)\);/);
  assert.match(source, /const theme = roomTheme\(roomId \|\| linkedRoom\);/);
  const wrapper = source.indexOf('<div className="pilot-room-page" data-room-theme={theme}>');
  assert.ok(wrapper > 0, "the wrapper carries the theme");
  assert.ok(wrapper < source.indexOf("<AppHeader current=\"rooms\" guide={roomId ?"), "the header sits inside it");
  assert.ok(source.indexOf("<AppHeader current=\"rooms\" guide={roomId ?") < source.indexOf('<main className="pilot-shell" id="shared-story" data-room-theme={theme}'), "and so does the main region");
  assert.doesNotMatch(source, /roomId === KESSLER_ROOM_ID \? "neon"/, "the skin no longer waits for the room id to resolve from the network");
});

test("one context slot sits between the title and the roster, for every room", () => {
  const source = read("src/components/shared-pilot.tsx");
  const slot = source.indexOf('<div className="pilot-context">');
  assert.ok(slot > source.indexOf('<div className="pilot-intro">'));
  assert.ok(slot < source.indexOf('<section className="pilot-room-sign"'));
  const context = source.slice(slot, source.indexOf('<section className="pilot-room-sign"'));
  assert.match(context, /<KesslerRoomGuide/);
  assert.match(context, /<PilotRoomFunding/);
  assert.equal(source.split("<PilotRoomFunding").length - 1, 1, "Other rooms retain their one funding view");
  assert.doesNotMatch(source, /pilot-network-details/);
});

test("the shared-room styles keep the phone toolbar, the release card and the theme contract honest", () => {
  const pilot = read("src/app/pilot/pilot.css");
  const rooms = read("src/app/pilot/rooms.css");
  const releases = read("src/app/pilot/releases.css");
  // The room name used to truncate because desktop order and flex rules out-ranked the phone ones.
  assert.doesNotMatch(pilot, /\.pilot-room-toolbar \.pilot-room-choice \{ (?:flex: 1 1 200px|order: 0)/);
  assert.match(pilot, /\.pilot-room-toolbar \.pilot-room-choice \{ order: 3; flex-basis: 100%; \}/);
  // The release card is the shared info card: a hairline, the card radius, no glow or gradient.
  assert.match(releases, /\.pilot-release-card \{[^}]*border: 1px solid var\(--line\); background: var\(--surface\); border-radius: var\(--radius-xl\);/);
  assert.doesNotMatch(releases, /gradient|rgba\(109, 53, 212/);
  assert.match(releases, /\.pilot-release-progress \{[^}]*background: var\(--line\)/, "the progress track is visible on the card");
  // Selection and focus come from the theme contract; fields use the 3:1 control border.
  assert.match(pilot, /::selection[^{]*\{\s*background: var\(--selection\)/);
  assert.match(pilot, /:focus-visible[^{]*\{\s*outline: 3px solid var\(--focus-ring\)/);
  assert.match(rooms, /\.pilot-create-label input[^{]*\{[^}]*border: 1px solid var\(--edge\)/);
  // The light literals that broke in neon are tokens now; the sticky paper is the one named constant.
  for (const literal of ["#cfc6ce", "#c3b4ed", "#e2d6ff", "#fff0cd", "#fff0a6", "#fff0b5", "#f7f4ff", "#61558b", "#e7dfff", "#862536", "#fde5dc", "#b6acbe"])
    for (const css of [pilot, rooms, releases, read("src/app/pilot/composer.css")]) assert.ok(!css.includes(literal), `${literal} should be a token`);
  assert.match(pilot, /--note: #fff0ac;/);
  const roomRules = rooms.replace(/\.pilot-directory-page \{[^}]*\}/, "");
  assert.doesNotMatch(roomRules, /#[0-9a-fA-F]{3,8}\b/, "room rules use tokens; the directory palette defines its own colours");
});
