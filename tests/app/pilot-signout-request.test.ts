import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import {
  consumeSignOutRequest, createSignOutRequest, expireCookie, forgetPrivySession, forgetSignedOut, hasSignOutRequest, markSignedOut,
  sessionKey, SIGNED_OUT_KEY, signedOutHere, SIGNOUT_REQUEST_KEY, withoutSignOutRequest,
} from "../../src/lib/supabase/signout-request.ts";

// Run PilotAccountProvider's own effects for the header chip's sign-out, with fakes and no React.
const path = "src/components/pilot-account.tsx";
const source = ts.createSourceFile(path, await readFile(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const js = (node: ts.Node) => ts.transpile(`(${node.getText(source)})`, { target: ts.ScriptTarget.ES2022 });
// An effect's callback and its dependency list; without a list it runs after every render.
function effect(...includes: string[]) {
  let found: ts.CallExpression | undefined;
  (function visit(node: ts.Node) {
    if (found) return;
    if (ts.isCallExpression(node) && node.expression.getText(source) === "useEffect" && includes.every(text => node.arguments[0].getText(source).includes(text))) found = node;
    else ts.forEachChild(node, visit);
  })(source);
  assert.ok(found);
  const [callback, deps] = found.arguments;
  return { node: found, callback: js(callback), deps: deps && js(deps) };
}
const effects = [effect("consumeSignOutRequest"), effect("signOutRequest.current", "location.replace"), effect("pagehide")];
const run = (code: string, env: Record<string, unknown>) => new Function(...Object.keys(env), `return ${code}`)(...Object.values(env));
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const origin = "http://localhost:3005";

function sessionStore() {
  const map = new Map<string, string>();
  return { map, getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { map.delete(key); } };
}

type Listener = { type: string; listener: (event: { type: string; repeat?: boolean }) => void; capture?: boolean };
// One /pilot page load. Each render runs the effects as React does: after the first render (twice
// under StrictMode), then after a render that changes one of their dependencies; a change to the
// signingOut flag (`tripping`) renders again. `trips` records each change to that flag; signOut waits
// for `until` when given; `privy` is whether a Privy session is stored. press() is a press or key
// reaching window's capture listeners, and hide() is the page being left (pagehide).
function pilotPage(href: string, storage = sessionStore(), { signOutFails = false, strict = false, until = Promise.resolve(), privy = false, blockedLocalStorage = false } = {}) {
  const steps: string[] = [];
  const trips: boolean[] = [];
  const refs = { signOutRequestRead: { current: false }, signOutRequest: { current: null as { returnTo: string | null } | null } };
  const listeners: Listener[] = [];
  const local = sessionStore();
  const window = {
    location: { href, replace: (url: string) => { steps.push(`replace ${url}`); } },
    sessionStorage: storage,
    get localStorage() { if (blockedLocalStorage) throw new Error("SecurityError"); return local; },
    history: { state: null, replaceState: (_state: unknown, _title: string, url: string) => { steps.push(`address ${url}`); window.location.href = url; } },
    addEventListener: (type: string, listener: Listener["listener"], capture?: boolean) => { listeners.push({ type, listener, capture }); },
    removeEventListener: (type: string, listener: Listener["listener"], capture?: boolean) => {
      const at = listeners.findIndex(entry => entry.type === type && entry.listener === listener && entry.capture === capture);
      if (at >= 0) listeners.splice(at, 1);
    },
  };
  const deliver = (type: string, event: { type: string; repeat?: boolean }, capture?: boolean) => {
    for (const entry of listeners.filter(entry => entry.type === type && entry.capture === capture)) entry.listener(event);
  };
  const press = (type: string, { repeat = false } = {}) => deliver(type, { type, repeat }, true);
  const hide = () => deliver("pagehide", { type: "pagehide" });
  const expireCookieFake = () => {};
  const consumed: unknown[] = [];
  let previous: (unknown[] | undefined)[] | undefined;
  const cleanups: (undefined | (() => void))[] = [];
  let tripping = false;
  let last: { loading: boolean; user?: { id: string }; error?: string } = { loading: true };
  async function render(props: { loading: boolean; user?: { id: string }; error?: string }) {
    last = props;
    for (let pass = 0; pass < 5; pass++) {
      const { loading, user, error = "" } = props;
      const env = { ...refs, window, hasSignOutRequest, withoutSignOutRequest, markSignedOut, loading, error, tripping, currentUser: { current: user }, privySessionStored: () => privy,
        consumeSignOutRequest: (...args: Parameters<typeof consumeSignOutRequest>) => { const result = consumeSignOutRequest(...args); consumed.push(result); return result; },
        signOut: async () => { steps.push("signOut"); await until; if (signOutFails) throw new Error("Your account could not be signed out. Refresh and try again."); },
        forgetPrivySession: (storage: unknown, expire: unknown) => { assert.equal(storage, local); assert.equal(expire, expireCookieFake); steps.push("forget privy"); },
        expireCookie: expireCookieFake, forgetStoredSessions: () => { steps.push("forget sessions"); },
        setError: (message: string) => { steps.push(`error ${message}`); }, setTripping: (value: boolean) => { trips.push(value); } };
      const deps = effects.map(({ deps }) => deps === undefined ? undefined : run(deps, env) as unknown[]);
      const due = effects.map((_, index) => index).filter(index => {
        const now = deps[index], before = previous?.[index];
        return !now || !before || now.some((value, at) => !Object.is(value, before[at]));
      });
      // Each run first cleans up the effect's previous run, as React does.
      for (let mount = !previous && strict ? 2 : 1; mount > 0; mount--) for (const index of due) {
        cleanups[index]?.();
        cleanups[index] = run(effects[index].callback, env)();
      }
      previous = deps;
      await settle();
      const now = trips.at(-1) ?? false;
      if (now === tripping) return;
      tripping = now;
    }
  }
  return { steps, trips, consumed, listeners, local, press, hide, render, rerender: () => render(last) };
}
const alice = { id: "a1111111-1111-4111-8111-111111111111" };
const pagehide = (page: { listeners: Listener[] }) => page.listeners.filter(entry => entry.type === "pagehide").length;
const releases = (page: { listeners: Listener[] }) => page.listeners.filter(entry => entry.type !== "pagehide").map(entry => [entry.type, entry.capture]);

test("a matching request signs out once the account loads, then goes back to where the chip was", async () => {
  const storage = sessionStore();
  const page = pilotPage(origin + createSignOutRequest(storage, `${origin}/agents?tab=wren#roster`), storage);
  await page.render({ loading: true });
  assert.deepEqual(page.steps, [`address ${origin}/pilot`], "the token and return path leave the address at once");
  assert.equal(storage.getItem(SIGNOUT_REQUEST_KEY), null, "the request is used up");
  await page.render({ loading: true, user: alice });
  assert.deepEqual(page.steps, [`address ${origin}/pilot`], "nothing more happens while the account is still loading");
  await page.render({ loading: false, user: alice });
  assert.deepEqual(page.steps, [`address ${origin}/pilot`, "signOut", "forget privy", "replace /agents?tab=wren#roster"], "the account finishing loading starts the sign-out");
  assert.ok(signedOutHere(storage, "/agents"), "the page it returns to confirms the sign-out");
  assert.equal(signedOutHere(storage, "/"), false, "and no other page does");
});

test("the return confirmation is this tab's, recent, for the return page only, and cleared once shown", () => {
  const storage = sessionStore();
  assert.equal(signedOutHere(storage, "/agents"), false);
  markSignedOut(storage, "/agents?tab=wren#roster", 1_000_000);
  assert.equal(signedOutHere(storage, "/agents", 1_000_000 + 29_000), true);
  for (const other of ["/", "/agents/wren", "/agents?tab=wren", "/pilot"]) assert.equal(signedOutHere(storage, other, 1_000_000), false, other);
  assert.equal(signedOutHere(storage, "/agents", 1_000_000 + 31_000), false, "a stale flag says nothing");
  assert.equal(signedOutHere(storage, "/agents", 1_000_000 - 31_000), false, "nor does one from a clock that moved back");
  markSignedOut(storage, "/#/project/blade-runner-memory", 2_000_000);
  assert.equal(signedOutHere(storage, "/", 2_000_000), true, "\"/\" restoring a #/project route still counts");
  storage.setItem(SIGNED_OUT_KEY, "2000000");
  assert.equal(signedOutHere(storage, "/", 2_000_000), false, "a flag without a path says nothing");
  forgetSignedOut(storage);
  assert.equal(storage.getItem(SIGNED_OUT_KEY), null);
  const refusing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
  assert.doesNotThrow(() => { markSignedOut(refusing, "/agents"); forgetSignedOut(refusing); });
  assert.equal(signedOutHere(refusing, "/agents"), false);
});

test("it shows from the moment the request is read until the browser leaves", async () => {
  const storage = sessionStore();
  let finish!: () => void;
  const page = pilotPage(origin + createSignOutRequest(storage, `${origin}/agents`), storage, { until: new Promise<void>(resolve => { finish = () => resolve(); }) });
  await page.render({ loading: true });
  assert.deepEqual(page.trips, [true], "it shows while the account loads");
  await page.render({ loading: false, user: alice });
  assert.deepEqual(page.steps, [`address ${origin}/pilot`, "signOut"]);
  assert.deepEqual(page.trips, [true], "it stays while Privy and Supabase sign out");
  finish();
  await settle();
  assert.deepEqual(page.steps, [`address ${origin}/pilot`, "signOut", "forget privy", "replace /agents"]);
  assert.deepEqual(page.trips, [true], "and while the chip's page replaces this one");
});

test("if the browser never leaves (Esc or Stop), the next press or key gives the page back, once, and a held key's repeat does not", async () => {
  for (const first of ["pointerdown", "keydown"]) {
    const storage = sessionStore();
    const page = pilotPage(origin + createSignOutRequest(storage, `${origin}/agents`), storage);
    await page.render({ loading: true });
    await page.render({ loading: false, user: alice });
    assert.deepEqual(page.steps, [`address ${origin}/pilot`, "signOut", "forget privy", "replace /agents"]);
    assert.deepEqual(releases(page), [["pointerdown", true], ["keydown", true]]);
    page.press("keydown", { repeat: true });
    assert.deepEqual(page.trips, [true], "a key held down since before the stop");
    page.press(first);
    assert.deepEqual(page.trips, [true, false], first);
    assert.deepEqual(releases(page), [], "both listeners go after the first press or key");
    page.press("pointerdown"); page.press("keydown");
    assert.deepEqual(page.trips, [true, false]);
  }
});

test("the provider gives the page that flag as signingOut and leaves loading alone, so the Privy bridge stays mounted", () => {
  const called = new Set<string>();
  (function visit(node: ts.Node) { if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) called.add(node.expression.text); ts.forEachChild(node, visit); })(effects[1].node);
  assert.ok(!called.has("setLoading"));
  let flag: string | undefined;
  (function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) && node.initializer?.getText(source) === "useState(false)") {
      const [state, setter] = node.name.elements.map(element => element.getText(source));
      if (called.has(setter)) flag = state;
    }
    ts.forEachChild(node, visit);
  })(source);
  assert.ok(flag, "the trip sets a flag of its own");
  let value: ts.Node | undefined;
  (function visit(node: ts.Node) {
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(source) === "PilotAccountContext.Provider") value = node.attributes.properties.find(prop => prop.name?.getText(source) === "value");
    ts.forEachChild(node, visit);
  })(source);
  const object = ((value as ts.JsxAttribute | undefined)?.initializer as ts.JsxExpression | undefined)?.expression;
  assert.ok(object && ts.isObjectLiteralExpression(object));
  const signingOut = object.properties.find(prop => prop.name?.getText(source) === "signingOut");
  assert.ok(signingOut && ts.isPropertyAssignment(signingOut));
  assert.equal(signingOut.initializer.getText(source), flag);
});

