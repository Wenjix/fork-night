import { test } from "node:test";
import assert from "node:assert/strict";
import { handleFunding, type FundingDeps } from "../../src/x402/funding.ts";
import { BASE_SEPOLIA, SOLANA_DEVNET, intentId, recordPaths, refillRequestId } from "../../src/x402/ids.ts";
import {
  OTHER_REF, REF, STEWARD,
  fakePayments, fundingConfig, fundingRequest, memoryLedger, memoryStore,
} from "./x402-fakes.ts";

function setup(maxTopUps = 2) {
  const storage = memoryStore(), ledger = memoryLedger(), payments = fakePayments();
  const deps: FundingDeps = {
    config: fundingConfig(maxTopUps), payments: payments.port, store: storage.store, ledger: ledger.ledger,
    now: () => new Date("2026-10-12T12:00:00.000Z"),
  };
  return { deps, storage, ledger, payments };
}
const solana = (memo = "b".repeat(32)) => ({ network: SOLANA_DEVNET, memo, payer: "4uxMGnZdLT6Jz2b4FtdBsB77DiobT5WvJsZp68XpGJsA" } as const);
const base = (nonce = `0x${"2".repeat(64)}`) => ({ network: BASE_SEPOLIA, nonce, payer: "0x309a90aA8453E78f1B5878B46E5B65342dF7Fe83" } as const);
const keyOf = (payment: ReturnType<typeof solana> | ReturnType<typeof base>) => intentId(
  payment.network === SOLANA_DEVNET
    ? { network: payment.network, memo: payment.memo }
    : { network: payment.network, payer: payment.payer.toLowerCase(), nonce: payment.nonce.toLowerCase() },
);

test("an unpaid request gets an x402 offer only for an eligible room, and changes nothing", async () => {
  const { deps, storage, ledger, payments } = setup();
  const offered = await handleFunding(fundingRequest(), REF, deps);
  assert.equal(offered.status, 402);
  assert.equal(offered.headers.get("PAYMENT-REQUIRED"), "offer-1");
  assert.equal(storage.objects.size, 0);
  assert(!ledger.calls.some((call) => call.startsWith("refill")));

  for (const [state, message] of [
    [{ open: false, deliveryLimit: 0, stewardExists: true }, /not open/],
    [{ open: true, deliveryLimit: 0, stewardExists: false }, /steward is unavailable/],
    [{ open: true, deliveryLimit: null, stewardExists: true }, /no generation allowance/],
    [{ open: true, deliveryLimit: 996, stewardExists: true }, /local test-credit limit/],
  ] as const) {
    ledger.rooms.lighthouse = { ...state };
    const refused = await handleFunding(fundingRequest(), REF, deps);
    assert.equal(refused.status, 409);
    assert.equal(refused.headers.get("PAYMENT-REQUIRED"), null, "an ineligible room must not invite payment");
    assert.match((await refused.json()).error, message);
  }
  assert.deepEqual(payments.calls, ["offer"]);
  assert.equal(storage.objects.size, 0);
});

test("a paid request verifies, writes the intent, settles, then credits once with the transaction's request ID", async () => {
  const { deps, storage, ledger, payments } = setup();
  const payment = base();
  const id = keyOf(payment), paths = recordPaths(id, "lighthouse");
  const refill = ledger.ledger.refill;
  let settlementBeforeRefill: unknown = null;
  ledger.ledger.refill = async (...args) => { settlementBeforeRefill = storage.json(paths.settlement); return refill(...args); };
  const response = await handleFunding(fundingRequest(REF, payment), REF, deps);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "credited");
  assert.equal(body.added, 5);
  assert.equal(body.replayed, false);
  assert.match(response.headers.get("PAYMENT-RESPONSE") ?? "", /^settled:/);
  assert.deepEqual(payments.calls, ["present", "verify", "settle"]);

  const intent = storage.json(paths.intent), receipt = storage.json(paths.receipt);
  assert.equal(intent.roomId, "lighthouse");
  assert.equal(intent.stewardProfileId, STEWARD);
  assert.deepEqual(storage.json(paths.roomIndex), { intentId: id, roomId: "lighthouse" });
  // EVM hashes are case-insensitive: the request ID uses the lowercased hash.
  assert.match(body.transaction, /^0x[0-9A-F]{64}$/);
  assert.equal(receipt.refillRequestId, refillRequestId(BASE_SEPOLIA, body.transaction));
  assert.equal(receipt.refillRequestId, refillRequestId(BASE_SEPOLIA, body.transaction.toLowerCase()));
  // The settlement is bound to the intent, in normalized form, before the room is credited.
  const settlement = {
    kind: "fork-night/x402-settlement/v1", intentId: id, network: BASE_SEPOLIA,
    transaction: body.transaction.toLowerCase(), refillRequestId: receipt.refillRequestId, recordedAt: "2026-10-12T12:00:00.000Z",
  };
  assert.deepEqual(settlementBeforeRefill, settlement);
  assert.deepEqual(storage.json(paths.settlement), settlement);
  assert.deepEqual(ledger.calls.filter((call) => call.startsWith("refill")), [`refill:${receipt.refillRequestId}`]);
  assert.equal(ledger.rooms.lighthouse.deliveryLimit, 5);
  assert.match(receipt.label, /Testnet funds demonstrate the payment rail/);
});

