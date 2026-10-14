import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { AuthApiError, AuthRetryableFetchError, isAuthRetryableFetchError, type User } from "@supabase/supabase-js";
import { checkGoogleLink, googleCallbackError, isSavedAccount, withoutGoogleCallbackError } from "../../src/lib/supabase/onboarding.ts";
import { moveVisitorIdeas } from "../../src/lib/pilot-rooms.ts";

// Exercise the provider's own verify, auth listener and sign-out code with fakes, without React or network calls.
async function component(path: string) {
  const source = ts.createSourceFile(path, await readFile(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return (pick: (node: ts.Node) => ts.Node | undefined) => {
    let found: ts.Node | undefined;
    (function visit(node: ts.Node) {
      if (found) return;
      const hit = pick(node);
      if (hit) found = hit; else ts.forEachChild(node, visit);
    })(source);
    assert.ok(found);
    return ts.transpile(`(${found.getText(source)})`, { target: ts.ScriptTarget.ES2022 });
  };
}
const account = await component("src/components/pilot-account.tsx");
const bridge = await component("src/components/pilot-privy.tsx");
const named = (name: string) => (node: ts.Node) => ts.isFunctionDeclaration(node) && node.name?.text === name ? node : undefined;
const argument = (callee: string, includes = "") => (node: ts.Node) =>
  ts.isCallExpression(node) && node.expression.getText() === callee && node.arguments[0]?.getText().includes(includes) ? node.arguments[0] : undefined;
const verifySource = account(named("verify"));
const listenerSource = account(argument("connected.auth.onAuthStateChange"));
const signOutSource = account(named("signOut"));
// The provider's own `useRef(...)` initializer for settledAsVisitor, so a page starts exactly as the component does.
const settledAsVisitorSource = account(node => ts.isVariableDeclaration(node) && node.name.getText() === "settledAsVisitor" ? node.initializer : undefined);
const run = (code: string, env: Record<string, unknown>) => new Function(...Object.keys(env), `return ${code}`)(...Object.values(env));
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

const alice = { id: "a1111111-1111-4111-8111-111111111111", is_anonymous: false } as User;
const bob = { id: "b2222222-2222-4222-8222-222222222222", is_anonymous: false } as User;
const offline = () => new AuthRetryableFetchError("Failed to fetch", 0);

// A Map-backed Storage; `full` makes setItem fail the way a browser over its quota does.
function memoryStorage({ full = false } = {}) {
  const map = new Map<string, string>();
  return { map, get length() { return map.size; }, key: (index: number) => [...map.keys()][index] ?? null, getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { if (full) throw new DOMException("The quota has been exceeded.", "QuotaExceededError"); map.set(key, value); },
    removeItem: (key: string) => { map.delete(key); } };
}

// `stored` is the session auth-js holds; null means none. `local` replaces window.localStorage, which may throw.
function provider({ current, stored = current ?? null, sessionError = null, userError = null, href = "http://localhost:3005/pilot?room=paper-moon", local }:
  { current?: User; stored?: User | null; sessionError?: Error | null; userError?: Error | null; href?: string; local?: () => unknown }) {
  const values = new Map<string, string>();
  const ideas = memoryStorage();
  const state = { user: current as User | undefined, stored, userError, error: "", notice: "", loading: [] as boolean[], users: [] as (User | undefined)[], replaced: [] as string[], getUser: 0, order: [] as string[] };
  const window = {
    location: { href }, get localStorage() { return local ? local() : ideas; },
    sessionStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } },
    history: { state: null, replaceState: (_state: unknown, _title: string, url: string) => { state.replaced.push(url); window.location.href = url; } },
  };
  const env: Record<string, unknown> = {
    version: { current: 0 }, active: true, currentUser: { current }, window,
    settledAsVisitor: run(settledAsVisitorSource, { useRef: (initial: unknown) => ({ current: initial }) }),
    connected: { auth: {
      getSession: async () => ({ data: { session: state.stored ? { user: state.stored, access_token: "token" } : null }, error: sessionError }),
      getUser: async () => { state.getUser++; return { data: { user: state.userError ? null : state.stored }, error: state.userError }; },
    } },
    googleCallbackError, withoutGoogleCallbackError, checkGoogleLink, isAuthRetryableFetchError, moveVisitorIdeas,
    setUser: (next: User | undefined | ((previous?: User) => User | undefined)) => {
      state.user = typeof next === "function" ? next(state.user) : next; state.users.push(state.user);
      // What is stored when the account appears, so a mounted PilotIdeas already finds its ideas moved.
      if (typeof next !== "function") state.order.push(`user ${next?.id ?? "none"}: ${[...ideas.map.keys()].join(", ")}`);
    },
    setError: (next: string) => { state.error = next; }, setNotice: (next: string) => { state.notice = next; },
    setLoading: (next: boolean) => { state.loading.push(next); }, queueMicrotask,
  };
  const verify = run(verifySource, env);
  const listener = run(listenerSource, { ...env, verify });
  return { state, verify, listener, ideas };
}

