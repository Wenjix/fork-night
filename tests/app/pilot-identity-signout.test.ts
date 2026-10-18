import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tsImport } from "tsx/esm/api";
import ts from "typescript";

const { GuestSignOutDialog, PilotAccountContext, PilotEntrance, PilotIdentity, roomSignOutBlock } = await tsImport("./pilot-identity-fixtures.ts", import.meta.url);

// The fields of the account context that PilotIdentity renders from.
const account = (user?: { id: string; is_anonymous: boolean }) => ({
  user, enabled: false, loading: false, error: "", authenticatingWallet: false, browserWallets: [],
  wallet: { owner: "", address: "", loading: false, error: "" }, walletMode: "external",
  signIn: async () => {}, signInWallet: async () => {}, signOut: async () => {}, chooseWallet() {},
});
const guest = { id: "c3333333-3333-4333-8333-333333333333", is_anonymous: true };
const profile = { id: guest.id, display_name: "Lamplighter", created_at: "2026-10-14T00:00:00Z" };
const render = (user: typeof guest | undefined, props: Record<string, unknown>) => renderToStaticMarkup(
  createElement(PilotAccountContext.Provider, { value: account(user) }, createElement(PilotIdentity, { onJoin() {}, disabled: false, ...props })));
const signOutButton = (html: string) => html.match(/<button[^>]*pilot-signout-button[^>]*>/)?.[0];

