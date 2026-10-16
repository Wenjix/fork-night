import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson } from "../../src/experiments/storage.ts";
import { ensureWrenCredits, validWrenFundingPolicy, WREN_FUNDING, type WrenCreditsInput, type WrenFundingDeps, type WrenFundingPolicy, type WrenPaymentRow } from "../../src/generation/wren-funding.ts";
import { createChargePort } from "../../src/mpp/charge.ts";
import { handleMppFunding } from "../../src/mpp/funding.ts";
import { mppRecordPaths } from "../../src/mpp/ids.ts";
import type { MppReceipt } from "../../src/mpp/records.ts";
import { readRecord } from "../../src/x402/store.ts";
import { blockNetwork, CHALLENGE_KEY, fakeAdapter, fakeChain, fakeModerato } from "./mpp-fakes.ts";
import { memoryLedger, memoryStore } from "./x402-fakes.ts";

blockNetwork();
const when = Date.parse("2026-10-15T16:00:00Z");
const input: WrenCreditsInput = {
  requestId: "95000000-0000-4000-8000-000000000001", actorId: "95000000-0000-4000-8000-000000000002",
  claimToken: "95000000-0000-4000-8000-000000000003", roomId: "kessler-ward", requiredCredits: 1,
};
const policy = (): WrenFundingPolicy => ({
  enabled: true, room_id: WREN_FUNDING.roomId, network: WREN_FUNDING.network,
  steward: WREN_FUNDING.steward, pay_to: WREN_FUNDING.payTo, currency: WREN_FUNDING.currency,
  access_key: "0x814d643005ace60552737db7e6bd83d458bcab8d", authorized_at: "2026-10-15T15:00:00Z",
  expires_at: "2026-10-16T15:00:00Z", authorization_tx: `0x${"a".repeat(64)}`,
  allowance_atomic: 2000000, period_seconds: 86400, topups_per_day: 1,
});

function harness() {
  const rows = new Map<string, WrenPaymentRow>();
  const store = memoryStore(), ledger = memoryLedger();
  ledger.rooms["kessler-ward"] = { open: true, deliveryLimit: 0, stewardExists: true };
  const { adapter } = fakeAdapter({ now: () => when });
  const chain = fakeChain();
  const moderato = fakeModerato(adapter, { clock: () => when });
  const charges = createChargePort({ network: WREN_FUNDING.network, recipient: WREN_FUNDING.payTo, currency: WREN_FUNDING.currency,
    rooms: { "kessler-ward": { maxTopUps: 1 } } }, { adapter, challengeKey: CHALLENGE_KEY, rpc: moderato.request, now: () => when });
  const room = (maker: string) => ({ roomId: input.roomId, stewardProfileId: maker, maxTopUps: 1 });
  const cfg = policy();
  const calls: string[] = [];
  let budget = true, lostSaveAck = false;
  const seller = (i: WrenCreditsInput, credential?: string) => handleMppFunding(new Request("https://internal.invalid/fund", {
    method: "POST", ...(credential ? { headers: { authorization: credential } } : {}),
  }), "internal-wren", { rooms: { "internal-wren": room(i.actorId) }, charges, chain: chain.reader, store: store.store, ledger: ledger.ledger, now: () => new Date(when) });
  const deps: WrenFundingDeps = {
    now: () => when,
    async preflight(i) {
      return { roomId: i.roomId, actorId: i.actorId, policy: cfg, budgetReady: budget,
        creditsReady: (ledger.rooms["kessler-ward"].deliveryLimit ?? 0) > 0 };
    },
    async claim(i) {
      const row = rows.get(i.requestId);
      if (row) return { state: "existing", payment: row };
      if (!budget) return { state: "blocked" };
      if ((ledger.rooms["kessler-ward"].deliveryLimit ?? 0) > 0) return { state: "ready" };
      // Synchronous admission models the SQL transaction's advisory lock. The
      // separate PostgreSQL proof exercises actual overlapping connections.
      if ([...rows.values()].some((row) => ["claimed", "signed", "pending"].includes(row.state))) return { state: "pending" };
      const created: WrenPaymentRow = { id: i.requestId, request_id: i.requestId, room_id: i.roomId, actor_id: i.actorId,
        state: "claimed", payment: null, receipt_id: null, message: null };
      rows.set(i.requestId, created);
      return { state: "claimed", payment: created };
    },
    async save(i, state, payment, receiptId, message) {
      calls.push(`save:${state}`);
      const row = rows.get(i.requestId)!;
      if (row.payment && payment) assert.equal(canonicalJson(row.payment), canonicalJson(payment));
      row.state = state;
      row.payment ??= payment;
      row.receipt_id ??= receiptId ?? null;
      row.message = message ?? null;
      if (lostSaveAck && state === "signed") { lostSaveAck = false; throw new Error("lost database acknowledgement"); }
      return structuredClone(row);
    },
    async offer(i) {
      calls.push("offer");
      const response = await seller(i);
      assert.equal(response.status, 402);
      return adapter.parseChallengeHeader(response.headers.get("WWW-Authenticate")!);
    },
    async sign(challenge) {
      calls.push("sign");
      return (await adapter.createPayment({ account: { address: WREN_FUNDING.steward }, challenge,
        expectedRecipient: WREN_FUNDING.payTo })).credential;
    },
    async inspectSigned(i, credential) {
      const result = await charges.present(credential, room(i.actorId));
      if ("invalid" in result) throw new Error(result.invalid);
      return result;
    },
    async pay(i, payment) { calls.push("pay"); await seller(i, payment.credential); },
    receipt: (payment) => readRecord<MppReceipt>(store.store, mppRecordPaths(payment.intentId, payment.roomId).receipt),
  };
  return { deps, cfg, rows, store, ledger, chain, moderato, calls,
    budget(value: boolean) { budget = value; }, loseSaveAck() { lostSaveAck = true; } };
}

