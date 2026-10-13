import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { loadMppAdapter, type MppAdapter } from "../../src/mpp/adapter.ts";
import { memoMatcher } from "../../src/mpp/chain.ts";
import { MPP_REALM, MPP_TOP_UP, PATHUSD, TRANSFER_WITH_MEMO_SELECTOR } from "../../src/mpp/ids.ts";
import { blockNetwork } from "./mpp-fakes.ts";
import { KEYCHAIN_TOP_UP as WREN } from "./mpp-keychain-fixture.ts";

blockNetwork();

// Wren's real top-up (Oct 12, 2026) was signed by a Tempo access key on behalf of its steward's account, and the door
// accepted it unchanged. This decodes those exact public bytes with the REAL isolated adapter and applies the door's
// pre-broadcast transaction rules (src/mpp/charge.ts present()), so a change that breaks access-key payments fails here.
// Skipped when vendor/mpp-adapter is not installed, like tests/app/mpp-adapter.test.ts.
const path = fileURLToPath(new URL("../../vendor/mpp-adapter/index.mjs", import.meta.url));
let adapter: MppAdapter | null = null;
let missing = "";
try { adapter = await loadMppAdapter(path); } catch (error) { missing = (error as Error).message; }
const real = (name: string, run: (t: TestContext, adapter: MppAdapter) => Promise<void>) =>
  test(name, adapter ? {} : { skip: `the isolated MPP adapter is not installed: ${missing}` }, (t) => run(t, adapter!));
const same = (a: unknown, b: string) => String(a ?? "").toLowerCase() === b.toLowerCase();

real("an access-key payment decodes as the steward's own unsponsored Moderato transfer", async (_t, mpp) => {
  const decoded = await mpp.decodeTransaction(WREN.rawTransaction);
  assert.equal(decoded.type, "tempo");
  assert.equal(decoded.sponsored, false);
  assert.equal(decoded.chainId, 42431);
  assert.ok(same(decoded.from, WREN.steward), `payer must be the steward's account, got ${decoded.from}`);
  assert.ok(!same(decoded.from, WREN.accessKey), "the access key is never recorded as the payer");
  assert.equal(decoded.hash, WREN.hash);
  assert.equal(decoded.validBefore, WREN.validBefore);
});

real("it satisfies every transaction rule the door applies before broadcasting", async (_t, mpp) => {
  const decoded = await mpp.decodeTransaction(WREN.rawTransaction);
  assert.equal(decoded.calls.length, 1, "exactly one call");
  const [call] = decoded.calls;
  assert.ok(same(call.to, PATHUSD) && same(PATHUSD, WREN.currency), "the call is to pathUSD");
  const data = call.data.toLowerCase();
  assert.ok(data.startsWith(TRANSFER_WITH_MEMO_SELECTOR), "the call is transferWithMemo");
  assert.match(data, /^0x[0-9a-f]{200}$/);
  assert.match(data.slice(10, 34), /^0{24}$/);
  assert.ok(same(`0x${data.slice(34, 74)}`, WREN.payTo), "it pays Fork Night's top-up address");
  assert.equal(BigInt(`0x${data.slice(74, 138)}`), BigInt(MPP_TOP_UP.atomic));
  assert.equal(BigInt(MPP_TOP_UP.atomic), WREN.amount);
  const memo = `0x${data.slice(138, 202)}`;
  assert.ok(memoMatcher(MPP_REALM, WREN.challengeId, mpp.keccakUtf8)(memo), "the memo is bound to the realm and this challenge");
  assert.ok(!memoMatcher(MPP_REALM, `${WREN.challengeId}x`, mpp.keccakUtf8)(memo), "and to no other challenge");
  assert.ok(!memoMatcher("another-realm", WREN.challengeId, mpp.keccakUtf8)(memo), "and to no other realm");
});

real("a corrupted access-key payment is not decoded into a different valid payment", async (_t, mpp) => {
  const raw = WREN.rawTransaction;
  const flipped = `${raw.slice(0, -2)}${raw.slice(-2) === "00" ? "01" : "00"}`;
  const decoded = await mpp.decodeTransaction(flipped).catch(() => null);
  if (decoded) assert.notEqual(decoded.hash, WREN.hash, "a changed signature changes the transaction hash the door credits");
});
