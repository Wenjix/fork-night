import { test } from "node:test";
import assert from "node:assert/strict";
import type { MppAdapter, MppChallenge, MppCredential } from "../../src/mpp/adapter.ts";
import { moderatoReader } from "../../src/mpp/chain.ts";
import { createChargePort, roomTagFor } from "../../src/mpp/charge.ts";
import { handleMppFunding, type PresentedCharge } from "../../src/mpp/funding.ts";
import { MODERATO_TEST_TOKENS, MPP_REALM, PATHUSD, mppIntentId, mppRecordPaths, mppRefillRequestId } from "../../src/mpp/ids.ts";
import { uuidv5 } from "../../src/x402/ids.ts";
import {
  blockNetwork, CHALLENGE_KEY, PAY_TO, REF, customCredential, doorConfig, doorRooms, fakeAdapter, fakeKeccak, fakeModerato, fakeSigned,
  mppRequest, transferWithMemoData,
} from "./mpp-fakes.ts";
import { memoryLedger, memoryStore } from "./x402-fakes.ts";

blockNetwork();

// The ChargePort's own rules over a scripted stand-in for the isolated adapter. tests/app/mpp-adapter.test.ts
// runs the same flows on the real adapter (mppx 0.13.4, viem 2.57.3) when it is installed.
const room = doorRooms()[REF];
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

function setup(options: { now?: () => number } = {}) {
  const fake = fakeAdapter(options);
  const chain = fakeModerato(fake.adapter);
  const port = createChargePort(doorConfig(), { challengeKey: CHALLENGE_KEY, adapter: fake.adapter, rpc: chain.request, ...options });
  const account = fake.adapter.accountFromKey(`0x${"11".repeat(32)}`);
  const sign = (challenge: MppChallenge) =>
    fake.adapter.createPayment({ account, challenge, expectedRecipient: PAY_TO, request: chain.request }).then((paid) => paid.credential);
  const offered = async (forRoom = room) => fake.adapter.parseChallengeHeader((await port.offer(forRoom)).header);
  return { fake, chain, port, account, sign, offered };
}
const presented = async (port: ReturnType<typeof setup>["port"], credential: string) => {
  const charge = await port.present(credential, room);
  assert(!("invalid" in charge), JSON.stringify(charge));
  return charge as PresentedCharge;
};
/** A challenge with this door's key and realm but other terms, as a misconfigured or hostile server would issue. */
async function forged(adapter: MppAdapter, options: { currency?: string; amount?: string; chainId?: number; key?: string }) {
  const server = adapter.createChargeServer({
    secretKey: options.key ?? CHALLENGE_KEY, realm: MPP_REALM, currency: options.currency ?? PATHUSD, recipient: PAY_TO, chainId: options.chainId ?? 42431,
  });
  return adapter.parseChallengeHeader((await server.challenge({ amount: options.amount ?? "1", meta: { r: roomTagFor(CHALLENGE_KEY, "lighthouse") } })).header);
}

test("the offer is one pull-mode test-dollar charge on Moderato, bound to its room by an HMAC tag, with no network call", async () => {
  const { chain, port, fake } = setup();
  const { header, body } = await port.offer(room, "earlier problem");
  const challenge = fake.adapter.parseChallengeHeader(header);
  assert.deepEqual([challenge.method, challenge.intent, challenge.realm], ["tempo", "charge", MPP_REALM]);
  assert.deepEqual(challenge.request, { amount: "1000000", currency: PATHUSD, methodDetails: { chainId: 42431, supportedModes: ["pull"] }, recipient: PAY_TO });
  const opaque = JSON.parse(Buffer.from(String(challenge.opaque), "base64url").toString());
  assert.equal(opaque.r, roomTagFor(CHALLENGE_KEY, "lighthouse"));
  assert.notEqual(opaque.r, roomTagFor(CHALLENGE_KEY, "paper-moon"));
  for (const secret of ["lighthouse", REF, "paper-moon"]) assert(!header.includes(secret) && !JSON.stringify(challenge).includes(secret));
  assert.equal((body as { error?: string }).error, "earlier problem");
  assert.equal((body as { challengeId?: string }).challengeId, challenge.id);
  assert.deepEqual(chain.calls, []);
});

