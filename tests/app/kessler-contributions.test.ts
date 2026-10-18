import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tsImport } from "tsx/esm/api";
import { kesslerSeedMoments } from "../../src/lib/kessler-room.ts";
import { prepareRelease } from "../../src/lib/onchain/model.ts";
import type { Snapshot } from "../../src/lib/onchain/client.ts";
const { KesslerContributions } = await tsImport("../../src/components/kessler-contributions.tsx", import.meta.url);
const moments = kesslerSeedMoments();
const config = { chainId: 10143, curator: "0x" + "1".repeat(40), address: "0x" + "2".repeat(40), rpcUrl: "https://example.test", explorer: "https://testnet.monadscan.com", name: "Monad testnet" };
const prepared = prepareRelease(moments, "kessler-ward", moments[5].id, config.curator);
const snapshot: Snapshot = { block: 100, curator: config.curator, root: prepared.scenes[0].id, termsMatch: true,
  scenes: prepared.scenes.map(scene => ({ id: scene.id, maker: config.curator, registered: false, matches: false })),
  release: { exists: false, received: 0n, paid: 0n, beneficiaries: [] } };
const render = (props = {}) => renderToStaticMarkup(createElement(KesslerContributions, { prepared, moments, config, loading: false, error: "", onChoosePath() {}, ...props }));

test("an unavailable chain is not mistaken for unregistered work", () => {
  assert.match(render(), /Monad status unavailable/);
  assert.doesNotMatch(render(), /Not registered on Monad|Registered on Monad|read at block/);
  assert.match(render({ loading: true }), /Checking Monad/);
});

test("the trail shows the actual registered state and labels receipts only when known", () => {
  const registered = structuredClone(snapshot);
  registered.scenes[0].registered = true; registered.scenes[0].matches = true;
  const html = render({ snapshot: registered, error: "network unavailable" });
  assert.match(html, /1 of 6 scenes registered/);
  assert.match(html, /last verified block/);
  assert.match(html, /Contract record/);
  assert.doesNotMatch(html, /Registration receipt/);
  registered.scenes[0].transactionHash = "0x" + "3".repeat(64);
  assert.match(render({ snapshot: registered }), /Registration receipt/);
  assert.match(render({ snapshot }), /Not registered on Monad/);
});

test("prepared contributors and published Wren assistance cannot be confused", () => {
  const html = render({ snapshot });
  assert.match(html, /Prepared story/);
  assert.doesNotMatch(html, /Sam|Priya|Wren assisted/);
  assert.match(render({ snapshot, assisted: new Set([moments[0].id]) }), /Wren assisted/);
  assert.match(html, /Continues scene 1/);
  assert.match(html, /2 forks/);
});
