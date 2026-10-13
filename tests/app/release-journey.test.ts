import assert from "node:assert/strict";
import test from "node:test";
import { ZeroAddress } from "ethers";
import { releaseJourney, walletBylines } from "../../src/lib/onchain/journey.ts";
import { prepareRelease } from "../../src/lib/onchain/model.ts";
import { readingPath } from "../../src/lib/pilot-social.ts";
import { curator, makerWallet, makers, moments, otherWallet, prepared, snapshot } from "./release-fixtures.ts";

test("wallet roles use approvals, independently of the active browser guest", () => {
  assert.equal(releaseJourney(prepared, undefined, makerWallet, curator).role, "Connected wallet");
  assert.equal(releaseJourney(prepared, snapshot(), curator, curator, makers[3]!).role, "Curator and maker wallet");
  assert.equal(releaseJourney(prepared, snapshot(), makerWallet, curator, makers[1]!).role, "Maker wallet");
  assert.equal(releaseJourney(prepared, snapshot(), otherWallet, curator, makers[3]!).role, "Supporter wallet");
  const pending = snapshot({ wallets: [curator, curator, curator, ZeroAddress] });
  assert.equal(releaseJourney(prepared, pending, makerWallet, curator, makers[3]!).role, "Maker approval pending");
});
test("several credited bylines on one address remain one disclosed wallet share", () => {
  const state = snapshot({ registered: [true, true, true, true] });
  assert.deepEqual(walletBylines(prepared, state, curator), ["Room starter", "Pilot Ada", "Burkes"]);
  assert.equal(releaseJourney(prepared, state, curator, curator).wallets, 2);
  const threeWallets = snapshot({ wallets: [curator, makerWallet, otherWallet, otherWallet] });
  assert.equal(releaseJourney(prepared, threeWallets, makerWallet, curator).wallets, 3);
});
test("a release shows its actual unmet stage and does not call an unfunded release fully claimed", () => {
  assert.equal(releaseJourney(prepared, snapshot({ wallets: [curator, ZeroAddress, curator, makerWallet] }), curator, curator).stage, "wallets");
  assert.equal(releaseJourney(prepared, snapshot(), curator, curator).stage, "scenes");
  const state = snapshot({ registered: [true, true, true, true] });
  assert.equal(releaseJourney(prepared, state, curator, curator).stage, "release");
  state.release = { exists: true, received: 0n, paid: 0n, beneficiaries: [{ address: makerWallet, claimable: 0n, claimed: 0n }] };
  assert.equal(releaseJourney(prepared, state, makerWallet, curator).stage, "support");
  state.release.received = 100n;
  state.release.beneficiaries[0].claimable = 50n;
  assert.match(releaseJourney(prepared, state, makerWallet, curator).title, /Your share/);
  state.release.paid = 100n;
  state.release.beneficiaries[0].claimable = 0n;
  assert.equal(releaseJourney(prepared, state, makerWallet, curator).stage, "claimed");
});
test("inspecting an ancestor retains the full chosen release; selecting a new branch changes it", () => {
  for (const inspected of moments) {
    const path = readingPath(moments, "midnight-signal", moments.at(-1)!.id, inspected.id);
    assert.equal(prepareRelease(moments, "midnight-signal", path.at(-1)!.id, curator).id, prepared.id);
  }
  const sibling = { ...moments[1], id: "10000000-0000-4000-8000-000000000005" };
  const path = readingPath([...moments, sibling], "midnight-signal", sibling.id, sibling.id);
  assert.notEqual(prepareRelease([...moments, sibling], "midnight-signal", path.at(-1)!.id, curator).id, prepared.id);
});