test("a same-account auth event re-verifies quietly, so the wallet bridge is never unmounted", async () => {
  const h = provider({ current: alice });
  h.listener("SIGNED_IN", { user: alice });
  await settle();
  assert.equal(h.state.getUser, 1, "the returning tab is still re-checked");
  assert.deepEqual(h.state.loading, [false], "loading never turns on, so provisionEmbedded stays true");
  assert.ok(h.state.users.length && h.state.users.every(user => user?.id === alice.id));
});

test("a different account's event still clears the previous storyteller and shows loading", async () => {
  const h = provider({ current: alice, stored: bob });
  h.listener("SIGNED_IN", { user: bob });
  assert.deepEqual(h.state.users, [undefined]);
  await settle();
  assert.deepEqual(h.state.loading, [true, false]);
  assert.equal(h.state.user?.id, bob.id);
});

test("a dropped connection while re-checking keeps the verified storyteller and its state", async () => {
  for (const failure of [{ userError: offline() }, { sessionError: offline(), stored: null }]) {
    const h = provider({ current: alice, ...failure });
    h.state.error = "earlier state";
    await h.verify();
    assert.equal(h.state.user?.id, alice.id);
    assert.deepEqual(h.state.users, []);
    assert.equal(h.state.error, "earlier state");
    assert.deepEqual(h.state.loading, [false]);
  }
});

test("verification failures that are not a dropped re-check still sign the page out", async () => {
  const cases = [
    provider({ stored: alice, userError: offline() }), // first load: no verified storyteller to keep
    provider({ current: alice, userError: new AuthApiError("invalid JWT", 401, "bad_jwt") }),
    provider({ current: alice, stored: bob, userError: offline() }), // the stored session belongs to someone else
  ];
  for (const h of cases) {
    await h.verify();
    assert.equal(h.state.user, undefined);
    assert.match(h.state.error, /could not be verified/);
  }
});

test("a cancelled Google return becomes a dismissible notice, leaves the address, and does not block the room", async () => {
  const error = "error=access_denied&error_code=access_denied&error_description=The+user+denied+access";
  const h = provider({ href: `http://localhost:3005/pilot?room=midnight-signal&onboarding=1&${error}#${error}` });
  await h.verify();
  assert.match(h.state.notice, /did not finish/);
  assert.equal(h.state.error, "", "account.error stays reserved for real verification failures");
  assert.deepEqual(h.state.replaced, ["http://localhost:3005/pilot?room=midnight-signal&onboarding=1"]);
  h.state.notice = "";
  await h.verify();
  assert.equal(h.state.notice, "", "a reload or later check does not report it again");
  assert.equal(h.state.replaced.length, 1);
});

const joiner = { id: "c3333333-3333-4333-8333-333333333333", is_anonymous: true } as User;
const keptOnB = "fork-night-pilot-idea:visitor:midnight-signal:B";
// The entrance settles signed out, then joinPilotAsGuest or a wallet sign-in stores a session in this page.
async function joinInPage(h: ReturnType<typeof provider>) {
  await h.verify();
  h.state.stored = joiner;
  h.listener("SIGNED_IN", { user: joiner });
  await settle();
}

test("a visitor who joins or signs in on any /pilot view keeps its unsent ideas, moved before the account appears", async () => {
  const h = provider({ stored: null });
  h.ideas.setItem(keptOnB, JSON.stringify({ body: "kept on B" }));
  await joinInPage(h);
  assert.deepEqual(h.state.order, [`user none: ${keptOnB}`, `user ${joiner.id}: fork-night-pilot-idea:${joiner.id}:midnight-signal:B`]);
  assert.equal(h.ideas.getItem(`fork-night-pilot-idea:${joiner.id}:midnight-signal:B`), JSON.stringify({ body: "kept on B" }));
});