test("a wrong or expired token only strips the address, and nothing shows", async () => {
  const storage = sessionStore();
  createSignOutRequest(storage, `${origin}/agents`);
  const kept = storage.getItem(SIGNOUT_REQUEST_KEY);
  const wrong = pilotPage(`${origin}/pilot?signout=${"0".repeat(32)}&return=%2Fagents`, storage);
  await wrong.render({ loading: true });
  await wrong.render({ loading: false, user: alice });
  assert.deepEqual(wrong.steps, [`address ${origin}/pilot`]);
  assert.deepEqual(wrong.trips, []);
  assert.equal(storage.getItem(SIGNOUT_REQUEST_KEY), kept, "another tab's request is left alone");

  const old = sessionStore();
  const expired = pilotPage(origin + createSignOutRequest(old, `${origin}/agents`, { now: Date.now() - 6 * 60_000 }), old);
  await expired.render({ loading: true });
  await expired.render({ loading: false, user: alice });
  assert.deepEqual(expired.steps, [`address ${origin}/pilot`]);
  assert.deepEqual(expired.trips, []);

  const plain = pilotPage(`${origin}/pilot?room=paper-moon`);
  await plain.render({ loading: true });
  await plain.render({ loading: false, user: alice });
  assert.deepEqual(plain.steps, [], "an ordinary /pilot address is not touched");
  assert.deepEqual(plain.trips, []);
  assert.equal(pagehide(plain), 0, "and leaving it signs no one out");
});

