import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getAddress, ZeroAddress } from "ethers";
import ts from "typescript";
import { prepareRelease, sameAddress } from "../../src/lib/onchain/model.ts";
import type { PilotMoment } from "../../src/lib/pilot.ts";

const curator = "0x0000000000000000000000000000000000000001";
const deployer = "0x0000000000000000000000000000000000000002";
const makers = [null, "20000000-0000-4000-8000-000000000001", "20000000-0000-4000-8000-000000000002", "20000000-0000-4000-8000-000000000003"];
const moments: PilotMoment[] = ["Room starter", "Pilot Ada", "Burkes", "Tester"].map((label, index) => ({
  id: `10000000-0000-4000-8000-00000000000${index + 1}`,
  parent_id: index ? `10000000-0000-4000-8000-00000000000${index}` : null,
  room_id: "midnight-signal", maker_id: makers[index], maker_label: label, title: `${label}'s scene`,
  panels: [{ caption: "An original scene.", imageUrl: "/art/midnight-story.webp#frame=0" }],
  created_at: "2026-10-12T03:00:00Z", source_kind: "fixture", source_idea_id: null, source_idea_label: null, source_idea_body: null,
}));
const prepared = prepareRelease(moments, "midnight-signal", moments.at(-1)!.id, curator);

// Exercise the real scene-list callback, including its visibility, disabled state and handlers.
const source = ts.createSourceFile("testnet-release.tsx", await readFile("src/components/testnet-release.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback: ts.ArrowFunction | undefined;
function visit(node: ts.Node) {
  if (ts.isCallExpression(node) && node.expression.getText(source) === "prepared.scenes.map" && ts.isArrowFunction(node.arguments[0])) callback = node.arguments[0];
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(callback);
const code = ts.transpileModule(`return (${callback.getText(source)});`, { fileName: "release-row.tsx", compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;
const rowFactory = new Function("React", "prepared", "snapshot", "account", "makerId", "curator", "wallets", "blocked", "busy", "pending", "accepted", "setWallets", "perform", "getAddress", "navigator", "setNotice", "setError", "sameAddress", "ZeroAddress", "shortAddress", code);

function rows({ account = curator, accepted = true, pending = false, busy = false, registered = [true, false, false, false], wallets = [curator, curator, curator, deployer] } = {}) {
  const submitted: unknown[][] = [];
  const snapshot = { scenes: prepared.scenes.map((scene, index) => ({ id: scene.id, maker: wallets[index], registered: registered[index], matches: registered[index] })) };
  const row = rowFactory(React, prepared, snapshot, account, makers[3], account === curator, {}, busy || pending, busy, pending, accepted,
    () => {}, (...args: unknown[]) => { submitted.push(args); }, getAddress, {}, () => {}, () => {}, sameAddress, ZeroAddress, (address: string) => address) as (scene: typeof prepared.scenes[number], index: number) => React.ReactElement;
  return { elements: prepared.scenes.map(row), submitted };
}
function buttons(element: unknown): React.ReactElement<any>[] {
  if (Array.isArray(element)) return element.flatMap(buttons);
  if (!React.isValidElement<{ children?: unknown }>(element)) return [];
  return [...(element.type === "button" ? [element] : []), ...buttons(element.props.children)];
}
function registration(element: unknown) {
  return buttons(element).find(button => renderToStaticMarkup(button).includes("Register"));
}
const html = (element: React.ReactNode) => renderToStaticMarkup(React.createElement("ol", null, element));

test("an approved wallet can register its public scene from the current Tester guest session", async () => {
  const result = rows();
  const ada = registration(result.elements[1]);
  assert.ok(ada, "The approved curator wallet needs Ada's registration action even in the Tester guest session");
  assert.equal(ada.props.disabled, false);
  await ada.props.onClick();
  assert.deepEqual(result.submitted, [["register", 1]]);
  assert.equal(registration(result.elements[0]), undefined, "Registered scenes cannot be registered again");
  assert.equal(registration(result.elements[3]), undefined, "The curator cannot register Tester's deployer-approved scene");
});

test("a missing ancestor is named beside the disabled registration action", () => {
  const burkes = rows().elements[2];
  assert.equal(registration(burkes)?.props.disabled, true);
  assert.match(html(burkes), /Register Pilot Ada.s scene first/);
  const tester = rows({ account: deployer }).elements[3];
  assert.equal(registration(tester)?.props.disabled, true);
  assert.match(html(tester), /Register Burkes.s scene first/);
  const ready = rows({ account: deployer, registered: [true, true, true, false] }).elements[3];
  assert.equal(registration(ready)?.props.disabled, false);
});

test("registration retains consent and pending-action checks with accessible reasons", () => {
  for (const [options, text] of [
    [{ accepted: false }, /Accept the release terms/],
    [{ pending: true }, /Check the saved action/],
    [{ busy: true }, /Waiting for the current wallet action/],
  ] as const) {
    const element = rows(options).elements[1];
    const button = registration(element);
    assert.ok(button);
    assert.equal(button.props.disabled, true);
    assert.match(html(element), text);
    assert.ok(button.props["aria-describedby"]);
    assert.ok(html(element).includes(`id="${button.props["aria-describedby"]}"`));
  }
});

test("unapproved wallets and unrelated accounts cannot register public scenes", () => {
  assert.equal(registration(rows({ wallets: [curator, ZeroAddress, curator, deployer] }).elements[1]), undefined);
  assert.equal(registration(rows({ account: "0x0000000000000000000000000000000000000003" }).elements[1]), undefined);
});
