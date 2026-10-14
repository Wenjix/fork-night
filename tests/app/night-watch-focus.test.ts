import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// The Night Watch focus code itself, run with fakes. No DOM library is installed, so the Act 1 effect and the
// Try again handlers are lifted from the source, as pilot-room-recovery.test.ts does.
async function component(path: string) {
  const source = ts.createSourceFile(path, await readFile(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const find = (pick: (node: ts.Node) => ts.Node | undefined) => {
    let found: ts.Node | undefined;
    (function visit(node: ts.Node) {
      if (found) return;
      const hit = pick(node);
      if (hit) found = hit; else ts.forEachChild(node, visit);
    })(source);
    assert.ok(found);
    return found!;
  };
  return { find, code: (node: ts.Node) => ts.transpile(`(${node.getText(source)})`, { target: ts.ScriptTarget.ES2022 }) };
}
const run = (code: string, env: Record<string, unknown>) => new Function(...Object.keys(env), `return ${code}`)(...Object.values(env));

const panel = await component("src/components/night-watch/world-panel.tsx");
const settle = panel.code(panel.find((node) => ts.isCallExpression(node) && node.expression.getText() === "useLayoutEffect" ? node.arguments[0] : undefined));
const handler = (name: string) => panel.code(panel.find((node) =>
  ts.isJsxAttribute(node) && node.name.getText() === name && /\b(retried|retryFocused)\b/.test(node.getText()) ? (node.initializer as ts.JsxExpression).expression : undefined));

/** Act 1 as the effect sees it: what has focus, the section's focus() calls and the polite status. */
function page(active: "body" | "control", flags: { retried?: boolean; retryFocused?: boolean }) {
  const body = { name: "body" }, control = { name: "Sign in with Google" };
  const focused: unknown[] = [], said: string[] = [];
  const document = { body, activeElement: active === "body" ? body : control };
  const section = { current: { focus: (options: unknown) => { focused.push(options); } } };
  const retried = { current: !!flags.retried }, retryFocused = { current: !!flags.retryFocused };
  const settled = (world: unknown) => run(settle, { world, retried, retryFocused, document, section, setLoaded: (value: string) => { said.push(value); } })();
  return { focused, said, retried, retryFocused, settled };
}
const WORLD = { room: {}, moments: [] };

test("a world that lands while Try again holds focus moves focus to Act 1 and says so, once", () => {
  const act = page("body", { retryFocused: true });
  act.settled(null);
  assert.deepEqual([act.focused, act.said, act.retryFocused.current], [[], [], true], "nothing happens while the world is still missing");
  act.settled(WORLD);
  assert.deepEqual(act.focused, [{ preventScroll: true }]);
  assert.deepEqual(act.said, ["The world is loaded."]);
  assert.deepEqual([act.retried.current, act.retryFocused.current], [false, false]);
  act.settled({ ...WORLD });
  assert.deepEqual([act.focused.length, act.said.length], [1, 1], "a later re-read neither moves focus nor speaks again");
});

test("a retry the reader pressed and then left is announced, but the world does not pull focus back to Act 1", () => {
  // Try again was pressed, the read failed, and the reader clicked plain text elsewhere: the button's blur cleared
  // retryFocused and focus sits on <body>. A quiet poll then loads the world.
  const act = page("body", { retried: true });
  act.settled(WORLD);
  assert.deepEqual(act.focused, []);
  assert.deepEqual(act.said, ["The world is loaded."]);
  assert.equal(act.retried.current, false);
});

test("the loaded world never takes focus from a control the reader moved to", () => {
  const act = page("control", { retried: true, retryFocused: true });
  act.settled(WORLD);
  assert.deepEqual(act.focused, []);
  assert.deepEqual(act.said, ["The world is loaded."]);
  assert.deepEqual([act.retried.current, act.retryFocused.current], [false, false]);
});

test("a world that lands without Try again leaves focus and the status alone", () => {
  const act = page("body", {});
  act.settled(WORLD);
  assert.deepEqual([act.focused, act.said], [[], []]);
});

test("Try again tracks whether it holds focus, and pressing it marks a retry", () => {
  const retryFocused = { current: false };
  run(handler("onFocus"), { retryFocused })();
  assert.equal(retryFocused.current, true, "a quiet poll that succeeds while Try again has focus still moves focus");
  run(handler("onBlur"), { retryFocused })();
  assert.equal(retryFocused.current, false, "once the reader leaves Try again, a later load must not pull focus back");
  const retried = { current: false };
  let retries = 0;
  run(handler("onClick"), { reading: false, retried, onRetry: () => { retries++; } })();
  assert.deepEqual([retried.current, retries], [true, 1]);
  assert.equal(run(handler("onClick"), { reading: true, retried, onRetry() {} }), undefined, "a press while reading does nothing");
});

test("both Act 1 branches hand the same section to the focus ref", async () => {
  const source = await readFile("src/components/night-watch/world-panel.tsx", "utf8");
  const sections = source.match(/<section [^>]*id="world"[^>]*>/g) ?? [];
  assert.equal(sections.length, 2);
  for (const section of sections) assert.match(section, /\bref=\{section\}/);
});

test("IdentityCard returns the same AgentCard element in every state, so the refresh button keeps focus", async () => {
  const card = await component("src/components/night-watch/identity-card.tsx");
  const body = card.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "IdentityCard" ? node : undefined) as ts.FunctionDeclaration;
  const returns: ts.ReturnStatement[] = [];
  (function visit(node: ts.Node) {
    if (node !== body && ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node)) returns.push(node);
    ts.forEachChild(node, visit);
  })(body);
  assert.equal(returns.length, 1);
  const element = returns[0].expression;
  assert.ok(element && ts.isJsxSelfClosingElement(element) && element.tagName.getText() === "AgentCard");
  assert.ok(!element.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText() === "key"), "no state-dependent key");
});
