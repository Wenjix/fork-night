import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tsImport } from "tsx/esm/api";

const { FirstNightGuide, firstNightContributionHref } = await tsImport("../../src/components/first-night-guide.tsx", import.meta.url);
const { FirstNightInvitation } = await tsImport("../../src/components/first-night-invitation.tsx", import.meta.url);

test("selecting the result screen cannot fabricate a published contribution", () => {
  const html = renderToStaticMarkup(createElement(FirstNightGuide, { actorId: null, activeStep: 3 }));
  assert.doesNotMatch(html, /Your continuation is part|Your idea is part|See your contribution/);
  assert.match(html, /data-state="current" aria-current="step"[^>]*><a[^>]*>.*Join a story/);
});

test("the first-night guide leads to the shared room without a local sample identity", () => {
  const html = renderToStaticMarkup(createElement(FirstNightGuide, { actorId: null }));
  assert.match(html, /href="\/pilot\?room=kessler-ward&amp;moment=15000000-0000-4000-8000-000000000001"/);
  assert.match(html, /href="\/pilot\?room=kessler-ward&amp;moment=15000000-0000-4000-8000-000000000001&amp;firstNight=1&amp;starter=own"/);
  assert.doesNotMatch(html, /href="#\/project|userId=|sam|priya/);
  assert.match(html, /aria-label="Hide first-night guide"/);
});

test("an invitation waiting for shared data does not promise a ready contribution flow", () => {
  const html = renderToStaticMarkup(createElement(FirstNightInvitation));
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /Finding the opening/);
  assert.doesNotMatch(html, /Continue this story|starter=|Make a private preview/);
});

test("a room can guard the guide read action through its own unfinished-work check", () => {
  const html = renderToStaticMarkup(createElement(FirstNightGuide, { actorId: null, onRead: () => undefined }));
  assert.match(html, /data-state="current" aria-current="step"[^>]*><button[^>]*type="button"[^>]*>.*Join a story/);
  assert.doesNotMatch(html, /href="\/pilot\?room=kessler-ward&amp;moment=15000000-0000-4000-8000-000000000001"/);
});

test("an idea result opens its actual source moment before reaching the idea list", () => {
  const result = firstNightContributionHref("paper-moon", { kind: "idea", id: "idea-id", parentId: "different-moment" });
  assert.equal(result, "/pilot?room=paper-moon&moment=different-moment#pilot-ideas");
  assert.equal(firstNightContributionHref("paper-moon", { kind: "moment", id: "published-moment", parentId: "source-moment" }), "/pilot?room=paper-moon&moment=published-moment");
  assert.equal(firstNightContributionHref("paper-moon", { kind: "idea", id: "legacy-idea" }), "/pilot?room=paper-moon#pilot-ideas");
});
