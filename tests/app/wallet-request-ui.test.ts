import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tsImport } from "tsx/esm/api";
import type { WalletRequest } from "../../src/lib/onchain/wallet-requests.ts";
import { projectKey } from "../../src/lib/onchain/model.ts";
import { config, makers, makerWallet, moments } from "./release-fixtures.ts";

const { WalletReviewDialog, WalletRequestList } = await tsImport("../../src/components/wallet-requests.tsx", import.meta.url);
const request: WalletRequest = {
  id: "10000000-0000-4000-8000-000000000020", room_id: "midnight-signal", project_id: projectKey(config.curator, "midnight-signal"),
  moment_id: moments[3].id, maker_id: makers[3]!, maker_label: "Tester", moment_title: "The paper boat returns",
  wallet_address: makerWallet, state: "pending", created_at: "2026-10-12T16:00:00Z", decided_at: null,
};
const review = { request, config, busy: false, error: "", motion: false, onClose: () => {}, onConfirm: () => {} };

test("approving requires a full-address review with the exact byline, network and permanent payout policy", () => {
  const html = renderToStaticMarkup(React.createElement(WalletReviewDialog, { ...review, action: "approve" }));
  assert.match(html, /<dialog[^>]*aria-labelledby=/);
  assert.match(html, /Approve Tester(?:&#x27;|')s wallet request/);
  assert.match(html, /The paper boat returns/);
  assert.match(html, /Monad testnet/);
  assert.match(html, new RegExp(`<code>${makerWallet}</code>`));
  assert.match(html, /permanently sets this byline/);
  assert.match(html, /Each distinct wallet counts once/);
  assert.match(html, /Approve this address/);
  assert.doesNotMatch(html, /<input|<form/);
});
test("reviewing or waiting for a wallet action cannot send a second approval", () => {
  const waiting = renderToStaticMarkup(React.createElement(WalletReviewDialog, { ...review, action: "approve", busy: true }));
  assert.match(waiting, /disabled=""[^>]*>Waiting for confirmation/);
  assert.match(waiting, /disabled=""[^>]*>Cancel/);
  assert.match(waiting, /Check your wallet to confirm/);
  const checking = renderToStaticMarkup(React.createElement(WalletReviewDialog, { ...review, action: "approve", disabled: true }));
  assert.match(checking, /disabled=""[^>]*>Approve this address/);
  assert.match(checking, /recorded path to finish checking/);
});
test("a remembered curator address without a wallet explains reconnection before review can proceed", () => {
  for (const action of ["approve", "deny"] as const) {
    const html = renderToStaticMarkup(React.createElement(WalletReviewDialog, { ...review, action, walletReady: false }));
    assert.match(html, /Connect the curator wallet/);
    assert.match(html, /open Payout wallet, select your browser wallet and click Reconnect wallet/);
    assert.match(html, /Your storyteller account stays the same/);
    assert.match(html, /disabled=""[^>]*>(Approve this address|Deny this request)/);
    assert.doesNotMatch(html, /disabled=""[^>]*>Cancel/);
  }
});
test("denial explains resubmission without implying revocation or a blockchain transaction", () => {
  const html = renderToStaticMarkup(React.createElement(WalletReviewDialog, { ...review, action: "deny", busy: true }));
  assert.match(html, /send a new request/);
  assert.match(html, /does not revoke an approval already recorded onchain/);
  assert.match(html, /signed decision uses no gas/);
  assert.doesNotMatch(html, /Approval uses test MON/);
});
test("room review actions carry the original request and distinguish pointer from keyboard entry", () => {
  const calls: unknown[][] = [];
  const element = WalletRequestList({ requests: [request], busy: false, onReview: (...args: unknown[]) => calls.push(args) });
  type Element = React.ReactElement<{ children?: React.ReactNode; onClick?: (event: { detail: number }) => void }>;
  function buttons(node: React.ReactNode): Element[] {
    if (Array.isArray(node)) return node.flatMap(buttons);
    if (!React.isValidElement<Element["props"]>(node)) return [];
    return [...(node.type === "button" ? [node] : []), ...buttons(node.props.children)];
  }
  const controls = buttons(element);
  controls[0].props.onClick?.({ detail: 1 });
  controls[1].props.onClick?.({ detail: 0 });
  assert.deepEqual(calls, [[request, "approve", true], [request, "deny", false]]);
  const blocked = renderToStaticMarkup(React.createElement(WalletRequestList, { requests: [request], busy: true, onReview: () => {} }));
  assert.match(blocked, /disabled=""[^>]*>Approve/);
  assert.match(blocked, /disabled=""[^>]*>Deny/);
  assert.doesNotMatch(blocked, /<input/);
});