test("existing room credits require no purchase, signer, funding config or receipt", async () => {
  const h = harness(); h.ledger.rooms["kessler-ward"].deliveryLimit = 3; h.cfg.enabled = false;
  assert.deepEqual(await ensureWrenCredits(input, h.deps), { state: "ready" });
  assert.equal(h.calls.length, 0); assert.equal(h.rows.size, 0);
});

test("Wren refuses other rooms, actor mismatches and requests outside the existing inference allowance", async () => {
  const h = harness();
  assert.equal((await ensureWrenCredits({ ...input, roomId: "night-shift" }, h.deps)).state, "blocked");
  h.deps.preflight = async () => ({ roomId: input.roomId, actorId: "another-maker", policy: h.cfg, creditsReady: false, budgetReady: true });
  assert.equal((await ensureWrenCredits(input, h.deps)).state, "blocked");
  const exhausted = harness(); exhausted.budget(false);
  assert.equal((await ensureWrenCredits(input, exhausted.deps)).state, "blocked");
  assert(!exhausted.calls.includes("sign")); assert.equal(exhausted.ledger.refills.size, 0);
});

test("allowance validation pins recipient, payer, network, token, amount, duration and unchanged daily cap", () => {
  assert(validWrenFundingPolicy(policy(), when));
  for (const change of [{ enabled: false }, { room_id: "paper-moon" }, { network: "eip155:1" }, { steward: `0x${"1".repeat(40)}` },
    { pay_to: `0x${"2".repeat(40)}` }, { currency: `0x${"3".repeat(40)}` }, { expires_at: "2026-10-13T00:00:00Z" },
    { expires_at: "2026-10-17T15:00:00Z" }, { allowance_atomic: 3000000 }, { period_seconds: 1 }, { topups_per_day: 2 }])
    assert.equal(validWrenFundingPolicy({ ...policy(), ...change }, when), false, JSON.stringify(change));
});

test("expired allowance never signs, grants credits or expands the inference budget", async () => {
  const h = harness(); h.cfg.expires_at = "2026-10-13T00:00:00Z";
  assert.equal((await ensureWrenCredits(input, h.deps)).state, "blocked");
  assert(!h.calls.includes("sign")); assert(!h.calls.includes("pay")); assert.equal(h.ledger.refills.size, 0);
});

test("ordinary generation eligibility lost after preflight blocks purchase at atomic admission", async () => {
  for (const reason of ["maker attempts exhausted", "another generation consumed the last image slot"]) {
    const h = harness(); const original = h.deps.claim;
    h.deps.claim = async (i) => { h.budget(false); return original(i); };
    assert.equal((await ensureWrenCredits(input, h.deps)).state, "blocked", reason);
    assert.equal(h.rows.size, 0, reason); assert(!h.calls.includes("sign"), reason);
    assert.equal(h.moderato.sentRaw.length, 0, reason);
  }
});

