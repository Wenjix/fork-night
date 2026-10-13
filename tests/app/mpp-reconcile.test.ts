import { test } from "node:test";
import assert from "node:assert/strict";
import type { MppChallenge } from "../../src/mpp/adapter.ts";
import { MPP_MEMO_TAG, TRANSFER_WITH_MEMO_TOPIC, memoMatcher, moderatoReader, tempoRpc } from "../../src/mpp/chain.ts";
import { createChargePort } from "../../src/mpp/charge.ts";
import { handleMppFunding, type PresentedCharge } from "../../src/mpp/funding.ts";
import { MPP_REALM, mppIntentId, mppRecordPaths, mppRefillRequestId } from "../../src/mpp/ids.ts";
import type { MppIntent } from "../../src/mpp/records.ts";
import { reconcileMppIntents } from "../../src/mpp/reconcile.ts";
import { recordBytes } from "../../src/x402/store.ts";
import { collectMppRecords } from "../../scripts/mpp-status.ts";
import {
  blockNetwork, CHALLENGE_KEY, PAY_TO, REF, STEWARD, doorConfig, doorRooms, fakeAdapter, fakeChain, fakeKeccak, fakeModerato, mppRequest,
} from "./mpp-fakes.ts";
import { memoryLedger, memoryStore } from "./x402-fakes.ts";

blockNetwork();

// The chain reader and the reconciler over an offline Moderato. The memo check runs with the fakes'
// stand-in hash here; tests/app/mpp-adapter.test.ts checks it against mppx's real memo and keccak256.
async function setup() {
  let offset = 0;
  const fake = fakeAdapter();
  const chain = fakeModerato(fake.adapter, { clock: () => Date.now() + offset });
  const port = createChargePort(doorConfig(), { challengeKey: CHALLENGE_KEY, adapter: fake.adapter, rpc: chain.request });
  const account = fake.adapter.accountFromKey(`0x${"33".repeat(32)}`);
  const room = doorRooms()[REF];
  async function payment(challenge?: MppChallenge) {
    const offered = challenge ?? fake.adapter.parseChallengeHeader((await port.offer(room)).header);
    const { credential } = await fake.adapter.createPayment({ account, challenge: offered, expectedRecipient: PAY_TO, request: chain.request });
    const charge = await port.present(credential, room) as PresentedCharge;
    const intent: MppIntent = {
      kind: "fork-night/mpp-intent/v1", intentId: mppIntentId(charge.challengeId), network: "eip155:42431",
      challengeId: charge.challengeId, challengeExpires: charge.challengeExpires, realm: charge.realm, roomId: "lighthouse",
      stewardProfileId: STEWARD, credits: 5, payer: charge.payer, payTo: charge.payTo, currency: charge.currency, amount: charge.amount,
      transaction: charge.transaction, validBefore: charge.validBefore, payloadDigest: charge.payloadDigest,
      signedTransaction: charge.signedTransaction, createdAt: new Date().toISOString(),
    };
    return { charge, intent, challenge: offered, credential };
  }
  const reader = (lookups = 3) => moderatoReader({ rpc: chain.rpc, keccak: fakeKeccak, sleep: async () => {}, spacingMs: 0, lookups });
  return { fake, chain, port, payment, reader, later(seconds: number) { offset = seconds * 1000; } };
}

test("the memo check binds a transfer to this realm and this challenge", async () => {
  const { payment, fake } = await setup();
  const { intent } = await payment();
  const memo = fake.memoFor(MPP_REALM, intent.challengeId);
  assert(memo.startsWith(`0x${MPP_MEMO_TAG}01`));
  assert(memoMatcher(MPP_REALM, intent.challengeId, fakeKeccak)(memo));
  assert(!memoMatcher("another-realm", intent.challengeId, fakeKeccak)(memo));
  assert(!memoMatcher(MPP_REALM, "another-challenge", fakeKeccak)(memo));
  assert(!memoMatcher(MPP_REALM, intent.challengeId, fakeKeccak)(`0x${"00".repeat(32)}`));
  assert(!memoMatcher(MPP_REALM, intent.challengeId, fakeKeccak)("0x1234"));
  assert.match(TRANSFER_WITH_MEMO_TOPIC, /^0x[0-9a-f]{64}$/);
});

