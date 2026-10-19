import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tsImport } from "tsx/esm/api";
import { ZeroAddress } from "ethers";
import { KESSLER_REGISTRATIONS, MIDNIGHT_SIGNAL_REGISTRATIONS, MONAD_RELEASE_CONTRACT, registrationTransaction } from "../../src/lib/onchain/records.ts";
import { curator, makerWallet, otherWallet, prepared, snapshot } from "./release-fixtures.ts";

const { ReleaseScenes } = await tsImport("../../src/components/release-scenes.tsx", import.meta.url);
type Element = React.ReactElement<{ children?: React.ReactNode; disabled?: boolean; onClick?: () => void; "aria-describedby"?: string }>;
function rows({ account = curator, accepted = true, pending = false, busy = false, registered = [true, false, false, false], wallets = [curator, curator, curator, makerWallet] } = {}) {
  const submitted: unknown[][] = [];
  const element = ReleaseScenes({ prepared, snapshot: snapshot({ registered, wallets }), account,
    accepted, busy, pending, onAction: (...args: unknown[]) => submitted.push(args) }) as Element;
  return { elements: React.Children.toArray(element.props.children), submitted };
}
function buttons(element: React.ReactNode): Element[] {
  if (Array.isArray(element)) return element.flatMap(buttons);
  if (!React.isValidElement<Element["props"]>(element)) return [];
  return [...(element.type === "button" ? [element] : []), ...buttons(element.props.children)];
}
function registration(element: React.ReactNode) {
  return buttons(element).find(button => renderToStaticMarkup(button).includes("Register scene"));
}
const html = (element: React.ReactNode) => renderToStaticMarkup(React.createElement("ol", null, element));

test("an approved wallet can register its public scene from the current Tester guest session", () => {
  const result = rows();
  const ada = registration(result.elements[1]);
  assert.ok(ada, "The approved curator wallet needs Ada's registration action even in the Tester guest session");
  assert.equal(ada.props.disabled, false);
  ada.props.onClick?.();
  assert.deepEqual(result.submitted, [["register", 1]]);
  assert.equal(registration(result.elements[0]), undefined, "Registered scenes cannot be registered again");
  assert.equal(registration(result.elements[3]), undefined, "The curator cannot register Tester's approved scene");
});
test("a missing ancestor is named beside the disabled registration action", () => {
  const burkes = rows().elements[2];
  assert.equal(registration(burkes)?.props.disabled, true);
  assert.match(html(burkes), /Register Pilot Ada.s scene first/);
  const tester = rows({ account: makerWallet }).elements[3];
  assert.equal(registration(tester)?.props.disabled, true);
  assert.match(html(tester), /Register Burkes.s scene first/);
  assert.equal(registration(rows({ account: makerWallet, registered: [true, true, true, false] }).elements[3])?.props.disabled, false);
});
test("registration retains consent and pending-action checks with accessible reasons", () => {
  for (const [options, text] of [
    [{ accepted: false }, /Accept the release terms/],
    [{ pending: true }, /Check the saved action/],
    [{ busy: true }, /Waiting for the current wallet action/],
  ] as const) {
    const element = rows(options).elements[1], button = registration(element);
    assert.ok(button);
    assert.equal(button.props.disabled, true);
    assert.match(html(element), text);
    assert.ok(button.props["aria-describedby"]);
    assert.ok(html(element).includes(`id="${button.props["aria-describedby"]}"`));
  }
});
test("unapproved wallets and unrelated accounts cannot register public scenes", () => {
  assert.equal(registration(rows({ wallets: [curator, ZeroAddress, curator, makerWallet] }).elements[1]), undefined);
  assert.equal(registration(rows({ account: otherWallet }).elements[1]), undefined);
});

test("registered scene state links to its MonadScan transaction when the receipt is known", () => {
  const state = snapshot({ registered: [true, true, false, false] });
  state.scenes[1].transactionHash = `0x${"a".repeat(64)}`;
  const element = ReleaseScenes({ prepared, snapshot: state, account: curator, accepted: true, busy: false, pending: false,
    onAction: () => {}, explorer: "https://testnet.monadscan.com" }) as Element;
  const markup = html(React.Children.toArray(element.props.children)[1]);
  assert.match(markup, /href="https:\/\/testnet\.monadscan\.com\/tx\/0x[a]+"/);
  assert.match(markup, /Scene registered/);
  assert.match(markup, /0x0000/);
});

test("archived Midnight Signal and Kessler receipts resolve only on their recorded chain and contract", () => {
  assert.equal(MIDNIGHT_SIGNAL_REGISTRATIONS.length, 6);
  assert.equal(KESSLER_REGISTRATIONS.length, 15);
  const registrations = [...MIDNIGHT_SIGNAL_REGISTRATIONS, ...KESSLER_REGISTRATIONS];
  assert.equal(new Set(registrations.map(entry => entry.sceneId)).size, registrations.length);
  for (const { sceneId, transactionHash } of registrations) {
    assert.match(sceneId, /^0x[a-f0-9]{64}$/);
    assert.match(transactionHash, /^0x[a-f0-9]{64}$/);
    assert.equal(registrationTransaction(10143, MONAD_RELEASE_CONTRACT, sceneId), transactionHash);
    assert.equal(registrationTransaction(31337, MONAD_RELEASE_CONTRACT, sceneId), undefined);
    assert.equal(registrationTransaction(10143, "0x0000000000000000000000000000000000000001", sceneId), undefined);
  }
  const [first] = MIDNIGHT_SIGNAL_REGISTRATIONS;
  assert.equal(registrationTransaction(10143, MONAD_RELEASE_CONTRACT.toLowerCase(), first.sceneId.toUpperCase().replace("0X", "0x")), first.transactionHash);
  assert.equal(registrationTransaction(31337, MONAD_RELEASE_CONTRACT, first.sceneId), undefined);
  assert.equal(registrationTransaction(10143, "0x0000000000000000000000000000000000000001", first.sceneId), undefined);
  assert.equal(registrationTransaction(10143, MONAD_RELEASE_CONTRACT, `0x${"1".repeat(64)}`), undefined);
});