test("React StrictMode's second mount consumes the request once, and a later reload of the account signs out only once", async () => {
  const storage = sessionStore();
  const page = pilotPage(origin + createSignOutRequest(storage, `${origin}/agents`), storage, { strict: true });
  await page.render({ loading: true });
  assert.equal(page.consumed.length, 1);
  assert.deepEqual(page.trips, [true]);
  assert.equal(pagehide(page), 1, "one pagehide listener, not two");
  await page.render({ loading: false, user: alice });
  await page.render({ loading: true });
  await page.render({ loading: false, user: alice });
  assert.deepEqual(page.steps, [`address ${origin}/pilot`, "signOut", "forget privy", "replace /agents"]);
});

test("a failed sign-out stays on /pilot and shows the error, keeping Privy's keys and the session", async () => {
  const storage = sessionStore();
  const page = pilotPage(origin + createSignOutRequest(storage, `${origin}/agents`), storage, { signOutFails: true });
  await page.render({ loading: true });
  await page.render({ loading: false, user: alice });
  assert.deepEqual(page.steps, [`address ${origin}/pilot`, "signOut", "error Your account could not be signed out. Refresh and try again."]);
  assert.deepEqual(page.trips, [true, false], "the account bar, with its own sign-out, comes back");
  assert.equal(signedOutHere(storage, "/agents"), false);
  assert.deepEqual(releases(page), []);
  await page.rerender();
  assert.equal(pagehide(page), 0, "leaving now keeps the session, as the page says");
});

