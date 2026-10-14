import { test } from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tsImport } from "tsx/esm/api";

// /tempo: the Tempo counterpart of the Privy demo, built only from recorded testnet evidence.
const { TempoDemo } = await tsImport("../../src/components/tempo/tempo-demo.tsx", import.meta.url);
const { TEMPO_DEMO } = await tsImport("../../src/lib/tempo-demo.ts", import.meta.url);

test("every transaction links to the Tempo testnet explorer with its full hash", () => {
  const html = renderToStaticMarkup(React.createElement(TempoDemo));
  for (const tx of [TEMPO_DEMO.authorization, TEMPO_DEMO.topUp, TEMPO_DEMO.plainPayment, TEMPO_DEMO.recoveryPayment]) {
    assert.match(tx.hash, /^0x[0-9a-f]{64}$/);
    assert.ok(html.includes(`href="https://explore.testnet.tempo.xyz/tx/${tx.hash}"`), tx.hash);
  }
});

test("the page keeps its testnet scope and the four Tempo refusals", () => {
  const html = renderToStaticMarkup(React.createElement(TempoDemo));
  assert.equal(html.match(/<h1/g)?.length, 1);
  assert.ok(html.includes("Tempo Moderato testnet"));
  assert.ok(html.includes("Test pathUSD never pays for image generation"));
  for (const answer of ["SpendingLimitExceeded", "CallNotAllowed", "KeyAlreadyRevoked", "KeyExpired"]) assert.ok(html.includes(answer), answer);
  assert.ok(html.includes("4 → 9"));
  assert.doesNotMatch(html, /real money|patron paid/i);
});

test("the wallet-abstraction section names what is used and what is not, with code from the real paths", async () => {
  const { TEMPO_AA_FEATURES } = await tsImport("../../src/lib/tempo-demo.ts", import.meta.url);
  const html = renderToStaticMarkup(React.createElement(TempoDemo));
  assert.ok(html.includes('href="https://tempo.xyz/blog/account-abstraction/"'));
  for (const row of TEMPO_AA_FEATURES) assert.ok(html.includes(row.feature), row.feature);
  const statuses = TEMPO_AA_FEATURES.map((row: { status: string }) => row.status);
  assert.ok(statuses.includes("not-yet") && statuses.includes("used"), "honest about both");
  assert.equal(TEMPO_AA_FEATURES.find((row: { feature: string }) => row.feature === "Fee sponsorship").status, "not-yet", "the door refuses sponsored payments");
  for (const snippet of ["Actions.accessKey.authorizeSync", "{ access: stewardAddress }", "decoded.sponsored", "getRemainingLimit"]) assert.ok(html.includes(snippet), snippet);
});

test("the payment-authority card lists what Wren's key can and cannot do", async () => {
  const { TEMPO_AUTHORITY } = await tsImport("../../src/lib/tempo-demo.ts", import.meta.url);
  const html = renderToStaticMarkup(React.createElement(TempoDemo));
  assert.ok(html.includes("Wren’s payment authority"));
  for (const item of [...TEMPO_AUTHORITY.can, ...TEMPO_AUTHORITY.cannot]) assert.ok(html.includes(item), item);
  assert.ok(html.includes("limited payment authority"));
});

test("Tempo's own wordmark and mark are used, each with the brand's name or an empty alt", () => {
  const html = renderToStaticMarkup(React.createElement(TempoDemo));
  assert.match(html, /<img[^>]*src="\/brands\/tempo\/wordmark-white.png"[^>]*alt="Tempo"|<img[^>]*alt="Tempo"[^>]*src="\/brands\/tempo\/wordmark-white.png"/);
  assert.ok(html.includes('src="/brands/tempo/mark-white.png"'));
});