test("a signed credential presents offline with its sender, deadline and the hash the chain will show", async () => {
  const { chain, port, sign, offered, account, fake } = setup();
  const challenge = await offered();
  const credential = await sign(challenge);
  chain.calls.length = 0;
  const charge = await presented(port, credential);
  assert.deepEqual(chain.calls, [], "present makes no network call");
  const signature = (fake.adapter.readCredential(credential)!.payload as { signature: string }).signature;
  assert.equal(charge.challengeId, challenge.id);
  assert.equal(charge.payer, account.address.toLowerCase());
  assert.equal(charge.transaction, (await fake.adapter.decodeTransaction(signature)).hash);
  assert.deepEqual([charge.payTo, charge.currency, charge.amount], [PAY_TO, PATHUSD, "1000000"]);
  const seconds = Math.floor(Date.now() / 1000);
  assert(charge.validBefore > seconds && charge.validBefore <= seconds + 26);
  assert.equal(charge.stale, undefined);
  assert.equal((await presented(port, credential)).payloadDigest, charge.payloadDigest);
  const resigned = await presented(port, await sign(challenge));
  assert.equal(resigned.challengeId, charge.challengeId);
  assert.notEqual(resigned.payloadDigest, charge.payloadDigest);
});

test("credentials for another server, room, network, token, amount or mode, or a malformed transaction, are refused", async () => {
  const { port, sign, offered, fake, account } = setup();
  const invalid = async (credential: string, forRoom = room) => {
    const result = await port.present(credential, forRoom);
    assert("invalid" in result, `expected a refusal, got ${JSON.stringify(result).slice(0, 120)}`);
    return (result as { invalid: string }).invalid;
  };
  const credential = await sign(await offered());
  const parsed = fake.adapter.readCredential(credential)!;
  const reissue = (changes: Partial<MppCredential>) => `Payment ${encode({ ...parsed, ...changes })}`;
  const withTx = (tx: Record<string, unknown>) => reissue({ payload: { type: "transaction", signature: fakeSigned({
    type: "tempo", from: account.address.toLowerCase(), chainId: 42431, validBefore: Math.floor(Date.now() / 1000) + 20, calls: [], nonce: "1", ...tx,
  } as never) } });

  assert.match(await invalid("Bearer abc"), /Only Payment credentials/);
  assert.match(await invalid("Payment !!!"), /could not be decoded/);
  assert.match(await invalid(credential, doorRooms()["ref_paper_moon_bbbbbbbbbbbbbb"]), /different funding link/);
  assert.match(await invalid(await sign(await forged(fake.adapter, { key: Buffer.alloc(32, 1).toString("base64url") }))), /did not make/);
  assert.match(await invalid(await sign(await forged(fake.adapter, { currency: MODERATO_TEST_TOKENS.alphaUSD }))), /token is not offered/);
  assert.match(await invalid(await sign(await forged(fake.adapter, { amount: "2" }))), /amount does not match/);
  assert.match(await invalid(reissue({ challenge: await forged(fake.adapter, { chainId: 4217 }) })), /network is not offered/);
  assert.match(await invalid(reissue({ payload: { type: "hash", hash: `0x${"ab".repeat(32)}` } })), /hash \(push\) credentials/);
  assert.match(await invalid(reissue({ payload: { type: "proof", signature: "0x00" } })), /signed Tempo transaction/);
  assert.match(await invalid(reissue({ source: `did:pkh:eip155:42431:${PAY_TO}` })), /source does not match/);
  assert.match(await invalid(reissue({ challenge: { ...parsed.challenge, request: { ...parsed.challenge.request, amount: "1" } } })), /did not make/);
  assert.match(await invalid(reissue({ payload: { type: "transaction", signature: "0x1234" } })), /could not be decoded/);
  assert.match(await invalid(withTx({ sponsored: true })), /unsponsored Tempo transaction/);
  assert.match(await invalid(withTx({ type: "eip1559" })), /unsponsored Tempo transaction/);
  assert.match(await invalid(withTx({ chainId: 4217 })), /not for Tempo Moderato/);
  assert.match(await invalid(withTx({ validBefore: null })), /no expiry/);
  assert.match(await invalid(withTx({ from: "nobody" })), /no recoverable sender/);
});

test("an expired offer or a far-off deadline is reported as stale, so only a recorded payment gets past it", async () => {
  const { port, sign, fake } = setup();
  // Issued by this door's key 400 s ago: its five-minute expiry has passed.
  const earlier = setup({ now: () => Date.now() - 400_000 });
  const stale = await presented(port, await earlier.sign(await earlier.offered()));
  assert.match(String(stale.stale), /offer expired/);
  const later = createChargePort(doorConfig(), { challengeKey: CHALLENGE_KEY, adapter: fake.adapter, now: () => Date.now() - 120_000 });
  const early = await later.present(await sign(await forged(fake.adapter, {})), room);
  assert.match(String((early as PresentedCharge).stale), /validity window/);
});

