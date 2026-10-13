import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { handleMppFunding, type MppFundingDeps } from "../../src/mpp/funding.ts";
import { mppIntentId, mppRecordPaths, mppRefillRequestId } from "../../src/mpp/ids.ts";
import { activeMppTopUps } from "../../src/mpp/records.ts";
import { reconcileMppIntents } from "../../src/mpp/reconcile.ts";
import { recordPaths } from "../../src/x402/ids.ts";
import {
  OTHER_REF, REF, STEWARD,
  blockNetwork, doorRooms, fakeChain, fakeCharges, mppRequest,
} from "./mpp-fakes.ts";
import { memoryLedger, memoryStore } from "./x402-fakes.ts";

blockNetwork();

function setup(maxTopUps = 2) {
  const storage = memoryStore(), ledger = memoryLedger(), charges = fakeCharges(), chain = fakeChain();
  const deps: MppFundingDeps = {
    rooms: doorRooms(maxTopUps), charges: charges.port, chain: chain.reader, store: storage.store, ledger: ledger.ledger,
    now: () => new Date("2026-10-12T12:00:00.000Z"),
  };
  return { deps, storage, ledger, charges, chain };
}
const txOf = (challenge = "challenge-a", tag = "") => `0x${createHash("sha256").update(`${challenge}|${tag}`).digest("hex")}`;
const pathsOf = (challenge = "challenge-a", room = "lighthouse") => mppRecordPaths(mppIntentId(challenge), room);

test("an unpaid request gets an MPP challenge only for an eligible room, and changes nothing", async () => {
  const { deps, storage, ledger, charges } = setup();
  const offered = await handleMppFunding(mppRequest(), REF, deps);
  assert.equal(offered.status, 402);
  assert.match(offered.headers.get("WWW-Authenticate") ?? "", /^Payment id="challenge-1"/);
  assert.equal(offered.headers.get("Cache-Control"), "no-store");
  assert.equal(storage.objects.size, 0);
  assert(!ledger.calls.some((call) => call.startsWith("refill")));

  for (const [state, message] of [
    [{ open: false, deliveryLimit: 0, stewardExists: true }, /not open/],
    [{ open: true, deliveryLimit: 0, stewardExists: false }, /steward is unavailable/],
    [{ open: true, deliveryLimit: null, stewardExists: true }, /no generation allowance/],
    [{ open: true, deliveryLimit: 996, stewardExists: true }, /local test-credit limit/],
  ] as const) {
    ledger.rooms.lighthouse = { ...state };
    const refused = await handleMppFunding(mppRequest(), REF, deps);
    assert.equal(refused.status, 409);
    assert.equal(refused.headers.get("WWW-Authenticate"), null, "an ineligible room must not invite payment");
    assert.match((await refused.json()).error, message);
  }
  assert.deepEqual(charges.calls, ["offer"]);
  assert.equal(storage.objects.size, 0);
});

