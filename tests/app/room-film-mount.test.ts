import assert from "node:assert/strict";
import { register as registerLoader } from "node:module";
import { after, test, type TestContext } from "node:test";
import { act, createElement, StrictMode } from "react";
import { JSDOM } from "jsdom";
import { register as registerTsx } from "tsx/esm/api";
import { firstNightRoomHref, FIRST_NIGHT_MOMENT_ID, FIRST_NIGHT_ROOM_ID, parseFirstNightStarter } from "../../src/lib/first-night.ts";
import { kesslerSeedMoments, KESSLER_BEAT_IDS, KESSLER_DESCRIPTION } from "../../src/lib/kessler-room.ts";
import { visitKey, visitSnapshot } from "../../src/lib/pilot-social.ts";
import type { PilotAccount } from "../../src/components/pilot-account.tsx";

// Mount the real room and its film studio with account readiness, HTTP and layout
// fixtures. React runs their effects, state updates and Strict Mode remounts.
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "https://fork-night.invalid/pilot", pretendToBeVisual: true });
const globals = {
  window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
  localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage,
  Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, Element: dom.window.Element,
  MutationObserver: dom.window.MutationObserver, BroadcastChannel: undefined,
  HTMLElement: dom.window.HTMLElement, HTMLDetailsElement: dom.window.HTMLDetailsElement,
  HTMLInputElement: dom.window.HTMLInputElement, Node: dom.window.Node,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  IS_REACT_ACT_ENVIRONMENT: true,
};
const originals = Object.fromEntries(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
dom.window.HTMLElement.prototype.scrollTo = () => {};
dom.window.matchMedia = media => ({ media, matches: false, onchange: null,
  addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => true });

registerLoader(`data:text/javascript,${encodeURIComponent(`export async function load(url, context, next) {
  return new URL(url).pathname.endsWith(".css") ? { format: "module", source: "", shortCircuit: true } : next(url, context);
}`)}`);
const loader = registerTsx({ namespace: "room-film-mount" });
const { createRoot } = await import("react-dom/client");
const { SharedPilot } = await loader.import("../../src/components/shared-pilot.tsx", import.meta.url);
const { PilotAccountContext } = await loader.import("../../src/components/pilot-account.tsx", import.meta.url);

const api = "https://room-fixture.invalid";
const envKeys = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_PRIVY_APP_ID"] as const;
const previousEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
process.env.NEXT_PUBLIC_SUPABASE_URL = api;
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
delete process.env.NEXT_PUBLIC_PRIVY_APP_ID;
const nativeFetch = globalThis.fetch;
let respond: typeof fetch;
globalThis.fetch = (...args) => respond(...args);
after(async () => {
  globalThis.fetch = nativeFetch;
  for (const key of envKeys) {
    if (previousEnv[key] === undefined) delete process.env[key]; else process.env[key] = previousEnv[key];
  }
  await loader.unregister();
  dom.window.close();
  for (const key of Object.keys(globals)) {
    if (originals[key]) Object.defineProperty(globalThis, key, originals[key]!);
    else Reflect.deleteProperty(globalThis, key);
  }
});

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

async function mountOverview(t: TestContext, query: string, options: { saved?: boolean; draft?: boolean; story?: ReturnType<typeof kesslerSeedMoments>; visit?: { scene: string; tip?: string } } = {}) {
  const room = { id: FIRST_NIGHT_ROOM_ID, title: "Kessler Ward", description: KESSLER_DESCRIPTION, is_open: true, is_listed: true };
  const maker = "35000000-0000-4000-8000-000000000001";
  const story = options.story ?? kesslerSeedMoments();
  const unexpected: string[] = [];
  respond = async (input, init) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, dom.window.location.origin);
    const table = url.pathname.split("/").at(-1);
    let body: unknown;
    if (url.origin === api && table === "pilot_rooms") body = url.searchParams.has("id") ? room : [room];
    else if (url.origin === api && table === "pilot_room_snapshot") body = { roomId: room.id, title: room.title, revision: 1, participants: [], credits: { limit: 2, used: 0, reserved: 0, available: 2, enabled: true } };
    else if (url.origin === api && table === "pilot_moments") body = story;
    else if (url.origin === api && table === "pilot_profiles" && options.draft) body = { id: maker, display_name: "Saved storyteller" };
    else if (url.origin === api && table === "pilot_room_participants") body = url.searchParams.get("select") === "public_id" ? null : [];
    else if (url.origin === api && ["pilot_ideas", "pilot_wren_assistance", "pilot_operations", "pilot_wren_requests"].includes(table!)) body = [];
    else if (url.origin === api && table === "pilot_kessler_overview") body = null;
    else if (url.pathname === "/api/pilot/activity") body = { queued_requests: 0, generating_requests: 0, checking_requests: 0 };
    else if (url.pathname === "/api/pilot/local-refill" && (init?.method ?? "GET") === "GET") body = { enabled: false };
    else { unexpected.push(`${init?.method ?? "GET"} ${url.pathname}`); return Response.json({}, { status: 500 }); }
    return Response.json(body);
  };
  dom.window.localStorage.clear(); dom.window.sessionStorage.clear();
  dom.reconfigure({ url: `https://fork-night.invalid/pilot?room=${room.id}${query}` });
  if (options.saved) {
    dom.window.sessionStorage.setItem(`pilot-selected:${room.id}`, KESSLER_BEAT_IDS["dawn-81"]);
    dom.window.sessionStorage.setItem(`pilot-tip:${room.id}`, KESSLER_BEAT_IDS["dawn-81"]);
    dom.window.localStorage.setItem(visitKey(room.id), JSON.stringify(visitSnapshot(story, KESSLER_BEAT_IDS["dawn-81"])));
  }
  if (options.visit) dom.window.localStorage.setItem(visitKey(room.id), JSON.stringify({ ...visitSnapshot(story, options.visit.scene), ...(options.visit.tip ? { lastTipId: options.visit.tip } : {}) }));
  if (options.draft) dom.window.localStorage.setItem(`fork-night-pilot-draft:${maker}:${room.id}`, JSON.stringify({ requestId: "35000000-0000-4000-8000-000000000002", roomId: room.id, parentId: FIRST_NIGHT_MOMENT_ID, captions: ["", ""], thought: "Find another way upstairs", stage: "idea" }));
  const account: PilotAccount = { loading: false, enabled: false, error: "", authenticatingWallet: false,
    wallet: { owner: "", address: "", loading: false, error: "" }, walletMode: "external", signIn: async () => {}, signInWallet: async () => {}, signOut: async () => {}, chooseWallet() {},
    ...(options.draft ? { user: { id: maker, app_metadata: {}, user_metadata: {}, aud: "authenticated", created_at: "2026-10-19T00:00:00Z", is_anonymous: true } } : {}),
  };
  let root = createRoot(dom.window.document.getElementById("root")!);
  const mount = () => root.render(createElement(StrictMode, null, createElement(PilotAccountContext.Provider, { value: account }, createElement(SharedPilot))));
  t.after(async () => { await act(async () => root.unmount()); assert.deepEqual(unexpected, [], "all external work is fixture-only"); });
  await act(async () => mount());
  return { reload: async () => { await act(async () => root.unmount()); root = createRoot(dom.window.document.getElementById("root")!); await act(async () => mount()); } };
}

