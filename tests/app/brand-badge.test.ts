import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tsImport } from "tsx/esm/api";

const { BRANDS } = await tsImport("../../src/lib/brands.ts", import.meta.url);
const { BrandBadge, BrandStrip, Chip } = await tsImport("../../src/components/brand-badge.tsx", import.meta.url);
const { hasLoaded } = await tsImport("../../src/components/lockup-image.tsx", import.meta.url);
/** React 19 emits image preload hints ahead of static markup; they are not part of the badge. */
const html = (element: unknown) => renderToStaticMarkup(element as never).replace(/<link rel="preload"[^>]*\/>/g, "");

test("every brand has a name and either an official mark that ships in public/ or a short monogram", () => {
  const names = new Set<string>();
  for (const [id, brand] of Object.entries(BRANDS) as [string, { name: string; mark?: string; monogram?: string; kind: string; net?: string }][]) {
    assert.ok(brand.name.trim(), `${id} needs a name`);
    assert.ok(!names.has(brand.name), `${brand.name} is listed twice`);
    names.add(brand.name);
    if (brand.mark) assert.ok(existsSync(new URL(`../../public${brand.mark}`, import.meta.url)), `${id}: ${brand.mark} is missing from public/`);
    if (brand.monogram) assert.ok([...brand.monogram].length <= 2, `${id}: a monogram is one or two characters`);
    if (brand.kind === "chain") assert.ok(brand.net, `${id}: a chain must say which network it is (Testnet, Devnet...)`);
  }
});

test("a chain badge always names its test network and never relies on colour alone", () => {
  const monad = html(createElement(BrandBadge, { brand: "monad", role: "releases" }));
  assert.match(monad, /<span class="fn-badge-name">Monad<\/span>/);
  assert.match(monad, /<span class="fn-badge-role">releases<\/span>/);
  assert.match(monad, /<span class="fn-net">Testnet<\/span>/);
  assert.match(html(createElement(BrandBadge, { brand: "solana" })), /<span class="fn-net">Devnet<\/span>/);
  assert.match(html(createElement(BrandBadge, { brand: "tempo" })), /<span class="fn-net">Moderato testnet<\/span>/);
  assert.doesNotMatch(html(createElement(BrandBadge, { brand: "monad", net: false })), /fn-net/);
  assert.doesNotMatch(html(createElement(BrandBadge, { brand: "privy" })), /fn-net/);
});

test("the tile is decorative: the brand name beside it is the accessible name", () => {
  const privy = html(createElement(BrandBadge, { brand: "privy" }));
  assert.match(privy, /<span class="fn-badge-tile"[^>]*aria-hidden="true"/);
  assert.match(privy, /<img src="\/brands\/privy-symbol-black\.svg" alt=""/);
  assert.match(html(createElement(BrandBadge, { brand: "tokenrouter" })), /data-mono="true"[^>]*aria-hidden="true"[^>]*><b>TR<\/b>/, "a brand with no file draws a monogram");
  assert.match(html(createElement(BrandBadge, { brand: "mon" })), /data-round="true"/);
});

test("a receipt badge is a link that says it opens a new tab and carries no network flag", () => {
  const link = html(createElement(BrandBadge, { brand: "tempo", label: "Tempo receipt", href: "https://explore.tempo.xyz/tx/0x1" }));
  assert.match(link, /^<a class="fn-badge"[^>]*href="https:\/\/explore\.tempo\.xyz\/tx\/0x1"[^>]*target="_blank"[^>]*rel="noreferrer"/);
  assert.match(link, /Tempo receipt/);
  assert.match(link, /\(opens in a new tab\)/);
  assert.doesNotMatch(link, /fn-net/);
  const internal = html(createElement(BrandBadge, { brand: "tempo", label: "Wren’s allowance", net: false, href: "/agents#allowance" }));
  assert.doesNotMatch(internal, /target=|opens in a new tab/);
});

test("a strip labels the group and puts every badge in its own list item", () => {
  const strip = html(createElement(BrandStrip, { label: "Monad releases · Privy wallets" },
    createElement(BrandBadge, { brand: "monad" }), createElement(BrandBadge, { brand: "privy" }), createElement(Chip, null, "Shared branching story")));
  assert.match(strip, /^<ul class="fn-badges" aria-label="Monad releases · Privy wallets">/);
  assert.equal([...strip.matchAll(/<li>/g)].length, 3);
  assert.match(strip, /data-kind="feature" data-plain="true"/);
});