test("a paid request verifies, writes the intent, broadcasts, then credits once with the lowercase-hash request ID", async () => {
  const { deps, storage, ledger, charges } = setup();
  const paths = pathsOf();
  const order: string[] = [];
  const settle = charges.port.settle;
  charges.port.settle = async (charge) => {
    order.push(`settle with intent=${!!storage.json(paths.intent)} pointer=${!!storage.json(paths.roomIndex)}`);
    return settle(charge);
  };
  const refill = ledger.ledger.refill;
  let settlementBeforeRefill: unknown = null;
  ledger.ledger.refill = async (...args) => { settlementBeforeRefill = storage.json(paths.settlement); return refill(...args); };

  const response = await handleMppFunding(mppRequest(REF, {}), REF, deps);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "credited");
  assert.equal(body.added, 5);
  assert.equal(body.replayed, false);
  assert.equal(body.network, "eip155:42431");
  assert.equal(body.transaction, txOf());
  assert.equal(body.explorerUrl, `https://explore.testnet.tempo.xyz/tx/${txOf()}`);
  assert.equal(response.headers.get("Payment-Receipt"), `receipt:${txOf().slice(2, 10)}`);
  assert.deepEqual(charges.calls, ["present", "verify", "settle"]);
  assert.deepEqual(order, ["settle with intent=true pointer=true"]);

  const intent = storage.json(paths.intent), receipt = storage.json(paths.receipt);
  assert.equal(intent.kind, "fork-night/mpp-intent/v1");
  assert.equal(intent.roomId, "lighthouse");
  assert.equal(intent.stewardProfileId, STEWARD);
  assert.equal(intent.transaction, txOf());
  assert.deepEqual(storage.json(paths.roomIndex), { intentId: mppIntentId("challenge-a"), roomId: "lighthouse" });
  // The adapter reported the hash in uppercase; the refill ID uses the lowercase form, as the reconciler does.
  assert.equal(receipt.refillRequestId, mppRefillRequestId(txOf()));
  assert.equal(receipt.refillRequestId, mppRefillRequestId(txOf().toUpperCase().replace(/^0X/, "0x")));
  const settlement = {
    kind: "fork-night/mpp-settlement/v1", intentId: mppIntentId("challenge-a"), network: "eip155:42431",
    transaction: txOf(), refillRequestId: receipt.refillRequestId, via: "broadcast", recordedAt: "2026-10-12T12:00:00.000Z",
  };
  assert.deepEqual(settlementBeforeRefill, settlement);
  assert.deepEqual(storage.json(paths.settlement), settlement);
  assert.deepEqual(ledger.calls.filter((call) => call.startsWith("refill")), [`refill:${receipt.refillRequestId}`]);
  assert.equal(ledger.rooms.lighthouse.deliveryLimit, 5);
  assert.match(receipt.label, /Testnet funds demonstrate the payment rail/);
  assert.equal(receipt.paymentReceipt, `receipt:${txOf().slice(2, 10)}`);
  // Every record lives under mpp/, none under x402/.
  assert(storage.paths("").every((path) => path.startsWith("mpp/")));
});