function roomButton(text: string, within: ParentNode = dom.window.document) {
  const button = [...within.querySelectorAll("button")].find(button => button.textContent?.trim() === text);
  assert.ok(button, `Missing button: ${text}`);
  return button;
}

test("bare Kessler entry offers saved reading without opening or overwriting it", async t => {
  const mounted = await mountOverview(t, "", { saved: true });
  assert.ok(dom.window.document.getElementById("kessler-overview-title"));
  assert.equal(dom.window.document.querySelector<HTMLElement>(".pilot-table")?.hidden, true);
  assert.match(dom.window.document.querySelector(".kessler-overview-resume")?.textContent ?? "", /Dawn on eighty-one/);
  assert.equal(JSON.parse(dom.window.localStorage.getItem(visitKey(FIRST_NIGHT_ROOM_ID))!).lastMomentId, KESSLER_BEAT_IDS["dawn-81"]);
  const rooftop = [...dom.window.document.querySelectorAll(".kessler-path-preview")].find(article => article.querySelector("h3")?.textContent === "The rooftops")!;
  await act(async () => roomButton("Read path", rooftop).click());
  assert.equal(dom.window.document.querySelector("#pilot-story-reader h2")?.textContent, "Lights out in Kessler Ward");
  assert.equal(dom.window.document.querySelectorAll(".pilot-recap-list > li").length, 6, "the selected path remains six scenes long at its opening");
  assert.equal(new URL(dom.window.location.href).searchParams.get("tip"), KESSLER_BEAT_IDS["window-81"]);
  await mounted.reload();
  assert.equal(dom.window.document.getElementById("kessler-overview-title"), null, "explicit scene links keep the reader");
  assert.equal(dom.window.document.querySelectorAll(".pilot-recap-list > li").length, 6, "reload retains the selected path");
  await act(async () => roomButton("Room overview").click());
  assert.ok(dom.window.document.getElementById("kessler-overview-title"));
  assert.equal(new URL(dom.window.location.href).searchParams.has("moment"), false);
  assert.equal(new URL(dom.window.location.href).searchParams.has("tip"), false);
});

