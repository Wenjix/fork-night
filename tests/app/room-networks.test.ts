import assert from "node:assert/strict";
import test from "node:test";
import { getRoomNetworkShowcase, NETWORK_BRANDS } from "../../src/lib/room-networks.ts";
import { WREN_TOP_UPS } from "../../src/lib/agents/wren.ts";
import { MIDNIGHT_SIGNAL_RELEASE_PROOF_LINE, MONAD_RELEASE_CONTRACT } from "../../src/lib/onchain/records.ts";

test("unknown and unassigned rooms do not acquire an invented testnet", () => {
  for (const id of ["lantern-archive", "missing-room", "", "__proto__"]) {
    assert.deepEqual(getRoomNetworkShowcase(id), []);
  }
});

test("Paper Moon's two verified USDC rails retain their exact test networks", () => {
  const demos = getRoomNetworkShowcase("paper-moon");
  assert.deepEqual(demos.map(({ network }) => network), ["solana", "base"]);
  assert.equal(NETWORK_BRANDS.solana.testnet, "Devnet");
  assert.equal(NETWORK_BRANDS.base.testnet, "Sepolia");
  for (const demo of demos) {
    assert.equal(NETWORK_BRANDS[demo.network].currency, "test USDC");
    assert.match(demo.summary, /Recorded: 1 test USDC for 5 room credits/);
  }
  const solana = new URL(demos[0].proof.href);
  assert.equal(solana.hostname, "explorer.solana.com");
  assert.equal(solana.searchParams.get("cluster"), "devnet");
  assert.equal(new URL(demos[1].proof.href).hostname, "sepolia.basescan.org");
});

test("Monad releases remain distinct from the USDC funding rails", () => {
  const [demo] = getRoomNetworkShowcase("midnight-signal");
  assert.equal(demo.network, "monad");
  assert.equal(NETWORK_BRANDS.monad.currency, "test MON");
  assert.equal(new URL(demo.proof.href).hostname, "testnet.monadscan.com");
  assert.equal(demo.summary, `${MIDNIGHT_SIGNAL_RELEASE_PROOF_LINE} ·`);
  assert.equal(demo.proof.label, "View on MonadScan ↗");
  assert.ok(demo.proof.href.endsWith(`/address/${MONAD_RELEASE_CONTRACT}`));
  assert.doesNotMatch(demo.summary, /USDC|top-up/);
});

test("Kessler points to the existing multi-project contract without borrowing another room’s receipts", () => {
  const [demo] = getRoomNetworkShowcase("kessler-ward");
  assert.equal(demo.network, "monad");
  assert.equal(demo.proof.href, getRoomNetworkShowcase("midnight-signal")[0].proof.href);
  assert.match(demo.summary, /Signatures are separate from publishing/);
  assert.doesNotMatch(demo.summary, /Recorded|received|paid|claimed/);
});

test("Night Shift's Tempo proof follows the recorded Wren payment", () => {
  const [demo] = getRoomNetworkShowcase("night-shift");
  const latest = WREN_TOP_UPS.at(-1)!;
  assert.equal(demo.network, "tempo");
  assert.equal(NETWORK_BRANDS.tempo.currency, "test pathUSD");
  assert.ok(demo.proof.href.endsWith(latest.txHash));
  assert.ok(demo.summary.includes(latest.amount));
  assert.equal(demo.related?.href, "/agents#allowance");
});