test("a landed payment is paid by its receipt; one without this challenge's transfer needs a hand check", async () => {
  const { chain, payment, reader } = await setup();
  const { intent, charge } = await payment();
  await chain.land(charge.signedTransaction, "0x1");
  const verdict = await reader().inspect(intent);
  assert.equal(verdict.status, "paid");
  assert.equal((verdict as { transaction: string }).transaction, intent.transaction);
  assert.equal((verdict as { evidence: Record<string, unknown> }).evidence.source, "receipt");
  const otherRealm = await reader().inspect({ ...intent, realm: "another-realm" });
  assert.deepEqual([otherRealm.status, (otherRealm as { handCheck?: boolean }).handCheck], ["pending", true]);
});

test("a lagging receipt is found by the memo scan, and a lagging log node is retried, never read as empty", async () => {
  const { chain, payment, reader } = await setup();
  const { intent, charge } = await payment();
  await chain.land(charge.signedTransaction, "0x1");
  chain.hideReceipts(true);
  chain.lagLogs(2);
  const verdict = await reader().inspect(intent);
  assert.equal(verdict.status, "paid");
  assert.equal((verdict as { evidence: Record<string, unknown> }).evidence.source, "memo-scan");
  chain.lagLogs(9);
  await assert.rejects(reader().inspect(intent), /beyond current head/);
});

test("expiry needs the head 120 s past validBefore, every receipt lookup missing and an empty scan", async () => {
  const { chain, payment, reader, later } = await setup();
  const { intent, charge } = await payment();
  const early = await reader().inspect(intent);
  assert.equal(early.status, "pending");
  assert.match((early as { reason: string }).reason, /can be declared expired after/);

  later(200);
  const lookups = () => chain.calls.filter((call) => call === "eth_getTransactionReceipt").length;
  const before = lookups();
  const expired = await reader().inspect(intent);
  assert.equal(expired.status, "unpayable");
  assert.equal(lookups() - before, 3);
  const evidence = (expired as { evidence: Record<string, number> }).evidence;
  assert(evidence.headTimestamp >= intent.validBefore + 120);
  assert(evidence.fromBlock < evidence.toBlock);

  // A replica that missed the receipt twice still finds it on the last lookup: never declared expired.
  await chain.land(charge.signedTransaction, "0x1");
  chain.missReceipts(2);
  chain.logs.length = 0; // the memo scan would also find it; hide the log to prove the spaced lookups catch it
  const caught = await reader().inspect(intent);
  assert.equal(caught.status, "paid");
});

test("a reverted transfer can never land; a different transaction paying the same challenge needs a hand check", async () => {
  const { chain, payment, reader } = await setup();
  const first = await payment();
  await chain.land(first.charge.signedTransaction, "0x0");
  const reverted = await reader().inspect(first.intent);
  assert.equal(reverted.status, "unpayable");
  assert.match((reverted as { reason: string }).reason, /reverted/);

  const recorded = await payment();
  const other = await payment(recorded.challenge);
  await chain.land(other.charge.signedTransaction, "0x1");
  const verdict = await reader().inspect(recorded.intent);
  assert.deepEqual([verdict.status, (verdict as { handCheck?: boolean }).handCheck], ["pending", true]);
  assert.match((verdict as { reason: string }).reason, new RegExp(other.intent.transaction));
});