// A component's source: find its nodes, read a JSX attribute, and run an expression from it with fakes.
const tsx = async (path: string) => ts.createSourceFile(path, await readFile(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function findAll(root: ts.Node, match: (node: ts.Node) => boolean) {
  const found: ts.Node[] = [];
  (function visit(node: ts.Node) { if (match(node)) found.push(node); ts.forEachChild(node, visit); })(root);
  return found;
}
const find = (root: ts.Node, match: (node: ts.Node) => boolean) => findAll(root, match)[0];
const element = (name: string) => (node: ts.Node) => (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText() === name;
function attr(node: ts.Node, name: string) {
  const found = (node as ts.JsxOpeningLikeElement).attributes.properties.find(prop => ts.isJsxAttribute(prop) && prop.name.getText() === name) as ts.JsxAttribute | undefined;
  return found?.initializer;
}
const js = (node: ts.Node) => ts.transpile(`(${(ts.isJsxExpression(node) ? node.expression! : node).getText()})`, { target: ts.ScriptTarget.ES2022 });
const evaluate = (code: string, env: Record<string, unknown>) => new Function(...Object.keys(env), `return ${code}`)(...Object.values(env));

// How a view wires its identity menu's sign-out: its `signOutBlock` and PilotIdentity's props, for one state of the view.
async function signOutWiring(path: string) {
  const source = await tsx(path);
  const block = find(source, node => ts.isVariableDeclaration(node) && node.name.getText() === "signOutBlock") as ts.VariableDeclaration;
  const identityDisabled = find(source, node => ts.isVariableDeclaration(node) && node.name.getText() === "identityDisabled") as ts.VariableDeclaration | undefined;
  const identity = find(source, element("PilotIdentity"));
  assert.ok(block?.initializer && identity);
  const prop = (name: string) => { const value = attr(identity, name); return value && js(value); };
  const [blockCode, disabled, signOutDisabled, reason] = [js(block.initializer), prop("disabled")!, prop("signOutDisabled"), prop("signOutBlockedReason")];
  return (state: Record<string, unknown>) => {
    const env = { roomSignOutBlock, profile: undefined, ...state };
    const view: Record<string, unknown> = { ...env, signOutBlock: evaluate(blockCode, env) };
    if (identityDisabled?.initializer) view.identityDisabled = evaluate(js(identityDisabled.initializer), view);
    const off = evaluate(disabled, view);
    return { disabled: off, signOutDisabled: signOutDisabled ? evaluate(signOutDisabled, view) : off, reason: reason ? evaluate(reason, view) : "" };
  };
}

// The text inside the braces that open at `open`.
function block(css: string, open: number) {
  let depth = 0;
  for (let index = open; index < css.length; index++) {
    if (css[index] === "{") depth++;
    else if (css[index] === "}" && --depth === 0) return css.slice(open + 1, index);
  }
  throw new Error("unbalanced braces");
}
// The declarations of the rule for `selector` that starts a line of `css`.
function declarations(css: string, selector: string) {
  const start = css.search(new RegExp(`^\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{`, "m"));
  assert.ok(start >= 0, selector);
  return Object.fromEntries(block(css, css.indexOf("{", start)).split(";").map(part => part.split(":").map(text => text.trim())).filter(([name]) => name));
}

test("on phones the identity menu opens under the name button and stays inside the screen", async () => {
  const css = await readFile("src/app/pilot/pilot.css", "utf8");
  const phone = [...css.matchAll(/@media \(max-width: 760px\) \{/g)].map(match => block(css, match.index! + match[0].length - 1)).join("\n");
  assert.match(css, /^\.pilot-guest-identity \{ position: relative;/m, "the name button anchors its menu");
  assert.match(css, /^\.pilot-guest-context \{ position: absolute;[^}]*top: calc\(100% \+ 8px\);[^}]*width: min\(300px, calc\(100vw - 40px\)\);/m);
  assert.doesNotMatch(phone, /\.pilot-guest-identity \{[^}]*position: static/, "phones keep that anchor instead of the page");
  assert.match(phone, /\.pilot-room-toolbar \.pilot-guest-context \{ right: auto; left: 0; \}/, "a room's name sits at the left edge, so its menu opens rightward");
});

test("the sign-out status takes the name's box; the whole entrance keeps a 16px side gutter, with the bar's controls at its right edge", async () => {
  const css = await readFile("src/app/pilot/pilot.css", "utf8");
  const media = (query: string) => [...css.matchAll(new RegExp(`@media \\(${query}\\) \\{`, "g"))].map(match => block(css, match.index! + match[0].length - 1)).join("\n");
  const name = declarations(css, ".pilot-guest-identity > summary"), status = declarations(css, ".pilot-signout-status");
  for (const property of ["min-height", "max-width", "font-size"]) assert.equal(status[property], name[property], property);
  assert.equal(status.color, "var(--muted)");
  const phone = media("max-width: 760px");
  assert.equal(declarations(phone, ".pilot-signout-status")["max-width"], declarations(phone, ".pilot-guest-identity > summary")["max-width"]);
  // Up to 480px the status never fits beside the label, so it takes a row of its own either way and keeps one line there (it comes later, so it wins).
  assert.equal(declarations(media("max-width: 480px"), ".pilot-signout-status")["max-width"], "none");
  assert.ok(css.indexOf(".pilot-signout-status { max-width: none; }") > css.indexOf(".pilot-signout-status { max-width: 16ch; }"));
  // The gutter belongs to the whole entrance, so the bar and everything under it line up at every width.
  const entrance = declarations(await readFile("src/app/pilot/rooms.css", "utf8"), ".pilot-entrance");
  assert.equal(entrance["max-width"], "min(1120px, calc(100% - 32px))");
  assert.equal(entrance["margin-inline"], "auto", "centered by itself, whatever .pilot-shell does");
  assert.doesNotMatch(css, /\.pilot-entrance-account \{[^}]*padding-inline/, "no gutter on the bar alone");
  // A bar that wraps keeps its controls at the right edge, as on one row.
  assert.equal(declarations(css, ".pilot-entrance-account > .pilot-header-actions")["margin-left"], "auto");
});

test("opening the identity menu brings it into view, then its sign-out and any reason it waits, so both are reachable when the menu is taller than the screen", async () => {
  const source = await tsx("src/components/pilot-identity.tsx");
  const found = find(source, node => ts.isFunctionDeclaration(node) && node.name?.text === "revealMenu");
  assert.ok(found);
  assert.match(source.text, /<details className="pilot-guest-identity" onToggle=\{revealMenu\}>/);
  const revealMenu = evaluate(js(found), {});
  const reveal = (open: boolean, blocked: boolean) => {
    const shown: string[] = [];
    const part = (selector: string) => selector.endsWith("+ small") && !blocked ? null : { scrollIntoView: (options: unknown) => { assert.deepEqual(options, { block: "nearest" }); shown.push(selector); } };
    revealMenu({ currentTarget: { open, querySelector: part } });
    return shown;
  };
  assert.deepEqual(reveal(true, false), [".pilot-guest-context", ".pilot-signout-button"]);
  assert.deepEqual(reveal(true, true), [".pilot-guest-context", ".pilot-signout-button + small"]);
  assert.deepEqual(reveal(false, true), []);
  const blocked = render(guest, { profile, signOutDisabled: true, signOutBlockedReason: "Finish the wallet action in progress before signing out." });
  assert.match(blocked, /pilot-signout-button"[^>]*>Sign out of this browser<\/button><small>Finish the wallet action/, "the reason is the <small> right after sign-out");
});

test("a room explains every sign-out block, and a missing selected moment is not one", () => {
  const none = { generating: false, drafting: false, walletBusy: false, checking: false, busy: false };
  assert.equal(roomSignOutBlock(none), "");
  const reasons = { generating: /Finish generation/, drafting: /Finish or cancel your continuation/, walletBusy: /Finish the wallet action/, checking: /Checking your storyteller account/, busy: /Wait for the current action/ };
  for (const [key, reason] of Object.entries(reasons)) assert.match(roomSignOutBlock({ ...none, [key]: true }), reason, key);
});

test("a room ties sign-out to its own block: no selected moment still lets you sign out, a wallet action in progress does not", async () => {
  const room = await signOutWiring("src/components/shared-pilot.tsx");
  // wrenBusy and wrenPreviewId are the room's Wren request (the kessler-judge release); without Wren they go unused.
  const idle = { selected: undefined, hasActive: false, draft: undefined, releaseBusy: false, busy: false, account: { loading: false }, wrenBusy: false, wrenPreviewId: undefined };
  assert.deepEqual(room(idle), { disabled: true, signOutDisabled: false, reason: "" }, "joining waits for a selected moment; sign-out does not");
  assert.deepEqual(room({ ...idle, releaseBusy: true }), { disabled: true, signOutDisabled: true, reason: "Finish the wallet action in progress before signing out." });
  if ((await readFile("src/components/shared-pilot.tsx", "utf8")).includes("wrenBusy")) {
    for (const wren of [{ wrenBusy: true }, { wrenPreviewId: "operation" }]) {
      const { signOutDisabled, reason } = room({ ...idle, selected: { id: "moment" }, ...wren });
      assert.deepEqual({ signOutDisabled, reason }, { signOutDisabled: true, reason: "Finish generation or publish or discard your preview before signing out." }, `a Wren request holds sign-out as generation does: ${Object.keys(wren)[0]}`);
    }
  }
});

test("the entrance says why sign-out waits, whichever of its states holds it", async () => {
  const entrance = await signOutWiring("src/components/pilot-entrance.tsx");
  const idle = { pending: undefined, busy: false, creating: false, account: { loading: false } };
  assert.deepEqual(entrance(idle), { disabled: false, signOutDisabled: false, reason: "" });
  const request = { requestId: "5f0c2a7e-0d1b-4c56-9a7e-3b2d1c0e9f88", title: "The midnight signal", templateId: "midnight-signal", templateVersion: 1 };
  const waits: [Record<string, unknown>, string][] = [
    [{ pending: request, creating: true }, "Check your saved room request before signing out."],
    [{ pending: request, creating: true, busy: true }, "Check your saved room request before signing out."],
    [{ pending: request }, "Open Create a room and check your saved room request before signing out."],
    [{ busy: true }, "Wait for your storyteller name to finish saving before signing out."],
    [{ account: { loading: true } }, "Checking your storyteller account. You can sign out when it finishes."],
  ];
  for (const [state, reason] of waits) assert.deepEqual(entrance({ ...idle, ...state }), { disabled: true, signOutDisabled: true, reason }, JSON.stringify(state));
});

test("the account's message sits right under the account bar, before the featured room or the create form; the page's own alert keeps its place", async () => {
  const message = "Your account could not be signed out. Refresh and try again.";
  const entrance = (creating: boolean, signingOut = false) => renderToStaticMarkup(createElement(PilotAccountContext.Provider, { value: { ...account(guest), error: message, signingOut } }, createElement(PilotEntrance, { creating, navigate() {} })));
  for (const creating of [false, true]) {
    const html = entrance(creating);
    const bar = html.indexOf('class="pilot-entrance-account"');
    const alert = html.indexOf(`<div class="pilot-notice" role="alert"><p>${message}</p></div>`);
    const next = html.indexOf(creating ? 'class="pilot-create-form"' : "fn-featured-kessler");
    assert.ok(bar >= 0 && alert > bar && next > alert, `creating=${creating}: bar ${bar}, alert ${alert}, next ${next}`);
  }
  assert.ok(!entrance(false, true).includes(message), "held back while the sign-out runs: an earlier \"refresh\" would stop it");
  // The page's own error (room list, name, room) stays after the form, with Check connection.
  const source = await tsx("src/components/pilot-entrance.tsx");
  const own = find(source, node => ts.isJsxElement(node) && attr(node.openingElement, "role")?.getText() === '"alert"' && node.getText().includes("Check connection"));
  assert.ok(own);
  assert.doesNotMatch(own.getText(), /account\?\.error/);
  // On a short phone the account's message is brought into view when it appears.
  const call = find(source, node => ts.isCallExpression(node) && node.expression.getText() === "useEffect" && node.arguments[0].getText().includes("accountNotice")) as ts.CallExpression | undefined;
  assert.ok(call);
  assert.match(call.arguments[1]?.getText() ?? "", /account\?\.error/);
  const scrolled: unknown[] = [];
  for (const error of ["", message]) evaluate(js(call.arguments[0]), { account: { error }, accountNotice: { current: { scrollIntoView: (options: unknown) => scrolled.push(options) } } })();
  assert.deepEqual(scrolled, [{ block: "nearest" }]);
});

test("while the header's sign-out runs, everything on the entrance but the account bar is inert, parts that appear meanwhile too", async () => {
  const source = await tsx("src/components/pilot-entrance.tsx");
  const call = find(source, node => ts.isCallExpression(node) && node.expression.getText() === "useEffect" && node.arguments[0].getText().includes("inert")) as ts.CallExpression | undefined;
  assert.ok(call?.arguments[1]);
  const [callback, deps] = [js(call.arguments[0]), js(call.arguments[1])];
  // Elements in the entrance's shape: .pilot-page > skip link, header, guide, main > account bar and the rest.
  class Element {
    inert = false; parentElement?: Element; name: string; children: Element[];
    constructor(name: string, children: Element[] = []) { this.name = name; this.children = children; for (const child of children) child.parentElement = this; }
    contains(other: Element): boolean { return other === this || this.children.some(child => child.contains(other)); }
    querySelector(selector: string): Element | undefined {
      for (const child of this.children) { const found = child.name === selector ? child : child.querySelector(selector); if (found) return found; }
    }
  }
  class Observer {
    callback: () => void; watched: string[] = []; connected = true;
    constructor(callback: () => void) { this.callback = callback; observers.push(this); }
    observe(target: Element, options: unknown) { assert.deepEqual(options, { childList: true }); this.watched.push(target.name); }
    disconnect() { this.connected = false; }
  }
  const observers: Observer[] = [];
  const bar = new Element(".pilot-entrance-account");
  const main = new Element("main", [bar, new Element(".fn-first-invitation"), new Element("#shared-directory")]);
  const root = new Element(".pilot-page", [new Element(".skip-link"), new Element("header.fn-header"), new Element(".fn-first-header-guide"), main]);
  const inert = () => [root, ...root.children, ...main.children, bar].filter(element => element.inert).map(element => element.name);
  // As React runs it: after a render that changes its dependencies, once the previous cleanup has run.
  let previous: unknown[] | undefined, cleanup: (() => void) | undefined;
  const render = (signingOut: boolean) => {
    const env = { page: { current: root }, account: { signingOut }, HTMLElement: Element, MutationObserver: Observer };
    const now = evaluate(deps, env) as unknown[];
    if (previous && now.every((value, at) => Object.is(value, previous![at]))) return;
    cleanup?.(); cleanup = evaluate(callback, env)(); previous = now;
  };
  render(false);
  assert.deepEqual(inert(), [], "no change while nothing is signing out");
  render(true);
  assert.deepEqual(inert(), [".skip-link", "header.fn-header", ".fn-first-header-guide", ".fn-first-invitation", "#shared-directory"]);
  assert.deepEqual(observers.map(observer => observer.watched), [[".pilot-page", "main"]]);
  const joined = new Element("joined rooms"); joined.parentElement = main; main.children.push(joined);
  observers[0].callback();
  assert.ok(joined.inert, "joined rooms that arrive mid-sign-out are held too");
  render(false);
  assert.deepEqual(inert(), [], "the page is live again afterwards");
  assert.equal(observers[0].connected, false);
});

test("on /pilot the account bar holds sign-out, so the entrance and room headers leave out the chip; an unavailable room keeps it", async () => {
  const html = renderToStaticMarkup(createElement(PilotAccountContext.Provider, { value: account(guest) }, createElement(PilotEntrance, { creating: false, navigate() {} })));
  const start = html.indexOf('<header class="fn-header">');
  assert.ok(start >= 0);
  assert.doesNotMatch(html.slice(start, html.indexOf("</header>", start)), /fn-header-actions|fn-account/, "no chip in the entrance header");
  assert.match(html, /class="pilot-entrance-account"/);

  const source = await tsx("src/components/shared-pilot.tsx");
  const headers = findAll(source, element("AppHeader"));
  const view = headers.find(node => attr(node, "guide")?.getText().includes("<FirstNightGuide roomId="));
  assert.ok(view);
  assert.equal(attr(view, "account")?.getText(), "{false}", "the room view's account bar replaces the chip");
  const unavailable = headers.find(node => attr(node, "guide")?.getText() === "{false}");
  assert.ok(unavailable);
  assert.equal(attr(unavailable, "account"), undefined, "a room that cannot open has no account bar, so it keeps the chip");
});

test("while the header's sign-out runs, the entrance's account bar says so in place of its controls", () => {
  const entrance = (signingOut: boolean) => renderToStaticMarkup(createElement(PilotAccountContext.Provider, { value: { ...account(guest), signingOut } }, createElement(PilotEntrance, { creating: false, navigate() {} })));
  const running = entrance(true);
  assert.match(running, /<div class="pilot-entrance-account"><span>[^<]*<\/span><div class="pilot-header-actions"><p class="pilot-signout-status" role="status">Signing out of this browser…<\/p><\/div><\/div>/);
  assert.doesNotMatch(running, /pilot-account-entry|pilot-guest-identity|pilot-signout-button/, "nothing to press or open while it runs");
  const idle = entrance(false);
  assert.match(idle, /class="pilot-account-entry"/);
  assert.doesNotMatch(idle, /pilot-signout-status/);
});

test("the identity menu shows why sign-out is off, and other controls can be off without blocking it", () => {
  const blocked = render(guest, { profile, signOutDisabled: true, signOutBlockedReason: "Finish the wallet action in progress before signing out." });
  assert.match(signOutButton(blocked)!, /disabled/);
  assert.match(blocked, /<small>Finish the wallet action in progress before signing out\.<\/small>/);
  const noMoment = render(guest, { profile, disabled: true, signOutDisabled: false });
  assert.doesNotMatch(signOutButton(noMoment)!, /disabled/);
  assert.match(signOutButton(render(guest, { profile, disabled: true }))!, /disabled/, "other pages keep sign-out tied to their disabled state");
});

test("a guest whose name never saved can end its session from the signed-out controls; a visitor without a session cannot", () => {
  const unnamed = render(guest, {});
  assert.match(unnamed, /class="pilot-account-entry"/);
  assert.match(unnamed, /Join this room/);
  assert.match(unnamed, /pilot-signout-button[^>]*>Sign out of this browser</);
  const visitor = render(undefined, {});
  assert.match(visitor, /Join this room/);
  assert.equal(signOutButton(visitor), undefined);
  assert.doesNotMatch(visitor, /Sign out/);
});

test("an unnamed guest's sign-out asks first, as a named guest's does", async () => {
  const source = await tsx("src/components/pilot-identity.tsx");
  const entry = find(source, node => ts.isJsxElement(node) && attr(node.openingElement, "className")?.getText() === '"pilot-account-entry"');
  assert.ok(entry);
  const button = find(entry, node => element("button")(node) && /pilot-signout-button/.test(attr(node, "className")?.getText() ?? ""));
  assert.ok(button);
  const steps: string[] = [];
  evaluate(js(attr(button, "onClick")!), { setError: () => steps.push("clear error"), setConfirmGuestSignOut: (open: boolean) => steps.push(`confirm ${open}`), signOut: async () => steps.push("signOut") })();
  assert.deepEqual(steps, ["clear error", "confirm true"]);
});

test("a named guest's confirmation keeps the byline", async () => {
  const source = await tsx("src/components/pilot-identity.tsx");
  const dialog = find(source, element("GuestSignOutDialog"));
  assert.ok(dialog);
  assert.equal(evaluate(js(attr(dialog, "name")!), { profile }), "Lamplighter");
  const html = renderToStaticMarkup(createElement(GuestSignOutDialog, { name: "Lamplighter", busy: false, disabled: false, error: "", blockedReason: "", onClose() {}, onConfirm() {} }));
  assert.match(html, /Your published moments stay credited to <strong>Lamplighter<\/strong>\./);
});

test("after sign-out, focus goes to the account entry's wallet sign-in, or to the page's main region while that is off, without scrolling", async () => {
  const source = await tsx("src/components/pilot-identity.tsx");
  const fallback = (find(source, node => ts.isVariableDeclaration(node) && node.name.getText() === "signOutFocusTarget") as ts.VariableDeclaration | undefined)?.initializer;
  assert.ok(fallback);
  const wallet = ".pilot-account-entry .pilot-wallet-signin button:not(:disabled)";
  const target = (present: string[]) => evaluate(js(fallback), { document: { querySelector: (selector: string) => present.includes(selector) ? selector : null } })();
  assert.equal(target([wallet, "main[tabindex]"]), wallet);
  assert.equal(target(["main[tabindex]"]), "main[tabindex]", "a room with no selected moment keeps wallet sign-in off");
  assert.equal(attr(find(source, element("PilotDialog")), "returnFocus")?.getText(), "{signOutFocusTarget}", "PilotDialog focuses it with preventScroll");
  assert.match(source.text, /requestAnimationFrame\(\(\) => signOutFocusTarget\(\)\?\.focus\(\{ preventScroll: true \}\)\)/);

  // What those selectors find on the entrance, signed out: wallet sign-in, or main#shared-stories while it is off.
  const entrance = (loading: boolean) => renderToStaticMarkup(createElement(PilotAccountContext.Provider, { value: { ...account(), client: {}, loading } }, createElement(PilotEntrance, { creating: false, navigate() {} })));
  const walletButton = (html: string) => html.match(/<div class="pilot-account-entry"><div class="pilot-wallet-signin"><button([^>]*)>/)?.[1];
  assert.doesNotMatch(walletButton(entrance(false)) ?? "missing", /disabled/);
  assert.match(walletButton(entrance(true)) ?? "", /disabled=""/);
  assert.deepEqual(entrance(true).match(/<main\b[^>]*\btabindex="[^"]*"/g), ['<main class="pilot-shell pilot-entrance" id="shared-stories" tabindex="-1"']);
  // In a room it is main#shared-story, the only main there with a tabIndex.
  const room = findAll(await tsx("src/components/shared-pilot.tsx"), element("main")).filter(node => attr(node, "tabIndex"));
  assert.deepEqual(room.map(node => [attr(node, "id")?.getText(), attr(node, "tabIndex")?.getText()]), [['"shared-story"', "{-1}"]]);
});

test("the guest confirmation still guards an unnamed guest and says why it must wait", () => {
  const html = renderToStaticMarkup(createElement(GuestSignOutDialog, {
    busy: false, disabled: true, error: "", blockedReason: "Finish or cancel your continuation before signing out.", onClose() {}, onConfirm() {},
  }));
  assert.match(html, /Sign out of this guest account\?/);
  assert.match(html, /This guest has no saved login\. After signing out, you cannot return to it\./);
  assert.doesNotMatch(html, /stay credited to/);
  assert.match(html, /Finish or cancel your continuation before signing out\./);
  assert.match(html.match(/<button[^>]*button danger[^>]*>/)![0], /disabled/);
});
