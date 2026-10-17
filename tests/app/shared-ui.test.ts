import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Sparkles } from "lucide-react";
import { tsImport } from "tsx/esm/api";

const { Disclosure } = await tsImport("../../src/components/disclosure.tsx", import.meta.url);
const { ForkNightMark } = await tsImport("../../src/components/fork-night-mark.tsx", import.meta.url);
const { SectionPlate } = await tsImport("../../src/components/visual-plates.tsx", import.meta.url);
const { BRANDS } = await tsImport("../../src/lib/brands.ts", import.meta.url);
const { NETWORK_BRANDS } = await tsImport("../../src/lib/room-networks.ts", import.meta.url);
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const html = (element: unknown) => renderToStaticMarkup(element as never);

test("a disclosure is a native details element with one chevron and a 44px summary", () => {
  const closed = html(createElement(Disclosure, { summary: "Terms, wallets and release record" }, "Body"));
  assert.match(closed, /^<details class="fn-disclosure"><summary class="fn-disclosure-summary"><svg[^>]*aria-hidden="true"/);
  assert.match(closed, /<span>Terms, wallets and release record<\/span>/);
  assert.doesNotMatch(closed, /<details[^>]* open/);
  assert.match(html(createElement(Disclosure, { summary: "Open by default", defaultOpen: true }, "Body")), /<details[^>]* open=""/);
  const css = read("src/app/disclosure.css");
  assert.match(css, /min-height: var\(--control-h\)/);
  assert.match(css, /\.fn-disclosure\[open\] > \.fn-disclosure-summary \.fn-disclosure-chevron/);
  assert.match(css, /prefers-reduced-motion/);
});

test("the wordmark links to the lobby, hides its glyph from assistive tech, and has a paper tone", () => {
  const mark = html(createElement(ForkNightMark));
  assert.match(mark, /^<a aria-label="Fork Night, return to the lobby" class="fn-mark" href="\/" data-size="md" data-tone="night">Fork Night<svg aria-hidden="true"/);
  assert.match(html(createElement(ForkNightMark, { size: "sm", tone: "paper", href: "/pilot" })), /href="\/pilot" data-size="sm" data-tone="paper"/);
  const css = read("src/app/navigation.css");
  assert.match(css, /\.fn-mark\[data-tone="paper"\] \{ color: var\(--ink\); \}/);
});

test("a section plate keeps its card by default and can be an inline heading row inside a panel", () => {
  const plate = html(createElement(SectionPlate, { title: "Story so far", icon: Sparkles }));
  assert.match(plate, /data-variant="plate"/);
  const inline = html(createElement(SectionPlate, { title: "Story so far", icon: Sparkles, variant: "inline" }));
  assert.match(inline, /data-variant="inline"/);
  assert.match(read("src/app/visual-plates.css"), /\.fn-section-plate\[data-variant="inline"\] \{[^}]*padding: 0;[^}]*border: 0;/s);
});

test("the root defines the night palette, the shape, type and space scales, and the theme contract", () => {
  const css = read("src/app/globals.css");
  for (const token of ["--night", "--night-panel", "--night-raised", "--night-line", "--night-ink", "--night-muted", "--night-yellow", "--ink-on-yellow", "--agent",
    "--radius-xs", "--radius-md", "--radius-xl", "--radius-pill", "--radius-plate", "--shadow-rest", "--shadow-overlay",
    "--text-xs", "--text-base", "--text-card", "--text-section", "--text-page", "--leading-body", "--space-1", "--space-8", "--gutter", "--control-h",
    "--dur-fast", "--ease-out", "--z-skip", "--icon-md", "--font-hand"]) {
    assert.match(css, new RegExp(`\\n  ${token}:`), `${token} is missing from :root`);
  }
  assert.match(css, /--text-xs: 12px;/, "12px is the text floor");
  assert.match(css, /@media \(max-width: 760px\) \{\s*:root \{\s*--gutter: 16px;/);
  // The contract names resolve per element, so a theme that remaps --violet or --yellow reaches them without a patch.
  const contract = css.match(/:root,\s*\[data-room-theme\] \{([^}]*)\}/)?.[1] ?? "";
  for (const token of ["--accent", "--accent-strong", "--accent-soft", "--accent-fill", "--on-accent", "--signal", "--on-signal", "--signal-soft", "--danger-fill", "--edge", "--selection", "--focus-ring"]) {
    assert.match(contract, new RegExp(`${token}:`), `${token} is missing from the theme contract`);
  }
  assert.match(css, /\.sr-only \{/);
});

test("the browser chrome takes the header's navy, and NETWORK_BRANDS is a view of the brand registry", () => {
  assert.match(read("src/app/layout.tsx"), /export const viewport: Viewport = \{ themeColor: "#10152f" \}/);
  for (const id of ["monad", "solana", "base", "tempo"] as const) {
    assert.equal(NETWORK_BRANDS[id].name, BRANDS[id].name);
    assert.equal(NETWORK_BRANDS[id].mark, BRANDS[id].mark);
    assert.equal(NETWORK_BRANDS[id].testnet, BRANDS[id].net);
  }
});
