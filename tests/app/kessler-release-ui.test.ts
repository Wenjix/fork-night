import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tsImport } from "tsx/esm/api";
import { ZeroAddress } from "ethers";
import * as journey from "../../src/lib/onchain/journey.ts";
import { prepareRelease } from "../../src/lib/onchain/model.ts";
import { MIDNIGHT_SIGNAL_RELEASE_TIP_ID } from "../../src/lib/onchain/records.ts";
import { config, curator, makerWallet, moments, otherWallet } from "./release-fixtures.ts";

const { TestnetRelease, PreparedWorkWallet, releaseDisplayTipId } = await tsImport("../../src/components/testnet-release.tsx", import.meta.url);
const { ReleaseScenes } = await tsImport("../../src/components/release-scenes.tsx", import.meta.url);
const samples = moments.slice(0, 2).map((moment, index) => ({ ...moment, room_id: "kessler-ward", maker_id: null,
  maker_label: index ? "Jules · prepared sample" : "Sam · prepared sample",
  panels: [{ caption: "An authored sample scene.", imageUrl: `/art/night-shift-neon${index ? "-2" : ""}.webp#frame=0` }] }));
const prepared = prepareRelease(samples, "kessler-ward", samples[1].id, curator);
const snapshot = { block: 1, curator, root: prepared.scenes[0].id, termsMatch: true,
  scenes: prepared.scenes.map(scene => ({ id: scene.id, maker: ZeroAddress, registered: false, matches: false })),
  release: { exists: false, received: 0n, paid: 0n, beneficiaries: [] } };

test("Kessler exposes its release panel while unrelated rooms remain outside it", () => {
  const saved = { address: process.env.NEXT_PUBLIC_MONAD_RELEASE_ADDRESS, curator: process.env.NEXT_PUBLIC_MONAD_CURATOR_ADDRESS };
  process.env.NEXT_PUBLIC_MONAD_RELEASE_ADDRESS = config.address;
  process.env.NEXT_PUBLIC_MONAD_CURATOR_ADDRESS = curator;
  try {
    const props = { roomId: "kessler-ward", moments: samples, tipId: samples[1].id, onChoosePath: () => {} };
    assert.match(renderToStaticMarkup(React.createElement(TestnetRelease, props)), /Story release and support/);
    assert.equal(renderToStaticMarkup(React.createElement(TestnetRelease, { ...props, roomId: "paper-moon" })), "");
  } finally {
    for (const [key, value] of [["NEXT_PUBLIC_MONAD_RELEASE_ADDRESS", saved.address], ["NEXT_PUBLIC_MONAD_CURATOR_ADDRESS", saved.curator]]) {
      if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
    }
  }
});

test("Midnight Signal defaults to the completed six-scene release when a newer child is selected", () => {
  const released = { ...moments.at(-1)!, id: MIDNIGHT_SIGNAL_RELEASE_TIP_ID };
  const child = { ...moments.at(-1)!, id: "10000000-0000-4000-8000-000000000099", parent_id: MIDNIGHT_SIGNAL_RELEASE_TIP_ID };
  assert.equal(releaseDisplayTipId("midnight-signal", [...moments.slice(0, -1), released, child], child.id), MIDNIGHT_SIGNAL_RELEASE_TIP_ID);
  assert.equal(releaseDisplayTipId("midnight-signal", [...moments, released], moments.at(-1)!.id), moments.at(-1)!.id);
  assert.equal(releaseDisplayTipId("kessler-ward", [released, child], child.id), child.id);
});

test("Midnight Signal lets a descendant path leave the archived release to register and freeze its own scenes", () => {
  const saved = { address: process.env.NEXT_PUBLIC_MONAD_RELEASE_ADDRESS, curator: process.env.NEXT_PUBLIC_MONAD_CURATOR_ADDRESS };
  process.env.NEXT_PUBLIC_MONAD_RELEASE_ADDRESS = config.address;
  process.env.NEXT_PUBLIC_MONAD_CURATOR_ADDRESS = curator;
  try {
    const released = { ...moments.at(-1)!, id: MIDNIGHT_SIGNAL_RELEASE_TIP_ID };
    const child = { ...moments.at(-1)!, id: "10000000-0000-4000-8000-000000000099", parent_id: MIDNIGHT_SIGNAL_RELEASE_TIP_ID };
    const props = { roomId: "midnight-signal", moments: [...moments.slice(0, -1), released, child], tipId: child.id, onChoosePath: () => {} };
    const html = renderToStaticMarkup(React.createElement(TestnetRelease, props));
    assert.match(html, /4 scenes in the completed release/);
    assert.match(html, /Release the chosen path/);
    const own = renderToStaticMarkup(React.createElement(TestnetRelease, { ...props, moments: [...moments.slice(0, -1), released], tipId: released.id }));
    assert.match(own, /4 scenes in the chosen path/);
    assert.doesNotMatch(own, /Release the chosen path|Show the completed release/);
  } finally {
    for (const [key, value] of [["NEXT_PUBLIC_MONAD_RELEASE_ADDRESS", saved.address], ["NEXT_PUBLIC_MONAD_CURATOR_ADDRESS", saved.curator]]) {
      if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
    }
  }
});