test("one real seller path records exact payment before broadcast and credits only with its persisted MPP receipt", async () => {
  const h = harness();
  const result = await ensureWrenCredits(input, h.deps);
  assert.equal(result.state, "ready"); assert.match(result.receiptId!, /^mpp\/receipts\/[0-9a-f]{64}\.json$/);
  assert(h.calls.indexOf("save:signed") < h.calls.indexOf("pay"));
  assert.equal(h.moderato.sentRaw.length, 1); assert.equal(h.ledger.refills.size, 1);
  assert.equal([...h.ledger.refills.values()][0].actor, input.actorId);
  const receipt = h.store.json(result.receiptId!);
  assert.equal(receipt.payer.toLowerCase(), WREN_FUNDING.steward.toLowerCase());
  assert.equal(receipt.refill.added, 5); assert.equal(h.rows.get(input.requestId)?.state, "credited");
  assert.equal((await ensureWrenCredits(input, h.deps)).state, "ready");
  assert.equal(h.calls.filter((call) => call === "sign").length, 1); assert.equal(h.moderato.sentRaw.length, 1);
});

test("competing requests share one durable payment admission and never buy two top-ups", async () => {
  const h = harness();
  const results = await Promise.all([ensureWrenCredits(input, h.deps), ensureWrenCredits({ ...input,
    requestId: "95000000-0000-4000-8000-000000000004", actorId: "95000000-0000-4000-8000-000000000005" }, h.deps)]);
  assert(results.some((result) => result.state === "ready")); assert(results.some((result) => result.state === "pending"));
  assert.equal(h.calls.filter((call) => call === "sign").length, 1); assert.equal(h.ledger.refills.size, 1);
});

test("a lost signed-record acknowledgement resumes its saved credential without signing again", async () => {
  const h = harness(); h.loseSaveAck();
  assert.equal((await ensureWrenCredits(input, h.deps)).state, "pending");
  assert.equal(h.moderato.sentRaw.length, 0); assert(h.rows.get(input.requestId)?.payment);
  assert.equal((await ensureWrenCredits(input, h.deps)).state, "ready");
  assert.equal(h.calls.filter((call) => call === "sign").length, 1); assert.equal(h.moderato.sentRaw.length, 1);
});

test("unknown broadcast blocks replacements; an expired allowance still resolves the same confirmed payment", async () => {
  const h = harness(); h.moderato.setBroadcast("land-then-timeout");
  assert.equal((await ensureWrenCredits(input, h.deps)).state, "pending");
  const payment = h.rows.get(input.requestId)!.payment!;
  h.cfg.expires_at = "2026-10-13T00:00:00Z";
  h.chain.set({ status: "paid", transaction: payment.transaction, evidence: { source: "offline-chain" } });
  assert.equal((await ensureWrenCredits({ ...input, claimToken: "95000000-0000-4000-8000-000000000009" }, h.deps)).state, "ready");
  assert.equal(h.calls.filter((call) => call === "sign").length, 1); assert.equal(h.moderato.sentRaw.length, 1);
  assert.equal(h.ledger.refills.size, 1);
});

test("a lost final receipt write retries one idempotent refill and never sends another transfer", async () => {
  const h = harness(); h.store.failCreate.push(/^mpp\/receipts\//);
  assert.equal((await ensureWrenCredits(input, h.deps)).state, "pending");
  const payment = h.rows.get(input.requestId)!.payment!;
  h.store.failCreate.length = 0;
  h.chain.set({ status: "paid", transaction: payment.transaction, evidence: {} });
  assert.equal((await ensureWrenCredits(input, h.deps)).state, "ready");
  assert.equal(h.ledger.refills.size, 1); assert.equal(h.moderato.sentRaw.length, 1);
});

test("a mismatched receipt never authorizes generation or another purchase", async () => {
  const h = harness(); h.deps.receipt = async () => ({ kind: "fork-night/mpp-receipt/v1", intentId: "wrong" }) as MppReceipt;
  assert.equal((await ensureWrenCredits(input, h.deps)).state, "pending");
  assert.equal(h.calls.filter((call) => call === "sign").length, 1);
  assert.equal((await ensureWrenCredits(input, h.deps)).state, "pending");
  assert.equal(h.calls.filter((call) => call === "sign").length, 1);
});