test("until the sign-out settles, leaving the page (Back, a reload, closing the tab) still signs this browser out", async () => {
  const storage = sessionStore();
  let finish!: () => void;
  const page = pilotPage(origin + createSignOutRequest(storage, `${origin}/agents`), storage, { until: new Promise<void>(resolve => { finish = () => resolve(); }) });
  await page.render({ loading: true });
  assert.equal(pagehide(page), 1, "armed while the account loads");
  page.hide();
  assert.deepEqual(page.steps, [`address ${origin}/pilot`, "forget sessions"]);
  await page.render({ loading: false, user: alice });
  assert.equal(pagehide(page), 1, "and while it signs out");
  finish();
  await settle();
  await page.rerender();
  assert.equal(pagehide(page), 1, "after success it stays (the sessions are already gone) until the status ends");
  page.press("pointerdown");
  await page.rerender();
  assert.equal(pagehide(page), 0);
});

test("the pagehide helper removes the stored Supabase session and Privy's whole layout, and never throws", () => {
  let helper: ts.FunctionDeclaration | undefined;
  (function visit(node: ts.Node) { if (ts.isFunctionDeclaration(node) && node.name?.text === "forgetStoredSessions") helper = node; else ts.forEachChild(node, visit); })(source);
  assert.ok(helper);
  assert.match(effects[2].callback, /addEventListener\("pagehide", forgetStoredSessions\)/);
  const supabase = "sb-zqdamfuvkyebrbugvmxy-auth-token";
  const forget = (storage: unknown, expireCookie: (name: string) => void) => run(js(helper!), {
    localStorage: storage, expireCookie, forgetPrivySession, sessionKey: () => sessionKey("https://zqdamfuvkyebrbugvmxy.supabase.co"),
  })();
  const storage = privyLayout();
  storage.setItem(supabase, JSON.stringify({ access_token: "a", refresh_token: "r" }));
  storage.setItem("fork-night-pilot-idea:visitor", "an unsent idea");
  const cookies: string[] = [];
  forget(storage, name => { cookies.push(name); });
  assert.equal(storage.getItem(supabase), null);
  assertPrivyForgotten(storage, cookies);
  assert.equal(storage.getItem("fork-night-pilot-idea:visitor"), "an unsent idea");
  const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
  assert.doesNotThrow(() => forget(blocked, () => { throw new Error("cookies blocked"); }));
  const unreadable = privyLayout();
  assert.doesNotThrow(() => forget(unreadable, () => { throw new Error("cookies blocked"); }));
  assert.equal(unreadable.getItem("privy:token"), null, "throwing cookies still clear the storage");
  const stuck = privyLayout();
  const removeItem = stuck.removeItem;
  stuck.removeItem = (key: string) => { if (key === supabase) throw new Error("blocked"); removeItem(key); };
  forget(stuck, () => {});
  assert.equal(stuck.getItem("privy:token"), null, "a Supabase key that cannot be removed does not keep Privy's");
});