test("nothing settles without a durable intent", async () => {
  for (const failing of [/^x402\/intents\//, /^x402\/rooms\//]) {
    const { deps, storage, ledger, payments } = setup();
    storage.failCreate.push(failing);
    const response = await handleFunding(fundingRequest(REF, solana()), REF, deps);
    assert.equal(response.status, 503);
    assert(!payments.calls.includes("settle"));
    assert(!ledger.calls.some((call) => call.startsWith("refill")));
  }
});

test("an invalid or unverifiable payment is refused before any record or settlement", async () => {
  const { deps, storage, payments } = setup();
  payments.setVerification({ valid: false, reason: "invalid_exact_svm_payload_memo_mismatch" });
  const invalid = await handleFunding(fundingRequest(REF, solana()), REF, deps);
  assert.equal(invalid.status, 402);
  assert.equal(invalid.headers.get("PAYMENT-REQUIRED"), "offer-1");
  assert.equal((await invalid.json()).error, "invalid_exact_svm_payload_memo_mismatch");
  payments.setVerification(new Error("facilitator unreachable"));
  assert.equal((await handleFunding(fundingRequest(REF, solana()), REF, deps)).status, 503);
  assert.equal(storage.objects.size, 0);
  assert(!payments.calls.includes("settle"));
});

test("pending, failed and uncredited settlements never credit, and keep the intent for reconciliation", async () => {
  const { deps, storage, ledger, payments } = setup(5);
  payments.setSettlement({ kind: "pending", transaction: "pendingSig", reason: "settlement_pending" });
  const pending = await handleFunding(fundingRequest(REF, solana()), REF, deps);
  assert.equal(pending.status, 202);
  assert.equal(pending.headers.get("PAYMENT-RESPONSE"), null);
  assert.equal((await pending.json()).status, "pending");
  const id = keyOf(solana());
  assert(storage.json(recordPaths(id, "lighthouse").intent));
  assert.equal(storage.json(recordPaths(id, "lighthouse").receipt), null);
  assert.equal(storage.paths(`x402/events/${id}/`).length, 1);

  payments.setSettlement(() => { throw new TypeError("fetch failed"); });
  const thrown = await handleFunding(fundingRequest(REF, solana("f".repeat(32))), REF, deps);
  assert.equal(thrown.status, 202);
  assert.equal((await thrown.json()).status, "pending");

  payments.setSettlement({ kind: "failed", reason: "invalid_json" });
  const failed = await handleFunding(fundingRequest(REF, solana("c".repeat(32))), REF, deps);
  assert.equal(failed.status, 402);
  assert.match((await failed.json()).error, /did not settle: invalid_json/);

  payments.setSettlement({ kind: "settled", transaction: "settledSig", response: {}, header: "settled:x" });
  ledger.failNextRefills(new Error("database unavailable"));
  const uncredited = await handleFunding(fundingRequest(REF, solana("d".repeat(32))), REF, deps);
  assert.equal(uncredited.status, 202);
  assert.equal((await uncredited.json()).status, "settled-credit-pending");
  assert.equal(uncredited.headers.get("PAYMENT-RESPONSE"), "settled:x");
  assert.equal(storage.json(recordPaths(keyOf(solana("d".repeat(32))), "lighthouse").receipt), null);
  assert.equal(ledger.refills.size, 0);

  // Unresolved payments keep their ceiling slots, and the refusal still explains the failure.
  const { deps: full, payments: fullPayments } = setup(1);
  fullPayments.setSettlement({ kind: "failed", reason: "invalid_json" });
  const atCeiling = await handleFunding(fundingRequest(REF, solana()), REF, full);
  assert.equal(atCeiling.status, 409);
  assert.match((await atCeiling.json()).error, /did not settle: invalid_json.*top-up limit/);
});

test("only the transaction recorded first for a payment can ever credit it", async () => {
  const { deps, storage, ledger, payments } = setup();
  let clock = Date.parse("2026-10-12T12:00:00.000Z");
  deps.now = () => new Date(clock);
  const payment = solana(), id = keyOf(payment), paths = recordPaths(id, "lighthouse");
  const events = () => storage.paths(`x402/events/${id}/`).map((path) => storage.json(path));
  // The facilitator reports A, then the refill fails: A stays bound to the payment.
  payments.setSettlement({ kind: "settled", transaction: "sigA", response: {}, header: "settled:A" });
  ledger.failNextRefills(new Error("database unavailable"));
  assert.equal((await handleFunding(fundingRequest(REF, payment), REF, deps)).status, 202);
  assert.deepEqual(storage.json(paths.settlement), {
    kind: "fork-night/x402-settlement/v1", intentId: id, network: SOLANA_DEVNET,
    transaction: "sigA", refillRequestId: refillRequestId(SOLANA_DEVNET, "sigA"), recordedAt: "2026-10-12T12:00:00.000Z",
  });
  ledger.failNextRefills(null);

  // Presented again, a misreported hash B settles nothing new and credits nothing.
  clock += 60_000;
  payments.setSettlement({ kind: "settled", transaction: "sigB", response: {}, header: "settled:B" });
  const misreported = await handleFunding(fundingRequest(REF, payment), REF, deps);
  assert.equal(misreported.status, 202);
  assert.equal((await misreported.json()).status, "settled-credit-pending");
  assert.equal(misreported.headers.get("PAYMENT-RESPONSE"), "settled:B");
  assert.deepEqual(ledger.calls.filter((call) => call.startsWith("refill")), [`refill:${refillRequestId(SOLANA_DEVNET, "sigA")}`]);
  assert.equal(ledger.refills.size, 0);
  assert.equal(storage.json(paths.receipt), null);
  assert.equal(storage.json(paths.settlement).transaction, "sigA");
  assert.deepEqual(events().map((event) => [event.kind, event.transaction, event.recorded ?? null]), [
    ["credit-pending", "sigA", null], ["credit-pending", "sigB", "sigA"],
  ]);

  // Only A credits, under the request ID recorded with it.
  payments.setSettlement({ kind: "settled", transaction: "sigA", response: {}, header: "settled:A" });
  assert.equal((await handleFunding(fundingRequest(REF, payment), REF, deps)).status, 200);
  assert.deepEqual([...ledger.refills.keys()], [refillRequestId(SOLANA_DEVNET, "sigA")]);
  assert.equal(ledger.rooms.lighthouse.deliveryLimit, 5);
});

test("a settlement that cannot be recorded is never credited by the route", async () => {
  const { deps, storage, ledger } = setup();
  storage.failCreate.push(/^x402\/settlements\//);
  const payment = base(), id = keyOf(payment);
  const response = await handleFunding(fundingRequest(REF, payment), REF, deps);
  assert.equal(response.status, 202);
  const body = await response.json();
  assert.equal(body.status, "settled-credit-pending");
  assert.match(response.headers.get("PAYMENT-RESPONSE") ?? "", /^settled:/);
  assert.deepEqual(ledger.calls.filter((call) => call.startsWith("refill")), []);
  assert.equal(storage.json(recordPaths(id, "lighthouse").receipt), null);
  const [event] = storage.paths(`x402/events/${id}/`).map((path) => storage.json(path));
  assert.deepEqual([event.kind, event.transaction], ["credit-pending", body.transaction]);
  assert.match(event.reason, /settlement could not be recorded/);
});

test("a recorded payment presented after its validity window gets its stored outcome; a new one a fresh offer", async () => {
  const { deps, storage, ledger, payments } = setup(5);
  const window = "The authorization's validity window does not match this offer.";
  const credited = await handleFunding(fundingRequest(REF, base()), REF, deps);
  assert.equal(credited.status, 200);
  payments.setSettlement({ kind: "pending", transaction: null, reason: "settlement_pending" });
  const unresolved = base(`0x${"3".repeat(64)}`), fresh = base(`0x${"4".repeat(64)}`);
  assert.equal((await handleFunding(fundingRequest(REF, unresolved), REF, deps)).status, 202);
  const before = payments.calls.length;

  payments.setStale(window);
  // Credited: the receipt answers and nothing settles again.
  const replayed = await handleFunding(fundingRequest(REF, base()), REF, deps);
  assert.equal(replayed.status, 200);
  assert.equal((await replayed.json()).replayed, true);
  assert.equal(replayed.headers.get("PAYMENT-RESPONSE"), credited.headers.get("PAYMENT-RESPONSE"));
  // Recorded without a receipt: it may have settled before the window closed, so it is never re-offered.
  const pending = await handleFunding(fundingRequest(REF, unresolved), REF, deps);
  assert.equal(pending.status, 202);
  assert.equal(pending.headers.get("PAYMENT-REQUIRED"), null);
  assert.match((await pending.json()).message, /may have settled.*do not sign a new payment/);
  // Never presented: refused with a fresh offer, before any record.
  const refused = await handleFunding(fundingRequest(REF, fresh), REF, deps);
  assert.equal(refused.status, 402);
  assert(refused.headers.get("PAYMENT-REQUIRED"));
  assert.equal((await refused.json()).error, window);
  assert.equal(storage.json(recordPaths(keyOf(fresh), "lighthouse").intent), null);

  assert.deepEqual(payments.calls.slice(before), ["present", "present", "present", `offer:${window}`]);
  assert.equal(ledger.refills.size, 1);
});

test("the same signed payment again returns the stored result without settling twice", async () => {
  const { deps, ledger, payments } = setup();
  const first = await handleFunding(fundingRequest(REF, solana()), REF, deps);
  assert.equal(first.status, 200);
  const again = await handleFunding(fundingRequest(REF, solana()), REF, deps);
  assert.equal(again.status, 200);
  const body = await again.json();
  assert.equal(body.replayed, true);
  assert.equal(again.headers.get("PAYMENT-RESPONSE"), first.headers.get("PAYMENT-RESPONSE"));
  assert.equal(payments.calls.filter((call) => call === "settle").length, 1);
  assert.equal(ledger.refills.size, 1);
});

test("a pending payment presented again settles the same intent and credits once", async () => {
  const { deps, ledger, payments } = setup(1);
  payments.setSettlement({ kind: "pending", transaction: null, reason: "FacilitatorTimeoutError" });
  assert.equal((await handleFunding(fundingRequest(REF, solana()), REF, deps)).status, 202);
  payments.setSettlement({ kind: "settled", transaction: "landedSig", response: {}, header: "settled:landed" });
  // The pending intent holds the room's only slot, but it is this payment's own slot.
  const retried = await handleFunding(fundingRequest(REF, solana()), REF, deps);
  assert.equal(retried.status, 200);
  assert.deepEqual([...ledger.refills.keys()], [refillRequestId(SOLANA_DEVNET, "landedSig")]);
});

test("a recorded payment that stops verifying is left to reconciliation unless the chain showed it expired", async () => {
  const { deps, storage, payments } = setup();
  payments.setSettlement({ kind: "pending", transaction: "broadcastSig", reason: "settlement_pending" });
  assert.equal((await handleFunding(fundingRequest(REF, solana()), REF, deps)).status, 202);
  // The broadcast landed, so the same payload now fails verification; inviting a new payment would charge twice.
  payments.setVerification({ valid: false, reason: "invalid_exact_svm_transaction_simulation_failed" });
  const again = await handleFunding(fundingRequest(REF, solana()), REF, deps);
  assert.equal(again.status, 202);
  assert.equal(again.headers.get("PAYMENT-REQUIRED"), null);
  assert.match((await again.json()).message, /do not sign a new payment/);
  // Once the reconciler records that it can no longer settle, the payer is told nothing was charged.
  await storage.store.create(recordPaths(keyOf(solana()), "lighthouse").expired, Buffer.from("{}"));
  const expired = await handleFunding(fundingRequest(REF, solana()), REF, deps);
  assert.equal(expired.status, 402);
  assert.match((await expired.json()).error, /expired before it settled/);
  assert.equal(payments.calls.filter((call) => call === "settle").length, 1);
});

test("one payment authorization funds at most one room, and one offer at most one payment", async () => {
  const { deps, payments } = setup();
  assert.equal((await handleFunding(fundingRequest(REF, base()), REF, deps)).status, 200);
  const elsewhere = await handleFunding(fundingRequest(OTHER_REF, base()), OTHER_REF, deps);
  assert.equal(elsewhere.status, 409);
  assert.match((await elsewhere.json()).error, /another room/);
  // A re-signed transaction carrying an already used memo is a different payment for the same offer.
  payments.setSettlement({ kind: "pending", transaction: null, reason: "settlement_pending" });
  assert.equal((await handleFunding(fundingRequest(REF, solana()), REF, deps)).status, 202);
  const resigned = await handleFunding(fundingRequest(REF, { ...solana(), tag: "re-signed" }), REF, deps);
  assert.equal(resigned.status, 409);
  assert.match((await resigned.json()).error, /different payment/);
  assert.equal(payments.calls.filter((call) => call === "settle").length, 2);
});

test("the steward's ceiling is enforced before settlement; only chain-confirmed expiry frees a slot", async () => {
  const { deps, payments } = setup(1);
  assert.equal((await handleFunding(fundingRequest(REF, solana()), REF, deps)).status, 200);
  const offer = await handleFunding(fundingRequest(), REF, deps);
  assert.equal(offer.status, 409);
  assert.match((await offer.json()).error, /top-up limit/);
  const second = await handleFunding(fundingRequest(REF, solana("e".repeat(32))), REF, deps);
  assert.equal(second.status, 409);
  assert.equal(payments.calls.filter((call) => call === "settle").length, 1);

  // A pending payment that the reconciler showed can no longer settle stops counting.
  const { deps: d2, storage: s2, payments: p2 } = setup(1);
  p2.setSettlement({ kind: "pending", transaction: null, reason: "settlement_pending" });
  assert.equal((await handleFunding(fundingRequest(REF, solana()), REF, d2)).status, 202);
  assert.equal((await handleFunding(fundingRequest(), REF, d2)).status, 409);
  const expired = recordPaths(keyOf(solana()), "lighthouse");
  await s2.store.create(expired.expired, Buffer.from("{}"));
  assert.equal((await handleFunding(fundingRequest(), REF, d2)).status, 402);
  // The expiry frees the slot without erasing evidence: the intent and its index entry stay, and nothing settled again.
  assert.equal(s2.json(expired.intent).intentId, keyOf(solana()));
  assert.deepEqual(s2.paths("x402/rooms/lighthouse/"), [expired.roomIndex]);
  assert.deepEqual(p2.calls, ["present", "verify", "settle", "offer"]);
});

test("concurrent payments for one room cannot exceed the ceiling", async () => {
  const { deps, payments } = setup(1);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const settle = payments.port.settle;
  payments.port.settle = async (payment) => { await gate; return settle(payment); };
  const first = handleFunding(fundingRequest(REF, solana("1".repeat(32))), REF, deps);
  const second = handleFunding(fundingRequest(REF, solana("2".repeat(32))), REF, deps);
  await new Promise((resolve) => setTimeout(resolve, 10));
  release();
  const statuses = (await Promise.all([first, second])).map((response) => response.status).sort();
  assert.deepEqual(statuses, [200, 409]);
  assert.equal(payments.calls.filter((call) => call === "settle").length, 1);
});

test("unknown references, other methods and oversized requests are refused", async () => {
  const { deps, payments } = setup();
  assert.equal((await handleFunding(fundingRequest("ref_unknown_ccccccccccccccc"), "ref_unknown_ccccccccccccccc", deps)).status, 404);
  assert.equal((await handleFunding(fundingRequest("toString"), "toString", deps)).status, 404);
  assert.equal((await handleFunding(fundingRequest(REF, undefined, { method: "GET" }), REF, deps)).status, 405);
  assert.equal((await handleFunding(fundingRequest(REF, solana(), { headers: { "content-length": "4096" } }), REF, deps)).status, 413);
  assert.deepEqual(payments.calls, []);
});