test("verify is validateCredential: valid, a payment error, revert or expiry refuses, anything else throws; nothing is sent", async () => {
  const { chain, port, sign, offered, fake } = setup();
  const charge = await presented(port, await sign(await offered()));
  assert.deepEqual(await port.verify(charge), { valid: true });
  chain.setSimulation(new Error("Execution reverted with reason: TIP20 token error: InsufficientBalance."));
  assert.deepEqual(await port.verify(charge), { valid: false, reason: "Execution reverted with reason: TIP20 token error: InsufficientBalance." });
  chain.setSimulation(new TypeError("fetch failed"));
  await assert.rejects(port.verify(charge), /Could not validate the payment: fetch failed/);
  chain.setSimulation(null);
  for (const kind of ["payment", "expired"] as const) {
    fake.script.validate = { ok: false, error: { kind, name: "PaymentError", message: `${kind} refused` } };
    assert.deepEqual(await port.verify(charge), { valid: false, reason: `${kind} refused` });
  }
  fake.script.validate = null;
  assert.deepEqual(chain.sentRaw, []);
});

test("settle broadcasts once; after the send any failure is pending, before it only an expired offer fails", async () => {
  const { chain, port, sign, offered, fake } = setup();
  const charge = await presented(port, await sign(await offered()));
  const settled = await port.settle(charge);
  assert.equal(settled.kind, "settled");
  assert.equal((settled as { transaction: string }).transaction, charge.transaction);
  assert.equal(fake.adapter.readReceiptHeader((settled as { receiptHeader: string }).receiptHeader)?.reference, charge.transaction);
  assert.equal(chain.sentRaw.length, 1);
  // The same bytes again: the replay marker refuses before sending. It may have landed, so it is not "failed".
  assert.deepEqual(await port.settle(charge), { kind: "pending", transaction: null, reason: "Payment verification failed: Transaction hash has already been used." });
  assert.equal(chain.sentRaw.length, 1);

  for (const mode of ["land-then-timeout", "reject", "revert"] as const) {
    chain.setBroadcast(mode);
    const next = await presented(port, await sign(await offered()));
    const result = await port.settle(next);
    assert.equal(result.kind, "pending", mode);
    assert.equal((result as { transaction: string | null }).transaction, next.transaction, mode);
  }
  chain.setBroadcast("land");
  const sent = chain.sentRaw.length;
  fake.script.beforeSend = { kind: "expired", name: "PaymentExpiredError", message: "Payment expired." };
  // Failed only once the signed deadline has also passed (see the review-fix test below for the window before it).
  const lapsed = await presented(port, await sign(await offered()));
  assert.deepEqual(await port.settle({ ...lapsed, validBefore: Math.floor(Date.now() / 1000) - 10 }), { kind: "failed", reason: "Payment expired." });
  fake.script.beforeSend = { kind: "other", name: "Error", message: "No client configured" };
  assert.deepEqual(await port.settle(await presented(port, await sign(await offered()))), { kind: "pending", transaction: null, reason: "No client configured" });
  assert.equal(chain.sentRaw.length, sent);
});