test("Continue reading retains a middle scene and its full branch after session storage is cleared", async t => {
  const mounted = await mountOverview(t, "");
  const neighbors = [...dom.window.document.querySelectorAll(".kessler-path-preview")].find(article => article.querySelector("h3")?.textContent === "The neighbors")!;
  await act(async () => roomButton("Read path", neighbors).click());
  const floor = [...dom.window.document.querySelectorAll<HTMLButtonElement>(".pilot-recap-row")].find(button => button.textContent?.includes("Floor forty"))!;
  await act(async () => floor.click());
  assert.equal(dom.window.document.querySelectorAll(".pilot-recap-list > li").length, 6);
  await act(async () => roomButton("Room overview").click());
  await act(async () => dom.window.document.querySelector<HTMLButtonElement>(".kessler-overview-resume")!.click());
  assert.equal(dom.window.document.querySelectorAll(".pilot-recap-list > li").length, 6, "same-tab resume retains the branch");
  await act(async () => roomButton("Room overview").click());
  dom.window.sessionStorage.clear();
  await mounted.reload();
  await act(async () => dom.window.document.querySelector<HTMLButtonElement>(".kessler-overview-resume")!.click());
  assert.equal(dom.window.document.querySelector("#pilot-story-reader h2")?.textContent, "Floor forty");
  assert.equal(dom.window.document.querySelectorAll(".pilot-recap-list > li").length, 6, "new-session resume retains later scenes");
  assert.equal(new URL(dom.window.location.href).searchParams.get("tip"), KESSLER_BEAT_IDS["dawn-81"]);
  await mounted.reload();
  assert.equal(dom.window.document.querySelectorAll(".pilot-recap-list > li").length, 6, "the resumed URL retains its branch on reload");
});

for (const [kind, tip] of [["legacy", undefined], ["missing", "25000000-0000-4000-8000-000000000099"], ["unrelated", KESSLER_BEAT_IDS["window-81"]]] as const) {
  test(`a ${kind} saved tip resumes the known scene without guessing another branch`, async t => {
    await mountOverview(t, "", { visit: { scene: KESSLER_BEAT_IDS["floor-forty"], tip } });
    await act(async () => dom.window.document.querySelector<HTMLButtonElement>(".kessler-overview-resume")!.click());
    assert.equal(dom.window.document.querySelector("#pilot-story-reader h2")?.textContent, "Floor forty");
    assert.equal(dom.window.document.querySelectorAll(".pilot-recap-list > li").length, 3);
    assert.equal(new URL(dom.window.location.href).searchParams.has("tip"), false, "an incompatible tip is not written into a shareable URL");
  });
}

function wideStory() {
  const story = kesslerSeedMoments();
  const roof = story.find(scene => scene.id === KESSLER_BEAT_IDS["window-81"])!;
  for (let i = 1; i <= 5; i++) story.push({ ...roof, id: `27000000-0000-4000-8000-${String(i).padStart(12, "0")}`, parent_id: roof.id, title: `Path ${i}`, created_at: `2026-10-19T11:0${i}:00Z` });
  return story;
}