test("the JSON-RPC reader reports node errors with their code and refuses HTTP failures", async () => {
  const responses: Response[] = [
    Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "block range extends beyond current head block" } }),
    new Response("bad gateway", { status: 502 }),
    Response.json({ jsonrpc: "2.0", id: 1, result: "0xa5bf" }),
  ];
  const sent: string[] = [];
  const rpc = tempoRpc("https://rpc.moderato.tempo.xyz", async (_url, init) => {
    sent.push(String(init?.body));
    return responses.shift()!;
  });
  await assert.rejects(rpc("eth_getLogs", [{}]), (error: Error & { code?: number }) => error.code === -32602 && /beyond current head/.test(error.message));
  await assert.rejects(rpc("eth_chainId", []), /HTTP 502/);
  assert.equal(await rpc("eth_chainId", []), "0xa5bf");
  assert.deepEqual(JSON.parse(sent[0]), { jsonrpc: "2.0", id: 1, method: "eth_getLogs", params: [{}] });
});

test("reconcile is a dry run by default; --apply credits paid intents once and marks provably expired ones", async () => {
  const { chain, payment, reader, later, port } = await setup();
  const storage = memoryStore(), ledger = memoryLedger();
  const paid = await payment(), lost = await payment(), waiting = await payment();
  for (const { intent } of [paid, lost, waiting])
    await storage.store.create(mppRecordPaths(intent.intentId, "lighthouse").intent, recordBytes(intent));
  await chain.land(paid.charge.signedTransaction, "0x1");
  const deps = { store: storage.store, ledger: ledger.ledger, chain: reader(), now: () => new Date(), apply: false };

  const dry = await reconcileMppIntents(deps);
  assert.equal(dry.apply, false);
  assert.deepEqual(dry.counts, { paid: 1, pending: 2 });
  assert.equal(storage.paths("mpp/receipts/").length + storage.paths("mpp/expired/").length, 0);
  assert.equal(ledger.refills.size, 0);

  later(200);
  // The waiting payment lands late, within its window; the lost one never does.
  await chain.land(waiting.charge.signedTransaction, "0x1");
  const applied = await reconcileMppIntents({ ...deps, apply: true });
  assert.deepEqual(applied.counts, { credited: 2, expired: 1 });
  assert.equal(applied.errors, 0);
  assert.deepEqual([...ledger.refills.keys()].sort(), [mppRefillRequestId(paid.intent.transaction), mppRefillRequestId(waiting.intent.transaction)].sort());
  const receipt = storage.json(mppRecordPaths(paid.intent.intentId, "lighthouse").receipt);
  assert.equal(receipt.source, "reconciler");
  assert.equal(receipt.paymentReceipt, null);
  assert.equal(storage.json(mppRecordPaths(lost.intent.intentId, "lighthouse").expired).kind, "fork-night/mpp-expired/v1");

  // Re-running is safe: everything is skipped, nothing is credited twice.
  const again = await reconcileMppIntents({ ...deps, apply: true });
  assert.deepEqual(again.counts, { skipped: 3 });
  assert.equal(ledger.refills.size, 2);

  // And the door answers the expired payment with "nothing was charged", and the late one from its receipt.
  const door = { rooms: doorRooms(5), charges: port, chain: fakeChain().reader, store: storage.store, ledger: ledger.ledger };
  const resend = (credential: string) => handleMppFunding(mppRequest(REF, undefined, { headers: { authorization: credential } }), REF, door);
  const expired = await resend(lost.credential);
  assert.equal(expired.status, 402);
  assert.match((await expired.json()).error, /expired before it settled; nothing was charged/);
  const credited = await resend(waiting.credential);
  assert.equal(credited.status, 200);
  assert.equal((await credited.json()).replayed, true);
});