test("an account that arrives with the page load or re-checks adopts no visitor ideas", async () => {
  const restored = provider({ stored: alice });
  restored.ideas.setItem(keptOnB, "{}");
  await restored.verify();
  restored.listener("SIGNED_IN", { user: alice });
  await settle();
  assert.deepEqual([...restored.ideas.map.keys()], [keptOnB]);
  const switched = provider({ current: alice, stored: bob });
  switched.ideas.setItem(keptOnB, "{}");
  switched.listener("SIGNED_IN", { user: bob });
  await settle();
  assert.deepEqual([...switched.ideas.map.keys()], [keptOnB], "an account replacing another is not a visitor joining");
});

test("an account restored on load while offline adopts no visitor ideas when it reconnects on the page", async () => {
  const h = provider({ stored: alice, userError: offline() });
  h.ideas.setItem(keptOnB, "{}");
  await h.verify(); // the page acts signed out
  assert.match(h.state.error, /could not be verified/);
  h.state.userError = null; // the connection returns; auth-js re-checks the same stored account
  h.listener("SIGNED_IN", { user: alice });
  await settle();
  assert.equal(h.state.user?.id, alice.id);
  assert.deepEqual([...h.ideas.map.keys()], [keptOnB]);
});

test("blocked or full idea storage never breaks an in-page sign-in", async () => {
  const blocked = provider({ stored: null, local: () => { throw new DOMException("The operation is insecure.", "SecurityError"); } });
  const full = memoryStorage({ full: true });
  full.map.set(keptOnB, "{}");
  const quota = provider({ stored: null, local: () => full });
  for (const h of [blocked, quota]) {
    await joinInPage(h);
    assert.equal(h.state.user?.id, joiner.id);
    assert.equal(h.state.error, "");
  }
  assert.deepEqual([...full.map.keys()], [keptOnB], "an idea that could not move stays under the visitor key");
});

test("Google callback errors are removed from the query and the hash, and nothing else is", () => {
  assert.equal(withoutGoogleCallbackError("https://story.invalid/pilot?room=paper-moon&error=server_error&error_code=identity_already_exists&error_description=SECRET#error=server_error&error_description=SECRET"), "https://story.invalid/pilot?room=paper-moon");
  assert.equal(withoutGoogleCallbackError("https://story.invalid/pilot?room=paper-moon&moment=123#shared-story"), "https://story.invalid/pilot?room=paper-moon&moment=123#shared-story");
  assert.equal(googleCallbackError(withoutGoogleCallbackError("https://story.invalid/pilot?create=1&error=access_denied#error=access_denied")), "");
});

// bridge: "mounted" has a registered handle; "on request" registers one only once mounted for sign-out; "never" fails to load.
function signingOut({ bridge = "mounted", failure, privy, privyFails = false, stored = true, user = alice }:
  { bridge?: "mounted" | "on request" | "never"; failure?: Error; privy?: Promise<void>; privyFails?: boolean; stored?: boolean; user?: User | null }) {
  const order: string[] = [];
  const state = { restarts: 0, user: user ?? undefined as User | undefined, retiring: [] as boolean[], settledAsVisitor: { current: false } };
  const end = () => { order.push("privy"); return privyFails ? Promise.reject(new Error("Privy is unreachable")) : privy ?? Promise.resolve(); };
  const privySignOut: { current?: () => Promise<void> } = { current: bridge === "mounted" ? end : undefined };
  const env: Record<string, unknown> = {
    client: {}, enabled: true, user, isSavedAccount, privySessionStored: () => stored, privySignOut, settledAsVisitor: state.settledAsVisitor,
    window: { sessionStorage: {}, localStorage: {} }, version: { current: 0 },
    setRetiring: (next: boolean) => {
      state.retiring.push(next);
      if (next) { order.push("mounted for sign-out"); if (bridge === "on request") setTimeout(() => { privySignOut.current = end; }, 20); }
    },
    signOutPilotAccount: async () => { order.push("supabase"); if (failure) throw failure; },
    clearVisitorIdeas: () => { order.push("visitor ideas cleared"); },
    setBridgeRestarts: (next: (value: number) => number) => { state.restarts = next(state.restarts); },
    setUser: (next: User | undefined) => { order.push("cleared"); state.user = next; },
    setWallet() {}, emptyWallet: {}, setWalletChoice() {}, setExternalWallet() {}, setError() {}, setNotice() {}, setLoading() {},
  };
  return { order, state, signOut: run(signOutSource, env) as () => Promise<void> };
}

