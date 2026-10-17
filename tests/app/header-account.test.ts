import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import test from "node:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tsImport } from "tsx/esm/api";
import ts from "typescript";
import {
  consumeSignOutRequest, createSignOutRequest, forgetSignedOut, hasSignOutRequest, markSignedOut, privySessionStored, safeReturnPath,
  SIGNED_OUT_KEY, signedOutHere, SIGNOUT_REQUEST_KEY, SIGNOUT_REQUEST_TTL_MS, withoutSignOutRequest,
} from "../../src/lib/supabase/signout-request.ts";

// The chip imports its stylesheet, as Next expects; under Node the import only has to resolve.
register(`data:text/javascript,${encodeURIComponent(`export async function load(url, context, next) {
  return new URL(url).pathname.endsWith(".css") ? { format: "module", source: "", shortCircuit: true } : next(url, context);
}`)}`);
const { AppHeader, HeaderAccount, HeaderAccountVisibility, NightWatchApp, accountDetail, accountLabel, needsPilotTrip, sessionKey, storyteller } =
  await tsImport("./header-account-fixtures.ts", import.meta.url);

const SITE = "https://fork-night.vercel.app";
/** next/dynamic loads the chip's chunk after the header's first render. */
async function chipLoaded() {
  renderToStaticMarkup(createElement(AppHeader, { current: "lobby", guide: false }));
  await new Promise(resolve => setTimeout(resolve, 50));
}
function memory(entries: Record<string, string> = {}) {
  const saved = new Map(Object.entries(entries));
  return { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => { saved.set(key, String(value)); }, removeItem: (key: string) => { saved.delete(key); } };
}
const wallet = "0x1111111111111111111111111111111111111111";
const users = {
  wallet: { id: "a1111111-1111-4111-8111-111111111111", is_anonymous: false, identities: [{ provider: "web3", identity_data: { custom_claims: { address: wallet, chain: "ethereum" }, address: wallet, chain: "ethereum" } }] },
  google: { id: "b2222222-2222-4222-8222-222222222222", is_anonymous: false, identities: [{ provider: "google", identity_data: {} }] },
  guest: { id: "c3333333-3333-4333-8333-333333333333", is_anonymous: true, identities: [] },
};

test("a sign-out request is a one-time token in this tab, with the page to come back to", () => {
  const storage = memory();
  const request = new URL(createSignOutRequest(storage, `${SITE}/#/project/blade-runner-memory`), SITE);
  assert.equal(request.pathname, "/pilot");
  const token = request.searchParams.get("signout")!;
  assert.match(token, /^[0-9a-f]{32}$/);
  assert.equal(request.searchParams.get("return"), "/#/project/blade-runner-memory");
  assert.equal(JSON.parse(storage.getItem(SIGNOUT_REQUEST_KEY)!).token, token);
  assert.notEqual(new URL(createSignOutRequest(memory(), `${SITE}/`), SITE).searchParams.get("signout"), token, "every request has its own token");
  assert.equal(new URL(createSignOutRequest(memory(), `${SITE}/agents?view=wren#turn`), SITE).searchParams.get("return"), "/agents?view=wren#turn");

  assert.deepEqual(consumeSignOutRequest(storage, request.href), { returnTo: "/#/project/blade-runner-memory" });
  assert.equal(storage.getItem(SIGNOUT_REQUEST_KEY), null);
  assert.equal(consumeSignOutRequest(storage, request.href), null, "a used token signs no one out again");
});

test("a request from another site or tab, or a stale one, signs no one out", () => {
  const storage = memory();
  const request = new URL(createSignOutRequest(storage, `${SITE}/tempo`, { now: 1_000 }), SITE);
  const forged = new URL(request);
  forged.searchParams.set("signout", "0".repeat(32));
  assert.equal(consumeSignOutRequest(storage, forged.href, 1_000), null);
  assert.notEqual(storage.getItem(SIGNOUT_REQUEST_KEY), null, "a wrong token leaves this tab's request alone");
  for (const token of ["", "abc", "0".repeat(31), "Z".repeat(32)]) {
    forged.searchParams.set("signout", token);
    assert.equal(consumeSignOutRequest(storage, forged.href, 1_000), null, token);
  }
  assert.equal(consumeSignOutRequest(memory(), request.href, 1_000), null, "another tab holds no request");
  assert.equal(consumeSignOutRequest(memory({ [SIGNOUT_REQUEST_KEY]: "not json" }), request.href), null);
  assert.equal(consumeSignOutRequest(storage, `${SITE}/pilot`), null, "no request in the address");
  assert.equal(consumeSignOutRequest(storage, request.href, 1_000 + SIGNOUT_REQUEST_TTL_MS + 1), null, "expired");
  assert.equal(storage.getItem(SIGNOUT_REQUEST_KEY), null, "an expired request is spent");
});