test("when nobody is signed in by then it still goes back, and without a return path it stays on /pilot", async () => {
  const storage = sessionStore();
  const nobody = pilotPage(origin + createSignOutRequest(storage, `${origin}/agents`), storage);
  await nobody.render({ loading: true });
  await nobody.render({ loading: false });
  assert.deepEqual(nobody.steps, [`address ${origin}/pilot`, "forget privy", "replace /agents"]);
  assert.deepEqual(nobody.trips, [true], "the status shows from the request until the page leaves");
  assert.ok(signedOutHere(storage, "/agents"), "and the page it returns to says this browser is signed out");

  const here = sessionStore();
  const token = new URL(origin + createSignOutRequest(here, `${origin}/agents`)).searchParams.get("signout")!;
  const stay = pilotPage(`${origin}/pilot?signout=${token}`, here);
  await stay.render({ loading: true });
  await stay.render({ loading: false, user: alice });
  assert.deepEqual(stay.steps, [`address ${origin}/pilot`, "signOut", "forget privy"]);
  assert.deepEqual(stay.trips, [true, false], "staying on /pilot ends the status");
  assert.equal(here.getItem(SIGNED_OUT_KEY), null, "no page to confirm on");
});

test("a failed account check still signs this browser out, since the session may still be stored, then goes back", async () => {
  for (const check of ["Your storyteller account could not be verified. Refresh to reconnect.", "Your account could not be restored. Refresh to reconnect."]) {
    const storage = sessionStore();
    const page = pilotPage(origin + createSignOutRequest(storage, `${origin}/agents`), storage);
    await page.render({ loading: true });
    await page.render({ loading: false, error: check });
    assert.deepEqual(page.steps, [`address ${origin}/pilot`, "signOut", "forget privy", "replace /agents"]);
    assert.deepEqual(page.trips, [true]);
    assert.ok(signedOutHere(storage, "/agents"));
  }
});

test("a session the server already ended still ends the Privy session it left before going back", async () => {
  const storage = sessionStore();
  const page = pilotPage(origin + createSignOutRequest(storage, `${origin}/agents`), storage, { privy: true });
  await page.render({ loading: true });
  await page.render({ loading: false });
  assert.deepEqual(page.steps, [`address ${origin}/pilot`, "signOut", "forget privy", "replace /agents"]);
  assert.deepEqual(page.trips, [true]);
});

test("blocked localStorage does not stop the return", async () => {
  const storage = sessionStore();
  const page = pilotPage(origin + createSignOutRequest(storage, `${origin}/agents`), storage, { blockedLocalStorage: true });
  await page.render({ loading: true });
  await page.render({ loading: false, user: alice });
  assert.deepEqual(page.steps, [`address ${origin}/pilot`, "signOut", "replace /agents"]);
  assert.ok(signedOutHere(storage, "/agents"));
});

test("a return path that dot segments turn into another site is dropped: sign out and stay on /pilot", async () => {
  const storage = sessionStore();
  const token = new URL(origin + createSignOutRequest(storage, `${origin}/agents`)).searchParams.get("signout")!;
  const page = pilotPage(`${origin}/pilot?signout=${token}&return=${encodeURIComponent("/.//evil.example/phish")}`, storage);
  await page.render({ loading: true });
  await page.render({ loading: false, user: alice });
  assert.deepEqual(page.steps, [`address ${origin}/pilot`, "signOut", "forget privy"]);
  assert.deepEqual(page.trips, [true, false]);
});