test("sign-out ends the Privy session through the mounted bridge before signing out of Supabase", async () => {
  const h = signingOut({});
  await h.signOut();
  assert.deepEqual(h.order, ["privy", "supabase", "visitor ideas cleared", "cleared"]);
  assert.deepEqual(h.state.retiring, [false]);
  assert.equal(h.state.restarts, 0);
  assert.equal(h.state.settledAsVisitor.current, true, "a later in-page sign-in moves visitor ideas again");
});

test("a browser-wallet user's stored Privy session is ended by mounting the bridge only for sign-out", async () => {
  const h = signingOut({ bridge: "on request" });
  await h.signOut();
  assert.deepEqual(h.order, ["mounted for sign-out", "privy", "supabase", "visitor ideas cleared", "cleared"]);
  assert.deepEqual(h.state.retiring, [true, false], "the temporary bridge unmounts once sign-out finishes");
  for (const quiet of [signingOut({ bridge: "never", stored: false }), signingOut({ bridge: "never", user: { ...alice, is_anonymous: true } })]) {
    await quiet.signOut();
    assert.deepEqual(quiet.order, ["supabase", "visitor ideas cleared", "cleared"], "no stored session, or a guest, mounts nothing");
  }
  // The header trip with nobody loaded: a failed account check, or a session the server ended, can leave Privy's.
  const nobody = signingOut({ bridge: "on request", user: null });
  await nobody.signOut();
  assert.deepEqual(nobody.order, ["mounted for sign-out", "privy", "supabase", "visitor ideas cleared", "cleared"]);
});

test("a temporary bridge that never registers holds sign-out for at most three seconds", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const flush = () => new Promise(resolve => setImmediate(resolve));
  const h = signingOut({ bridge: "never" });
  const done = h.signOut();
  for (let waited = 0; waited < 2950; waited += 50) { await flush(); t.mock.timers.tick(50); }
  await flush();
  assert.deepEqual(h.order, ["mounted for sign-out"]);
  t.mock.timers.tick(50);
  await done;
  assert.deepEqual(h.order, ["mounted for sign-out", "supabase", "visitor ideas cleared", "cleared"]);
});

test("an unreachable Privy holds sign-out for at most three seconds", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const flush = () => new Promise(resolve => setImmediate(resolve));
  const h = signingOut({ privy: new Promise(() => {}) });
  const done = h.signOut();
  await flush();
  t.mock.timers.tick(2999);
  await flush();
  assert.deepEqual(h.order, ["privy"]);
  t.mock.timers.tick(1);
  await done;
  assert.deepEqual(h.order, ["privy", "supabase", "visitor ideas cleared", "cleared"]);
});

test("a failing Privy logout still signs this browser out of Supabase", async () => {
  const h = signingOut({ privyFails: true });
  await h.signOut();
  assert.deepEqual(h.order, ["privy", "supabase", "visitor ideas cleared", "cleared"]);
  assert.equal(h.state.user, undefined);
  assert.equal(h.state.restarts, 0, "the bridge unmounts with the signed-out account instead of restarting");
});

test("a failed Supabase sign-out keeps the storyteller and restarts the bridge to reconnect its wallet", async () => {
  const failure = new Error("Your account could not be signed out. Refresh and try again.");
  const h = signingOut({ failure });
  await assert.rejects(h.signOut(), failure);
  assert.deepEqual(h.order, ["privy", "supabase"], "visitor ideas stay until a sign-out succeeds");
  assert.equal(h.state.user?.id, alice.id);
  assert.equal(h.state.restarts, 1);
  assert.equal(h.state.settledAsVisitor.current, false);
  const external = signingOut({ bridge: "never", stored: false, failure });
  await assert.rejects(external.signOut(), failure);
  assert.equal(external.state.restarts, 0);
});

