import assert from "node:assert/strict";
import test from "node:test";
import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tsImport } from "tsx/esm/api";
import { parseSocialRoute } from "../../src/social/navigation.ts";

const { AppHeader } = await tsImport("../../src/components/app-header.tsx", import.meta.url);
const { AgentRoomHeader } = await tsImport("../../src/components/agents/agent-room-header.tsx", import.meta.url);

function anchors(node: ReactNode): ReactElement<Record<string, any>>[] {
  return Children.toArray(node).flatMap(child => {
    if (!isValidElement<Record<string, any>>(child)) return [];
    return [...(child.type === "a" ? [child] : []), ...anchors(child.props.children)];
  });
}
const hrefs = ["/", "/pilot", "/#/spaces", "/#/desk", "/agents"];

test("every main destination exposes the same routes in the same order and one current destination", () => {
  for (const [index, current] of ["lobby", "rooms", "spaces", "desk", "agents"].entries()) {
    const html = renderToStaticMarkup(createElement(AppHeader, { current }));
    const nav = html.match(/<nav[^>]+aria-label="Main navigation"[^>]*>([\s\S]*?)<\/nav>/)![1];
    assert.deepEqual([...nav.matchAll(/href="([^"]+)"/g)].map(match => match[1]), hrefs);
    const active = nav.match(/<a[^>]*aria-current="page"[^>]*>/g) ?? [];
    assert.equal(active.length, 1);
    assert.ok(active[0].includes(`href="${hrefs[index]}"`));
  }
  assert.equal(parseSocialRoute(new URL(hrefs[2], "https://example.invalid").hash).kind, "spaces");
  assert.equal(parseSocialRoute(new URL(hrefs[3], "https://example.invalid").hash).kind, "desk");
});

test("ordinary local navigation uses the existing workspace router, including its leave guard", () => {
  const calls: string[] = [];
  const header = AppHeader({ current: "desk", onLocalNavigate: (route: { kind: string }) => { calls.push(route.kind); } });
  for (const link of anchors(header).filter(link => ["/", "/#/spaces", "/#/desk"].includes(link.props.href))) {
    let prevented = false;
    link.props.onClick({ button: 0, preventDefault() { prevented = true; } });
    assert.equal(prevented, true, "the existing router decides whether the desk can be left");
  }
  assert.deepEqual(calls, ["lobby", "lobby", "spaces", "desk"]);
});

test("cross-page, modified and non-primary clicks retain native link and beforeunload behavior", () => {
  const header = AppHeader({ current: "lobby", onLocalNavigate: () => assert.fail("must not intercept") });
  for (const link of anchors(header)) {
    const events = [{ button: 0, metaKey: true }, { button: 0, ctrlKey: true }, { button: 0, shiftKey: true }, { button: 0, altKey: true }, { button: 1 }, { button: 0, defaultPrevented: true }];
    if (["/pilot", "/agents"].includes(link.props.href)) events.push({ button: 0 });
    for (const event of events) link.props.onClick({ ...event, preventDefault: () => assert.fail("native navigation must survive") });
  }
  for (const link of anchors(AppHeader({ current: "rooms" }))) link.props.onClick({ button: 0, preventDefault: () => assert.fail("no local router on this page") });
});

test("agent spaces keep the product exits and identify the current tool within their own navigation", () => {
  for (const [current, href] of [["agents", "/agents"], ["night-watch", "/night-watch"], ["creator", "/creator-demo"], ["privy", "/night-watch-privy"], ["tempo", "/tempo"]]) {
    const html = renderToStaticMarkup(createElement(AgentRoomHeader, { current }));
    assert.match(html, /<details class="fn-agent-spaces">/);
    assert.doesNotMatch(html, /<details[^>]+open/);
    const nav = html.match(/<nav[^>]+aria-label="Agent spaces"[^>]*>([\s\S]*?)<\/nav>/)![1];
    assert.deepEqual([...nav.matchAll(/href="([^"]+)"/g)].map(match => match[1]), ["/agents", "/night-watch", "/creator-demo", "/night-watch-privy", "/tempo"]);
    assert.equal((nav.match(/aria-current="page"/g) ?? []).length, 1);
    assert.match(nav, new RegExp(`href="${href}" aria-current="page"`));
    assert.ok(html.includes('href="/pilot"'));
    assert.ok(html.includes('href="/#/desk"'));
  }
});



test("both entry components expose the shared first-night invitation while data loads", async () => {
  const { PilotEntrance } = await tsImport("../../src/components/pilot-entrance.tsx", import.meta.url);
  const html = renderToStaticMarkup(createElement(PilotEntrance, { creating: false, navigate: () => undefined }));
  assert.match(html, /aria-label="Main navigation"/);
  assert.match(html, /id="shared-directory"[^>]*aria-busy="true"/);
  assert.match(html, /Opening the shared stories/);
  assert.doesNotMatch(html, /No stories in the directory yet/);
  assert.match(html, /public stories, private previews/);
  assert.match(html, /Every story starts somewhere/);
  assert.match(html, /Finding the opening/);
  assert.match(html, /Join a story/);
  assert.match(html, /Make your mark/);
  assert.match(html, /href="\/pilot\?create=1"/);
});

test("shared-room routing resolves the query before showing an invitation or draft", async () => {
  const { PilotExperience } = await tsImport("../../src/components/pilot-experience.tsx", import.meta.url);
  const html = renderToStaticMarkup(createElement(PilotExperience));
  assert.match(html, /Opening the rooms/);
  assert.match(html, /aria-label="Main navigation"/);
  assert.match(html, /data-compact="true"/);
  assert.doesNotMatch(html, /fn-first-invitation|Continue this story|Create a room/);
});
