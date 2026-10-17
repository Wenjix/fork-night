import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { formatEther, ZeroAddress } from "ethers";
import ts from "typescript";
import { tsImport } from "tsx/esm/api";
import { registrationReason, releaseJourney } from "../../src/lib/onchain/journey.ts";
import { prepareRelease, releaseByline, releaseRoom, RELEASE_TERMS, TERMS_HASH } from "../../src/lib/onchain/model.ts";
import type { Snapshot } from "../../src/lib/onchain/client.ts";
import { config, curator, makerWallet, makers, moments, otherWallet, prepared, snapshot } from "./release-fixtures.ts";

const { BrowserPayoutWallet, ReleaseConfirmation } = await tsImport("../../src/components/testnet-release.tsx", import.meta.url);

// Execute the real callbacks with fake navigation/storage ports, as the focus and recovery tests do.
async function sourceFile(path: string) {
  const source = ts.createSourceFile(path, await readFile(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return (pick: (node: ts.Node) => ts.Node | undefined) => {
    let found: ts.Node | undefined;
    (function visit(node: ts.Node) {
      if (found) return;
      found = pick(node);
      if (!found) ts.forEachChild(node, visit);
    })(source);
    assert.ok(found);
    return ts.transpile(`(${found.getText(source)})`, { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React });
  };
}
const release = await sourceFile("src/components/testnet-release.tsx");
const definition = (name: string) => release(node => ts.isFunctionDeclaration(node) && node.name?.text === name ? node : undefined);
const run = (code: string, env: Record<string, unknown>) => new Function(...Object.keys(env), `return ${code}`)(...Object.values(env));
const confirmation = run(definition("confirmCopy"), { releaseByline });
const copy = run(definition("actionCopy"), { releaseRoom, ZeroAddress });
const next = release(node => ts.isVariableDeclaration(node) && node.name.getText() === "nextAction" ? node.initializer : undefined);
const dialogProps = { confirm: confirmation("register", 1, prepared), account: makerWallet, busy: false, rememberedTerms: false, accepted: false,
  onAccept: (_accepted: boolean) => {}, onConfirm: () => {}, onClose: () => {} };

test("full release terms are readable inside the confirmation before first consent", () => {
  const html = renderToStaticMarkup(React.createElement(ReleaseConfirmation, dialogProps));
  assert.match(html, /^<dialog[\s\S]*<details class="pilot-release-terms" open="">/);
  assert.ok(html.includes(RELEASE_TERMS));
  assert.match(html, /disabled=""[^>]*>Register on Monad/);
  assert.doesNotMatch(html, /href="#release-terms"/);
  const accepted = renderToStaticMarkup(React.createElement(ReleaseConfirmation, { ...dialogProps, accepted: true }));
  assert.doesNotMatch(accepted, /disabled=""[^>]*>Register on Monad/);
});

test("remembered consent retains readable terms and still needs explicit transaction confirmation", () => {
  let confirmed = 0;
  const props = { ...dialogProps, rememberedTerms: true, onConfirm: () => { confirmed++; } };
  const html = renderToStaticMarkup(React.createElement(ReleaseConfirmation, props));
  assert.match(html, /<details class="pilot-release-terms"><summary>Read the full release terms/);
  assert.ok(html.includes(RELEASE_TERMS));
  assert.match(html, /already accepted for this wallet/);
  assert.doesNotMatch(html, /type="checkbox"/);
  assert.equal(confirmed, 0, "rendering remembered consent never sends a transaction");
  type Element = React.ReactElement<{ children?: React.ReactNode; onClick?: () => void }>;
  const buttons = (node: React.ReactNode): Element[] => Array.isArray(node) ? node.flatMap(buttons)
    : React.isValidElement<Element["props"]>(node) ? [...(node.type === "button" ? [node] : []), ...buttons(node.props.children)] : [];
  buttons(ReleaseConfirmation(props)).find(button => renderToStaticMarkup(button).includes("Register on Monad"))?.props.onClick?.();
  assert.equal(confirmed, 1);
  const busy = renderToStaticMarkup(React.createElement(ReleaseConfirmation, { ...props, busy: true }));
  assert.match(busy, /disabled=""[^>]*>Register on Monad/);
  assert.match(busy, /disabled=""[^>]*>Cancel/);
  const disconnected = renderToStaticMarkup(React.createElement(ReleaseConfirmation, { ...props, account: "" }));
  assert.match(disconnected, /disabled=""[^>]*>Register on Monad/);
});

test("consent remains scoped to the wallet and exact terms hash", () => {
  const values = new Map<string, string>();
  const window = { localStorage: { getItem: (key: string) => values.get(key), setItem: (key: string, value: string) => values.set(key, value) } };
  const releaseTermsKey = run(definition("releaseTermsKey"), { TERMS_HASH });
  const accepted = run(definition("releaseTermsAccepted"), { window, releaseTermsKey });
  const remember = run(definition("rememberReleaseTerms"), { window, releaseTermsKey });
  remember(makerWallet);
  assert.equal(accepted(makerWallet), true);
  assert.equal(accepted(otherWallet), false);
  assert.equal(values.get(`fork-night:release-terms:${TERMS_HASH}:${makerWallet.toLowerCase()}`), "1");
  values.clear();
  values.set(`fork-night:release-terms:obsolete:${makerWallet.toLowerCase()}`, "1");
  assert.equal(accepted(makerWallet), false);
});

function action({ account = otherWallet, state = snapshot(), pending = false } = {}) {
  const calls: unknown[][] = [];
  const journey = releaseJourney(prepared, state, account, curator, makers[3]!);
  const ownUnregisteredIndex = state.scenes.findIndex(scene => !scene.registered && scene.maker.toLowerCase() === account.toLowerCase());
  const ownScene = prepared.scenes[ownUnregisteredIndex];
  const registrationBlocked = ownScene ? registrationReason({ prepared, snapshot: state, index: ownUnregisteredIndex, account, accepted: true, busy: false, pending }) : "";
  const env = { account, needsBrowserChoice: false, requiresProvider: false, pending, snapshot: state, journey, ownScene, prepared, ownUnregisteredIndex, registrationBlocked,
    allRegistered: journey.registered === prepared.scenes.length, blocked: pending, walletBusy: false, identity: { enabled: true }, signInWorking: false,
    formatEther, ZeroAddress, confirmCopy: confirmation, signInWithGoogle: () => calls.push(["sign in"]), setConfirm: (value: unknown) => calls.push(["confirm", value]),
    session: { recover: () => calls.push(["recover"]), refresh: () => calls.push(["refresh"]) },
    onInspect: (id: string) => calls.push(["inspect", id]), onChoosePath: (id: string) => calls.push(["choose path", id]) };
  return { next: run(next, env), calls, copy: copy({ journey, snapshot: state, ownScene, prepared, registrationBlocked }) };
}

test("Return to story inspects the chosen tip without changing its path or opening a wallet confirmation", () => {
  const result = action();
  assert.equal(result.next.label, "Return to story");
  assert.equal(result.next.disabled, false);
  assert.deepEqual(result.calls, []);
  result.next.onClick();
  assert.deepEqual(result.calls, [["inspect", moments.at(-1)!.id]]);
});

test("a named guest saves Google onto the same storyteller while a signed-out visitor uses returning sign-in", async () => {
  for (const anonymous of [true, false]) {
    const user = anonymous ? { id: "named-guest", is_anonymous: true } : undefined;
    const modes: string[] = [], busy: boolean[] = [];
    const signIn = run(definition("signInWithGoogle"), { identity: { user, signIn: async (mode: string) => { modes.push(mode); } }, signInWorking: false,
      setSignInWorking: (value: boolean) => busy.push(value), session: { feedback: () => assert.fail("the valid sign-in path must not fail") } });
    await signIn();
    assert.deepEqual(modes, [anonymous ? "link" : "return"]);
    assert.deepEqual(busy, [true, false]);
    if (user) assert.equal(user.id, "named-guest");
  }
});

test("a restored login with several wallets waits for a provider choice instead of using window.ethereum", () => {
  const selected = release(node => ts.isVariableDeclaration(node) && node.name.getText() === "selectedProvider" ? node.initializer : undefined);
  let fallbacks = 0;
  const identity = { walletMode: "external", externalProvider: undefined };
  const legacy = { request: async () => [] };
  assert.equal(run(selected, { identity, browserWallet: () => { fallbacks++; return legacy; } }), undefined);
  assert.equal(fallbacks, 0);
  const chosen = { request: async () => [] };
  assert.equal(run(selected, { identity: { ...identity, externalProvider: chosen }, browserWallet: () => legacy }), chosen);
});

test("choosing a payout provider never signs in or connects until the explicit connect action", () => {
  const first = { id: "metamask", name: "MetaMask", chain: "ethereum" as const, provider: { request: async () => [] } };
  const second = { id: "phantom", name: "Phantom", chain: "ethereum" as const, provider: { request: async () => [] } };
  const calls: unknown[][] = [];
  const props = { wallets: [first, second], account: "", blocked: false, connecting: false,
    onChoose: (choice: unknown) => calls.push(["choose", choice]), onConnect: () => calls.push(["connect"]) };
  type Element = React.ReactElement<{ children?: React.ReactNode; onChange?: (event: { target: { value: string } }) => void; onClick?: () => void; disabled?: boolean }>;
  const nodes = (node: React.ReactNode): Element[] => Array.isArray(node) ? node.flatMap(nodes)
    : React.isValidElement<Element["props"]>(node) ? [node, ...nodes(node.props.children)] : [];
  const initial = nodes(BrowserPayoutWallet(props));
  assert.equal(initial.find(node => node.type === "button")?.props.disabled, true);
  initial.find(node => node.type === "select")?.props.onChange?.({ target: { value: second.id } });
  assert.deepEqual(calls, [["choose", second]]);
  const selected = nodes(BrowserPayoutWallet({ ...props, provider: second.provider }));
  const connect = selected.find(node => node.type === "button");
  assert.equal(connect?.props.disabled, false);
  connect?.props.onClick?.();
  assert.deepEqual(calls, [["choose", second], ["connect"]]);
  assert.match(renderToStaticMarkup(React.createElement(BrowserPayoutWallet, props)), /keeping this storyteller.*byline and drafts/);
});

test("switching an EVM sign-in account to an existing payout wallet clears the shared hint before connecting", async () => {
  const events: unknown[][] = [];
  const accountRef: { current: string | undefined } = { current: curator };
  const connect = run(definition("connectBrowserPayout"), { walletBusy: false, pending: false, selectedProvider: {}, identity: { walletMode: "external" }, actorId: "original-storyteller", accountRef,
    setBrowserPayoutOwner: (owner: string) => events.push(["owner", owner]), session: { syncWallet: () => events.push(["sync", accountRef.current]), connect: async () => events.push(["connect", accountRef.current]) } });
  await connect();
  assert.deepEqual(events, [["owner", "original-storyteller"], ["sync", undefined], ["connect", undefined]]);
});

test("the primary registration action names and respects an unfinished ancestor", () => {
  const result = action({ account: makerWallet });
  assert.equal(result.next.label, "Register my scene");
  assert.equal(result.next.disabled, true);
  assert.match(result.copy, /Register Burkes.s scene first/);
  const ready = action({ account: makerWallet, state: snapshot({ registered: [true, true, true, false] }) });
  assert.equal(ready.next.disabled, false);
  ready.next.onClick();
  assert.equal(ready.calls[0][0], "confirm");
  assert.deepEqual(ready.calls[0][1], confirmation("register", 3, prepared));
  const pending = action({ account: makerWallet, pending: true });
  assert.equal(pending.next.label, "Check saved action");
  pending.next.onClick();
  assert.deepEqual(pending.calls, [["recover"]]);
});

test("release prerequisites explain the missing host, prepared rights holder and maker wallet steps", () => {
  const samples = moments.slice(0, 2).map(moment => ({ ...moment, room_id: "kessler-ward", maker_id: null,
    panels: [{ caption: "Prepared story", imageUrl: "/art/night-shift-neon.webp#frame=0" }] }));
  const preparedStory = prepareRelease(samples, "kessler-ward", samples[1].id, curator);
  const state: Snapshot = { ...snapshot(), scenes: preparedStory.scenes.map(scene => ({ id: scene.id, maker: ZeroAddress, registered: false, matches: false })) };
  const message = (source = preparedStory, current = state, account = otherWallet, makerId?: string) => copy({ prepared: source, snapshot: current,
    journey: releaseJourney(source, current, account, curator, makerId), registrationBlocked: "" });
  assert.match(message(preparedStory, { ...state, curator: ZeroAddress }), /curator must open/);
  assert.match(message(), /actual rights holder and approve their wallet/);
  assert.match(message(prepared, snapshot({ wallets: [curator, curator, curator, ZeroAddress] }), makerWallet, makers[3]!), /Send your wallet request below/);
  assert.match(message(prepared, snapshot()), /register their scenes in order, after their parents/);
});

test("returning to the reader selects first, then scrolls and moves keyboard focus after rendering", async () => {
  const shared = await sourceFile("src/components/shared-pilot.tsx");
  const inspect = shared(node => ts.isJsxAttribute(node) && node.name.getText() === "onInspect" && node.getText().includes("pilot-story-reader")
    ? (node.initializer as ts.JsxExpression).expression : undefined);
  const events: unknown[][] = [], frames: Array<() => void> = [];
  const reader = { scrollIntoView: (options: unknown) => events.push(["scroll", options]), focus: (options: unknown) => events.push(["focus", options]) };
  const handler = run(inspect, { select: (...args: unknown[]) => events.push(["select", ...args]),
    requestAnimationFrame: (callback: () => void) => frames.push(callback), document: { getElementById: (id: string) => id === "pilot-story-reader" ? reader : null } });
  handler(moments.at(-1)!.id);
  assert.deepEqual(events, [["select", moments.at(-1)!.id]]);
  frames[0]();
  assert.deepEqual(events.slice(1), [["scroll", { block: "start" }], ["focus", { preventScroll: true }]]);
});