test("the bridge's sign-out handle stops the JWT sync from signing the departing account back in", async () => {
  const register = bridge(argument("useEffect", "signOut.current"));
  const jwt = bridge(node => ts.isVariableDeclaration(node) && node.name.getText() === "getExternalJwt" && node.initializer && ts.isCallExpression(node.initializer) ? node.initializer.arguments[0] : undefined);
  const signingOutFlag = { current: false }, handle: { current?: () => Promise<void> } = {};
  let logouts = 0, tokens = 0;
  const cleanup = run(register, { signOut: handle, signingOut: signingOutFlag, settled: { current: true }, logout: async () => { logouts++; } })();
  const getExternalJwt = run(jwt, { owner: alice.id, signingOut: signingOutFlag, client: {}, current: { current: alice.id }, failure() {}, walletAuthToken: async () => { tokens++; return "jwt"; } });
  assert.equal(await getExternalJwt(), "jwt");
  await handle.current!();
  assert.equal(logouts, 1);
  assert.equal(await getExternalJwt(), undefined);
  assert.equal(tokens, 1);
  cleanup();
  assert.equal(handle.current, undefined);
});

// Privy writes tokens when its init refresh or an in-flight JWT sign-in resolves; a logout before then clears nothing.
function ending(settled: { current: boolean }) {
  const signingOut = { current: false }, handle: { current?: () => Promise<void> } = {}, state = { logouts: 0 };
  run(bridge(argument("useEffect", "signOut.current")), { signOut: handle, signingOut, settled, logout: async () => { state.logouts++; } })();
  return { end: handle.current!, signingOut, state };
}

test("sign-out logs Privy out only after its init refresh and any in-flight JWT sign-in settle", async () => {
  const settled = { current: false };
  const h = ending(settled);
  const done = h.end();
  assert.equal(h.signingOut.current, true, "no new JWT sign-in can start meanwhile");
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(h.state.logouts, 0);
  settled.current = true;
  await done;
  assert.equal(h.state.logouts, 1);
});

test("sign-out waits while Privy is not ready or a JWT sign-in is in flight, and only then", () => {
  const when = bridge(node => ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && node.left.getText() === "settled.current" ? node.right : undefined);
  const settled = (ready: boolean, status: string) => run(when, { ready, state: { status } });
  assert.equal(settled(false, "initial"), false, "Privy's init refresh is still running");
  assert.equal(settled(false, "done"), false, "Privy is not ready yet");
  assert.equal(settled(true, "loading"), false, "a JWT sign-in is in flight");
  for (const status of ["initial", "not-enabled", "done", "error"]) assert.equal(settled(true, status), true, status);
});

test("an unsettled Privy delays its logout by at most three seconds", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const flush = () => new Promise(resolve => setImmediate(resolve));
  const h = ending({ current: false });
  const done = h.end();
  for (let waited = 0; waited < 2950; waited += 50) { await flush(); t.mock.timers.tick(50); }
  await flush();
  assert.equal(h.state.logouts, 0);
  t.mock.timers.tick(50);
  await done;
  assert.equal(h.state.logouts, 1);
});

test("a bridge mounted only for sign-out never signs in, opens the wallet or reports one to the release panel", () => {
  const guard = bridge(node => ts.isVariableDeclaration(node) && node.name.getText() === "signingOut" ? node.initializer : undefined);
  assert.equal(run(guard, { useRef: (current: boolean) => ({ current }), logoutOnly: true }).current, true);
  assert.equal(run(guard, { useRef: (current: boolean) => ({ current }), logoutOnly: undefined }).current, false);
  const wallet = bridge(argument("useEffect", "getEthereumProvider"));
  for (const logoutOnly of [true, false]) {
    const reported: unknown[] = [];
    let opened = 0;
    const embedded = { address: "0x1111111111111111111111111111111111111111", getEthereumProvider: async () => { opened++; return { request: async () => [] }; } };
    run(wallet, { logoutOnly, owner: alice.id, ready: true, authenticated: true, walletsReady: true, subjectMatches: true, embedded, address: embedded.address,
      onWallet: (next: unknown) => { reported.push(next); }, current: { current: alice.id }, failure() {}, creating: { current: false }, attempted: { current: "" } })();
    assert.equal(reported.length === 0 && opened === 0, logoutOnly);
  }
});