test("reconcile reports, never credits, a settlement mismatch, a hand check or a malformed intent", async () => {
  const { chain, payment, reader } = await setup();
  const storage = memoryStore(), ledger = memoryLedger();
  const mismatched = await payment(), checked = await payment();
  for (const { intent } of [mismatched, checked])
    await storage.store.create(mppRecordPaths(intent.intentId, "lighthouse").intent, recordBytes(intent));
  await chain.land(mismatched.charge.signedTransaction, "0x1");
  await storage.store.create(mppRecordPaths(mismatched.intent.intentId, "lighthouse").settlement, recordBytes({
    kind: "fork-night/mpp-settlement/v1", intentId: mismatched.intent.intentId, network: "eip155:42431",
    transaction: `0x${"ef".repeat(32)}`, refillRequestId: mppRefillRequestId(`0x${"ef".repeat(32)}`), via: "broadcast", recordedAt: new Date().toISOString(),
  }));
  const other = await payment(checked.challenge);
  await chain.land(other.charge.signedTransaction, "0x1");
  await storage.store.create(`mpp/intents/${"0".repeat(64)}.json`, recordBytes({ kind: "fork-night/mpp-intent/v1", intentId: "0".repeat(64) }));
  const report = await reconcileMppIntents({ store: storage.store, ledger: ledger.ledger, chain: reader(), now: () => new Date(), apply: true });
  assert.equal(report.errors, 3);
  const reasons = report.intents.map((entry) => entry.reason).join("\n");
  assert.match(reasons, /recorded 0xefef.*check by hand/);
  assert.match(reasons, /different transaction/);
  assert.match(reasons, /unreadable or does not match/);
  assert.equal(ledger.refills.size, 0);
  assert.equal(storage.paths("mpp/receipts/").length, 0);
});

// Review fixes (12 October). Each of these failed on the reviewed sources.

test("a reverted payment is unpayable only when no other transaction paid its challenge; reconcile never marks that one expired", async () => {
  const { chain, payment, reader } = await setup();
  const first = await payment();
  const other = await payment(first.challenge); // the payer re-signed the same offer (another nonce)
  await chain.land(first.charge.signedTransaction, "0x0");
  assert.equal((await reader().inspect(first.intent)).status, "unpayable", "nothing else paid it yet");
  await chain.land(other.charge.signedTransaction, "0x1"); // the payer pushed the second signature itself
  const verdict = await reader().inspect(first.intent);
  assert.deepEqual([verdict.status, (verdict as { handCheck?: boolean }).handCheck], ["pending", true]);
  assert.match((verdict as { reason: string }).reason, new RegExp(other.intent.transaction));
  const storage = memoryStore(), ledger = memoryLedger();
  await storage.store.create(mppRecordPaths(first.intent.intentId, "lighthouse").intent, recordBytes(first.intent));
  const report = await reconcileMppIntents({ store: storage.store, ledger: ledger.ledger, chain: reader(), now: () => new Date(), apply: true });
  assert.deepEqual([report.intents[0].outcome, report.errors], ["error", 1]);
  assert.equal(storage.json(mppRecordPaths(first.intent.intentId, "lighthouse").expired), null);
  assert.equal(ledger.refills.size, 0);
});

test("the reconciler binds the paying transaction and the room pointer before it credits, and never credits another hash", async () => {
  const { chain, payment, reader } = await setup();
  const storage = memoryStore(), ledger = memoryLedger();
  const { intent, charge } = await payment();
  const paths = mppRecordPaths(intent.intentId, "lighthouse");
  await storage.store.create(paths.intent, recordBytes(intent));
  await chain.land(charge.signedTransaction, "0x1");
  let boundBeforeRefill: unknown = null;
  const refill = ledger.ledger.refill;
  ledger.ledger.refill = async (...args) => { boundBeforeRefill = [storage.json(paths.settlement), storage.json(paths.roomIndex)]; return refill(...args); };
  const report = await reconcileMppIntents({ store: storage.store, ledger: ledger.ledger, chain: reader(), now: () => new Date("2026-10-12T12:00:00.000Z"), apply: true });
  assert.equal(report.intents[0].outcome, "credited");
  const settlement = {
    kind: "fork-night/mpp-settlement/v1", intentId: intent.intentId, network: "eip155:42431", transaction: intent.transaction,
    refillRequestId: mppRefillRequestId(intent.transaction), via: "chain", recordedAt: "2026-10-12T12:00:00.000Z",
  };
  assert.deepEqual(boundBeforeRefill, [settlement, { intentId: intent.intentId, roomId: "lighthouse" }]);
  assert.deepEqual([...ledger.refills.keys()], [mppRefillRequestId(intent.transaction)]);

  // A chain reader that reports a hash other than the intent's is a hand check: nothing is bound or credited.
  const other = memoryStore(), otherLedger = memoryLedger();
  await other.store.create(paths.intent, recordBytes(intent));
  const misreporting = fakeChain({ status: "paid", transaction: `0x${"cd".repeat(32)}`, evidence: {} });
  const misreported = await reconcileMppIntents({ store: other.store, ledger: otherLedger.ledger, chain: misreporting.reader, now: () => new Date(), apply: true });
  assert.equal(misreported.intents[0].outcome, "error");
  assert.match(misreported.intents[0].reason, /check by hand/);
  assert.equal(other.json(paths.settlement), null);
  assert.equal(otherLedger.refills.size, 0);
});

