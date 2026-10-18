import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tsImport } from "tsx/esm/api";

/** React 19 emits image preload hints ahead of static markup; they are not part of the page. */
const markup = (element: unknown) => renderToStaticMarkup(element as never).replace(/<link rel="preload"[^>]*\/>/g, "");

// The /hunyuan article's walkthrough: Wenjie's YouTube video, embedded with YouTube's privacy-enhanced player.
const { HunyuanArticle } = await tsImport("../../src/components/hunyuan/hunyuan-article.tsx", import.meta.url);
const { COPY, DEMO_YOUTUBE, LANGS, langFrom } = await tsImport("../../src/components/hunyuan/copy.tsx", import.meta.url);

test("the walkthrough plays from YouTube, titled in the reader's language, with its own referrer policy", () => {
  assert.deepEqual(DEMO_YOUTUBE, { id: "mvQY0h9BfZo", href: "https://youtu.be/mvQY0h9BfZo" });
  const html = markup(React.createElement(HunyuanArticle, { hasVideo: false }));
  assert.match(html, /<iframe src="https:\/\/www.youtube-nocookie.com\/embed\/mvQY0h9BfZo\?rel=0"/);
  assert.ok(html.includes(`title="${COPY.en.videoLabel}"`), "English title on first render");
  // The page's metadata sends no referrer; without its own policy YouTube's player refuses to load.
  assert.match(html, /referrerPolicy="strict-origin-when-cross-origin"/i);
  assert.doesNotMatch(html, /hy-video-placeholder/, "no 'coming soon' frame once the video exists");
});

test("a ?lang=zh link is rendered in Chinese on the server, so it never paints English first", () => {
  for (const [value, lang] of [["zh", "zh"], [["zh", "en"], "zh"], ["en", "en"], ["fr", "en"], [undefined, "en"]] as const)
    assert.equal(langFrom(value), lang, `?lang=${value}`);
  const html = markup(React.createElement(HunyuanArticle, { hasVideo: false, initialLang: "zh" }));
  assert.match(html, /^<div class="hy-page" lang="zh-CN">/);
  assert.ok(html.includes(`<h1><span>${COPY.zh.title[0]}</span>`), "the Chinese headline");
  assert.ok(!html.includes(COPY.en.title[0]), "no English headline");
  assert.match(html, /<button type="button" lang="zh-CN" aria-pressed="true">中文<\/button>/);
  assert.ok(html.includes(`title="${COPY.zh.videoLabel}"`), "the same walkthrough, titled in Chinese");
  assert.match(html, /<iframe src="https:\/\/www.youtube-nocookie.com\/embed\/mvQY0h9BfZo\?rel=0"/);
  // The root layout renders <html lang="en">; a zh request corrects it before the first paint, with a constant script.
  const zh = LANGS.find((item: { id: string }) => item.id === "zh");
  assert.ok(html.includes(`<script>document.documentElement.lang="${zh.htmlLang}"</script>`), "the document language is Chinese before paint");
  const en = markup(React.createElement(HunyuanArticle, { hasVideo: false, initialLang: "en" }));
  assert.doesNotMatch(en, /<script/, "an English request needs no script");
  // The page reads ?lang on the server and hands it over; nothing pins it to a static, English-only render.
  const page = readFileSync(new URL("../../src/app/hunyuan/page.tsx", import.meta.url), "utf8");
  assert.match(page, /initialLang=\{langFrom\(\(await searchParams\)\.lang\)\}/);
  assert.doesNotMatch(page, /force-static|generateStaticParams/);
});

test("the skip link, the site header and main are siblings, in both languages", () => {
  for (const lang of ["en", "zh"] as const) {
    const html = markup(React.createElement(HunyuanArticle, { hasVideo: false, initialLang: lang }));
    const boot = lang === "zh" ? `<script>document.documentElement.lang="zh-CN"</script>` : "";
    assert.ok(html.startsWith(`<div class="hy-page" lang="${lang === "zh" ? "zh-CN" : "en"}">${boot}<a class="hy-skip" href="#hy-main">${COPY[lang].skip}</a><header class="hy-header">`), lang);
    assert.ok(html.includes(`</header><main id="hy-main"><article>`), `${lang}: the header is outside main`);
    assert.ok(html.endsWith("</article></main></div>"), lang);
    assert.equal(html.match(/<main/g)?.length, 1, `${lang}: one main`);
  }
});