test("the badge stylesheet is global, uses the surrounding text colour, and carries no Safari-only properties", () => {
  const css = readFileSync(new URL("../../src/app/brand-badge.css", import.meta.url), "utf8");
  assert.match(readFileSync(new URL("../../src/app/layout.tsx", import.meta.url), "utf8"), /import "\.\/brand-badge\.css"/);
  assert.match(css, /color-mix\(in srgb, currentColor/);
  assert.doesNotMatch(css, /user-select|backdrop-filter/);
});

test("tokens reuse their chain's mark, and protocols without a mark draw a glyph, not letters", () => {
  const mon = html(createElement(BrandBadge, { brand: "mon" }));
  assert.match(mon, /data-round="true"/);
  assert.match(mon, /<img src="\/brands\/networks\/monad\.svg"/);
  assert.doesNotMatch(mon, /fn-net/);
  assert.match(html(createElement(BrandBadge, { brand: "pathusd" })), /<img src="\/brands\/networks\/tempo\.svg"/);
  const erc = html(createElement(BrandBadge, { brand: "erc8004" }));
  assert.match(erc, /data-mono="true"[^>]*aria-hidden="true"[^>]*><svg/, "ERC-8004 has no official mark, so it draws a glyph");
  assert.doesNotMatch(erc, /<b>/);
});

test("official marks from public/brands are wired: square marks fill the tile, wide logotypes sit on their own plate and stand in for the name", () => {
  // Square marks.
  assert.match(html(createElement(BrandBadge, { brand: "metamask" })), /<span class="fn-badge-tile"[^>]*><img src="\/brands\/metamask-fox\.svg" alt=""/);
  for (const [brand, file] of [["phantom", "phantom.svg"], ["hunyuan", "hunyuan.png"]]) {
    const tile = html(createElement(BrandBadge, { brand }));
    assert.match(tile, /data-fit="bleed"/, `${brand}: a filled square is the whole tile`);
    assert.match(tile, new RegExp(`<img src="/brands/${file.replace(".", "\\.")}" alt=""`));
    assert.doesNotMatch(tile, /data-mono|<b>/);
  }
  // Wide logotypes: the plate takes the ground the file was drawn for, the image keeps its own proportions, and the name stays for screen readers.
  const kimi = html(createElement(BrandBadge, { brand: "kimi" }));
  assert.match(kimi, /data-lockup="light"[^>]*style="[^"]*--lockup-ratio:2\.95/);
  assert.match(kimi, /<img src="\/brands\/kimi\.svg" alt="" width="118" height="40" loading="lazy"\/>/, "the large Kimi file loads lazily");
  assert.match(kimi, /<span class="fn-badge-name">Kimi <\/span><span class="fn-badge-version">K3<\/span>/, "its version stays text");
  assert.match(kimi, /<span class="fn-badge" data-size="sm" data-kind="model" data-lockup="true">/);
  assert.doesNotMatch(kimi, /data-bare/, "a chip with a version after the logotype is not bare");
  const x402 = html(createElement(BrandBadge, { brand: "x402" }));
  assert.match(x402, /data-lockup="dark"/, "x402's wordmark has white letters, so it sits on a dark plate");
  assert.match(x402, /data-bare="true"/, "a logotype alone leaves no empty padding after it");
  assert.match(x402, /<span class="fn-badge-name">x402<\/span>/);
  assert.match(html(createElement(BrandBadge, { brand: "mpp", role: "agent payments" })), /data-lockup="light"[\s\S]*<span class="fn-badge-name">MPP<\/span><span class="fn-badge-role">agent payments<\/span>/);
  assert.doesNotMatch(html(createElement(BrandBadge, { brand: "mpp", role: "agent payments" })), /data-bare/);
  // The label can name more than the logotype spells.
  assert.match(html(createElement(BrandBadge, { brand: "mpp", label: "Machine Payments Protocol" })), /<span class="fn-badge-version">Machine Payments Protocol<\/span>/);
  // The CSS gives the plate its shape and hides the spelled-out name.
  const css = readFileSync(new URL("../../src/app/brand-badge.css", import.meta.url), "utf8");
  assert.match(css, /\.fn-badge-tile\[data-lockup="dark"\] \{[^}]*background: #0b1024/);
  assert.match(css, /\.fn-badge\[data-lockup="true"\] > \.fn-badge-name \{[^}]*clip: rect/);
});

test("only the brands with no usable official file keep a monogram or a glyph", () => {
  const plain = Object.entries(BRANDS as Record<string, { mark?: string; monogram?: string }>).filter(([, brand]) => !brand.mark).map(([id]) => id).sort();
  // Squads: public/brands/squads.svg is the safety-zone diagram from the Squads brand page, not the logo. ERC-8004: no official mark exists.
  assert.deepEqual(plain, ["erc8004", "gmi", "squads", "tokenrouter", "wan"]);
});

test("a logotype never leaves its plate empty: the plate spells the name until the image has loaded, and the image stays mounted", () => {
  // Nothing is spelled in the server markup, so a logo that is cached never flashes letters before hydration.
  for (const brand of ["kimi", "mpp", "x402"]) assert.doesNotMatch(html(createElement(BrandBadge, { brand })), /fn-lockup-word/, `${brand}: no letters before the page has hydrated`);
  // What counts as loaded: finished, and with something to show.
  assert.equal(hasLoaded({ complete: true, naturalWidth: 118 }), true);
  assert.equal(hasLoaded({ complete: false, naturalWidth: 0 }), false, "still loading");
  assert.equal(hasLoaded({ complete: true, naturalWidth: 0 }), false, "finished but broken");
  // The component keeps the <img> in the page whatever the state, so a slow file still replaces the letters when it arrives.
  const source = readFileSync(new URL("../../src/components/lockup-image.tsx", import.meta.url), "utf8");
  assert.match(source, /^"use client";/);
  assert.match(source, /<img ref=\{image\}[^>]*onLoad=\{\(\) => setSpelled\(false\)\}[^>]*onError=\{\(\) => setSpelled\(true\)\}/);
  assert.match(source, /\{spelled && <span className="fn-lockup-word">\{word\}<\/span>\}/);
  assert.doesNotMatch(source, /\{[^{}]*\? <img|\{!?\w+ && <img/, "the image is never rendered conditionally");
  // The letters sit inside the plate without changing its size.
  const css = readFileSync(new URL("../../src/app/brand-badge.css", import.meta.url), "utf8");
  assert.match(css, /\.fn-badge-tile\[data-lockup\] \{\s*position: relative;/);
  assert.match(css, /\.fn-lockup-word \{\s*position: absolute;\s*inset: 0;/);
});
