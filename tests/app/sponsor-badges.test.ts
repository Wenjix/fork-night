import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tsImport } from "tsx/esm/api";
import { ARTICLE } from "../../src/lib/kimi-article.ts";

// The sponsor articles and the waitlist pages draw tool names as badges and share the wordmark and the night
// palette. The words never change: only the shape of the names does.
const { KimiArticle } = await tsImport("../../src/components/kimi/kimi-article.tsx", import.meta.url);
const { HunyuanArticle } = await tsImport("../../src/components/hunyuan/hunyuan-article.tsx", import.meta.url);
const { COPY } = await tsImport("../../src/components/hunyuan/copy.tsx", import.meta.url);
const { ArticleLinks } = await tsImport("../../src/components/kimi/article-links.tsx", import.meta.url);

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
/** The words only: no tags, no badge monograms, no spacing, so reflowing a line into badges cannot hide a changed word. */
const words = (markup: string) => markup.replace(/<span class="fn-badge-tile"[\s\S]*?<\/span>/g, "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, "");
const kimi = renderToStaticMarkup(React.createElement(KimiArticle));

test("Kimi's byline and flow steps draw the tool names as badges and keep every word, in both languages", () => {
  const [, en, zh] = kimi.split(/<article class="km-article km-locale"/);
  for (const [locale, article] of [["en", en], ["zh", zh]] as const) {
    const copy = ARTICLE[locale];
    const credit = /<span class="km-byline-credit">([\s\S]*?)<\/span><span>Fork Night/.exec(article)?.[1] ?? "";
    assert.equal(words(credit), words(copy.hero.eyebrow), `${locale} byline words`);
    assert.match(credit, /<span class="fn-badge-name">Kimi <\/span><span class="fn-badge-version">K3<\/span>/, "Kimi's logotype, with its version beside it");
    assert.match(credit, /<span class="fn-badge-name">TokenRouter<\/span>/);
    const actors = [...article.matchAll(/<p class="km-step-actor">([\s\S]*?)<\/p>/g)].map((match) => match[1]);
    assert.deepEqual(actors.map(words), copy.flow.steps.map((step) => words(step.actor)), `${locale} flow-step actors`);
    assert.ok(actors.some((actor) => actor.includes('<span class="fn-badge-name">Privy</span>')), `${locale}: Privy is a badge`);
  }
});

test("Kimi's nav marks its own page by name, without a tile or the Night Watch moon", () => {
  const nav = /<nav class="km-nav"[\s\S]*?<\/nav>/.exec(kimi)?.[0] ?? "";
  assert.match(nav, /<a href="\/kimi" aria-current="page"><span class="km-locale"/);
  assert.doesNotMatch(nav, /<svg|fn-badge/);
});

test("both articles end with a strip that links to the payment and wallet pages and to no other model", () => {
  const strips = [...kimi.matchAll(/<ul class="fn-badges km-more" aria-label="([^"]+)">([\s\S]*?)<\/ul>/g)];
  assert.equal(strips.length, 2, "one strip in each language's article");
  for (const [, label, items] of strips) {
    assert.equal(label, "Tempo · Privy");
    assert.deepEqual([...items.matchAll(/href="([^"]+)"/g)].map((match) => match[1]), ["/tempo", "/night-watch-privy"]);
  }
  // The Hunyuan page hands the strip in, so the article renders without it and the page-level markup stays as pinned.
  const closing = React.createElement(ArticleLinks, { className: "hy-more" });
  const html = renderToStaticMarkup(React.createElement(HunyuanArticle, { hasVideo: false, closing })).replace(/<link rel="preload"[^>]*\/>/g, "");
  const strip = /<ul class="fn-badges hy-more" aria-label="([^"]+)">([\s\S]*?)<\/ul>/.exec(html)!;
  assert.equal(strip[1], "Tempo · Privy");
  assert.deepEqual([...strip[2].matchAll(/href="([^"]+)"/g)].map((match) => match[1]), ["/tempo", "/night-watch-privy"]);
  assert.ok(html.endsWith("</ul></article></main></div>"), "the strip is the article's last element");
  // The Kimi article's own rule: no other model is named, in the markup as well as in the source files.
  assert.doesNotMatch(kimi, new RegExp(["hun" + "yuan", "ten" + "cent"].join("|"), "i"), "/kimi renders no other model's name");
});

test("Hunyuan's byline, restyle tag and tool chips keep the words; each step's label sits beside its title", () => {
  for (const lang of ["en", "zh"] as const) {
    const html = renderToStaticMarkup(React.createElement(HunyuanArticle, { hasVideo: false, initialLang: lang }));
    const byline = /<p class="hy-byline">([\s\S]*?)<\/p>/.exec(html)![1];
    assert.equal(words(byline), lang === "en" ? "AsponsorspotlightonTencentHunyuan,usedthroughGMICloud" : "赞助商专题：通过GMICloud使用腾讯混元");
    assert.match(byline, /<span class="fn-badge-name">GMI Cloud<\/span>/);
    // The step number is a chip in the heading row, never a kicker above the title.
    COPY[lang].flow.forEach(({ title }: { title: string }, index: number) => {
      assert.ok(html.includes(`<span class="fn-badge-name">${COPY[lang].step(index + 1)}</span></span><h3>${title}</h3>`), `${lang} step ${index + 1}`);
    });
    assert.doesNotMatch(html, /hy-flow-number/);
    // Each use names its tools in its text; the chips repeat those names and add none.
    const tools = [...html.matchAll(/<ul class="fn-badges hy-use-tools" aria-label="([^"]+)">/g)].map((match) => match[1]);
    assert.deepEqual(tools, lang === "en" ? ["Hunyuan Image 3.5", "Wan 3.0 · GMI Cloud", "Hy-Image 3.5 preview"] : ["混元图像 3.5", "Wan 3.0 · GMI Cloud", "Hy-Image 3.5 preview"]);
    assert.ok(html.includes(`<span class="fn-badge-tile"`) && html.includes(`${COPY[lang].restyled}</span>`), "the restyle tag carries the Hunyuan tile");
  }
});

test("the shared wordmark replaces the bespoke ones, and the pages keep their own palette names on the root night tokens", () => {
  for (const [path, mark] of [["src/components/kimi/kimi-article.tsx", /<ForkNightMark href=\{KIMI_HREFS\.home\} \/>/], ["src/components/hunyuan/hunyuan-article.tsx", /<ForkNightMark size="sm" \/>/],
    ["src/app/signup/page.tsx", /<ForkNightMark href="\/demo" aria-label="Fork Night" size="sm" \/>/], ["src/app/demo/page.tsx", /<ForkNightMark href="\/demo" aria-label="Fork Night" size="sm" \/>/]] as const) {
    assert.match(read(path), mark, path);
  }
  for (const path of ["src/app/kimi/kimi.css", "src/app/hunyuan/hunyuan.css", "src/app/signup/signup.css"]) assert.doesNotMatch(read(path), /\.(?:km|hy|signup)-brand\b/, `${path} still styles a bespoke wordmark`);
  assert.match(read("src/app/kimi/kimi.css"), /--km-night: var\(--night\);[\s\S]*--km-moon: var\(--night-yellow\);/);
  assert.match(read("src/app/hunyuan/hunyuan.css"), /--hy-night: var\(--night\);[\s\S]*--hy-yellow: var\(--night-yellow\);/);
  assert.match(read("src/app/world-demo/world-demo.css"), /--wd-night: var\(--night\);[\s\S]*--wd-yellow: var\(--night-yellow\);/);
  assert.match(read("src/app/signup/signup.css"), /--signup-night: var\(--night, #10162e\);/);
});

test("the hosted waitlist export ships signup.css alone, so every root token it uses carries a fallback", () => {
  const css = read("src/app/signup/signup.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const bare = [...css.matchAll(/var\((--[\w-]+)\s*([,)])/g)].filter(([, name, end]) => end === ")" && !name.startsWith("--signup-") && !name.startsWith("--font-")).map(([, name]) => name);
  assert.deepEqual(bare, [], "a root token without a fallback would render unstyled outside the app");
});

test("both language toggles mark the chosen language yellow on navy", () => {
  assert.match(read("src/app/hunyuan/hunyuan.css"), /\.hy-lang button\[aria-pressed="true"\] \{ background: var\(--hy-yellow\); color: var\(--ink-on-yellow\); \}/);
  assert.match(read("src/app/kimi/kimi.css"), /\.km-toggle \{ --km-kimi: var\(--night-yellow\); --km-kimi-ink: var\(--ink-on-yellow\);/);
});
