import assert from "node:assert/strict";
import { after, test, type TestContext } from "node:test";
import { act, createElement, StrictMode } from "react";
import { JSDOM } from "jsdom";
import { register } from "tsx/esm/api";
import { createClient } from "@supabase/supabase-js";
import { kesslerSeedMoments, KESSLER_BEAT_IDS } from "../../src/lib/kessler-room.ts";
import { visitKey, visitSnapshot } from "../../src/lib/pilot-social.ts";
import type { Database, Tables } from "../../src/lib/supabase/database.types.ts";

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "https://home-fixture.invalid/pilot" });
const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, localStorage: dom.window.localStorage, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true };
const original = Object.fromEntries(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
const loader = register({ namespace: "pilot-room-home-mount" });
const { PilotRoomHome } = await loader.import("../../src/components/pilot-room-home.tsx", import.meta.url);
const { createRoot } = await import("react-dom/client");
after(async () => {
  await loader.unregister(); dom.window.close();
  for (const key of Object.keys(globals)) {
    if (original[key]) Object.defineProperty(globalThis, key, original[key]!); else Reflect.deleteProperty(globalThis, key);
  }
});

const room: Tables<"pilot_rooms"> = { id: "kessler-ward", title: "Kessler Ward", description: "A blackout.", is_open: true, is_listed: true, template_id: null, template_version: null, revision: 0, funding_policy: "closed", owner_id: null };
const story = kesslerSeedMoments();
const wait = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
async function mount(t: TestContext, options: { visit?: boolean; fail?: boolean; joined?: boolean } = {}) {
  localStorage.clear();
  if (options.visit) localStorage.setItem(visitKey(room.id), JSON.stringify(visitSnapshot(story.slice(0, -1), KESSLER_BEAT_IDS["floor-forty"], KESSLER_BEAT_IDS["chain"])));
  const requests: URL[] = [];
  let fail = options.fail;
  const client = createClient<Database>("https://home-fixture.invalid", "fixture", { auth: { persistSession: false, autoRefreshToken: false, storageKey: t.name }, global: { fetch: async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    assert.equal(init?.method ?? "GET", "GET");
    assert.equal(url.pathname, "/rest/v1/pilot_moments");
    requests.push(url);
    return fail ? Response.json({ message: "Fixture request unavailable" }, { status: 400 }) : Response.json(story);
  } } });
  const root = createRoot(document.getElementById("root")!);
  t.after(async () => { await act(async () => root.unmount()); });
  await act(async () => root.render(createElement(StrictMode, {}, createElement(PilotRoomHome, { client, rooms: [room], joined: options.joined ? [room] : [], templates: [], loading: false, unavailable: false }))));
  await wait();
  return { requests, reconnect: () => { fail = false; } };
}

test("a mounted first visit shows visual invitations, working guild and agent links, without fictitious updates", async t => {
  const { requests } = await mount(t);
  assert.equal(requests.length, 0);
  assert.equal(document.querySelectorAll(".room-home-return").length, 0);
  assert.equal(document.querySelectorAll(".room-home-story").length, 2);
  assert.match(document.querySelector(".room-home-preview-note")!.textContent!, /local previews/);
  for (const href of ["/#/project/malfoy-hogwarts", "/#/project/blade-runner-memory", "/#/guild/paper-lantern", "/pilot?room=kessler-ward#kessler-wren"]) assert.ok(document.querySelector(`a[href='${href}']`));
  const disclosure = document.querySelector("details")!;
  assert.equal(disclosure.open, false);
  await act(async () => (disclosure.querySelector("summary") as HTMLElement).click());
  assert.equal(disclosure.open, true);
  assert.equal(document.querySelectorAll(".room-home-all-grid > a").length, 1);
});

test("a mounted returning visit checks public history and preserves independent new-scene and resume links", async t => {
  const { requests } = await mount(t, { visit: true });
  assert.ok(requests.length > 0);
  assert.ok(requests.every(url => url.searchParams.get("limit") === "501" && url.searchParams.get("room_id") === "eq.kessler-ward"));
  assert.match(document.querySelector(".room-home-return-status")!.textContent!, /1 new scene since your visit/);
  const links = [...document.querySelectorAll<HTMLAnchorElement>(".room-home-return-actions a")];
  const latest = new URL(links.find(link => link.textContent?.includes("what’s new"))!.href);
  const resume = new URL(links.find(link => link.textContent?.includes("Continue"))!.href);
  assert.equal(latest.searchParams.get("moment"), KESSLER_BEAT_IDS["dawn-81"]);
  assert.equal(resume.searchParams.get("moment"), KESSLER_BEAT_IDS["floor-forty"]);
  assert.equal(resume.searchParams.get("tip"), KESSLER_BEAT_IDS.chain);
  assert.equal(JSON.parse(localStorage.getItem(visitKey(room.id))!).knownIds.length, story.length - 1);
});

test("unavailable updates remain recoverable and never claim there are no new scenes", async t => {
  const { reconnect } = await mount(t, { joined: true, fail: true });
  assert.equal(document.querySelector(".room-home-return-status")!.textContent, "Updates unavailable");
  assert.ok(document.querySelector(".room-home-return-actions a"));
  reconnect();
  await act(async () => (document.querySelector(".room-home-refresh button") as HTMLButtonElement).click());
  await wait();
  assert.equal(document.querySelector(".room-home-return-status")!.textContent, "Joined room");
  assert.equal(document.querySelector(".room-home-refresh"), null);
});
