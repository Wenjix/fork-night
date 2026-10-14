import { test } from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tsImport } from "tsx/esm/api";

// The /hunyuan article's walkthrough: Wenjie's YouTube video, embedded with YouTube's privacy-enhanced player.
const { HunyuanArticle } = await tsImport("../../src/components/hunyuan/hunyuan-article.tsx", import.meta.url);
const { COPY, DEMO_YOUTUBE } = await tsImport("../../src/components/hunyuan/copy.tsx", import.meta.url);

test("the walkthrough plays from YouTube, titled in the reader's language, with its own referrer policy", () => {
  assert.deepEqual(DEMO_YOUTUBE, { id: "mvQY0h9BfZo", href: "https://youtu.be/mvQY0h9BfZo" });
  const html = renderToStaticMarkup(React.createElement(HunyuanArticle, { hasVideo: false }));
  assert.match(html, /<iframe src="https:\/\/www.youtube-nocookie.com\/embed\/mvQY0h9BfZo\?rel=0"/);
  assert.ok(html.includes(`title="${COPY.en.videoLabel}"`), "English title on first render");
  // The page's metadata sends no referrer; without its own policy YouTube's player refuses to load.
  assert.match(html, /referrerPolicy="strict-origin-when-cross-origin"/i);
  assert.doesNotMatch(html, /hy-video-placeholder/, "no 'coming soon' frame once the video exists");
});