test("Midnight Signal keeps the path switch when a path cannot be prepared for release", () => {
  const saved = { address: process.env.NEXT_PUBLIC_MONAD_RELEASE_ADDRESS, curator: process.env.NEXT_PUBLIC_MONAD_CURATOR_ADDRESS };
  process.env.NEXT_PUBLIC_MONAD_RELEASE_ADDRESS = config.address;
  process.env.NEXT_PUBLIC_MONAD_CURATOR_ADDRESS = curator;
  try {
    const released = { ...moments.at(-1)!, id: MIDNIGHT_SIGNAL_RELEASE_TIP_ID, panels: [{ caption: "A reading-only panel.", imageUrl: "/art/night-city-anime.webp#frame=0" }] };
    const child = { ...moments.at(-1)!, id: "10000000-0000-4000-8000-000000000099", parent_id: MIDNIGHT_SIGNAL_RELEASE_TIP_ID };
    const props = { roomId: "midnight-signal", moments: [...moments.slice(0, -1), released, child], tipId: child.id, onChoosePath: () => {} };
    const html = renderToStaticMarkup(React.createElement(TestnetRelease, props));
    assert.match(html, /role="alert"/);
    assert.match(html, /Release the chosen path/);
  } finally {
    for (const [key, value] of [["NEXT_PUBLIC_MONAD_RELEASE_ADDRESS", saved.address], ["NEXT_PUBLIC_MONAD_CURATOR_ADDRESS", saved.curator]]) {
      if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
    }
  }
});

test("prepared work approval is restricted to its curator, an unapproved prepared identity and explicit rights consent", () => {
  assert.deepEqual(journey.preparedWorkApproval?.(prepared, snapshot, curator, curator, makerWallet, true), { index: 0, address: makerWallet });
  assert.throws(() => journey.preparedWorkApproval(prepared, snapshot, otherWallet, curator, makerWallet, true), /curator/);
  assert.throws(() => journey.preparedWorkApproval(prepared, snapshot, curator, curator, makerWallet, false), /rights/);
  assert.throws(() => journey.preparedWorkApproval(prepared, snapshot, curator, curator, ZeroAddress, true), /wallet/);
  assert.throws(() => journey.preparedWorkApproval(prepared, { ...snapshot, curator: ZeroAddress }, curator, curator, makerWallet, true), /project/);
  const approved = { ...snapshot, scenes: snapshot.scenes.map(scene => ({ ...scene, maker: makerWallet })) };
  assert.throws(() => journey.preparedWorkApproval(prepared, approved, curator, curator, otherWallet, true), /already/);
});

test("the prepared-work setup is visible only to the curator and explains sample provenance", () => {
  assert.ok(PreparedWorkWallet, "A curator needs a bounded setup control for the prepared-work identity");
  const props = { prepared, snapshot, config, account: curator, blocked: false, onApprove: async () => undefined };
  const html = renderToStaticMarkup(React.createElement(PreparedWorkWallet, props));
  assert.match(html, /Prepared story wallet/);
  assert.match(html, /sample bylines/);
  assert.match(html, /permanently/);
  assert.match(html, /rights holder/);
  assert.match(html, /disabled=""[^>]*>Approve prepared-work wallet/);
  assert.equal(renderToStaticMarkup(React.createElement(PreparedWorkWallet, { ...props, account: otherWallet })), "");
  const approved = { ...snapshot, scenes: snapshot.scenes.map(scene => ({ ...scene, maker: makerWallet })) };
  assert.equal(renderToStaticMarkup(React.createElement(PreparedWorkWallet, { ...props, snapshot: approved })), "");
});

test("Kessler release rows identify sample provenance separately from actual wallet contributors", () => {
  const html = renderToStaticMarkup(React.createElement(ReleaseScenes, { prepared, snapshot, account: curator, accepted: false, busy: false, pending: false, onAction: () => {} }));
  assert.match(html, /Prepared Kessler Ward story/);
  assert.match(html, /Sample byline/);
  assert.match(html, /Sam/);
  assert.doesNotMatch(html, /The maker sends a signed wallet request/);
});