test("only a same-origin path that starts with one slash is a return address", () => {
  for (const [path, expected] of [["/", "/"], ["/agents", "/agents"], ["/#/project/blade-runner-memory", "/#/project/blade-runner-memory"],
    ["/pilot?room=paper-moon#moment", "/pilot?room=paper-moon#moment"], ["/a/../tempo", "/tempo"], ["/agents?tab=wren#roster", "/agents?tab=wren#roster"],
    ["/a/../agents", "/agents"]]) assert.equal(safeReturnPath(path, SITE), expected);
  for (const path of ["//evil.example", "/\\evil.example", "\\\\evil.example", "https://evil.example/", "javascript:alert(1)", "/\t/evil.example",
    "/\n/evil.example", "agents", " /agents", "", null, undefined, `/${"a".repeat(2000)}`]) assert.equal(safeReturnPath(path, SITE), null, JSON.stringify(path));
  // Dot segments, plain or percent-encoded, can collapse a path to "//host", which location.replace reads as another site.
  for (const path of ["/.//evil.example", "/..//evil.example/x", "/%2e//evil.example", "/%2E//evil.example", "/a/..//evil.example",
    "/a/%2e%2e//evil.example", "/.%2e//evil.example", "/x/.././/evil.example?q#h", "/.//"]) assert.equal(safeReturnPath(path, SITE), null, path);
  // A return address forged into this tab's own request still stays on the site.
  for (const forged of ["//evil.example/next", "/.//evil.example/phish"]) {
    const storage = memory();
    const request = new URL(createSignOutRequest(storage, `${SITE}/tempo`), SITE);
    request.searchParams.set("return", forged);
    assert.deepEqual(consumeSignOutRequest(storage, request.href), { returnTo: null }, forged);
  }
});

test("/pilot can drop the request from its address and keep the rest", () => {
  const address = `${SITE}/pilot?room=paper-moon&signout=${"a".repeat(32)}&return=%2Fagents#moment`;
  assert.equal(hasSignOutRequest(address), true);
  assert.equal(withoutSignOutRequest(address), `${SITE}/pilot?room=paper-moon#moment`);
  assert.equal(hasSignOutRequest(`${SITE}/pilot?room=paper-moon`), false);
  assert.equal(hasSignOutRequest("not a url"), false);
});

test("only a saved account with a stored Privy session takes the trip through /pilot", () => {
  assert.equal(privySessionStored(memory({ "privy:token": "t" })), true);
  assert.equal(privySessionStored(memory({ "privy:refresh_token": "r" })), true);
  assert.equal(privySessionStored(memory({ "privy:caid": "device" })), false, "a device id is not a sign-in");
  assert.equal(privySessionStored({ getItem() { throw new Error("blocked"); } }), false);
  const privy = memory({ "privy:token": "t" });
  const saved = storyteller(users.google);
  assert.equal(needsPilotTrip(saved, privy, true), true);
  assert.equal(needsPilotTrip(storyteller(users.wallet), privy, true), true);
  assert.equal(needsPilotTrip(saved, memory(), true), false, "no Privy session: sign out on the page");
  assert.equal(needsPilotTrip(storyteller(users.guest), privy, true), false, "/pilot mounts no Privy bridge for a guest either");
  assert.equal(needsPilotTrip(saved, privy, false), false, "without a Privy app there is no bridge to mount");
  assert.throws(() => createSignOutRequest({ setItem() { throw new Error("blocked"); } }, `${SITE}/`), "without session storage the chip signs out on the page");
});