test("nothing is broadcast without a durable intent and room pointer", async () => {
  for (const failing of [/^mpp\/intents\//, /^mpp\/rooms\//]) {
    const { deps, storage, ledger, charges } = setup();
    storage.failCreate.push(failing);
    const response = await handleMppFunding(mppRequest(REF, {}), REF, deps);
    assert.equal(response.status, 503);
    assert(!charges.calls.includes("settle"));
    assert(!ledger.calls.some((call) => call.startsWith("refill")));
  }
});

test("an invalid or unverifiable payment is refused before any record or broadcast", async () => {
  const { deps, storage, charges } = setup();
  charges.setVerification({ valid: false, reason: "TIP20 token error: InsufficientBalance" });
  const invalid = await handleMppFunding(mppRequest(REF, {}), REF, deps);
  assert.equal(invalid.status, 402);
  assert(invalid.headers.get("WWW-Authenticate"));
  assert.equal((await invalid.json()).error, "TIP20 token error: InsufficientBalance");
  charges.setVerification(new Error("Moderato unreachable"));
  assert.equal((await handleMppFunding(mppRequest(REF, {}), REF, deps)).status, 503);
  // Undecodable credentials get a fresh offer, never a record.
  const garbage = await handleMppFunding(mppRequest(REF, undefined, { headers: { authorization: "Payment !!!" } }), REF, deps);
  assert.equal(garbage.status, 402);
  assert.equal((await garbage.json()).error, "undecodable");
  assert.equal(storage.objects.size, 0);
  assert(!charges.calls.includes("settle"));
});

test("pending, failed and uncredited payments never credit, and keep their intent and limit slot", async () => {
  const { deps, storage, ledger, charges } = setup(5);
  charges.setSettlement({ kind: "pending", transaction: txOf("challenge-a"), reason: "The request took too long to respond." });
  const pending = await handleMppFunding(mppRequest(REF, {}), REF, deps);
  assert.equal(pending.status, 202);
  assert.equal(pending.headers.get("Payment-Receipt"), null);
  assert.equal(pending.headers.get("WWW-Authenticate"), null, "a payment that may have landed is never re-offered");
  const pendingBody = await pending.json();
  assert.equal(pendingBody.status, "pending");
  assert.match(pendingBody.message, /must not sign a new payment/);
  assert(storage.json(pathsOf().intent));
  assert.equal(storage.json(pathsOf().receipt), null);
  assert.equal(storage.paths(`mpp/events/${mppIntentId("challenge-a")}/`).length, 1);

  charges.setSettlement(() => { throw new TypeError("fetch failed"); });
  const thrown = await handleMppFunding(mppRequest(REF, { challenge: "challenge-b" }), REF, deps);
  assert.equal(thrown.status, 202);
  assert.equal((await thrown.json()).status, "pending");

  charges.setSettlement({ kind: "failed", reason: "Payment expired." });
  const failed = await handleMppFunding(mppRequest(REF, { challenge: "challenge-c" }), REF, deps);
  assert.equal(failed.status, 402);
  assert.match((await failed.json()).error, /did not settle: Payment expired/);

  charges.setSettlement((charge) => ({ kind: "settled", transaction: charge.transaction, receipt: {}, receiptHeader: "receipt:x" }));
  ledger.failNextRefills(new Error("database unavailable"));
  const uncredited = await handleMppFunding(mppRequest(REF, { challenge: "challenge-d" }), REF, deps);
  assert.equal(uncredited.status, 202);
  assert.equal((await uncredited.json()).status, "settled-credit-pending");
  assert.equal(uncredited.headers.get("Payment-Receipt"), "receipt:x");
  assert.equal(storage.json(pathsOf("challenge-d").receipt), null);
  assert.equal(ledger.refills.size, 0);

  // Unresolved payments keep their slots, and the refusal still explains the failure.
  const { deps: full, charges: fullCharges } = setup(1);
  fullCharges.setSettlement({ kind: "failed", reason: "Payment expired." });
  const atLimit = await handleMppFunding(mppRequest(REF, {}), REF, full);
  assert.equal(atLimit.status, 409);
  assert.match((await atLimit.json()).error, /did not settle: Payment expired.*top-up limit/);
});

test("the same signed payment again returns the stored result without broadcasting twice", async () => {
  const { deps, ledger, charges, chain } = setup();
  const first = await handleMppFunding(mppRequest(REF, {}), REF, deps);
  assert.equal(first.status, 200);
  const again = await handleMppFunding(mppRequest(REF, {}), REF, deps);
  assert.equal(again.status, 200);
  const body = await again.json();
  assert.equal(body.replayed, true);
  assert.equal(again.headers.get("Payment-Receipt"), first.headers.get("Payment-Receipt"));
  assert.equal(charges.calls.filter((call) => call === "settle").length, 1);
  assert.equal(charges.calls.filter((call) => call === "verify").length, 1);
  assert.deepEqual(chain.inspected, []);
  assert.equal(ledger.refills.size, 1);
});

test("a pending payment presented again is resolved from the chain and credited once, never re-broadcast", async () => {
  const { deps, storage, ledger, charges, chain } = setup(1);
  charges.setSettlement({ kind: "pending", transaction: txOf(), reason: "The request took too long to respond." });
  assert.equal((await handleMppFunding(mppRequest(REF, {}), REF, deps)).status, 202);

  // Not on chain yet: still pending, no offer, nothing re-sent.
  const waiting = await handleMppFunding(mppRequest(REF, {}), REF, deps);
  assert.equal(waiting.status, 202);
  assert.equal(waiting.headers.get("WWW-Authenticate"), null);
  assert.match((await waiting.json()).message, /may still land.*do not sign a new payment/);
  // The chain cannot be read: still pending, never a 503 that claims nothing was charged.
  chain.set(new Error("Moderato eth_getTransactionReceipt returned HTTP 502."));
  const unreadable = await handleMppFunding(mppRequest(REF, {}), REF, deps);
  assert.equal(unreadable.status, 202);
  assert.match((await unreadable.json()).message, /could not be read/);

  // The chain shows the transfer: settlement first, then one credit with the transaction's request ID.
  chain.set({ status: "paid", transaction: txOf().toUpperCase().replace(/^0X/, "0x"), evidence: { source: "receipt" } });
  const resumed = await handleMppFunding(mppRequest(REF, {}), REF, deps);
  assert.equal(resumed.status, 200);
  assert.equal((await resumed.json()).replayed, false);
  assert.equal(resumed.headers.get("Payment-Receipt"), null);
  assert.equal(storage.json(pathsOf().settlement).via, "chain");
  assert.deepEqual([...ledger.refills.keys()], [mppRefillRequestId(txOf())]);
  // And once credited, the receipt answers without reading the chain again.
  const inspections = chain.inspected.length;
  assert.equal((await handleMppFunding(mppRequest(REF, {}), REF, deps)).status, 200);
  assert.equal(chain.inspected.length, inspections);
  assert.equal(charges.calls.filter((call) => call === "settle").length, 1);
  assert.equal(charges.calls.filter((call) => call === "verify").length, 1);
});

test("a recorded payment presented after its offer expired gets its stored outcome; a new one a fresh offer", async () => {
  const { deps, storage, ledger, charges, chain } = setup(5);
  const expired = "This offer expired; ask for a new one.";
  assert.equal((await handleMppFunding(mppRequest(REF, {}), REF, deps)).status, 200);
  charges.setSettlement({ kind: "pending", transaction: null, reason: "TimeoutError" });
  assert.equal((await handleMppFunding(mppRequest(REF, { challenge: "challenge-b" }), REF, deps)).status, 202);
  const before = charges.calls.length;

  charges.setStale(expired);
  const replayed = await handleMppFunding(mppRequest(REF, {}), REF, deps);
  assert.equal(replayed.status, 200);
  assert.equal((await replayed.json()).replayed, true);
  const unresolved = await handleMppFunding(mppRequest(REF, { challenge: "challenge-b" }), REF, deps);
  assert.equal(unresolved.status, 202);
  assert.equal(unresolved.headers.get("WWW-Authenticate"), null);
  const fresh = await handleMppFunding(mppRequest(REF, { challenge: "challenge-c" }), REF, deps);
  assert.equal(fresh.status, 402);
  assert.equal((await fresh.json()).error, expired);
  assert.equal(storage.json(pathsOf("challenge-c").intent), null);
  // Recorded payments are answered before any match against the current offer, so only the new one is presented.
  assert.deepEqual(charges.calls.slice(before), ["present", `offer:${expired}`]);
  assert.deepEqual(chain.inspected, [mppIntentId("challenge-b")]);
  assert.equal(ledger.refills.size, 1);
});

test("only the chain's proof of expiry, recorded by the reconciler, turns a recorded payment into a fresh offer", async () => {
  const { deps, storage, charges, chain } = setup();
  charges.setSettlement({ kind: "pending", transaction: txOf(), reason: "TimeoutError" });
  assert.equal((await handleMppFunding(mppRequest(REF, {}), REF, deps)).status, 202);
  // The route sees an unpayable verdict but never writes the expired marker itself.
  chain.set({ status: "unpayable", reason: "The deadline passed with no transfer.", evidence: {} });
  const told = await handleMppFunding(mppRequest(REF, {}), REF, deps);
  assert.equal(told.status, 202);
  assert.match((await told.json()).message, /node --env-file-if-exists=\.env\.local scripts\/mpp-reconcile\.ts --apply/);
  assert.equal(storage.json(pathsOf().expired), null);
  // Once the reconciler records it, the payer is told nothing was charged.
  await storage.store.create(pathsOf().expired, Buffer.from("{}"));
  const answered = await handleMppFunding(mppRequest(REF, {}), REF, deps);
  assert.equal(answered.status, 402);
  assert.match((await answered.json()).error, /expired before it settled; nothing was charged/);
  assert.equal(charges.calls.filter((call) => call === "settle").length, 1);
});

test("only the transaction recorded first for a payment can ever credit it", async () => {
  const { deps, storage, ledger, charges, chain } = setup();
  let clock = Date.parse("2026-10-12T12:00:00.000Z");
  deps.now = () => new Date(clock);
  const paths = pathsOf();
  charges.setSettlement((charge) => ({ kind: "settled", transaction: charge.transaction, receipt: {}, receiptHeader: "receipt:A" }));
  ledger.failNextRefills(new Error("database unavailable"));
  assert.equal((await handleMppFunding(mppRequest(REF, {}), REF, deps)).status, 202);
  assert.equal(storage.json(paths.settlement).transaction, txOf());
  ledger.failNextRefills(null);

  // A chain reader that reports another hash for the same intent credits nothing.
  clock += 60_000;
  const other = `0x${"cd".repeat(32)}`;
  chain.set({ status: "paid", transaction: other, evidence: {} });
  const misreported = await handleMppFunding(mppRequest(REF, {}), REF, deps);
  assert.equal(misreported.status, 202);
  assert.equal((await misreported.json()).status, "settled-credit-pending");
  assert.equal(ledger.refills.size, 0);
  const events = storage.paths(`mpp/events/${mppIntentId("challenge-a")}/`).map((path) => storage.json(path));
  assert.deepEqual(events.map((event) => [event.kind, event.transaction ?? null, event.recorded ?? null]), [
    ["credit-pending", txOf(), null], ["hash-differs", null, txOf()], ["credit-pending", other, txOf()],
  ]);

  // Only the recorded hash credits, under the request ID recorded with it.
  chain.set({ status: "paid", transaction: txOf(), evidence: {} });
  assert.equal((await handleMppFunding(mppRequest(REF, {}), REF, deps)).status, 200);
  assert.deepEqual([...ledger.refills.keys()], [mppRefillRequestId(txOf())]);

  // A settlement record that names another transaction (written by hand or by an older build) blocks the credit,
  // even when the chain confirms the intent's own hash.
  const stale = setup();
  stale.charges.setSettlement({ kind: "pending", transaction: txOf(), reason: "TimeoutError" });
  assert.equal((await handleMppFunding(mppRequest(REF, {}), REF, stale.deps)).status, 202);
  await stale.storage.store.create(paths.settlement, Buffer.from(JSON.stringify({
    kind: "fork-night/mpp-settlement/v1", intentId: mppIntentId("challenge-a"), network: "eip155:42431",
    transaction: other, refillRequestId: mppRefillRequestId(other), via: "broadcast", recordedAt: "2026-10-12T11:59:00.000Z",
  })));
  stale.chain.set({ status: "paid", transaction: txOf(), evidence: {} });
  const blocked = await handleMppFunding(mppRequest(REF, {}), REF, stale.deps);
  assert.equal(blocked.status, 202);
  assert.equal((await blocked.json()).status, "settled-credit-pending");
  assert.equal(stale.ledger.refills.size, 0);
});

test("one challenge funds at most one room, and one offer at most one signed payment", async () => {
  const { deps, charges } = setup();
  assert.equal((await handleMppFunding(mppRequest(REF, {}), REF, deps)).status, 200);
  const elsewhere = await handleMppFunding(mppRequest(OTHER_REF, {}), OTHER_REF, deps);
  assert.equal(elsewhere.status, 409);
  assert.match((await elsewhere.json()).error, /another room/);
  // A second signed transaction for the same challenge (stock mppx accepts both) is refused, never broadcast.
  charges.setSettlement({ kind: "pending", transaction: null, reason: "TimeoutError" });
  assert.equal((await handleMppFunding(mppRequest(REF, { challenge: "challenge-b" }), REF, deps)).status, 202);
  const second = await handleMppFunding(mppRequest(REF, { challenge: "challenge-b", tag: "re-signed" }), REF, deps);
  assert.equal(second.status, 409);
  assert.match((await second.json()).error, /different payment/);
  assert.equal(charges.calls.filter((call) => call === "settle").length, 2);
});

test("the MPP limit is enforced before broadcast, per rail; only chain-confirmed expiry frees a slot", async () => {
  const { deps, storage, charges } = setup(1);
  // An x402 top-up of the same room does not count against the MPP rail.
  await storage.store.create(recordPaths("a".repeat(64), "lighthouse").roomIndex, Buffer.from("{}"));
  assert.equal((await handleMppFunding(mppRequest(REF, {}), REF, deps)).status, 200);
  const offer = await handleMppFunding(mppRequest(), REF, deps);
  assert.equal(offer.status, 409);
  assert.match((await offer.json()).error, /top-up limit/);
  const second = await handleMppFunding(mppRequest(REF, { challenge: "challenge-e" }), REF, deps);
  assert.equal(second.status, 409);
  assert.equal(charges.calls.filter((call) => call === "settle").length, 1);
  // The other room has its own MPP limit.
  assert.equal((await handleMppFunding(mppRequest(OTHER_REF), OTHER_REF, deps)).status, 402);

  const { deps: d2, storage: s2, charges: c2 } = setup(1);
  c2.setSettlement({ kind: "pending", transaction: null, reason: "TimeoutError" });
  assert.equal((await handleMppFunding(mppRequest(REF, {}), REF, d2)).status, 202);
  assert.equal((await handleMppFunding(mppRequest(), REF, d2)).status, 409);
  await s2.store.create(pathsOf().expired, Buffer.from("{}"));
  assert.equal((await handleMppFunding(mppRequest(), REF, d2)).status, 402);
  assert.equal(s2.json(pathsOf().intent).intentId, mppIntentId("challenge-a"));
  assert.deepEqual(s2.paths("mpp/rooms/lighthouse/"), [pathsOf().roomIndex]);
  assert.deepEqual(c2.calls, ["present", "verify", "settle", "offer"]);
});

test("concurrent payments for one room cannot exceed the MPP limit", async () => {
  const { deps, charges } = setup(1);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const settle = charges.port.settle;
  charges.port.settle = async (charge) => { await gate; return settle(charge); };
  const first = handleMppFunding(mppRequest(REF, { challenge: "challenge-1" }), REF, deps);
  const second = handleMppFunding(mppRequest(REF, { challenge: "challenge-2" }), REF, deps);
  await new Promise((resolve) => setTimeout(resolve, 10));
  release();
  const statuses = (await Promise.all([first, second])).map((response) => response.status).sort();
  assert.deepEqual(statuses, [200, 409]);
  assert.equal(charges.calls.filter((call) => call === "settle").length, 1);
});

test("a challenge offered for another room is refused before any record", async () => {
  const { deps, storage, charges } = setup();
  const refused = await handleMppFunding(mppRequest(REF, { room: "paper-moon" }), REF, deps);
  assert.equal(refused.status, 402);
  assert.match((await refused.json()).error, /different funding link/);
  assert.equal(storage.objects.size, 0);
  assert(!charges.calls.includes("verify"));
});

test("unknown references, other methods and oversized requests are refused", async () => {
  const { deps, charges } = setup();
  assert.equal((await handleMppFunding(mppRequest("ref_unknown_ccccccccccccccc"), "ref_unknown_ccccccccccccccc", deps)).status, 404);
  assert.equal((await handleMppFunding(mppRequest("toString"), "toString", deps)).status, 404);
  const get = await handleMppFunding(mppRequest(REF, undefined, { method: "GET" }), REF, deps);
  assert.equal(get.status, 405);
  assert.equal(get.headers.get("Allow"), "POST");
  assert.equal((await handleMppFunding(mppRequest(REF, {}, { headers: { "content-length": "4096" } }), REF, deps)).status, 413);
  assert.deepEqual(charges.calls, []);
});

// Review fixes (12 October). Each of these failed on the reviewed sources.

test("a confirmed transaction other than the one the intent recorded is never credited, not even beside a concurrent reconcile (MS-3)", async () => {
  // The broadcast alone reports another hash: a hand check, no settlement, no credit.
  const alone = setup();
  const T2 = `0x${"ee".repeat(32)}`;
  alone.charges.setSettlement({ kind: "settled", transaction: T2, receipt: {}, receiptHeader: "receipt:T2" });
  const reported = await handleMppFunding(mppRequest(REF, {}), REF, alone.deps);
  assert.equal(reported.status, 202);
  const body = await reported.json();
  assert.deepEqual([body.status, body.handCheck, body.transaction], ["settled-credit-pending", true, txOf()]);
  assert.match(body.message, /check(ed)? by hand.*do not pay again/i);
  assert.equal(reported.headers.get("Payment-Receipt"), null);
  assert.equal(alone.storage.json(pathsOf().settlement), null);
  assert.equal(alone.storage.json(pathsOf().receipt), null);
  assert.equal(alone.ledger.refills.size, 0);
  const kinds = alone.storage.paths(`mpp/events/${mppIntentId("challenge-a")}/`).map((path) => alone.storage.json(path).kind).sort();
  assert.deepEqual(kinds, ["credit-pending", "hash-differs"]);

  // The reconciler credits the recorded hash while that broadcast is still in flight: one refill, never two.
  const { deps, storage, ledger, charges, chain } = setup();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  charges.port.settle = async () => { await gate; return { kind: "settled", transaction: T2, receipt: {}, receiptHeader: "receipt:T2" }; };
  const inFlight = handleMppFunding(mppRequest(REF, {}), REF, deps);
  let report: Awaited<ReturnType<typeof reconcileMppIntents>>;
  try {
    for (let i = 0; i < 100 && !storage.json(pathsOf().roomIndex); i += 1) await new Promise((resolve) => setTimeout(resolve, 1));
    chain.set({ status: "paid", transaction: txOf(), evidence: { source: "receipt" } });
    report = await reconcileMppIntents({ store: storage.store, ledger: ledger.ledger, chain: chain.reader, now: deps.now!, apply: true });
  } finally {
    release(); // never leave the room lock held for the tests that follow
  }
  assert.equal(report.intents[0].outcome, "credited");
  assert.deepEqual([storage.json(pathsOf().settlement)?.transaction, storage.json(pathsOf().settlement)?.via], [txOf(), "chain"]);
  assert.equal((await inFlight).status, 202);
  assert.deepEqual([...ledger.refills.keys()], [mppRefillRequestId(txOf())]);
  assert.equal(ledger.rooms.lighthouse.deliveryLimit, 5);
  assert.equal(storage.json(pathsOf().receipt).transaction, txOf());
});

test("every credited payment holds its slot: the room pointer is rewritten before any credit, by the route and by the reconciler", async () => {
  const { deps, storage, ledger, chain } = setup(1);
  storage.failCreate.push(/^mpp\/rooms\//);
  const first = await handleMppFunding(mppRequest(REF, {}), REF, deps);
  assert.equal(first.status, 503);
  assert.match((await first.json()).error, /do not sign a new one/);
  assert(storage.json(pathsOf().intent));
  assert.equal(storage.json(pathsOf().roomIndex), null);

  // The signed transaction lands anyway (the payer holds it); the re-send cannot credit it without the pointer.
  chain.set({ status: "paid", transaction: txOf(), evidence: { source: "receipt" } });
  const blocked = await handleMppFunding(mppRequest(REF, {}), REF, deps);
  assert.equal(blocked.status, 202);
  assert.equal((await blocked.json()).status, "settled-credit-pending");
  assert.equal(ledger.refills.size, 0);
  storage.failCreate.length = 0;
  const resumed = await handleMppFunding(mppRequest(REF, {}), REF, deps);
  assert.equal(resumed.status, 200);
  assert.deepEqual(storage.json(pathsOf().roomIndex), { intentId: mppIntentId("challenge-a"), roomId: "lighthouse" });
  assert.equal(await activeMppTopUps(storage.store, "lighthouse"), 1);
  // Limit 1: no second top-up is offered or credited.
  chain.set({ status: "pending", reason: "not on chain yet" });
  assert.equal((await handleMppFunding(mppRequest(), REF, deps)).status, 409);
  assert.equal((await handleMppFunding(mppRequest(REF, { challenge: "challenge-b" }), REF, deps)).status, 409);
  assert.equal(ledger.refills.size, 1);

  // The reconciler writes the missing pointer before it credits, too.
  const other = setup(1);
  other.storage.failCreate.push(/^mpp\/rooms\//);
  assert.equal((await handleMppFunding(mppRequest(REF, {}), REF, other.deps)).status, 503);
  other.storage.failCreate.length = 0;
  other.chain.set({ status: "paid", transaction: txOf(), evidence: { source: "receipt" } });
  const report = await reconcileMppIntents({ store: other.storage.store, ledger: other.ledger.ledger, chain: other.chain.reader, now: other.deps.now!, apply: true });
  assert.equal(report.intents[0].outcome, "credited");
  assert(other.storage.json(pathsOf().roomIndex), "the reconciler wrote the room pointer");
  assert.equal(await activeMppTopUps(other.storage.store, "lighthouse"), 1);
});

test("storage failures after a credential is presented never claim that nothing was charged", async () => {
  const { deps, storage, ledger, charges, chain } = setup();
  charges.setSettlement({ kind: "pending", transaction: txOf(), reason: "The request took too long to respond." });
  assert.equal((await handleMppFunding(mppRequest(REF, {}), REF, deps)).status, 202);
  chain.set({ status: "paid", transaction: txOf(), evidence: {} });
  const failing = (prefix: string) => ({
    ...storage.store,
    async read(path: string) { if (path.startsWith(prefix)) throw new Error("storage 502"); return storage.store.read(path); },
  });
  // The intent is known but its receipt cannot be read: pending, never "nothing was charged".
  const recorded = await handleMppFunding(mppRequest(REF, {}), REF, { ...deps, store: failing("mpp/receipts/") });
  assert.equal(recorded.status, 202);
  const body = await recorded.json();
  assert.equal(body.status, "pending");
  assert.match(body.message, /do not sign a new payment/);
  assert.doesNotMatch(JSON.stringify(body), /Nothing was charged/);
  // Whether an intent exists cannot be read: a neutral 503 that never invites a new signature.
  const unknown = await handleMppFunding(mppRequest(REF, {}), REF, { ...deps, store: failing("mpp/intents/") });
  assert.equal(unknown.status, 503);
  const error = (await unknown.json()).error;
  assert.match(error, /re-send the same payment later; do not sign a new one/i);
  assert.doesNotMatch(error, /Nothing was charged/);
  assert.equal(ledger.refills.size, 0);
  // Before any credential exists, "nothing was charged" is still true and still said.
  ledger.ledger.state = async () => { throw new Error("database unavailable"); };
  const unpaid = await handleMppFunding(mppRequest(), REF, deps);
  assert.equal(unpaid.status, 503);
  assert.match((await unpaid.json()).error, /Nothing was charged/);
});
