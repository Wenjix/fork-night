import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tsImport } from "tsx/esm/api";
import { ARTICLE, KIMI_FACTS, KIMI_QUOTES, KIMI_QUOTES_ZH, KIMI_VIDEO, LANG_STORAGE_KEY, fill, type ArticleCopy } from "../../src/lib/kimi-article.ts";

// /kimi: the Kimi K3 sponsor article in English and Simplified Chinese. Its numbers and quotes come from
// the live testnet runs of Oct 13, 2026; these tests pin them, keep both languages in step, and keep the
// page static and within the project's copy rules.
const { KimiArticle, VideoSlot } = await tsImport("../../src/components/kimi/kimi-article.tsx", import.meta.url);

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const FILES = ["src/lib/kimi-article.ts", "src/components/kimi/kimi-article.tsx", "src/components/kimi/language-toggle.tsx", "src/app/kimi/page.tsx", "src/app/kimi/kimi.css"];
const html = renderToStaticMarkup(React.createElement(KimiArticle));
const visibleText = (markup: string) => markup.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");

/** Every string leaf with its path. */
function leaves(value: unknown, path = ""): [string, string][] {
  if (typeof value === "string") return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((item, index) => leaves(item, `${path}[${index}]`));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([key, item]) => leaves(item, path ? `${path}.${key}` : key));
  return [];
}
/** Object keys and array lengths, without the strings. */
function shape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(shape);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shape(item)]));
  return typeof value;
}
/** Numbers in a string ("1,054" counts as 1054), with the locale date placeholder removed. */
const numbers = (text: string) => (text.replaceAll("{date}", "").match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((token) => token.replace(/,(?=\d{3}\b)/g, "")).sort();

test("both languages have the same shape, and every number matches across them", () => {
  assert.deepEqual(shape(ARTICLE.zh), shape(ARTICLE.en), "same keys and list lengths");
  const zh = new Map(leaves(ARTICLE.zh));
  for (const [path, text] of leaves(ARTICLE.en)) {
    if (path === "date") continue;
    assert.deepEqual(numbers(zh.get(path) ?? ""), numbers(text), `numbers differ at ${path}`);
  }
  assert.deepEqual(shape(KIMI_QUOTES_ZH), shape(KIMI_QUOTES), "every quote has a translation");
  const original = new Map(leaves(KIMI_QUOTES));
  for (const [path, text] of leaves(KIMI_QUOTES_ZH)) {
    for (const number of numbers(text)) assert.ok(numbers(original.get(path) ?? "").includes(number), `translation adds ${number} at ${path}`);
  }
});

test("the measured numbers are the ones from the live runs", () => {
  assert.deepEqual(KIMI_FACTS.jobs, {
    desk: { seconds: "3.9", usd: "0.0039", approximate: false },
    night: { seconds: "15.7", usd: "0.0117", approximate: false },
    wren: { seconds: "3.8", usd: "0.0041", approximate: true },
  });
  assert.equal(KIMI_FACTS.pick, 1);
  assert.equal(KIMI_FACTS.model.id, "moonshotai/kimi-k3");
  const en = ARTICLE.en;
  assert.match(en.jobs.desk.detail, /22\.1 s and \$0\.0225/);
  assert.match(en.jobs.night.detail, /planning 9\.4 s, self-check 3\.7 s/);
  assert.match(en.jobs.wren.detail, /1,054 input and 241 output tokens, 24 of them reasoning\. At default effort it took 9\.1 s\./);
  assert.deepEqual(en.why.metrics.map((metric) => metric.value), ["22.1 s → 3.9 s", "15.7 s", "About a cent", "12 of 12"]);
  assert.match(en.why.metrics[3].sub, /The 10 strict-schema calls/);
  assert.match(en.why.reasons[1].body, /All 12 Kimi K3 calls .*3 probes, 3 overnight plans, 2 plan checks, 2 desk co-pilot answers and 2 Wren plans/);
  assert.match(en.why.reasons[2].body, /it checked a plan in 3\.7 s/);
  assert.match(en.honest.items[3], /\$1\.80 per million input tokens, \$9\.00 per million output tokens and \$0\.18 per million cached input tokens, 40% off the \$3\.00 \/ \$15\.00 list/);
  assert.match(en.safe.items[4], /12 answers per maker per hour/);
});

test("Kimi's words are quoted verbatim", () => {
  assert.equal(KIMI_QUOTES.night.morningNote, "Quiet night. All three paths stayed gentle and wordless. I'd show the maker candidate 1 first: the second lighthouse answering from across the still sea, exactly the beat the brief asked for. 2 and 3 travel further ahead — warm arrivals to keep in the drawer for next time.");
  assert.equal(KIMI_QUOTES.night.takes[1].check, "Lovely welcoming beam, but it stages the arrival the brief saves for later.");
  assert.equal(KIMI_QUOTES.copilot.read, "Mira and the Dokkaebi are aboard the glowing boat heading into the magical realm — the story needs what they first encounter there.");
  assert.match(KIMI_QUOTES.copilot.suggestions[0].brief, /a kind octopus librarian waves them in with one of its many arms\.$/);
  assert.equal(KIMI_QUOTES.wren.title, "A light to guide her home");
  assert.equal(KIMI_QUOTES.wren.captions.length, 2);
  assert.equal(KIMI_QUOTES.night.takes.length, 3);
  assert.equal(KIMI_QUOTES.copilot.suggestions.length, 3);
});

test("the copy keeps the project's rules in both languages, and names no other model", () => {
  const en = leaves(ARTICLE.en).map(([, text]) => text).join("\n");
  const zh = leaves(ARTICLE.zh).map(([, text]) => text).join("\n") + leaves(KIMI_QUOTES_ZH).map(([, text]) => text).join("\n");
  for (const phrase of [/real money/i, /\bmainnet\b/i, /\baudited\b/i, /funded credits/i, /patron paid/i]) {
    assert.doesNotMatch(en, phrase);
    for (const path of FILES) assert.doesNotMatch(read(path), phrase, path);
  }
  for (const phrase of [/真钱|真实资金|真金白银/, /主网/, /审计/, /注资/]) assert.doesNotMatch(zh, phrase);
  // This article is about Kimi K3 alone: no other model, comparison or rival timing. The names are built
  // from fragments so a repository search for them stays empty while the guard still holds.
  const others = new RegExp(["ten" + "cent", "hun" + "yuan", "\\bh" + "y[34]\\b", "gpt-" + "4\\.1"].join("|"), "i");
  for (const path of FILES) assert.doesNotMatch(read(path), others, `${path} names another model`);
  assert.doesNotMatch(en + zh, others);
  // Kimi plans and checks; it never draws, publishes or spends.
  assert.doesNotMatch(en, /Kimi(?: K3)? (?:draws|publishes|spends)/);
  assert.doesNotMatch(zh, /Kimi(?: K3)?\s*(?:作画|发布|花钱)/);
  assert.match(ARTICLE.en.honest.items[0], /operator-paid inference/);
  assert.match(ARTICLE.zh.honest.items[0], /运营方承担的推理费用/);
  assert.match(ARTICLE.zh.honest.items[0], /测试网/);
  assert.match(ARTICLE.en.jobs.intro, /Kimi K3 \(by Moonshot AI\) via TokenRouter/);
  assert.match(ARTICLE.zh.hero.title, /Night Watch（夜巡）/, "the Chinese name appears once, at first mention");
});

test("the page is static and safe on the hosted site", () => {
  for (const path of FILES) {
    assert.doesNotMatch(read(path), /process\.env|fetch\(|createClient|supabase/i, path);
  }
  assert.doesNotMatch(read("src/app/kimi/page.tsx"), /searchParams|headers\(|cookies\(/, "nothing makes the route dynamic");
  assert.deepEqual(KIMI_VIDEO, { kind: "youtube", id: "KOdXT0_DNQI", href: "https://youtu.be/KOdXT0_DNQI" }, "the walkthrough is Wenjie's YouTube video");
});

test("both languages render; English is the server default; ?lang=zh selects Chinese before paint", () => {
  assert.match(html, /<div class="kimi-page" data-lang="en" lang="en">/);
  assert.match(html, /<article class="km-article km-locale" data-locale="en" lang="en"[^>]*>[\s\S]*<h1 id="km-en-title">Kimi K3 is the Night Watch’s brain<\/h1>/);
  assert.match(html, /<article class="km-article km-locale" data-locale="zh" lang="zh-Hans"[^>]*>[\s\S]*<h1 id="km-zh-title">Kimi K3 是 Night Watch（夜巡）的大脑<\/h1>/);
  for (const heading of ["一个模型，三项工作", "Kimi K3 的一个夜晚", "Kimi 实际写了什么", "为什么选 Kimi K3", "安全兜底的设计", "如实说明"]) assert.ok(html.includes(`>${heading}</h2>`), heading);
  assert.ok(html.split(`>${fill(ARTICLE.en.wrote.live, ARTICLE.en)}<`).length - 1 >= 3, "each live output is labelled");
  // In Chinese the translation reads first; Kimi's English original follows, labelled, as evidence.
  assert.ok(html.includes('<p class="km-original" lang="en"><span class="km-original-label" lang="zh-Hans">原文</span>'), "the English original stays on the Chinese page, labelled");
  const zhArticle = html.indexOf('<article class="km-article km-locale" data-locale="zh"');
  assert.ok(zhArticle > 0 && html.indexOf("从飞行的纸船上", zhArticle) < html.indexOf("From the flying paper boat, Mira and the Dokkaebi spot", zhArticle), "the translation reads before the original");
  assert.equal(html.split('class="km-toggle').length - 1, 1, "one language switch on the page (the header's)");
  assert.ok(html.includes('aria-pressed="true"') && html.includes(">中文</button>"), "the toggle renders");
  assert.match(html, /role="status" aria-live="polite"/);
  // CSS shows one language at a time, by the root's data-lang.
  const css = read("src/app/kimi/kimi.css");
  assert.match(css, /\.kimi-page\[data-lang="zh"\] \.km-locale\[data-locale="en"\]/);
  assert.match(css, /\.kimi-page\[data-lang="en"\] \.km-locale\[data-locale="zh"\]/);
  // Run the boot script against a stub page: ?lang=zh wins over a remembered "en".
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
  assert.ok(script.includes(LANG_STORAGE_KEY));
  const run = (search: string, stored: string | null, throwing = false) => {
    const attributes: Record<string, string> = {};
    const root = { setAttribute: (name: string, value: string) => (attributes[name] = value) };
    const window = {
      location: { search },
      localStorage: { getItem: () => { if (throwing) throw new Error("blocked"); return stored; } },
    };
    new Function("document", "window", "URLSearchParams", script)({ currentScript: { parentElement: root } }, window, URLSearchParams);
    return attributes;
  };
  assert.deepEqual(run("?lang=zh", "en"), { "data-lang": "zh", lang: "zh-Hans" });
  assert.deepEqual(run("", "zh"), { "data-lang": "zh", lang: "zh-Hans" });
  assert.deepEqual(run("?lang=fr", null), { "data-lang": "en", lang: "en" });
  assert.deepEqual(run("?lang=zh", null, true), { "data-lang": "zh", lang: "zh-Hans" }, "blocked storage still honours the link");
});

test("the video slot: an empty frame now, a player or a link once the walkthrough exists", () => {
  const en: ArticleCopy = ARTICLE.en;
  const empty = renderToStaticMarkup(React.createElement(VideoSlot, { video: null, copy: en }));
  assert.match(empty, /role="img" aria-label="The walkthrough video goes here"/);
  const file = renderToStaticMarkup(React.createElement(VideoSlot, { video: { kind: "file", src: "/kimi/walkthrough.mp4", poster: "/kimi/poster.webp" }, copy: en }));
  assert.match(file, /<video class="km-video-media" controls="" preload="metadata" playsInline="" poster="\/kimi\/poster.webp"><source src="\/kimi\/walkthrough.mp4"\/><\/video>/);
  const youtube = renderToStaticMarkup(React.createElement(VideoSlot, { video: { kind: "youtube", id: "KOdXT0_DNQI", href: "https://youtu.be/KOdXT0_DNQI" }, copy: en }));
  assert.match(youtube, /<iframe class="km-video-media" src="https:\/\/www.youtube-nocookie.com\/embed\/KOdXT0_DNQI\?rel=0" title="Watch the walkthrough"/);
  assert.match(youtube, /referrerPolicy="strict-origin-when-cross-origin"|referrerpolicy="strict-origin-when-cross-origin"/i, "YouTube's player needs a referrer");
  assert.match(youtube, /href="https:\/\/youtu.be\/KOdXT0_DNQI"/, "a plain link stays for anyone who prefers YouTube itself");
  const zhCopy = ARTICLE.zh;
  assert.match(renderToStaticMarkup(React.createElement(VideoSlot, { video: KIMI_VIDEO, copy: zhCopy })), /title="观看演示视频"/);
  const link = renderToStaticMarkup(React.createElement(VideoSlot, { video: { kind: "link", href: "https://example.com/watch", label: "Watch the walkthrough" }, copy: en }));
  assert.match(link, /<a class="km-video-frame km-video-link" href="https:\/\/example.com\/watch" target="_blank" rel="noreferrer">/);
  assert.match(visibleText(link), /Watch the walkthrough/);
});

test("every class in the markup has a rule in kimi.css", () => {
  const css = read("src/app/kimi/kimi.css");
  const classes = new Set([...html.matchAll(/class="([^"]+)"/g)].flatMap((match) => match[1].split(/\s+/)).filter((name) => name.startsWith("km") || name === "kimi-page"));
  for (const extra of ["km-video-media", "km-video-link", "km-video-caption", "km-toggle-compact"]) classes.add(extra);
  for (const name of classes) assert.match(css, new RegExp(`\\.${name}(?![\\w-])`), `${name} has a rule`);
});
