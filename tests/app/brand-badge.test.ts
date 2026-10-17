import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tsImport } from "tsx/esm/api";

const { BRANDS } = await tsImport("../../src/lib/brands.ts", import.meta.url);
const { BrandBadge, BrandStrip, Chip } = await tsImport("../../src/components/brand-badge.tsx", import.meta.url);
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
  assert.match(html(createElement(BrandBadge, { brand: "kimi" })), /data-mono="true"[^>]*aria-hidden="true"[^>]*><b>K<\/b>/);
  assert.match(html(createElement(BrandBadge, { brand: "usdc" })), /data-round="true"/);
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
  for (const brand of ["x402", "mpp", "erc8004"]) {
    const badge = html(createElement(BrandBadge, { brand }));
    assert.match(badge, /data-mono="true"[^>]*aria-hidden="true"[^>]*><svg/, `${brand} should draw a glyph tile`);
    assert.doesNotMatch(badge, /<b>/);
  }
});