test("a five-way fork can page through its map and select the corresponding alphabetic preview", async t => {
  await mountOverview(t, "", { story: wideStory() });
  await act(async () => dom.window.document.querySelector<HTMLButtonElement>('[aria-label="Explore The rooftops, 5 paths"]')!.click());
  assert.equal(dom.window.document.querySelectorAll(".kessler-overview-node.is-path").length, 4);
  const next = dom.window.document.querySelector<HTMLButtonElement>('[aria-label="Next branches"]');
  assert.ok(next);
  await act(async () => next.click());
  const last = dom.window.document.querySelector<HTMLButtonElement>(".kessler-overview-node.is-path")!;
  assert.match(last.textContent ?? "", /Path 5/);
  await act(async () => last.click());
  assert.equal(dom.window.document.querySelector(".kessler-path-preview.is-selected h3")?.textContent, "Path 5");
  await act(async () => dom.window.document.querySelector<HTMLButtonElement>('[aria-label="Previous branches"]')!.click());
  assert.equal(dom.window.document.querySelectorAll(".kessler-overview-node.is-path").length, 4);
  await act(async () => roomButton("Whole story").click());
  await act(async () => dom.window.document.querySelector<HTMLButtonElement>('[aria-label="Explore The rooftops, 5 paths"]')!.click());
  assert.equal(dom.window.document.querySelectorAll(".kessler-overview-node.is-path").length, 4, "entering a group resets its map page");
});