test("the door on the adapter credits once offline, refuses a second transfer for one challenge, and resumes a timeout from the chain", async () => {
  const { chain, port, sign, fake } = setup();
  const storage = memoryStore(), ledger = memoryLedger();
  const deps = {
    rooms: doorRooms(5), charges: port, chain: moderatoReader({ rpc: chain.rpc, keccak: fakeKeccak, sleep: async () => {}, spacingMs: 0 }),
    store: storage.store, ledger: ledger.ledger,
  };
  const challengeOf = (response: Response) => fake.adapter.parseChallengeHeader(response.headers.get("WWW-Authenticate") ?? "");
  const post = (authorization?: string) => handleMppFunding(mppRequest(REF, undefined, authorization ? { headers: { authorization } } : {}), REF, deps);
  const challenge = challengeOf(await post());
  const credential = await sign(challenge);
  const paid = await post(credential);
  assert.equal(paid.status, 200);
  const hash = (await presented(port, credential)).transaction;
  assert.equal((await paid.json()).transaction, hash);
  assert.equal(fake.adapter.readReceiptHeader(paid.headers.get("Payment-Receipt"))?.reference, hash);
  assert.deepEqual([...ledger.refills.keys()], [uuidv5(`eip155:42431:${hash}`)]);
  assert.equal(mppRefillRequestId(hash.toUpperCase().replace(/^0X/, "0x")), uuidv5(`eip155:42431:${hash}`));
  assert.equal(chain.sentRaw.length, 1);

  // Hazard A: a second signed transfer for the same challenge is refused unsent.
  assert.equal((await post(await sign(challenge))).status, 409);
  assert.equal(chain.sentRaw.length, 1);
  // Hazard B: the same credential again is answered from the receipt, never a 402 that invites a new payment.
  const replay = await post(credential);
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).replayed, true);

  // Hazard C: the RPC times out after the transfer landed. 202, then the resume credits once from the chain.
  chain.setBroadcast("land-then-timeout");
  const late = await sign(challengeOf(await post()));
  const timedOut = await post(late);
  assert.equal(timedOut.status, 202);
  assert.equal(timedOut.headers.get("WWW-Authenticate"), null);
  chain.setBroadcast("land");
  const resumed = await post(late);
  assert.equal(resumed.status, 200);
  assert.equal(chain.sentRaw.length, 2, "the resume read the chain and sent nothing");
  assert.equal(ledger.refills.size, 2);
  const lateId = mppIntentId(fake.adapter.readCredential(late)!.challenge.id);
  assert.equal(storage.json(mppRecordPaths(lateId, "lighthouse").settlement).via, "chain");
});

// Review fixes (12 October). Each of these failed on the reviewed sources.

test("a recorded payment re-sent after a token, recipient or key change is answered from its records or the chain, never re-offered", async () => {
  const { chain, port, sign, fake } = setup();
  const storage = memoryStore(), ledger = memoryLedger();
  const reader = moderatoReader({ rpc: chain.rpc, keccak: fakeKeccak, sleep: async () => {}, spacingMs: 0 });
  const depsFor = (charges: typeof port) => ({ rooms: doorRooms(5), charges, chain: reader, store: storage.store, ledger: ledger.ledger });
  const post = (charges: typeof port, authorization?: string) =>
    handleMppFunding(mppRequest(REF, undefined, authorization ? { headers: { authorization } } : {}), REF, depsFor(charges));
  const challenge = fake.adapter.parseChallengeHeader((await post(port)).headers.get("WWW-Authenticate") ?? "");
  const credential = await sign(challenge);
  chain.setBroadcast("land-then-timeout");
  assert.equal((await post(port, credential)).status, 202, "the transfer landed but its answer was lost");
  chain.setBroadcast("land");
  const portWith = (config = doorConfig(), challengeKey = CHALLENGE_KEY) => createChargePort(config, { challengeKey, adapter: fake.adapter, rpc: chain.request });
  const changed = [
    ["token edited", portWith({ ...doorConfig(), currency: MODERATO_TEST_TOKENS.alphaUSD })],
    ["recipient edited", portWith({ ...doorConfig(), recipient: `0x${"00".repeat(19)}aa` })],
    ["challenge key rotated", portWith(doorConfig(), Buffer.alloc(32, 7).toString("base64url"))],
  ] as const;
  const statuses: number[] = [];
  for (const [label, charges] of changed) {
    const resent = await post(charges, credential);
    assert.equal(resent.headers.get("WWW-Authenticate"), null, `${label}: never a fresh offer for a payment that landed`);
    statuses.push(resent.status);
  }
  assert.deepEqual(statuses, [200, 200, 200]);
  assert.equal(ledger.refills.size, 1);
  assert.equal(chain.sentRaw.length, 1, "nothing was broadcast again");
  // Another signature for that challenge under the changed key is still refused unsent.
  assert.equal((await post(changed[2][1], await sign(challenge))).status, 409);
  assert.equal(chain.sentRaw.length, 1);
});