test("the chip checks the same storage key supabase-js derives for the project", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const url = "https://abcdefghijklmnopqrst.supabase.co";
  const client = createClient(url, "sb_publishable_0123456789abcdefghijkl", { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  assert.equal(sessionKey(url), (client.auth as unknown as { storageKey: string }).storageKey);
  assert.equal(sessionKey(url), "sb-abcdefghijklmnopqrst-auth-token");
  assert.equal(sessionKey(""), undefined);
  assert.equal(sessionKey("not a url"), undefined);
});

test("the chip names the storyteller, else a short wallet address, else the kind of account", () => {
  const named = (user: object, name: string) => accountLabel(storyteller(user, name));
  assert.equal(named(users.wallet, "  Lamplighter "), "Lamplighter");
  assert.equal(accountLabel(storyteller(users.wallet)), "0x1111…1111");
  assert.equal(accountLabel(storyteller(users.guest)), "Guest");
  assert.equal(accountLabel(storyteller(users.google)), "Google account");
  assert.equal(accountLabel(storyteller({ id: "d", is_anonymous: false, identities: [] })), "Saved account");
  assert.equal(accountLabel(storyteller(users.wallet, "   ")), "0x1111…1111", "a blank name is no name");
  assert.equal(accountLabel(storyteller({ ...users.wallet, identities: [{ provider: "web3", identity_data: { address: "not-an-address" } }] })), "Saved account");
  assert.equal(accountDetail(storyteller(users.guest, "Moth")), "Guest in this browser, with no saved sign-in.");
  assert.equal(accountDetail(storyteller(users.wallet, "Lamplighter")), "Signed in with your wallet 0x1111…1111.");
  assert.equal(accountDetail(storyteller(users.wallet)), "Signed in with your wallet.");
  assert.equal(accountDetail(storyteller(users.google)), "Saved with Google.");
  assert.equal(storyteller({ id: "e", identities: [] }).anonymous, true, "an unknown account is treated as a guest, so sign-out asks first");
});

test("the server sends an empty box of fixed size and never guesses the account", () => {
  assert.equal(renderToStaticMarkup(createElement(HeaderAccount)), '<div class="fn-account"><span class="fn-account-sr" role="status"></span></div>');
  assert.equal(renderToStaticMarkup(createElement(HeaderAccountVisibility.Provider, { value: false }, createElement(HeaderAccount))), "");
});

test("the header holds the chip after a page's own controls; views with an account bar leave it out", async () => {
  const header = (props: Record<string, unknown>, children?: ReactNode) => renderToStaticMarkup(createElement(AppHeader, { current: "lobby", guide: false, ...props }, children));
  const actions = (html: string) => html.match(/<div class="fn-header-actions">([\s\S]*)<\/div><\/header>/)?.[1] ?? null;
  await chipLoaded();
  const box = '<div class="fn-account"><span class="fn-account-sr" role="status"></span></div>';
  assert.equal(actions(header({})), box, "the container is created when a page passes nothing");
  assert.equal(actions(header({}, createElement("span", { className: "persona" }, "Sam"))), `<span class="persona">Sam</span>${box}`);
  assert.equal(actions(header({ account: false })), null, "no empty container");
  assert.equal(actions(header({ account: false }, createElement("span", null, "Sam"))), "<span>Sam</span>");
  const wrapped = renderToStaticMarkup(createElement(HeaderAccountVisibility.Provider, { value: false }, createElement(AppHeader, { current: "agents", guide: false }, createElement("span", null, "Menu"))));
  assert.equal(actions(wrapped), "<span>Menu</span>");
  assert.match(renderToStaticMarkup(createElement(AppHeader, { current: "lobby" })), /<div class="fn-first-header-guide">/, "the first-night guide stays");
});

test("the Night Watch keeps its own account menu in the header and hides the chip", async () => {
  await chipLoaded();
  assert.match(renderToStaticMarkup(createElement(AppHeader, { current: "agents", guide: false })), /class="fn-account"/);
  const html = renderToStaticMarkup(createElement(NightWatchApp, { privyDemo: false }));
  const header = html.slice(html.indexOf('<header class="fn-header">'), html.indexOf("</header>"));
  assert.match(header, /<div class="fn-header-actions"><span class="nw-account-slot">/);
  assert.doesNotMatch(header, /fn-account/);
});

test("the chip asks for the Supabase client only for a stored session, and its copy stays plain", async () => {
  const source = await readFile("src/components/header-account.tsx", "utf8");
  const header = await readFile("src/components/app-header.tsx", "utf8");
  assert.match(header, /dynamic\(\(\) => import\("\.\/header-account\.tsx"\)/, "the chip is its own chunk");
  assert.match(source, /^import "@\/app\/header-account\.css";$/m);
  const imports = [...source.matchAll(/^import (?!type\b)[^;]+from "([^"]+)";$/gm)].map(match => match[1]);
  assert.deepEqual(imports.filter(path => /supabase-js|pilot-client|onboarding|pilot-rooms/.test(path)), [], "header-account.tsx has no static import of the Supabase client or the sign-out helpers");
  assert.match(source, /await import\("\.\.\/lib\/supabase\/pilot-client\.ts"\)/);
  assert.match(source, /This guest can't be recovered\./);
  assert.match(source, /Sign out of this browser/);
  assert.doesNotMatch(source, /real money|mainnet|audited|funded credits|patron paid/i);
  assert.doesNotMatch(source, /window\.confirm|confirm\(/, "the guest confirms inside the menu");
});

test("a guest can save with Google from the chip, or from the menu on phones, and Back from Google frees the button", async () => {
  const source = await readFile("src/components/header-account.tsx", "utf8");
  const css = (await readFile("src/app/header-account.css", "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");
  assert.equal(source.match(/void saveWithGoogle\(\)/g)?.length, 2, "the inline action and the menu action start the same flow");
  assert.match(source, /if \(event\.persisted\) \{ setBusy\(false\); setGoogleBusy\(false\); \}/, "a page restored from the back-forward cache is not stuck on Opening Google");
  assert.match(css, /\.fn-account-save-google \{ display: none; \}/, "the inline action leaves phones");
  assert.match(css, /\.fn-account-save-google-menu \{\s*display: none;/, "the menu action is hidden wherever the inline one shows");
  assert.match(css, /\.fn-account-save-google-menu \{ display: block; \}/, "and the menu carries it on phones");
});

test("the box keeps one size from the first paint, and the phone menu opens under the chip inside the screen", async () => {
  const css = (await readFile("src/app/header-account.css", "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = (selector: string, within = css) => within.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`))?.[1] ?? "";
  const phone = css.slice(css.indexOf("@media (max-width: 640px)"));
  // The text inside the media query that opens with `opening`.
  const block = (text: string, opening: string) => {
    const start = text.indexOf(opening);
    assert.ok(start >= 0, opening);
    for (let index = start + opening.length, depth = 1; index < text.length; index++) {
      if (text[index] === "{") depth++;
      else if (text[index] === "}" && --depth === 0) return text.slice(start + opening.length, index);
    }
    throw new Error("unbalanced braces");
  };
  assert.match(rule(".fn-header .fn-account"), /flex: none;[\s\S]*width: 184px;\s*height: 44px;/);
  assert.match(rule(".fn-header .fn-account", css.slice(css.indexOf("@media (max-width: 720px)"))), /width: 152px;/);
  assert.match(rule(".fn-header .fn-account", phone), /width: 44px;/);
  assert.match(rule(".fn-header .fn-account"), /position: relative;/, "the menu is placed against the chip, not the page");
  const panel = rule(".fn-header .fn-account-panel");
  assert.match(panel, /position: absolute;\s*top: calc\(100% \+ 8px\);\s*right: 0;/);
  assert.match(panel, /width: min\(300px, calc\(100vw - 32px\)\);/);
  assert.doesNotMatch(phone, /fn-account-panel|position: static/, "phones keep the same anchor");
  assert.match(rule(".fn-header .fn-account-signin"), /height: 44px;/);
  assert.match(rule(".fn-header .fn-account-menu > summary"), /height: 44px;/);
  assert.match(rule(".fn-header .fn-account-signout"), /min-height: 44px;/);
  assert.match(rule(".fn-header :is(.fn-account-keep, .fn-account-danger)"), /min-height: 44px;/);
  // The agents page's "Open the room" is an arrow circle beside the chip on phones, its words above 420px, and gone below 310px.
  const icon = css.indexOf(".fn-header .ag-header-room > svg { display: none; }");
  assert.ok(icon > 0, "no arrow above 420px");
  assert.equal([...css.slice(0, icon)].reduce((depth, char) => depth + (char === "{" ? 1 : char === "}" ? -1 : 0), 0), 0, "outside any media query");
  const room = block(css, "@media (max-width: 420px) {");
  assert.ok(css.indexOf("@media (max-width: 420px) {") > icon, "the phone rule comes later, so it wins");
  assert.match(room, /\.fn-header \.fn-header-actions > \.ag-button \{ width: 44px; min-height: 44px; height: 44px; padding: 0; border-radius: 999px; \}/);
  assert.match(room, /\.fn-header \.ag-header-room > svg \{ display: block; \}/);
  assert.match(rule(".fn-header .ag-header-room-label", room), /position: absolute;\s*width: 1px;\s*height: 1px;\s*margin: -1px;\s*overflow: hidden;\s*clip-path: inset\(50%\);/,
    "the words leave the screen but stay in the accessible name");
  assert.doesNotMatch(room, /display: none/);
  assert.match(block(css, "@media (max-width: 309px) {"), /\.fn-header \.fn-header-actions > \.ag-button \{ display: none; \}/);
  // On phones only the chip shows an avatar in the header; the lobby's preview strip keeps its portrait.
  assert.match(block(css, "@media (max-width: 640px) {"), /\.fn-header \.fn-header-actions \.social-user \.social-avatar \{ display: none; \}/);
  // Controls a page adds after hydration do not move the chip: the actions box fills its row at every width.
  const filled = css.indexOf(".fn-header .fn-header-actions { flex: 1 1 auto; justify-content: flex-end; }");
  assert.ok(filled > 0, "the actions box fills its row");
  assert.equal([...css.slice(0, filled)].reduce((depth, char) => depth + (char === "{" ? 1 : char === "}" ? -1 : 0), 0), 0, "outside any media query");
  // The narrowest phones shrink only the social pages' brand and gaps, which the server already renders.
  const narrow = block(css, "@media (max-width: 340px) {");
  assert.match(narrow, /\.social-app \.fn-header \{ column-gap: 8px; \}/);
  assert.match(narrow, /\.social-app \.fn-header \.fn-brand \{ font-size: 26px; \}/);
  assert.match(narrow, /\.social-app \.fn-header \.fn-header-actions \{ gap: 8px; \}/);
  assert.deepEqual([...narrow.matchAll(/^\s*([^{}\n]+?)\s*\{/gm)].map(match => match[1]).filter(selector => !selector.startsWith(".social-app ")), [],
    "scoped to the social pages");
});

// The chip's own decisions, lifted out of header-account.tsx and run with fakes for React state, storage,
// navigation and its two dynamic imports. Rendering on the server cannot reach them: they run only in the browser.
const chipFile = ts.createSourceFile("header-account.tsx", await readFile("src/components/header-account.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function lift(name: string) {
  let found: ts.FunctionDeclaration | ts.VariableDeclaration | undefined;
  (function visit(node: ts.Node) {
    if (found) return;
    if ((ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) && node.name?.getText(chipFile) === name) found = node;
    else ts.forEachChild(node, visit);
  })(chipFile);
  assert.ok(found, `header-account.tsx declares ${name}`);
  return ts.isVariableDeclaration(found) ? found.initializer!.getText(chipFile) : found.getText(chipFile);
}
function argumentOf(callee: string) {
  let found: ts.CallExpression | undefined;
  (function visit(node: ts.Node) {
    if (found) return;
    if (ts.isCallExpression(node) && node.expression.getText(chipFile) === callee) found = node;
    else ts.forEachChild(node, visit);
  })(chipFile);
  assert.ok(found, `header-account.tsx calls ${callee}`);
  return found.arguments[0].getText(chipFile);
}
/** Runs lifted code as JavaScript in `scope`; its dynamic imports go to scope.load. */
function run(code: string, scope: Record<string, unknown>) {
  const js = ts.transpile(`(${code})`, { target: ts.ScriptTarget.ES2022 }).replace(/\bimport\(/g, "load(");
  return new Function(...Object.keys(scope), `return ${js}`)(...Object.values(scope));
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

function chipMenu(user: object, saved: Record<string, string>, failures: { signOut?: Error; sessionStorage?: boolean; localStorage?: boolean } = {}) {
  const steps: string[] = [];
  const timers: (() => void)[] = [];
  const account = storyteller(user, "Moth");
  const client = { fake: "client" };
  const sessionStorage = failures.sessionStorage ? { getItem: () => null, setItem() { throw new Error("blocked"); }, removeItem() {} } : memory();
  const localStorage = memory();
  const listeners = new Map<string, Set<(event: Event) => void>>();
  const listenerKey = (type: string, capture?: boolean) => `${type}${capture ? " capture" : ""}`;
  const window = {
    sessionStorage, localStorage,
    location: { href: `${SITE}/agents?tab=wren`, replace: (url: string) => steps.push(`replace ${url}`), assign: (url: string) => steps.push(`assign ${url}`) },
    setTimeout: (run: () => void, ms: number) => { timers.push(run); steps.push(`timer ${ms}`); },
    addEventListener: (type: string, listener: (event: Event) => void, capture?: boolean) => {
      listeners.set(listenerKey(type, capture), (listeners.get(listenerKey(type, capture)) ?? new Set()).add(listener));
    },
    removeEventListener: (type: string, listener: (event: Event) => void, capture?: boolean) => { listeners.get(listenerKey(type, capture))?.delete(listener); },
  };
  if (failures.localStorage) Object.defineProperty(window, "localStorage", { get() { throw new Error("blocked"); } });
  /** The page's next input of this type: every listener for it runs, as a dispatch would. */
  const press = (type: string, init: { repeat?: boolean } = {}) => {
    for (const key of [listenerKey(type, true), listenerKey(type)]) for (const listener of [...listeners.get(key) ?? []]) listener({ type, ...init } as unknown as Event);
  };
  const listening = () => [...listeners].filter(([, set]) => set.size).map(([key, set]) => `${key} x${set.size}`);
  const modules: Record<string, object> = {
    "../lib/supabase/onboarding.ts": { signOutPilotAccount: async (used: unknown, storage: unknown) => {
      steps.push("signOutPilotAccount");
      assert.equal(used, client); assert.equal(storage, sessionStorage);
      if (failures.signOut) throw failures.signOut;
    } },
    "../lib/pilot-rooms.ts": { clearVisitorIdeas: (storage: unknown) => { steps.push("clearVisitorIdeas"); assert.equal(storage, localStorage); } },
  };
  const focusAfterConfirm = { current: null as unknown };
  const warning = { current: null };
  const expireCookie = (name: string) => steps.push(`expire ${name}`);
  // The chip calls this inside a try/catch, so a failed check shows only as the missing step.
  const forgetPrivySession = (storage: unknown, expire: unknown, appId?: unknown) => {
    assert.equal(storage, localStorage); assert.equal(expire, expireCookie);
    assert.equal(appId, undefined, "the build's app id, so this app's guest credential goes too");
    steps.push("forgetPrivySession");
  };
  const handlers = run(`() => { ${lift("signOut")}\n${lift("requestSignOut")}\nreturn { signOut, requestSignOut }; }`, {
    ready: { status: "ready", client, account, named: true }, busy: false, account, savedHere: memory(saved), window, createSignOutRequest,
    forgetPrivySession, expireCookie,
    needsPilotTrip: (who: unknown, storage: unknown) => needsPilotTrip(who, storage, true),
    load: async (path: string) => { steps.push(`load ${path}`); return modules[path]; },
    setBusy: (value: boolean) => steps.push(`busy ${value}`), setError: (value: string) => { if (value) steps.push(`error ${value}`); },
    setConfirming: (value: boolean) => steps.push(`confirm ${value}`), focusAfterConfirm, warning, onSignedOut: () => steps.push("signed out"),
  })();
  return { steps, timers, handlers, sessionStorage, focusAfterConfirm, warning, press, listening };
}
const loads = ["load ../lib/supabase/onboarding.ts", "load ../lib/pilot-rooms.ts"];

test("a guest confirms in the menu first, then signs out on the page even with Privy keys left over", async () => {
  const chip = chipMenu(users.guest, { "privy:token": "t" });
  chip.handlers.requestSignOut();
  await settle();
  assert.deepEqual(chip.steps, ["confirm true"], "nothing is signed out before the guest confirms");
  assert.equal(chip.focusAfterConfirm.current, chip.warning, "focus moves to the warning");
  chip.handlers.signOut();
  await settle();
  assert.deepEqual(chip.steps.slice(1), ["busy true", ...loads, "signOutPilotAccount", "clearVisitorIdeas", "signed out"]);
});

test("a saved account with a stored Privy session replaces the page with the /pilot trip and signs nothing out here", async () => {
  const chip = chipMenu(users.google, { "privy:token": "t" });
  chip.handlers.requestSignOut();
  await settle();
  const [busy, replace, ...rest] = chip.steps;
  assert.deepEqual([busy, rest], ["busy true", []], "no dynamic imports and no local sign-out");
  const trip = new URL(replace.replace(/^replace /, ""), SITE);
  assert.equal(`${trip.pathname}?signout`, "/pilot?signout");
  assert.deepEqual(consumeSignOutRequest(chip.sessionStorage, trip.href), { returnTo: "/agents?tab=wren" }, "/pilot accepts the request this tab stored");
});

test("during the trip the button stays busy until the next press or key, which also lets it start again", async () => {
  for (const input of ["pointerdown", "keydown"]) {
    const chip = chipMenu(users.google, { "privy:token": "t" });
    chip.handlers.requestSignOut();
    await settle();
    assert.deepEqual(chip.timers, [], "no timer: without input the button stays busy until /pilot loads");
    assert.deepEqual(chip.listening(), ["pointerdown capture x1", "keydown capture x1"], "the chip hears the next input before the page does");
    assert.match(chip.steps.at(-1)!, /^replace /, "still busy without input");
    chip.press(input);
    assert.equal(chip.steps.at(-1), "busy false", `the next ${input} gives the button back after a cancelled navigation`);
    assert.deepEqual(chip.listening(), [], "both listeners are gone");
    chip.press("pointerdown");
    chip.press("keydown");
    assert.equal(chip.steps.filter(step => step === "busy false").length, 1, "later input changes nothing");
    chip.handlers.requestSignOut();
    await settle();
    assert.equal(chip.steps.filter(step => step.startsWith("replace ")).length, 2, "a press on the button starts the trip again");
    assert.deepEqual(chip.listening(), ["pointerdown capture x1", "keydown capture x1"]);
  }
});

test("a held key's repeats keep the trip's button busy; the next fresh key gives it back, once", async () => {
  const chip = chipMenu(users.google, { "privy:token": "t" });
  chip.handlers.requestSignOut();
  await settle();
  chip.press("keydown", { repeat: true });
  chip.press("keydown", { repeat: true });
  assert.equal(chip.steps.includes("busy false"), false, "a held Enter cannot re-enable the button and start the trip again");
  assert.deepEqual(chip.listening(), ["pointerdown capture x1", "keydown capture x1"]);
  chip.press("keydown");
  chip.press("keydown");
  assert.equal(chip.steps.filter(step => step === "busy false").length, 1);
  assert.deepEqual(chip.listening(), []);
});

test("a saved account without a Privy session signs out on the page: Supabase first, then this browser's unsent ideas", async () => {
  const chip = chipMenu(users.google, {});
  chip.handlers.requestSignOut();
  await settle();
  assert.deepEqual(chip.steps, ["busy true", ...loads, "signOutPilotAccount", "clearVisitorIdeas", "signed out"]);
  const blocked = chipMenu(users.wallet, { "privy:token": "t" }, { sessionStorage: true });
  blocked.handlers.requestSignOut();
  await settle();
  assert.deepEqual(blocked.steps, ["busy true", ...loads, "signOutPilotAccount", "forgetPrivySession", "clearVisitorIdeas", "signed out"],
    "no safe request without sessionStorage: sign out here, then remove the Privy session's keys as /pilot does");
  const failed = chipMenu(users.google, {}, { signOut: new Error("Your account could not be signed out. Refresh and try again.") });
  failed.handlers.requestSignOut();
  await settle();
  assert.deepEqual(failed.steps, ["busy true", ...loads, "signOutPilotAccount", "busy false", "error Your account could not be signed out. Refresh and try again."],
    "a failed sign-out keeps the ideas and the account");
});

test("without sessionStorage, Privy's keys go only after the storyteller is signed out, and blocked storage cannot stop it", async () => {
  const failed = chipMenu(users.wallet, { "privy:token": "t" }, { sessionStorage: true, signOut: new Error("Your account could not be signed out. Refresh and try again.") });
  failed.handlers.requestSignOut();
  await settle();
  assert.deepEqual(failed.steps, ["busy true", ...loads, "signOutPilotAccount", "busy false", "error Your account could not be signed out. Refresh and try again."],
    "still signed in: the Privy session stays with it");
  const locked = chipMenu(users.wallet, { "privy:token": "t" }, { sessionStorage: true, localStorage: true });
  locked.handlers.requestSignOut();
  await settle();
  assert.deepEqual(locked.steps, ["busy true", ...loads, "signOutPilotAccount", "signed out"], "storage that refuses access is skipped");
});

test("the chip treats only supabase-js's own session key as a stored session", () => {
  const key = "sb-abcdefghijklmnopqrst-auth-token";
  const stored = (entries: Record<string, string>, sessionKey = () => key as string | undefined) => run(lift("sessionStored"), { sessionKey, savedHere: memory(entries) })();
  assert.equal(stored({ [key]: "{}" }), true);
  assert.equal(stored({ [`${key}-code-verifier`]: "verifier" }), false, "a Google sign-in in progress is not a session");
  assert.equal(stored({}), false);
  assert.equal(stored({ [key]: "{}" }, () => undefined), false, "without Supabase settings there is no session to read");
});

test("this tab's sign-out and other tabs' storage changes both reach the session store", () => {
  const target = new EventTarget();
  const SESSION_CHANGED = run(lift("SESSION_CHANGED"), {});
  let changes = 0;
  const unsubscribe = run(lift("subscribeSession"), { window: target, SESSION_CHANGED })(() => changes++);
  const focusSignIn = { current: false };
  let notice = "";
  run(lift("signedOut"), { window: target, SESSION_CHANGED, focusSignIn, setNotice: (value: string) => { notice = value; } })();
  assert.equal(changes, 1, "the chip re-reads the store after its own sign-out");
  assert.equal(notice, "Signed out of this browser.");
  assert.equal(focusSignIn.current, true, "focus moves to Sign in");
  target.dispatchEvent(new Event("storage"));
  assert.equal(changes, 2, "another tab's sign-in or sign-out");
  unsubscribe();
  target.dispatchEvent(new Event("storage"));
  assert.equal(changes, 2);
});

test("the open menu follows auth events after the first read, and other tabs' changes to the session key", () => {
  const key = "sb-abcdefghijklmnopqrst-auth-token";
  let refreshes = 0;
  const changed = run(lift("changed"), { key, refresh: () => { refreshes++; } });
  for (const event of [{ key }, { key: null }, { key: `${key}-code-verifier` }, { key: "fork-night-pilot-idea:visitor:x" }]) changed(event);
  assert.equal(refreshes, 2, "the session key, or a cleared storage");

  const shown: unknown[][] = [];
  const later: (() => void)[] = [];
  const connected = { fake: "client" };
  const listen = (live: boolean) => run(argumentOf("connected.auth.onAuthStateChange"), {
    live, connected, show: (...args: unknown[]) => { shown.push(args); }, setTimeout: (run: () => void) => { later.push(run); },
  });
  const session = { user: users.wallet };
  listen(true)("INITIAL_SESSION", session);
  assert.equal(later.length, 0, "the first session comes from getSession()");
  listen(true)("SIGNED_IN", session);
  listen(true)("SIGNED_OUT", null);
  assert.deepEqual(shown, [], "Supabase calls wait until the auth callback has returned");
  for (const run of later) run();
  assert.deepEqual(shown, [[connected, session], [connected, null]]);
  listen(false)("TOKEN_REFRESHED", session);
  later.at(-1)!();
  assert.equal(shown.length, 2, "an unmounted menu ignores late events");
});

/** The chip's first effect on a page load at `pathname`, with this tab's storage, a stored session or not, and a manual clock. */
function chipMount(tab: Pick<Storage, "getItem" | "setItem" | "removeItem"> | "blocked", { session = false, pathname = "/agents" } = {}) {
  let effect: ts.CallExpression | undefined;
  (function visit(node: ts.Node) {
    if (effect) return;
    if (ts.isCallExpression(node) && node.expression.getText(chipFile) === "useEffect" && node.arguments[0].getText(chipFile).includes("signedOutHere")) effect = node;
    else ts.forEachChild(node, visit);
  })(chipFile);
  assert.ok(effect, "AccountChip checks for a sign-out on mount");
  const steps: string[] = [];
  const pending = new Map<number, () => void>();
  let timer = 0;
  const listeners = new Map<string, Set<(event?: Event) => void>>();
  const window = {
    get sessionStorage() { if (tab === "blocked") throw new Error("blocked"); return tab; },
    location: { pathname },
    setTimeout: (run: () => void, ms: number) => { steps.push(`timer ${ms}`); pending.set(++timer, run); return timer; },
    clearTimeout: (id: number) => { pending.delete(id); },
    addEventListener: (type: string, listener: (event?: Event) => void, capture?: boolean) => {
      steps.push(`listen ${type}${capture ? " capture" : ""}`);
      listeners.set(type, (listeners.get(type) ?? new Set()).add(listener));
    },
    removeEventListener: (type: string, listener: (event?: Event) => void, capture?: boolean) => { if (capture) listeners.get(type)?.delete(listener); },
  };
  const focusSignIn = { current: false };
  const cleanup = run(effect.arguments[0].getText(chipFile), {
    window, focusSignIn, signedOutHere, forgetSignedOut, sessionStored: () => session,
    setMounted: (value: boolean) => steps.push(`mounted ${value}`), setNotice: (value: string) => steps.push(`notice ${value}`),
  })();
  /** The browser fires `type` at the window: pagehide when the page goes away (a link, a reload), pointerdown or keydown when the visitor acts. */
  const fire = (type: string, init: { repeat?: boolean } = {}) => { for (const listener of [...listeners.get(type) ?? []]) listener({ type, ...init } as unknown as Event); };
  const leave = () => fire("pagehide");
  const listening = () => [...listeners.values()].reduce((count, set) => count + set.size, 0);
  return { steps, focusSignIn, cleanup, pending, fire, leave, listening };
}

test("back from the /pilot trip, the chip confirms the sign-out and moves focus to Sign in, then forgets it", () => {
  const tab = memory();
  markSignedOut(tab, "/agents?tab=wren#roster");
  const chip = chipMount(tab, { pathname: "/agents" });
  assert.deepEqual(chip.steps, ["mounted true", "notice Signed out of this browser.", "listen pagehide capture", "listen pointerdown capture", "listen keydown capture", "timer 1000"]);
  assert.equal(chip.focusSignIn.current, true);
  assert.ok(signedOutHere(tab, "/agents"), "kept for a second");
  for (const forget of chip.pending.values()) forget();
  assert.equal(tab.getItem(SIGNED_OUT_KEY), null, "a reload or the next page says nothing");
});

test("a stale flag, a stored session or blocked storage give no confirmation", () => {
  const stale = memory();
  markSignedOut(stale, "/agents", Date.now() - 31_000);
  const signedIn = memory();
  markSignedOut(signedIn, "/agents");
  const refusing = { getItem: () => { throw new Error("blocked"); }, setItem() {}, removeItem() {} };
  for (const chip of [chipMount(stale), chipMount(signedIn, { session: true }), chipMount("blocked"), chipMount(refusing)]) {
    assert.deepEqual(chip.steps, ["mounted true"]);
    assert.equal(chip.focusSignIn.current, false);
    assert.equal(chip.cleanup, undefined);
  }
});

test("a header replaced within the second (\"/\" restoring a #/project route) still confirms in the chip that stays", () => {
  const tab = memory();
  markSignedOut(tab, "/#/project/blade-runner-memory");
  const removed = chipMount(tab, { pathname: "/" });
  removed.cleanup();
  assert.equal(removed.pending.size, 0, "the removed chip does not forget the sign-out");
  assert.equal(removed.listening(), 0, "nor when the page goes away or the visitor acts later");
  const stays = chipMount(tab, { pathname: "/" });
  assert.deepEqual(stays.steps, ["mounted true", "notice Signed out of this browser.", "listen pagehide capture", "listen pointerdown capture", "listen keydown capture", "timer 1000"]);
  assert.equal(stays.focusSignIn.current, true);
  for (const forget of stays.pending.values()) forget();
  assert.equal(signedOutHere(tab, "/"), false);
});

test("only the page the trip returns to confirms: after a stopped return, another page says nothing", () => {
  const tab = memory();
  markSignedOut(tab, "/agents");
  const lobby = chipMount(tab, { pathname: "/" });
  assert.deepEqual(lobby.steps, ["mounted true"]);
  assert.equal(lobby.focusSignIn.current, false, "focus stays where the visitor put it");
  assert.ok(signedOutHere(tab, "/agents"), "the flag is left for its own page");
  assert.deepEqual(chipMount(tab, { pathname: "/agents" }).steps, ["mounted true", "notice Signed out of this browser.", "listen pagehide capture", "listen pointerdown capture", "listen keydown capture", "timer 1000"]);
});

test("leaving the return page within the second forgets the confirmation, so the next page stays quiet", () => {
  const tab = memory();
  markSignedOut(tab, "/agents");
  const page = chipMount(tab, { pathname: "/agents" });
  page.leave();
  assert.equal(tab.getItem(SIGNED_OUT_KEY), null);
  const reloaded = chipMount(tab, { pathname: "/agents" });
  assert.deepEqual(reloaded.steps, ["mounted true"], "a reload, a header link or Sign in then back: no second confirmation");
  assert.equal(reloaded.focusSignIn.current, false);
});

test("a press or key on the return page forgets the confirmation, so a view switch that replaces the header stays quiet", () => {
  for (const input of ["pointerdown", "keydown"]) {
    const tab = memory();
    markSignedOut(tab, "/#/project/blade-runner-memory");
    const project = chipMount(tab, { pathname: "/" });
    project.fire(input);
    assert.equal(tab.getItem(SIGNED_OUT_KEY), null, `the ${input} that starts a header link's view switch comes first`);
    project.cleanup();
    const lobby = chipMount(tab, { pathname: "/" });
    assert.deepEqual(lobby.steps, ["mounted true"], "the lobby's new header says nothing");
    assert.equal(lobby.focusSignIn.current, false);
  }
});

test("once the confirmation is forgotten, nothing is left listening and no timer is pending", () => {
  for (const end of ["timer", "pointerdown", "keydown", "pagehide"]) {
    const tab = memory();
    markSignedOut(tab, "/agents");
    const chip = chipMount(tab, { pathname: "/agents" });
    assert.deepEqual([chip.listening(), chip.pending.size], [3, 1]);
    if (end === "timer") for (const forget of [...chip.pending.values()]) forget();
    else chip.fire(end);
    assert.equal(tab.getItem(SIGNED_OUT_KEY), null, end);
    assert.deepEqual([chip.listening(), chip.pending.size], [0, 0], `after the ${end}, later presses find nothing to forget`);
  }
  const tab = memory();
  markSignedOut(tab, "/agents");
  const held = chipMount(tab, { pathname: "/agents" });
  held.fire("keydown", { repeat: true });
  assert.deepEqual([held.listening(), held.pending.size], [3, 1], "a held key's repeat changes nothing");
  assert.ok(signedOutHere(tab, "/agents"));
});

test("a key still held from the trip does not forget the confirmation before \"/\" restores its route", () => {
  const tab = memory();
  markSignedOut(tab, "/#/project/blade-runner-memory");
  const first = chipMount(tab, { pathname: "/" });
  first.fire("keydown", { repeat: true });
  assert.ok(signedOutHere(tab, "/"), "a repeat is not the visitor acting");
  first.cleanup();
  assert.equal(chipMount(tab, { pathname: "/" }).focusSignIn.current, true, "the chip that stays still confirms");
});

test("\"/\" restoring a #/project route confirms once: in the chip that stays, and in no later view", () => {
  const tab = memory();
  markSignedOut(tab, "/#/project/blade-runner-memory");
  const lobbyHeader = chipMount(tab, { pathname: "/" });
  lobbyHeader.cleanup();
  const projectHeader = chipMount(tab, { pathname: "/" });
  projectHeader.fire("pointerdown");
  projectHeader.cleanup();
  const spacesHeader = chipMount(tab, { pathname: "/" });
  const notices = [projectHeader, spacesHeader].flatMap(chip => chip.steps).filter(step => step.startsWith("notice "));
  assert.deepEqual(notices, ["notice Signed out of this browser."]);
  assert.equal(spacesHeader.focusSignIn.current, false);
});

test("the agents page's header link is named by its words, with an arrow that screen readers skip", async () => {
  const page = ts.createSourceFile("agents-showcase.tsx", await readFile("src/components/agents/agents-showcase.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let header: ts.JsxElement | undefined;
  (function visit(node: ts.Node) {
    if (header) return;
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(page) === "AgentRoomHeader") header = node;
    else ts.forEachChild(node, visit);
  })(page);
  assert.ok(header, "the page has its agents header");
  const links = header.children.filter(ts.isJsxElement);
  assert.equal(links.length, 1);
  const attribute = (element: ts.JsxOpeningLikeElement, name: string) =>
    element.attributes.properties.find(property => ts.isJsxAttribute(property) && property.name.getText(page) === name)?.getText(page);
  assert.equal(attribute(links[0].openingElement, "className"), 'className="ag-button ag-button-yellow ag-header-room"');
  assert.equal(attribute(links[0].openingElement, "href"), "href={ROOM_HREF}");
  const [arrow, label, ...rest] = links[0].children.filter(child => !ts.isJsxText(child) || child.getText(page).trim());
  assert.deepEqual(rest, []);
  assert.ok(ts.isJsxSelfClosingElement(arrow) && arrow.tagName.getText(page) === "ArrowRight");
  assert.equal(attribute(arrow, "aria-hidden"), 'aria-hidden="true"');
  assert.ok(ts.isJsxElement(label));
  assert.equal(attribute(label.openingElement, "className"), 'className="ag-header-room-label"');
  assert.equal(label.children.map(child => child.getText(page)).join(""), "Open the room", "the link's accessible name");
});