// Privy's real layout (@privy-io/js-sdk-core 0.78.2): every value JSON-encoded; each token stored with no
// user and under the active user; the saved users a JSON array encoded twice; privy:caid for the device.
const ACTIVE = "did:privy:cm0active00", OTHER = "did:privy:cm0other000";
function privyLayout() {
  const storage = sessionStore();
  const put = (key: string, value: unknown) => storage.setItem(key, JSON.stringify(value));
  for (const scope of ["", `${ACTIVE}:`, `${OTHER}:`]) for (const name of ["token", "pat", "refresh_token", "id-token"]) put(`privy:${scope}${name}`, `${scope}${name}`);
  put("privy:active-user", ACTIVE);
  put("privy:saved-users", JSON.stringify([ACTIVE, OTHER]));
  put("privy:caid", "device-1");
  return storage;
}
function assertPrivyForgotten(storage: ReturnType<typeof sessionStore>, cookies: string[]) {
  assert.deepEqual([...storage.map.keys()].filter(key => key.startsWith("privy:")).sort(), [
    "privy:caid", `privy:${OTHER}:id-token`, `privy:${OTHER}:pat`, `privy:${OTHER}:refresh_token`, `privy:${OTHER}:token`, "privy:saved-users",
  ].sort(), "the unscoped and the active user's tokens and the active user go; another saved user and the device stay");
  assert.deepEqual(JSON.parse(JSON.parse(storage.getItem("privy:saved-users")!)), [OTHER]);
  assert.equal(JSON.parse(storage.getItem("privy:caid")!), "device-1");
  assert.deepEqual(cookies, [
    "privy-token", "privy-refresh-token", "privy-id-token", "privy-session",
    `privy-${ACTIVE}-token`, `privy-${ACTIVE}-refresh-token`, `privy-${ACTIVE}-id-token`, `privy-${ACTIVE}-session`,
  ]);
}

test("forgetPrivySession removes what Privy's own cleanup removes, and nothing else", () => {
  const storage = privyLayout();
  const cookies: string[] = [];
  forgetPrivySession(storage, name => { cookies.push(name); });
  assertPrivyForgotten(storage, cookies);

  const alone = privyLayout();
  alone.setItem("privy:saved-users", JSON.stringify(JSON.stringify([ACTIVE])));
  forgetPrivySession(alone, () => {});
  assert.equal(alone.getItem("privy:saved-users"), null, "a list left empty goes");

  const noUser = privyLayout();
  noUser.removeItem("privy:active-user");
  const unscoped: string[] = [];
  forgetPrivySession(noUser, name => { unscoped.push(name); });
  assert.deepEqual(unscoped, ["privy-token", "privy-refresh-token", "privy-id-token", "privy-session"]);
  assert.equal(noUser.getItem("privy:token"), null);
  assert.equal(noUser.getItem(`privy:${ACTIVE}:token`), JSON.stringify(`${ACTIVE}:token`), "with no active user, no user's tokens are touched");
  assert.deepEqual(JSON.parse(JSON.parse(noUser.getItem("privy:saved-users")!)), [ACTIVE, OTHER]);

  const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
  const tried: string[] = [];
  assert.doesNotThrow(() => forgetPrivySession(blocked, name => { tried.push(name); throw new Error("cookies blocked"); }));
  assert.deepEqual(tried, ["privy-token", "privy-refresh-token", "privy-id-token", "privy-session"], "blocked storage still expires the cookies");
  const garbled = privyLayout();
  garbled.setItem("privy:saved-users", "not json");
  assert.doesNotThrow(() => forgetPrivySession(garbled, () => {}));
  assert.equal(garbled.getItem("privy:token"), null);
});

test("expireCookie expires a cookie as Privy's cookie library removes it, and sessionKey names supabase-js's key", () => {
  const writes: string[] = [];
  const scope = globalThis as { document?: unknown };
  scope.document = { set cookie(value: string) { writes.push(value); } };
  try { expireCookie(`privy-${ACTIVE}-token`); }
  finally { delete scope.document; }
  assert.deepEqual(writes, [`${encodeURIComponent(`privy-${ACTIVE}-token`)}=; Max-Age=0; Path=/`]);
  assert.equal(sessionKey("https://zqdamfuvkyebrbugvmxy.supabase.co"), "sb-zqdamfuvkyebrbugvmxy-auth-token");
  assert.equal(sessionKey(""), undefined);
  assert.equal(sessionKey("not a url"), undefined);
});