test("--recheck-expired re-reads expired intents, writes nothing, and flags one the chain now shows paid", async () => {
  const { chain, payment, reader } = await setup();
  const storage = memoryStore(), ledger = memoryLedger();
  const first = await payment();
  const other = await payment(first.challenge);
  const paths = mppRecordPaths(first.intent.intentId, "lighthouse");
  await storage.store.create(paths.intent, recordBytes(first.intent));
  await chain.land(first.charge.signedTransaction, "0x0");
  const marked = await reconcileMppIntents({ store: storage.store, ledger: ledger.ledger, chain: reader(), now: () => new Date(), apply: true });
  assert.equal(marked.intents[0].outcome, "expired");
  await chain.land(other.charge.signedTransaction, "0x1"); // a second signature for that offer lands later
  const before = [...storage.objects.keys()].sort();
  const plain = await reconcileMppIntents({ store: storage.store, ledger: ledger.ledger, chain: reader(), now: () => new Date(), apply: true });
  assert.equal(plain.intents[0].outcome, "skipped");
  const rechecked = await reconcileMppIntents({ store: storage.store, ledger: ledger.ledger, chain: reader(), now: () => new Date(), apply: true, recheckExpired: true });
  assert.deepEqual([rechecked.intents[0].outcome, rechecked.errors], ["error", 1]);
  assert.match(rechecked.intents[0].reason, /marked expired.*check by hand/);
  assert.deepEqual([...storage.objects.keys()].sort(), before, "the recheck writes nothing");
  assert.equal(ledger.refills.size, 0);
});

test("status reads the settlement record for credit-pending and flags an intent that holds no slot", async () => {
  const { payment } = await setup();
  const storage = memoryStore();
  const settled = await payment(), unpointed = await payment();
  for (const { intent } of [settled, unpointed]) await storage.store.create(mppRecordPaths(intent.intentId, "lighthouse").intent, recordBytes(intent));
  const settledPaths = mppRecordPaths(settled.intent.intentId, "lighthouse");
  await storage.store.create(settledPaths.roomIndex, recordBytes({ intentId: settled.intent.intentId, roomId: "lighthouse" }));
  await storage.store.create(settledPaths.settlement, recordBytes({
    kind: "fork-night/mpp-settlement/v1", intentId: settled.intent.intentId, network: "eip155:42431", transaction: settled.intent.transaction,
    refillRequestId: mppRefillRequestId(settled.intent.transaction), via: "broadcast", recordedAt: new Date().toISOString(),
  }));
  const groups = await collectMppRecords(storage.store);
  const byId = Object.fromEntries(groups.map((group) => [group.intentId, group]));
  assert.equal(byId[settled.intent.intentId].state, "credit-pending");
  assert.equal(byId[settled.intent.intentId].settlement?.transaction, settled.intent.transaction);
  assert.equal(byId[settled.intent.intentId].holdsSlot, true);
  assert.equal(byId[unpointed.intent.intentId].state, "pending");
  assert.equal(byId[unpointed.intent.intentId].holdsSlot, false);
});