test("a signed payment that outlives its offer is refused before any record; one whose offer expired before the send fails only once it cannot land", async () => {
  const { chain, port, fake, account, offered } = setup();
  const now = Math.floor(Date.now() / 1000);
  const server = fake.adapter.createChargeServer({ secretKey: CHALLENGE_KEY, realm: MPP_REALM, currency: PATHUSD, recipient: PAY_TO, chainId: 42431 });
  const shortLived = fake.adapter.parseChallengeHeader((await server.challenge({
    amount: "1", meta: { r: roomTagFor(CHALLENGE_KEY, "lighthouse") }, expires: new Date(Date.now() + 2_000).toISOString(),
  })).header);
  // A non-stock payer signs a deadline 50 s out for an offer that ends in 2 s.
  const call = { to: PATHUSD, data: transferWithMemoData(PAY_TO, 1_000_000n, fake.memoFor(MPP_REALM, shortLived.id)) };
  const outliving = customCredential(shortLived, account.address, [call], now + 50);
  const refused = await port.present(outliving.credential, room);
  assert.match((refused as { invalid?: string }).invalid ?? "", /outlives this offer/);
  const storage = memoryStore(), ledger = memoryLedger();
  const deps = { rooms: doorRooms(5), charges: port, chain: moderatoReader({ rpc: chain.rpc, keccak: fakeKeccak, sleep: async () => {} }), store: storage.store, ledger: ledger.ledger };
  const response = await handleMppFunding(mppRequest(REF, undefined, { headers: { authorization: outliving.credential } }), REF, deps);
  assert.equal(response.status, 402);
  assert.equal(storage.objects.size, 0, "nothing is recorded for it");
  assert.deepEqual(chain.sentRaw, []);

  // The adapter says the offer expired before the send: failed only once the signed deadline has passed.
  const charge = await presented(port, await fake.adapter.createPayment({ account, challenge: await offered(), expectedRecipient: PAY_TO, request: chain.request }).then((paid) => paid.credential));
  fake.script.beforeSend = { kind: "expired", name: "PaymentExpiredError", message: "Payment expired." };
  assert.deepEqual(await port.settle(charge), { kind: "pending", transaction: null, reason: "Payment expired." });
  assert.deepEqual(await port.settle({ ...charge, validBefore: now - 10 }), { kind: "failed", reason: "Payment expired." });
  fake.script.beforeSend = null;
  assert.deepEqual(chain.sentRaw, []);
});

test("only a signed transaction that makes exactly this offer's transfer is accepted: no extra call, token, recipient, amount or memo", async () => {
  const { port, offered, fake, account, sign } = setup();
  const challenge = await offered();
  const validBefore = Math.floor(Date.now() / 1000) + 20;
  const memo = fake.memoFor(MPP_REALM, challenge.id);
  const good = { to: PATHUSD, data: transferWithMemoData(PAY_TO, 1_000_000n, memo) };
  const refusal = async (calls: { to: string; data: string }[]) => {
    const result = await port.present(customCredential(challenge, account.address, calls, validBefore).credential, room);
    assert("invalid" in result, `accepted ${JSON.stringify(calls).slice(0, 160)}`);
    return (result as { invalid: string }).invalid;
  };
  const plainTransfer = `0xa9059cbb${"0".repeat(24)}${"00".repeat(18)}dead${(1).toString(16).padStart(64, "0")}`;
  assert.match(await refusal([good, { to: PATHUSD, data: plainTransfer }]), /exactly one transfer/);
  assert.match(await refusal([good, good]), /exactly one transfer/);
  assert.match(await refusal([]), /exactly one transfer/);
  assert.match(await refusal([{ to: MODERATO_TEST_TOKENS.alphaUSD, data: good.data }]), /transferWithMemo of this offer's token/);
  assert.match(await refusal([{ to: PATHUSD, data: `0xa9059cbb${good.data.slice(10)}` }]), /transferWithMemo of this offer's token/);
  assert.match(await refusal([{ to: PATHUSD, data: `${good.data}00` }]), /transferWithMemo of this offer's token/);
  assert.match(await refusal([{ to: PATHUSD, data: transferWithMemoData(`0x${"99".repeat(20)}`, 1_000_000n, memo) }]), /does not pay this room's address/);
  assert.match(await refusal([{ to: PATHUSD, data: transferWithMemoData(PAY_TO, 2_000_000n, memo) }]), /amount does not match/);
  assert.match(await refusal([{ to: PATHUSD, data: transferWithMemoData(PAY_TO, 1_000_000n, fake.memoFor(MPP_REALM, "another-challenge")) }]), /memo is not bound to this offer/);
  assert.match(await refusal([{ to: PATHUSD, data: transferWithMemoData(PAY_TO, 1_000_000n, fake.memoFor("another-realm", challenge.id)) }]), /memo is not bound to this offer/);
  const exact = await port.present(customCredential(challenge, account.address, [good], validBefore).credential, room);
  assert(!("invalid" in exact), JSON.stringify(exact));
  // The stock payer's own transaction is exactly that shape.
  assert(!("invalid" in await port.present(await sign(challenge), room)));
});