test("Recent shows newest paths while All and search use a stable alphabetic directory", async t => {
  await mountOverview(t, "", { story: wideStory() });
  const titles = () => [...dom.window.document.querySelectorAll(".kessler-path-title h3")].map(node => node.textContent);
  await act(async () => roomButton("Recent").click());
  assert.deepEqual(titles(), ["Path 5", "Path 4", "Path 3"]);
  await act(async () => roomButton("All paths").click());
  assert.deepEqual(titles(), ["Path 1", "Path 2", "Path 3"]);
  await act(async () => dom.window.document.querySelector<HTMLButtonElement>('[aria-label="Next three paths"]')!.click());
  assert.deepEqual(titles(), ["Path 4", "Path 5", "The neighbors"]);
  const search = dom.window.document.querySelector<HTMLInputElement>('input[type="search"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(search, "Path");
    search.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  assert.deepEqual(titles(), ["Path 1", "Path 2", "Path 3"], "search resets paging and preserves directory order");
});

test("watching from the overview opens the chosen film and returns to the same room entrance", async t => {
  await mountOverview(t, "");
  const neighbors = [...dom.window.document.querySelectorAll(".kessler-path-preview")].find(article => article.querySelector("h3")?.textContent === "The neighbors")!;
  await act(async () => roomButton("Watch film", neighbors).click());
  assert.equal(dom.window.document.querySelector(".room-film-about h3")?.textContent, "Dawn on eighty-one");
  assert.equal(new URL(dom.window.location.href).searchParams.has("moment"), false);
  await act(async () => dom.window.document.querySelector<HTMLButtonElement>('[aria-label="Close film workspace"]')!.click());
  assert.ok(dom.window.document.getElementById("kessler-overview-title"));
  assert.equal(dom.window.document.querySelector<HTMLElement>(".pilot-table")?.hidden, true);
  assert.equal(new URL(dom.window.location.href).searchParams.has("film"), false);
});

test("a recovered draft takes precedence over the bare room overview", async t => {
  await mountOverview(t, "", { draft: true });
  assert.equal(dom.window.document.getElementById("kessler-overview-title"), null);
  assert.equal(dom.window.document.querySelector<HTMLElement>(".pilot-table")?.hidden, false);
  assert.match(dom.window.document.body.textContent ?? "", /saved|draft/i);
  assert.ok(dom.window.localStorage.getItem(`fork-night-pilot-draft:35000000-0000-4000-8000-000000000001:${FIRST_NIGHT_ROOM_ID}`));
});

for (const readyFirst of ["room", "account"] as const) {
  test(`a film deep link consumes its invitation once when ${readyFirst} data is ready first`, async t => {
    const roomReady = gate();
    if (readyFirst === "room") roomReady.release();
    const room = { id: FIRST_NIGHT_ROOM_ID, title: "Kessler Ward", description: KESSLER_DESCRIPTION, is_open: true, is_listed: true };
    const unexpected: string[] = [];
    respond = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      const method = init?.method ?? "GET";
      const path = url.pathname;
      let body: unknown;
      if (url.origin === api && method === "GET" && path === "/rest/v1/pilot_rooms") {
        await roomReady.promise;
        body = url.searchParams.has("id") ? room : [room];
      } else if (url.origin === api && method === "POST" && path === "/rest/v1/rpc/pilot_room_snapshot") {
        body = { roomId: room.id, title: room.title, revision: 1, participants: [], credits: { limit: 2, used: 0, reserved: 0, available: 2, enabled: true } };
      } else if (url.origin === api && method === "GET" && path === "/rest/v1/pilot_moments") {
        body = kesslerSeedMoments();
      } else if (url.origin === api && (method === "GET" && path === "/rest/v1/pilot_ideas" ||
        method === "POST" && path === "/rest/v1/rpc/pilot_wren_assistance")) {
        body = [];
      } else if (url.origin === api && method === "POST" && path === "/rest/v1/rpc/pilot_kessler_overview") {
        body = null;
      } else {
        unexpected.push(`${method} ${url.href}`);
        return Response.json({ message: "No fixture for this request" }, { status: 500 });
      }
      return Response.json(body);
    };
    dom.window.localStorage.clear(); dom.window.sessionStorage.clear();
    const invitation = new URL(firstNightRoomHref("rooftops"), dom.window.location.origin);
    invitation.searchParams.set("film", "neighbors");
    invitation.searchParams.set("view", "read");
    invitation.hash = "#opening";
    dom.reconfigure({ url: invitation.href });
    const pending = parseFirstNightStarter(invitation.search);
    const consumed: string[] = [];
    const history = dom.window.history;
    const replace = history.replaceState.bind(history);
    t.mock.method(history, "replaceState", (state: unknown, title: string, href?: string | URL | null) => {
      const before = parseFirstNightStarter(dom.window.location.search);
      replace(state, title, href);
      if (before && !parseFirstNightStarter(dom.window.location.search)) consumed.push(dom.window.location.href);
    });
    const root = createRoot(dom.window.document.getElementById("root")!);
    t.after(async () => { roomReady.release(); await act(async () => root.unmount()); });
    const account = (loading: boolean): PilotAccount => ({
      loading, enabled: false, error: "", authenticatingWallet: false,
      wallet: { owner: "", address: "", loading: false, error: "" }, walletMode: "external",
      signIn: async () => {}, signInWallet: async () => {}, signOut: async () => {}, chooseWallet() {},
    });
    const mount = (loading: boolean) => root.render(createElement(StrictMode, null,
      createElement(PilotAccountContext.Provider, { value: account(loading) }, createElement(SharedPilot))));
    await act(async () => { mount(readyFirst === "room"); });
    assert.deepEqual(parseFirstNightStarter(dom.window.location.search), pending);
    assert.equal(consumed.length, 0);
    if (readyFirst === "room") {
      assert.equal(dom.window.document.querySelector(".room-film-about h3")?.textContent, "Dawn on eighty-one", "film mount effect ran before account readiness");
    } else {
      assert.equal(dom.window.document.querySelector("#kessler-films"), null, "film waits for room data");
    }
    await act(async () => {
      if (readyFirst === "room") mount(false); else roomReady.release();
    });
    assert.equal(consumed.length, 1);
    assert.equal(dom.window.document.querySelector(".room-film-about h3")?.textContent, "Dawn on eighty-one");
    assert.ok(dom.window.document.querySelector("[data-pilot-storyteller-name]"), "the invitation reaches the ordinary anonymous join-and-compose step");
    const cancel = [...dom.window.document.querySelectorAll("button")].find(button => button.textContent === "Cancel continuation");
    assert.ok(cancel, "the invitation opened a continuation");
    const current = new URL(dom.window.location.href);
    assert.equal(current.searchParams.get("moment"), FIRST_NIGHT_MOMENT_ID);
    assert.equal(current.searchParams.get("view"), "read");
    assert.equal(current.searchParams.get("film"), "neighbors");
    assert.equal(current.searchParams.has("firstNight"), false);
    assert.equal(current.searchParams.has("starter"), false);
    assert.equal(current.hash, "#opening");
    await act(async () => { cancel.click(); });
    const close = dom.window.document.querySelector<HTMLButtonElement>('[aria-label="Close film workspace"]');
    assert.ok(close);
    await act(async () => { close.click(); mount(false); });
    assert.equal(consumed.length, 1, "rerenders never replay the consumed invitation");
    assert.equal(dom.window.document.querySelector("#pilot-story-reader h2")?.textContent, "Lights out in Kessler Ward");
    assert.equal(new URL(dom.window.location.href).searchParams.get("moment"), FIRST_NIGHT_MOMENT_ID);
    assert.equal(new URL(dom.window.location.href).searchParams.has("film"), false);
    assert.deepEqual(unexpected, [], "all external work is fixture-only");
  });
}
