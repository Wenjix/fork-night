import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  address,
  appendTransactionMessageInstructions,
  blockhash,
  compileTransaction,
  createTransactionMessage,
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  getCompiledTransactionMessageDecoder,
  getSignatureFromTransaction,
  partiallySignTransaction,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  setTransactionMessageLifetimeUsingDurableNonce,
  signTransaction,
  type Nonce,
} from "@solana/kit";
import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { handleFunding, type FundingDeps, type PaymentPort, type Settlement } from "../../src/x402/funding.ts";
import { BASE_SEPOLIA, SOLANA_DEVNET, TESTNET_USDC, intentId, recordPaths, refillRequestId } from "../../src/x402/ids.ts";
import { activeTopUps, type FundingIntent, type FundingSettlement } from "../../src/x402/records.ts";
import {
  baseSepoliaReader,
  reconcileIntents,
  solanaDevnetReader,
  type ChainReader,
  type ChainVerdict,
} from "../../src/x402/reconcile.ts";
import { recordBytes } from "../../src/x402/store.ts";
import {
  REF, STEWARD,
  fakePayments, fundingConfig, fundingRequest, memoryLedger, memoryStore,
  type TestPayment,
} from "./x402-fakes.ts";
import { DEVNET_BLOCKHASH } from "./x402-solana-fixture.ts";

const NOW = new Date("2026-10-12T12:00:00.000Z");
const evm = (nonce = `0x${"2".repeat(64)}`) =>
  ({ network: BASE_SEPOLIA, nonce, payer: "0x309a90aA8453E78f1B5878B46E5B65342dF7Fe83" }) as const;
const solana = (memo = "b".repeat(32)) =>
  ({ network: SOLANA_DEVNET, memo, payer: "4uxMGnZdLT6Jz2b4FtdBsB77DiobT5WvJsZp68XpGJsA" }) as const;
const idOf = (payment: ReturnType<typeof evm> | ReturnType<typeof solana>) => intentId(
  payment.network === SOLANA_DEVNET
    ? { network: payment.network, memo: payment.memo }
    : { network: payment.network, payer: payment.payer.toLowerCase(), nonce: payment.nonce.toLowerCase() },
);
const pending: Settlement = { kind: "pending", transaction: null, reason: "settlement_pending" };

/** A room funded through the real route with fake payments, and a scripted chain. */
function room(maxTopUps = 2) {
  const storage = memoryStore(), ledger = memoryLedger(), payments = fakePayments();
  const deps: FundingDeps = {
    config: fundingConfig(maxTopUps), payments: payments.port, store: storage.store, ledger: ledger.ledger, now: () => NOW,
  };
  const chain = new Map<string, ChainVerdict | Error>();
  const inspected: string[] = [];
  const reader: ChainReader = {
    async inspect(intent) {
      inspected.push(intent.intentId);
      const verdict = chain.get(intent.intentId) ?? { status: "pending", reason: "Nothing on chain yet." };
      if (verdict instanceof Error) throw verdict;
      return verdict;
    },
  };
  return {
    deps, storage, ledger, payments, chain, inspected,
    pay(payment: TestPayment, settlement?: Settlement) {
      if (settlement) payments.setSettlement(settlement);
      return handleFunding(fundingRequest(REF, payment), REF, deps);
    },
    reconcile: (apply: boolean) => reconcileIntents({
      store: storage.store, ledger: ledger.ledger, chains: { [BASE_SEPOLIA]: reader, [SOLANA_DEVNET]: reader },
      now: () => NOW, apply,
    }),
    refills: () => ledger.calls.filter((call) => call.startsWith("refill")),
  };
}

test("a payment the chain shows as paid is credited once, under the refill request ID the route would use", async () => {
  const r = room();
  const payment = evm();
  assert.equal((await r.pay(payment, pending)).status, 202);
  const id = idOf(payment), tx = `0x${"ab".repeat(32)}`;
  const evidence = { network: BASE_SEPOLIA, transaction: tx, blockNumber: 48018708, logIndex: 202 };
  r.chain.set(id, { status: "paid", transaction: tx, evidence });

  const report = await r.reconcile(true);
  assert.deepEqual(report.intents, [{
    id: id.slice(0, 12), room: "lighthouse", network: BASE_SEPOLIA, outcome: "credited", transaction: tx,
    explorerUrl: `https://sepolia.basescan.org/tx/${tx}`, reason: "The room was credited; the receipt is recorded.",
  }]);
  const receipt = r.storage.json(recordPaths(id, "lighthouse").receipt);
  assert.equal(receipt.refillRequestId, refillRequestId(BASE_SEPOLIA, tx));
  assert.equal(receipt.source, "reconciler");
  assert.equal(receipt.paymentResponse, null);
  assert.deepEqual(receipt.settlement, evidence);
  assert.deepEqual(r.refills(), [`refill:${refillRequestId(BASE_SEPOLIA, tx)}`]);
  assert.equal(r.ledger.rooms.lighthouse.deliveryLimit, 5);

  // Later runs and the route both answer from the receipt; nothing settles or credits twice.
  assert.equal((await r.reconcile(true)).intents[0].outcome, "skipped");
  const replay = await r.pay(payment);
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).replayed, true);
  assert.deepEqual(r.inspected, [id]);
  assert.equal(r.refills().length, 1);
  assert.equal(r.payments.calls.filter((call) => call === "settle").length, 1);
});

test("a payment the route already credited is skipped without reading the chain", async () => {
  const r = room();
  const credited = await r.pay(evm());
  assert.equal(credited.status, 200);
  const { transaction } = await credited.json();
  const [entry] = (await r.reconcile(true)).intents;
  assert.equal(entry.outcome, "skipped");
  assert.equal(entry.reason, "Already credited by the route.");
  assert.equal(entry.transaction, transaction);
  assert.deepEqual(r.inspected, []);
  assert.equal(r.refills().length, 1);
});

test("a settled payment whose receipt was lost replays the route's refill and records the receipt", async () => {
  const r = room();
  r.storage.failCreate.push(/^x402\/receipts\//);
  const response = await r.pay(evm());
  assert.equal(response.status, 202);
  const { status, transaction } = await response.json();
  assert.equal(status, "settled-credit-pending");
  assert.match(transaction, /^0x[0-9A-F]{64}$/, "the fake facilitator reports the hash in upper case");
  assert.equal(r.ledger.rooms.lighthouse.deliveryLimit, 5);
  r.storage.failCreate.length = 0;

  // The chain reports the same hash in lower case; both name the same refill.
  const id = idOf(evm()), onChain = transaction.toLowerCase();
  r.chain.set(id, { status: "paid", transaction: onChain, evidence: { network: BASE_SEPOLIA, transaction: onChain } });
  const [entry] = (await r.reconcile(true)).intents;
  assert.equal(entry.outcome, "credited");
  assert.equal(entry.reason, "The earlier refill was replayed; the receipt is recorded.");
  const receipt = r.storage.json(recordPaths(id, "lighthouse").receipt);
  assert.equal(receipt.source, "reconciler");
  assert.equal(receipt.refill.replayed, true);
  assert.equal(receipt.refillRequestId, refillRequestId(BASE_SEPOLIA, transaction));
  assert.equal(r.ledger.refills.size, 1);
  assert.equal(r.ledger.rooms.lighthouse.deliveryLimit, 5);
});

/** What the route records once the facilitator confirms a settlement, before it refills. */
const settlementRecord = (payment: ReturnType<typeof evm>, transaction: string): FundingSettlement => ({
  kind: "fork-night/x402-settlement/v1", intentId: idOf(payment), network: payment.network, transaction,
  refillRequestId: refillRequestId(payment.network, transaction), recordedAt: NOW.toISOString(),
});

test("a chain payment is credited when the route recorded no settlement, or the same transaction in any hex case", async () => {
  const r = room(3);
  const [unrecorded, recorded] = [evm(`0x${"7".repeat(64)}`), evm(`0x${"8".repeat(64)}`)];
  for (const payment of [unrecorded, recorded]) assert.equal((await r.pay(payment, pending)).status, 202);
  const [first, second] = [`0x${"cd".repeat(32)}`, `0x${"ab".repeat(32)}`];
  // EVM hashes compare without case: the record holds upper case here, the chain reader reports lower case.
  await r.storage.store.create(recordPaths(idOf(recorded), "lighthouse").settlement,
    recordBytes(settlementRecord(recorded, `0x${"AB".repeat(32)}`)));
  r.chain.set(idOf(unrecorded), { status: "paid", transaction: first, evidence: {} });
  r.chain.set(idOf(recorded), { status: "paid", transaction: second, evidence: {} });

  const report = await r.reconcile(true);
  assert.deepEqual(Object.fromEntries(report.intents.map((entry) => [entry.id, entry.outcome])), {
    [idOf(unrecorded).slice(0, 12)]: "credited", [idOf(recorded).slice(0, 12)]: "credited",
  });
  assert.deepEqual(r.refills().sort(),
    [`refill:${refillRequestId(BASE_SEPOLIA, first)}`, `refill:${refillRequestId(BASE_SEPOLIA, second)}`].sort());
  assert.equal(r.storage.json(recordPaths(idOf(recorded), "lighthouse").receipt).refillRequestId, refillRequestId(BASE_SEPOLIA, second));
  assert.equal(r.ledger.rooms.lighthouse.deliveryLimit, 10);
});

test("the reconciler refills under the request ID the route's settlement record bound, so both converge on one refill", async () => {
  const r = room();
  const payment = evm();
  assert.equal((await r.pay(payment, pending)).status, 202);
  const id = idOf(payment), tx = `0x${"ef".repeat(32)}`;
  // Whatever ID the route bound before its refill is the one to reuse, even if not derived from the hash.
  const bound = { ...settlementRecord(payment, tx), refillRequestId: "00000000-0000-4000-8000-0000000000b0" };
  await r.storage.store.create(recordPaths(id, "lighthouse").settlement, recordBytes(bound));
  await r.ledger.ledger.refill(bound.refillRequestId, "lighthouse", STEWARD);
  r.chain.set(id, { status: "paid", transaction: tx, evidence: {} });
  const [entry] = (await r.reconcile(true)).intents;
  assert.equal(entry.reason, "The earlier refill was replayed; the receipt is recorded.");
  assert.equal(r.ledger.refills.size, 1);
  assert.equal(r.storage.json(recordPaths(id, "lighthouse").receipt).refillRequestId, bound.refillRequestId);
});

test("a chain transaction other than the one the route recorded as settled is an error for a person, never a second credit", async () => {
  const r = room();
  const payment = evm();
  assert.equal((await r.pay(payment, pending)).status, 202);
  const id = idOf(payment), reported = `0x${"aa".repeat(32)}`, onChain = `0x${"bb".repeat(32)}`;
  // The route recorded the facilitator's hash and refilled under it, then lost the receipt.
  await r.storage.store.create(recordPaths(id, "lighthouse").settlement, recordBytes(settlementRecord(payment, reported)));
  await r.ledger.ledger.refill(refillRequestId(BASE_SEPOLIA, reported), "lighthouse", STEWARD);
  r.chain.set(id, { status: "paid", transaction: onChain, evidence: {} });

  const before = new Map(r.storage.objects);
  for (const apply of [false, true]) {
    const report = await r.reconcile(apply);
    assert.deepEqual(report.intents.map(({ outcome, reason, transaction }) => ({ outcome, reason, transaction })), [{
      outcome: "error",
      reason: `The route recorded ${reported} as settled, but the chain shows ${onChain} paying this intent; check by hand.`,
      transaction: onChain,
    }]);
    assert.equal(report.errors, 1);
  }
  assert.deepEqual(new Map(r.storage.objects), before, "no receipt and no expiry");
  assert.deepEqual(r.refills(), [`refill:${refillRequestId(BASE_SEPOLIA, reported)}`]);
  assert.equal(r.ledger.rooms.lighthouse.deliveryLimit, 5);
});

test("a dry run reads the chain but writes nothing", async () => {
  const r = room(5);
  const [paid, gone, waiting] = [evm(`0x${"3".repeat(64)}`), solana("c".repeat(32)), solana("d".repeat(32))];
  for (const payment of [paid, gone, waiting]) assert.equal((await r.pay(payment, pending)).status, 202);
  r.chain.set(idOf(paid), { status: "paid", transaction: `0x${"cd".repeat(32)}`, evidence: {} });
  r.chain.set(idOf(gone), { status: "unpayable", reason: "The payment's blockhash expired.", evidence: {} });
  const before = new Map(r.storage.objects);
  const report = await r.reconcile(false);
  assert.deepEqual(new Map(r.storage.objects), before);
  assert.deepEqual(r.refills(), []);
  assert.equal(report.apply, false);
  const outcomes = Object.fromEntries(report.intents.map((entry) => [entry.id, `${entry.outcome}: ${entry.reason}`]));
  assert.deepEqual(outcomes, {
    [idOf(paid).slice(0, 12)]: "paid: Paid on chain; --apply credits the room.",
    [idOf(gone).slice(0, 12)]: "unpayable: The payment's blockhash expired. --apply marks it expired.",
    [idOf(waiting).slice(0, 12)]: "pending: Nothing on chain yet.",
  });
  assert.deepEqual(report.counts, { paid: 1, unpayable: 1, pending: 1 });
});

test("a payment the chain proves unpayable gets an expired marker, the only record that frees its ceiling slot", async () => {
  const r = room(1);
  const payment = solana();
  assert.equal((await r.pay(payment, pending)).status, 202);
  assert.equal(await activeTopUps(r.storage.store, "lighthouse"), 1);
  assert.equal((await handleFunding(fundingRequest(), REF, r.deps)).status, 409);

  const id = idOf(payment);
  const evidence = { network: SOLANA_DEVNET, blockhash: "4uckwVjjp93i9skFUtk2FWHEKNp5d5ci6KtUPHgRLANB", blockhashValid: false };
  r.chain.set(id, { status: "unpayable", reason: "The payment's blockhash expired.", evidence });
  assert.equal((await r.reconcile(true)).intents[0].outcome, "expired");
  assert.deepEqual(r.storage.json(recordPaths(id, "lighthouse").expired), {
    kind: "fork-night/x402-expired/v1", intentId: id, roomId: "lighthouse", network: SOLANA_DEVNET,
    reason: "The payment's blockhash expired.", evidence, recordedAt: NOW.toISOString(),
  });
  assert.equal(await activeTopUps(r.storage.store, "lighthouse"), 0);
  assert.equal((await handleFunding(fundingRequest(), REF, r.deps)).status, 402);
  assert.deepEqual(r.refills(), []);
  assert.deepEqual((await r.reconcile(true)).intents.map((entry) => entry.reason), ["Already marked expired: nothing was charged; signing a new payment is safe."]);
  assert.equal(r.inspected.length, 1);
});

test("pending, failing and malformed intents are reported without writes, and errors fail the run", async () => {
  const r = room(5);
  const [waiting, broken, bogus] = [evm(`0x${"4".repeat(64)}`), evm(`0x${"5".repeat(64)}`), evm(`0x${"6".repeat(64)}`)];
  for (const payment of [waiting, broken, bogus]) assert.equal((await r.pay(payment, pending)).status, 202);
  r.chain.set(idOf(broken), new Error("Base Sepolia returned HTTP 503."));
  r.chain.set(idOf(bogus), { status: "paid", transaction: "0x1234", evidence: {} });
  const stray = "f".repeat(64);
  r.storage.objects.set(`x402/intents/${stray}.json`, Buffer.from("{}\n"));
  r.storage.objects.set("x402/intents/notes.txt", Buffer.from("not an intent"));
  const before = new Map(r.storage.objects);
  const report = await r.reconcile(true);
  assert.deepEqual(new Map(r.storage.objects), before);
  assert.deepEqual(r.refills(), []);
  assert.deepEqual(Object.fromEntries(report.intents.map((entry) => [entry.id, `${entry.outcome}: ${entry.reason}`])), {
    [idOf(waiting).slice(0, 12)]: "pending: Nothing on chain yet.",
    [idOf(broken).slice(0, 12)]: "error: Base Sepolia returned HTTP 503.",
    [idOf(bogus).slice(0, 12)]: "error: The chain reader returned a malformed transaction.",
    [stray.slice(0, 12)]: "error: The intent record is unreadable or does not match its key.",
  });
  assert.equal(report.errors, 3);
});

// ---- Chain readers against canned JSON-RPC (shapes captured read-only from the public testnet RPCs) ----

type RpcCall = { method: string; params: any[] };
function stubRpc(t: TestContext, url: string, answer: (call: RpcCall) => unknown) {
  const calls: RpcCall[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(input), url, "no request may go anywhere else");
    const { id, method, params } = JSON.parse(String(init?.body));
    calls.push({ method, params });
    const reply = answer({ method, params });
    return reply instanceof Response ? reply : Response.json({ jsonrpc: "2.0", id, ...(reply as object) });
  });
  return calls;
}
const hex = (value: number) => `0x${value.toString(16)}`;
const pad = (value: string) => `0x${value.slice(2).toLowerCase().padStart(64, "0")}`;

// x402.org settled exactly 1.00 USDC on Base Sepolia in block 48018708 (2 s blocks; head 162 blocks later).
const USDC_EVM = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
const USED = "0x98de503528ee59b575ef0c0a2576a82497bfc029a5685b209e9ec333479b10a5";
const CANCELED = "0x1cdd46ff242716cdaa72d159d339a485b3438398348d68f09d7c8c0a59353d81";
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const SETTLED = {
  payer: "0xA849bbaD82F9edafDf9A5550CC874276138779d9",
  nonce: "0xe804be6510d47a35a1c9d6e5a73e70ac16377a8dc6bf4fbc2cbc9db07556ffee",
  payTo: "0x114859721bF43b44D401aFF3E10F78A20BDe4fEa",
  transaction: "0x0c835e6316f184d0aab589b09db21b4a758413cd1053109492cce9f7bbbb516e",
  block: 48018708,
  timestamp: 1791805704,
};
const HEAD = { number: 48018870, timestamp: 1791806028 };
const LOG = {
  blockHash: "0x1c38adc705233f1668e455a0e4c63056d83489a6adc1970ee716e38b98ca2afe", blockNumber: "0x2dcb514",
  blockTimestamp: "0x6accc908", transactionHash: SETTLED.transaction, transactionIndex: "0x5e", removed: false,
};
const USED_LOG = { address: USDC_EVM, topics: [USED, pad(SETTLED.payer), SETTLED.nonce], data: "0x", ...LOG, logIndex: "0xca" };
const transferLog = (to = SETTLED.payTo, value = 1_000_000) =>
  ({ address: USDC_EVM, topics: [TRANSFER, pad(SETTLED.payer), pad(to)], data: pad(hex(value)), ...LOG, logIndex: "0xcb" });
const receipt = (logs: object[], status = "0x1") => ({
  type: "0x2", status, cumulativeGasUsed: "0x6c9bb2", logs, transactionHash: SETTLED.transaction, transactionIndex: "0x5e",
  blockHash: LOG.blockHash, blockNumber: "0x2dcb514", gasUsed: "0x14f14", effectiveGasPrice: "0x5b8d80", blobGasUsed: "0x17692",
  from: "0xd407e409e34e0b9afb99ecceb609bdbcd5e7f1bf", to: USDC_EVM, contractAddress: null, l1GasPrice: "0x11", l1GasUsed: "0xd70",
  l1Fee: "0x15c", l1BaseFeeScalar: "0x44d", l1BlobBaseFee: "0x2", l1BlobBaseFeeScalar: "0xa118b", daFootprintGasScalar: "0x1be",
});
const BLOCK = {
  baseFeePerGas: "0x4c4b40", blobGasUsed: "0x61ccfa", difficulty: "0x0", excessBlobGas: "0x0",
  extraData: "0x01000000640000000f00000000004c4b40", gasLimit: "0x47868c00", gasUsed: "0x82e8b7", hash: LOG.blockHash,
  miner: "0x4200000000000000000000000000000000000011", mixHash: "0x88c37cc138c206c53ac255a48509d7f403ca5c222a8357b4d063f1584f8b6584",
  nonce: "0x0000000000000000", parentBeaconBlockRoot: "0xdbffc44999c8b2427f8eec2122f9ee6a55d2b6bc7274c2e10a1099579e60a0dd",
  parentHash: "0x42c7fdb09fd8bd14a96158babc1161311e196fe33faad3316147ffbb4f39390e",
  receiptsRoot: "0xa5ea2fb4ec78d9ef5ec34090664772cf19a67b52e4ca918bbde4a9b7241a0a33",
  requestsHash: "0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  sha3Uncles: "0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347", size: "0x7dfe",
  stateRoot: "0xcc0e9104697221a737407d247979819cac4a1ab5fa7d604b0d37d5ec51afb113", transactions: [],
  transactionsRoot: "0xc30858dd96b05384f5ea774c40e9fa7ac557058f4409c046ed3f4474974d3be4", uncles: [], withdrawals: [],
  withdrawalsRoot: "0xa37f8b4eca220b53e2dff1addef8464aef5abf1b1f0d2f7a8784be6104707b4a",
};
type EvmChain = { used?: boolean; logs?: (from: number, to: number) => object[]; receipt?: object | null; blockTime?: (block: number) => number };
function baseSepolia(t: TestContext, chain: EvmChain) {
  return stubRpc(t, "https://sepolia.base.org", ({ method, params }) => {
    if (method === "eth_getBlockByNumber") {
      const number = params[0] === "latest" ? HEAD.number : Number(params[0]);
      const time = chain.blockTime ?? ((block: number) => HEAD.timestamp - 2 * (HEAD.number - block));
      return { result: { ...BLOCK, number: hex(number), timestamp: hex(number === HEAD.number ? HEAD.timestamp : time(number)) } };
    }
    if (method === "eth_call") return { result: pad(hex(chain.used === false ? 0 : 1)) };
    if (method === "eth_getLogs") return { result: chain.logs?.(Number(params[0].fromBlock), Number(params[0].toBlock)) ?? [] };
    if (method === "eth_getTransactionReceipt")
      return { result: chain.receipt === undefined ? receipt([USED_LOG, transferLog()]) : chain.receipt };
    throw new Error(`Unexpected ${method}`);
  });
}
const evmIntent = (validBefore: number): FundingIntent => {
  const key = { network: BASE_SEPOLIA, payer: SETTLED.payer.toLowerCase(), nonce: SETTLED.nonce } as const;
  return {
    kind: "fork-night/x402-intent/v1", intentId: intentId(key), key, roomId: "lighthouse", stewardProfileId: STEWARD,
    credits: 5, payer: SETTLED.payer, payTo: SETTLED.payTo, asset: TESTNET_USDC[BASE_SEPOLIA], amount: "1000000",
    payloadDigest: "0".repeat(64), payload: {}, requirement: {}, validUntil: new Date(validBefore * 1000).toISOString(),
    createdAt: new Date((validBefore - 120) * 1000).toISOString(),
  };
};

test("Base Sepolia: a used authorization followed by its 1.00 USDC transfer is paid (captured settlement)", async (t) => {
  const validBefore = SETTLED.timestamp + 60;
  const calls = baseSepolia(t, { logs: (from, to) => (from <= SETTLED.block && SETTLED.block <= to ? [USED_LOG] : []) });
  assert.deepEqual(await baseSepoliaReader().inspect(evmIntent(validBefore)), {
    status: "paid",
    transaction: SETTLED.transaction,
    evidence: {
      network: BASE_SEPOLIA, rpc: "https://sepolia.base.org", authorizer: SETTLED.payer.toLowerCase(), nonce: SETTLED.nonce,
      validBefore, headBlock: HEAD.number, headTimestamp: HEAD.timestamp, transaction: SETTLED.transaction,
      blockNumber: SETTLED.block, logIndex: 0xca, event: "AuthorizationUsed", to: SETTLED.payTo.toLowerCase(), value: "1000000",
    },
  });
  assert.deepEqual(calls.map((call) => call.method),
    ["eth_getBlockByNumber", "eth_call", "eth_getLogs", "eth_getTransactionReceipt"]);
  assert.deepEqual(calls[0].params, ["latest", false]);
  // authorizationState(payer, nonce), pinned to the head block whose timestamp is compared.
  assert.equal(calls[1].params[0].to.toLowerCase(), USDC_EVM);
  assert.equal(calls[1].params[0].data, `0xe94a0102${pad(SETTLED.payer).slice(2)}${SETTLED.nonce.slice(2)}`);
  assert.equal(calls[1].params[1], hex(HEAD.number));
  // validBefore - 160 s is 424 s, so 212 two-second blocks, before the head; one window spans 200 blocks.
  const filter = calls[2].params[0];
  assert.deepEqual([Number(filter.fromBlock), Number(filter.toBlock)], [48018658, 48018858]);
  assert.equal(filter.address.toLowerCase(), USDC_EVM);
  assert.deepEqual(new Set(filter.topics[0]), new Set([USED, CANCELED]));
  assert.deepEqual(filter.topics.slice(1), [pad(SETTLED.payer), SETTLED.nonce]);
});

test("Base Sepolia: an unused authorization becomes unpayable only once the chain is 30 s past validBefore", async (t) => {
  const calls = baseSepolia(t, { used: false });
  const reader = baseSepoliaReader();
  const almost = HEAD.timestamp - 30, gone = HEAD.timestamp - 31;
  assert.deepEqual(await reader.inspect(evmIntent(almost)), {
    status: "pending",
    reason: `The authorization is unused; it can be declared expired 30 s after ${new Date(almost * 1000).toISOString()}.`,
  });
  assert.deepEqual(await reader.inspect(evmIntent(gone)), {
    status: "unpayable",
    reason: "The authorization expired unused.",
    evidence: {
      network: BASE_SEPOLIA, rpc: "https://sepolia.base.org", authorizer: SETTLED.payer.toLowerCase(), nonce: SETTLED.nonce,
      validBefore: gone, headBlock: HEAD.number, headTimestamp: HEAD.timestamp, authorizationState: false,
    },
  });
  assert(!calls.some((call) => call.method === "eth_getLogs"));
});

test("Base Sepolia: a canceled authorization or a nonce spent elsewhere is unpayable; an unreadable receipt is not", async (t) => {
  const chain: EvmChain = { logs: () => [{ ...USED_LOG, topics: [CANCELED, ...USED_LOG.topics.slice(1)] }] };
  const calls = baseSepolia(t, chain);
  const reader = baseSepoliaReader(), intent = evmIntent(SETTLED.timestamp + 60);
  const verdict = async () => {
    const result = await reader.inspect(intent);
    return result.status === "paid" ? result.status : `${result.status}: ${result.reason}`;
  };
  assert.equal(await verdict(), "unpayable: The payer canceled the authorization.");
  assert(!calls.some((call) => call.method === "eth_getTransactionReceipt"));

  chain.logs = () => [USED_LOG];
  for (const [logs, expected] of [
    [[USED_LOG, transferLog("0x000000000000000000000000000000000000dEaD")], "unpayable: A different authorization used this nonce."],
    [[USED_LOG, transferLog(SETTLED.payTo, 999_999)], "unpayable: A different authorization used this nonce."],
    [[USED_LOG], "unpayable: A different authorization used this nonce."],
    [[USED_LOG, transferLog()], "paid"],
  ] as const) {
    chain.receipt = receipt([...logs]);
    assert.equal(await verdict(), expected);
  }
  for (const unreadable of [null, receipt([USED_LOG, transferLog()], "0x0"), receipt([transferLog()])]) {
    chain.receipt = unreadable;
    assert.equal(await verdict(), "pending: The authorization's transaction receipt is not available yet.");
  }
});

/** The verdict for the captured AuthorizationUsed event when its transaction receipt holds these logs. */
async function authorizationVerdict(t: TestContext, logs: object[]) {
  baseSepolia(t, { logs: () => [USED_LOG], receipt: receipt(logs) });
  const verdict = await baseSepoliaReader().inspect(evmIntent(SETTLED.timestamp + 60));
  return verdict.status === "paid" ? verdict.status : `${verdict.status}: ${verdict.reason}`;
}

test("Base Sepolia evidence: the Transfer after AuthorizationUsed must move the payer's USDC", async (t) => {
  const transfer = transferLog();
  const fromAnother = { ...transfer, topics: [TRANSFER, pad("0x000000000000000000000000000000000000bEEF"), transfer.topics[2]] };
  assert.equal(await authorizationVerdict(t, [USED_LOG, fromAnother]), "unpayable: A different authorization used this nonce.");
});

test("Base Sepolia evidence: the Transfer after AuthorizationUsed must be emitted by the USDC contract", async (t) => {
  const elsewhere = { ...transferLog(), address: "0x00000000000000000000000000000000000c0de0" };
  assert.equal(await authorizationVerdict(t, [USED_LOG, elsewhere]), "unpayable: A different authorization used this nonce.");
});

test("Base Sepolia: the event search moves forward in contiguous windows of at most 200 blocks, four at most", async (t) => {
  const validBefore = HEAD.timestamp - 2000;
  // Blocks that look older than their numbers keep every window short of validBefore + 10 s.
  const chain: EvmChain = { blockTime: () => validBefore };
  const calls = baseSepolia(t, chain);
  const reader = baseSepoliaReader();
  assert.deepEqual(await reader.inspect(evmIntent(validBefore)), {
    status: "pending",
    reason: "The nonce is used, but no authorization event was found near its deadline; check it by hand.",
  });
  const windows = () => calls.filter((call) => call.method === "eth_getLogs")
    .map((call) => [Number(call.params[0].fromBlock), Number(call.params[0].toBlock)]);
  const start = HEAD.number - (2000 + 160) / 2;
  assert.deepEqual(windows(), [[start, start + 200], [start + 201, start + 401], [start + 402, start + 602], [start + 603, start + 803]]);
  assert.equal(calls.filter((call) => call.method === "eth_getBlockByNumber").length, 1 + 3);

  // With true 2 s blocks, the first window already ends past validBefore + 10 s.
  calls.length = 0;
  chain.blockTime = undefined;
  await reader.inspect(evmIntent(validBefore));
  assert.deepEqual(windows(), [[start, start + 200]]);
});

// An x402.org settlement on Solana devnet with a 32-hex seller memo (its transfer retargeted to this payTo).
const USDC_SOLANA = TESTNET_USDC[SOLANA_DEVNET];
const PAY_TO = "AyvwjpFvDrvigbArDjT3JoTgX443rV86M6xdt63GGpXH";
const PAY_TO_ATA = "HQewN3t6qLmNSXn8qv5mxUGdmoDgXcoumGvuA81WSkyu"; // its devnet USDC account, as seen on chain
const PAYER_ACCOUNT = "5A7TZqWssg4M8virzK5egKq9kSg1VcZXvSvgPxzPCvJm"; // the settlement's source: the payer's own USDC account
const STRANGER = "BREyxoN5xkHr7Qks3n9RKaCtA8arfLrZpNSCDdViLogp";
const MEMO = "0b4d319e44546963302bf2d4e067d7a2";
const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const EXPIRED_BLOCKHASH = "4uckwVjjp93i9skFUtk2FWHEKNp5d5ci6KtUPHgRLANB";
const FEE_PAYER = "CKPKJWNdJEqa81x7CkZ14BVPiY6y16Sxs7owznqtWYp5";
const SLOT = 510255312;
const SLOT_TIME = 1791808056; // SLOT's block time: 12,253 slots of about 0.4 s after the captured payment
const PAID = "66x87vdkTbzaT5FbJda2pKbSJKS5ggYkYHaNsozJEsiZHnp8X3sSo9e6cEg3STzBCYEr1AYYtrmaRK7iUjaH9jUb";
const OTHERS = [
  "YBBCdC8XMBGZ7Y9UytPqBHobPrLPybHhQDQNXNVJBftvGqgZcwJHXZpE9CXL37h1YGV6UNdfu8UbRFQr6ak1w6z",
  "4PjpH1rWzugYFKwwzvUFSpm11BXMa5YjxdVrzCKG2TEbD7ekt22P8AauyjYCnNUW5D2PNmf9RMNuARP8mGnSL9aE",
  "HPGZcRonS4oiAieNmg4rjXaJfd9ZWGDtbqCk2gCyHzoduZJJ3Nz2ezBT4aGM5ayaCkhv8H29uoiHh5xtMCmQknK",
  "2Vid3EfQrumaUMuPHKHg5yEDJU9kgTjrwWToXKfMUJMgt3NDQ5n3bNsThdgQeCE8WyfeXMMmbR1rEeEtkZanADEB",
];
const ANOTHER_MEMO = "[32] 1e2ba0faddcd06fb87f0c5b92c7893a2";
const listed = (signature: string, memo: string | null, err: unknown = null, blockTime = 1791803155) =>
  ({ blockTime, confirmationStatus: "finalized", err, memo, signature, slot: 510243059, transactionIndex: 13 });
const parsedMemo = (text: string) => ({ parsed: text, program: "spl-memo", programId: MEMO_PROGRAM, stackHeight: 1 });
const settled = (authority: string, amount = "1000000", { destination = PAY_TO_ATA, memo = MEMO } = {}) => ({
  blockTime: 1791803155,
  meta: {
    computeUnitsConsumed: 13260, err: null as unknown, fee: 10001, innerInstructions: [], preTokenBalances: [], postTokenBalances: [],
    logMessages: [`Program log: Memo (len 32): "${memo}"`], rewards: [], status: { Ok: null } as unknown,
  },
  slot: 510243059,
  transaction: {
    message: {
      accountKeys: [{ pubkey: FEE_PAYER, signer: true, source: "transaction", writable: true }],
      addressTableLookups: [],
      instructions: [
        { accounts: [], data: "EuxTsD", programId: "ComputeBudget111111111111111111111111111111", stackHeight: 1 },
        { accounts: [], data: "3DdGGhkhJbjm", programId: "ComputeBudget111111111111111111111111111111", stackHeight: 1 },
        {
          parsed: {
            info: {
              authority, destination, mint: USDC_SOLANA, source: PAYER_ACCOUNT,
              tokenAmount: { amount, decimals: 6, uiAmount: Number(amount) / 1e6, uiAmountString: String(Number(amount) / 1e6) },
            },
            type: "transferChecked",
          },
          program: "spl-token", programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", stackHeight: 1,
        },
        parsedMemo(memo),
      ] as any[],
      recentBlockhash: EXPIRED_BLOCKHASH,
    },
    signatures: [PAID, "469DtYZknyt3MPuHZo6dtA5DQFQsskTCHSsWkhGhhcEmykLQa7MsYeWyuWog3XxtUtT1YKRfWaGGC4e89D1krNy6"],
  },
  transactionIndex: 13,
  version: 0,
});
/** A copy of a parsed settlement with its instructions (transferChecked at index 2, memo at 3) or meta changed. */
const edited = (transaction: ReturnType<typeof settled>, change: (instructions: any[], meta: any) => void) => {
  const copy = structuredClone(transaction);
  change(copy.transaction.message.instructions, copy.meta);
  return copy;
};
const memoInstruction = (text: string) => ({ programAddress: address(MEMO_PROGRAM), data: new TextEncoder().encode(text) });

/** A partially signed exact-SVM payment, built in memory with a throwaway authority, stored as the route would. */
async function solanaIntent(options: { durableNonce?: boolean } = {}) {
  const payer = await generateKeyPairSigner();
  const [source] = await findAssociatedTokenPda({ owner: payer.address, mint: address(USDC_SOLANA), tokenProgram: TOKEN_PROGRAM_ADDRESS });
  const base = setTransactionMessageFeePayer(address(FEE_PAYER), createTransactionMessage({ version: 0 }));
  const timed = options.durableNonce
    ? setTransactionMessageLifetimeUsingDurableNonce({
      nonce: EXPIRED_BLOCKHASH as Nonce, nonceAccountAddress: (await generateKeyPairSigner()).address, nonceAuthorityAddress: payer.address,
    }, base)
    : setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash(EXPIRED_BLOCKHASH), lastValidBlockHeight: 0n }, base);
  const message = appendTransactionMessageInstructions([
    getTransferCheckedInstruction({ source, mint: address(USDC_SOLANA), destination: address(PAY_TO_ATA), authority: payer, amount: 1_000_000n, decimals: 6 }),
    memoInstruction(MEMO),
  ], timed);
  const transaction = getBase64EncodedWireTransaction(await partiallySignTransaction([payer.keyPair], compileTransaction(message)));
  const key = { network: SOLANA_DEVNET, memo: MEMO } as const;
  const intent: FundingIntent = {
    kind: "fork-night/x402-intent/v1", intentId: intentId(key), key, roomId: "lighthouse", stewardProfileId: STEWARD,
    credits: 5, payer: payer.address, payTo: PAY_TO, asset: USDC_SOLANA, amount: "1000000", payloadDigest: "0".repeat(64),
    payload: { x402Version: 2, payload: { transaction } }, requirement: {}, validUntil: null, createdAt: "2026-10-12T11:05:30.000Z",
  };
  return { intent, authority: String(payer.address), payer };
}
type SolanaChain = { valid?: boolean; pages?: () => unknown; transaction?: (signature: string) => unknown; slotTime?: () => unknown };
function devnet(t: TestContext, chain: SolanaChain) {
  return stubRpc(t, "https://api.devnet.solana.com", ({ method, params }) => {
    if (method === "isBlockhashValid") return { result: { context: { apiVersion: "4.4.0-beta.0", slot: SLOT }, value: chain.valid ?? false } };
    if (method === "getSignaturesForAddress") {
      const page = chain.pages?.() ?? [];
      return page instanceof Response || !Array.isArray(page) ? page : { result: page };
    }
    if (method === "getTransaction") return chain.transaction?.(params[0]) ?? { result: null };
    if (method === "getBlockTime") return chain.slotTime?.() ?? { result: SLOT_TIME };
    throw new Error(`Unexpected ${method}`);
  });
}
const fast = { minIntervalMs: 0 };
const getTransactionOptions = { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" };
const unproven = (why: string, signature = PAID) =>
  `A transaction that may pay this intent could not be verified (${signature.slice(0, 12)}…: ${why}); check it by hand.`;

test("Solana devnet: entries listing this memo or none are read, other memos and failures are not, and one must pay", async (t) => {
  const { intent, authority } = await solanaIntent();
  const transactions = new Map<string, unknown>([
    [OTHERS[0], edited(settled(STRANGER), (instructions) => instructions.splice(3, 1))], // someone topping up payTo, no memo
    [OTHERS[3], edited(settled(authority), (instructions) => instructions.push(parsedMemo("tip")))],
    [PAID, settled(authority)],
  ]);
  const calls = devnet(t, {
    pages: () => [
      listed(OTHERS[0], null),
      listed(OTHERS[1], ANOTHER_MEMO),
      listed(OTHERS[2], `[32] ${MEMO}`, { InstructionError: [2, { Custom: 1 }] }),
      listed(OTHERS[3], `[32] ${MEMO}; [3] tip`),
      listed(PAID, `[32] ${MEMO}`),
    ],
    transaction: (signature) => ({ result: transactions.get(signature) ?? null }),
  });
  assert.deepEqual(await solanaDevnetReader(fast).inspect(intent), {
    status: "paid",
    transaction: PAID,
    evidence: {
      network: SOLANA_DEVNET, rpc: "https://api.devnet.solana.com", transaction: PAID, slot: 510243059, blockTime: 1791803155,
      payToTokenAccount: PAY_TO_ATA, mint: USDC_SOLANA, amount: "1000000", authority, memo: MEMO,
    },
  });
  // The blockhash comes from the stored payment; history is read at or after the confirmed slot that checked it.
  assert.deepEqual(calls.map((call) => [call.method, call.params]), [
    ["isBlockhashValid", [EXPIRED_BLOCKHASH, { commitment: "confirmed" }]],
    ["getSignaturesForAddress", [PAY_TO_ATA, { limit: 100, commitment: "confirmed", minContextSlot: SLOT }]],
    ["getTransaction", [OTHERS[0], getTransactionOptions]],
    ["getTransaction", [OTHERS[3], getTransactionOptions]],
    ["getTransaction", [PAID, getTransactionOptions]],
  ]);
});

test("Solana devnet: an expired blockhash with no memo payment in the history is unpayable; a valid one is pending", async (t) => {
  const { intent } = await solanaIntent();
  const chain: SolanaChain = {
    valid: false,
    pages: () => [listed(OTHERS[1], ANOTHER_MEMO), listed(OTHERS[2], `[32] ${MEMO}`, { InstructionError: [2, { Custom: 1 }] })],
  };
  const calls = devnet(t, chain);
  const reader = solanaDevnetReader(fast);
  assert.deepEqual(await reader.inspect(intent), {
    status: "unpayable",
    reason: "The payment's blockhash expired and no transaction carrying its memo reached the payTo account.",
    evidence: {
      network: SOLANA_DEVNET, rpc: "https://api.devnet.solana.com", blockhash: EXPIRED_BLOCKHASH, blockhashValid: false,
      checkedSlot: SLOT, checkedSlotTime: SLOT_TIME, payToTokenAccount: PAY_TO_ATA, memo: MEMO, signaturesRead: 2,
    },
  });
  assert.deepEqual(calls.map((call) => [call.method, call.params[0]]),
    [["isBlockhashValid", EXPIRED_BLOCKHASH], ["getSignaturesForAddress", PAY_TO_ATA], ["getBlockTime", SLOT]]);
  chain.valid = true;
  assert.deepEqual(await reader.inspect(intent), { status: "pending", reason: "The payment's blockhash is still valid, so it can still settle." });
  assert(!calls.some((call) => call.method === "getTransaction"));
  assert.equal(calls.filter((call) => call.method === "getBlockTime").length, 1);
});

test("Solana devnet: an invalid blockhash proves expiry only from a slot whose block time is 180 s past the intent", async (t) => {
  const { intent } = await solanaIntent();
  const created = Date.parse(intent.createdAt) / 1000;
  let slotTime: unknown;
  const calls = devnet(t, { slotTime: () => slotTime });
  const reader = solanaDevnetReader(fast);
  // A node that has not reached the payment's blockhash also calls it invalid; its slot's block time gives it away.
  for (const answer of [
    { result: created + 179 },
    { result: created - 40 },
    { result: null },
    { result: String(SLOT_TIME) },
    { error: { code: -32004, message: `Block not available for slot ${SLOT}` } },
    new Response("Internal Server Error", { status: 500 }),
  ]) {
    slotTime = answer;
    assert.deepEqual(await reader.inspect(intent), {
      status: "pending",
      reason: `The devnet RPC called the blockhash invalid at slot ${SLOT}, but that slot cannot prove expiry yet: ` +
        "its block time must be 180 s past the intent. Run again later.",
    });
  }
  slotTime = { result: created + 180 };
  const proven = await reader.inspect(intent);
  assert.equal(proven.status, "unpayable");
  assert.equal(proven.status === "unpayable" && proven.evidence.checkedSlotTime, created + 180);
  assert.deepEqual(calls.slice(0, 3).map((call) => [call.method, call.params]), [
    ["isBlockhashValid", [EXPIRED_BLOCKHASH, { commitment: "confirmed" }]],
    ["getSignaturesForAddress", [PAY_TO_ATA, { limit: 100, commitment: "confirmed", minContextSlot: SLOT }]],
    ["getBlockTime", [SLOT]],
  ]);
});

test("Solana devnet: a payment listed without its memo is still read and paid; recent unlisted entries without it are passed over", async (t) => {
  const { intent, authority } = await solanaIntent();
  const created = Date.parse(intent.createdAt) / 1000;
  let history = [listed(OTHERS[0], null, null, created + 40), listed(PAID, null, null, created + 25)];
  const transactions = new Map<string, unknown>([
    [OTHERS[0], edited(settled(STRANGER), (instructions) => instructions.splice(3, 1))],
    [PAID, settled(authority)],
  ]);
  const calls = devnet(t, { pages: () => history, transaction: (signature) => ({ result: transactions.get(signature) ?? null }) });
  const reader = solanaDevnetReader(fast);
  const found = await reader.inspect(intent);
  assert.equal(found.status === "paid" && found.transaction, PAID);

  // Without it, an unlisted entry older than any payment for this intent is not read, and expiry is proven.
  history = [listed(OTHERS[0], null, null, created + 40), listed(OTHERS[1], null, null, created - 601)];
  calls.length = 0;
  assert.equal((await reader.inspect(intent)).status, "unpayable");
  assert.deepEqual(calls.filter((call) => call.method === "getTransaction").map((call) => call.params[0]), [OTHERS[0]]);

  // An unlisted entry that cannot be read might be the payment.
  transactions.delete(OTHERS[0]);
  assert.deepEqual(await reader.inspect(intent), {
    status: "pending",
    reason: `A transaction that may pay this intent could not be verified (${OTHERS[0].slice(0, 12)}… (no memo listed): ` +
      "it failed or is not visible yet); check it by hand.",
  });
});

test("Solana devnet: a memo match that cannot be read keeps the intent pending after its blockhash expired", async (t) => {
  const { intent } = await solanaIntent();
  let reply: unknown = null;
  devnet(t, { pages: () => [listed(PAID, `[32] ${MEMO}`)], transaction: () => reply });
  const reader = solanaDevnetReader(fast);
  const v1 = 'Transaction version (1) is not supported by the requesting client. Please try the request again with the following configuration parameter: "maxSupportedTransactionVersion": 1';
  for (const [answer, why] of [
    [{ error: { code: -32015, message: v1 } }, `Solana devnet getTransaction: ${v1}`],
    [{ result: null }, "it failed or is not visible yet"],
  ] as const) {
    reply = answer;
    assert.deepEqual(await reader.inspect(intent), { status: "pending", reason: unproven(why) });
  }
});

/** The reader's answer for a history of one confirmed entry, listed with `memoField`, whose parsed transaction is `answer(payer)`. */
async function oneEntry(t: TestContext, answer: (payer: string) => unknown, memoField = `[32] ${MEMO}`) {
  const { intent, authority } = await solanaIntent();
  devnet(t, { pages: () => [listed(PAID, memoField)], transaction: () => ({ result: answer(authority) }) });
  const verdict = await solanaDevnetReader(fast).inspect(intent);
  return verdict.status === "pending" ? verdict.reason : verdict.status;
}

test("Solana devnet evidence: a decoy with the memo that touches payTo's account but pays the payer's own credits nothing", async (t) => {
  const { intent, payer } = await solanaIntent();
  const mint = address(USDC_SOLANA);
  const [source] = await findAssociatedTokenPda({ owner: payer.address, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  const [elsewhere] = await findAssociatedTokenPda({ owner: (await generateKeyPairSigner()).address, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  // Broadcast by the payer itself: the idempotent create is a no-op on payTo's existing account, but it lists the
  // transaction in that account's history with exactly this memo.
  const decoy = await signTransaction([payer.keyPair], compileTransaction(appendTransactionMessageInstructions([
    getCreateAssociatedTokenIdempotentInstruction({ payer, ata: address(PAY_TO_ATA), owner: address(PAY_TO), mint }),
    getTransferCheckedInstruction({ source, mint, destination: elsewhere, authority: payer, amount: 1_000_000n, decimals: 6 }),
    memoInstruction(MEMO),
  ], setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash(EXPIRED_BLOCKHASH), lastValidBlockHeight: 0n },
    setTransactionMessageFeePayer(payer.address, createTransactionMessage({ version: 0 }))))));
  const message = getCompiledTransactionMessageDecoder().decode(decoy.messageBytes);
  const keys = message.staticAccounts.map(String);
  assert(keys.includes(PAY_TO_ATA), "the RPC lists it under payTo's account");
  assert.equal(message.instructions.filter((ix) => keys[ix.programAddressIndex] === MEMO_PROGRAM).length, 1);
  const signature = getSignatureFromTransaction(decoy);
  const parsed = {
    blockTime: 1791803155, slot: 510243059, version: 0,
    meta: { err: null, fee: 5000, innerInstructions: [], logMessages: [`Program log: Memo (len 32): "${MEMO}"`], status: { Ok: null } },
    transaction: {
      signatures: [signature],
      message: {
        recentBlockhash: EXPIRED_BLOCKHASH,
        instructions: [
          {
            parsed: {
              info: { account: PAY_TO_ATA, mint: USDC_SOLANA, source: payer.address, systemProgram: "11111111111111111111111111111111", tokenProgram: TOKEN_PROGRAM_ADDRESS, wallet: PAY_TO },
              type: "createIdempotent",
            },
            program: "spl-associated-token-account", programId: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, stackHeight: 1,
          },
          {
            parsed: {
              info: { authority: payer.address, destination: elsewhere, mint: USDC_SOLANA, source, tokenAmount: { amount: "1000000", decimals: 6, uiAmount: 1, uiAmountString: "1" } },
              type: "transferChecked",
            },
            program: "spl-token", programId: TOKEN_PROGRAM_ADDRESS, stackHeight: 1,
          },
          parsedMemo(MEMO),
        ],
      },
    },
  };
  devnet(t, { pages: () => [listed(signature, `[32] ${MEMO}`)], transaction: (wanted) => ({ result: wanted === signature ? parsed : null }) });
  const storage = memoryStore(), ledger = memoryLedger();
  await storage.store.create(recordPaths(intent.intentId, "lighthouse").intent, recordBytes(intent));
  const report = await reconcileIntents({
    store: storage.store, ledger: ledger.ledger, chains: { [SOLANA_DEVNET]: solanaDevnetReader(fast) }, now: () => NOW, apply: true,
  });
  assert.deepEqual(report.intents.map(({ outcome, reason }) => ({ outcome, reason })),
    [{ outcome: "pending", reason: unproven("its transfer does not pay this intent", signature) }]);
  assert.deepEqual(ledger.calls, []);
  assert.equal(storage.json(recordPaths(intent.intentId, "lighthouse").receipt), null);
});

test("Solana devnet evidence: the transfer must move test USDC", async (t) => {
  const otherMint = (payer: string) => edited(settled(payer), (instructions) => {
    instructions[2].parsed.info.mint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  });
  assert.equal(await oneEntry(t, otherMint), unproven("its transfer does not pay this intent"));
});

test("Solana devnet evidence: the transfer must move exactly 1.00 test USDC", async (t) => {
  assert.equal(await oneEntry(t, (payer) => settled(payer, "999999")), unproven("its transfer does not pay this intent"));
});

test("Solana devnet evidence: the transfer must be signed by the intent's payer", async (t) => {
  assert.equal(await oneEntry(t, () => settled(STRANGER)), unproven("its transfer does not pay this intent"));
});

test("Solana devnet evidence: a transaction whose meta records an error pays nothing", async (t) => {
  const failed = (payer: string) => edited(settled(payer), (_, meta) => {
    meta.err = { InstructionError: [2, { Custom: 1 }] };
    meta.status = { Err: meta.err };
  });
  assert.equal(await oneEntry(t, failed), unproven("it failed or is not visible yet"));
});

test("Solana devnet evidence: a second memo instruction is not this payment", async (t) => {
  const tipped = (payer: string) => edited(settled(payer), (instructions) => instructions.push(parsedMemo("tip")));
  assert.equal(await oneEntry(t, tipped, `[32] ${MEMO}; [3] tip`), unproven("its memo instructions differ"));
});

test("Solana devnet evidence: the memo must go through the SPL Memo program the route required", async (t) => {
  const legacy = (payer: string) => edited(settled(payer), (instructions) => {
    instructions[3].programId = "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo";
  });
  assert.equal(await oneEntry(t, legacy), unproven("its memo instructions differ"));
});

test("Solana devnet evidence: a memo that merely contains this one is not this payment", async (t) => {
  const quoted = (payer: string) => edited(settled(payer), (instructions) => { instructions[3].parsed = `re: ${MEMO}`; });
  assert.equal(await oneEntry(t, quoted, `[36] re: ${MEMO}`), unproven("its memo instructions differ"));
});

test("Solana devnet evidence: the transfer must go through the SPL Token program", async (t) => {
  const token2022 = (payer: string) => edited(settled(payer), (instructions) => {
    instructions[2].programId = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
  });
  assert.equal(await oneEntry(t, token2022), unproven("its transfer does not pay this intent"));
});

test("Solana devnet evidence: a paying transfer preceded by a decoy transfer is not this payment", async (t) => {
  const doubled = (payer: string) => edited(settled(payer), (instructions) => {
    const decoy = structuredClone(instructions[2]);
    decoy.parsed.info.destination = PAYER_ACCOUNT;
    instructions.splice(2, 0, decoy);
  });
  assert.equal(await oneEntry(t, doubled), unproven("its transfer does not pay this intent"));
});

test("Solana devnet: expiry needs the payTo history back to the intent, read at the checked slot or later", async (t) => {
  const { intent } = await solanaIntent();
  const created = Date.parse(intent.createdAt) / 1000;
  const chain: SolanaChain = {
    pages: () => Array.from({ length: 100 }, (_, index) => listed(`${OTHERS[0].slice(0, 80)}${index}`, ANOTHER_MEMO, null, created)),
  };
  const calls = devnet(t, chain);
  const reader = solanaDevnetReader(fast);
  assert.deepEqual(await reader.inspect(intent), {
    status: "pending", reason: "The payTo account has more history than the reconciler reads; check it by hand.",
  });
  const pages = calls.filter((call) => call.method === "getSignaturesForAddress").map((call) => call.params[1].before);
  assert.deepEqual(pages, [undefined, ...Array(4).fill(`${OTHERS[0].slice(0, 80)}99`)]);

  // A full page that already reaches ten minutes before the intent covers the window.
  chain.pages = () => Array.from({ length: 100 }, (_, index) => listed(`${OTHERS[0].slice(0, 80)}${index}`, ANOTHER_MEMO, null, created - 601));
  const verdict = await reader.inspect(intent);
  assert.equal(verdict.status === "unpayable" && verdict.evidence.signaturesRead, 100);

  chain.pages = () => ({ error: { code: -32016, message: "Minimum context slot has not been reached", data: { contextSlot: SLOT - 3 } } });
  assert.deepEqual(await reader.inspect(intent), {
    status: "pending", reason: "The devnet RPC has not confirmed the checked slot yet; run again.",
  });
});

test("Solana devnet: calls are spaced a second apart and a 429 is retried once after Retry-After", async (t) => {
  const { intent, authority } = await solanaIntent();
  let now = 0, limited = 1;
  let history = [listed(PAID, `[32] ${MEMO}`)];
  const slept: number[] = [];
  const timing = { clock: () => now, sleep: async (ms: number) => { slept.push(ms); now += ms; } };
  devnet(t, {
    pages: () => (limited-- > 0 ? new Response("Too many requests", { status: 429, headers: { "retry-after": "2" } }) : history),
    transaction: () => ({ result: settled(authority) }),
  });
  assert.equal((await solanaDevnetReader(timing).inspect(intent)).status, "paid");
  // Spacing before getSignaturesForAddress, Retry-After, then spacing before getTransaction.
  assert.deepEqual(slept, [1000, 2000, 1000]);
  limited = 2;
  await assert.rejects(solanaDevnetReader(timing).inspect(intent), /getSignaturesForAddress returned HTTP 429/);

  // The expiry proof's block-time read is spaced the same way.
  slept.length = 0;
  history = [];
  assert.equal((await solanaDevnetReader(timing).inspect(intent)).status, "unpayable");
  assert.deepEqual(slept, [1000, 1000]);
});

test("Solana devnet: a durable-nonce payment is never declared expired", async (t) => {
  const { intent } = await solanaIntent({ durableNonce: true });
  const calls = devnet(t, { valid: false });
  assert.deepEqual(await solanaDevnetReader(fast).inspect(intent), {
    status: "pending", reason: "The payment uses a durable nonce, so its expiry cannot be proven.",
  });
  assert.deepEqual(calls.map((call) => call.method), ["getSignaturesForAddress"]);
  assert.equal(calls[0].params[1].minContextSlot, undefined);
});

test("Solana devnet: a lagging node's 'invalid' cannot expire a fresh payment, which is credited once it lands", async (t) => {
  // The route takes a real partially signed payment; the facilitator broadcast it, then its confirmation wait timed out.
  const memo = "5f1c0e9a7b3d4c2e8f6a1b0c9d8e7f60";
  const payer = await generateKeyPairSigner();
  const mint = address(USDC_SOLANA), payTo = fundingConfig().payTo[SOLANA_DEVNET]!;
  const [source] = await findAssociatedTokenPda({ owner: payer.address, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  const [payToAta] = await findAssociatedTokenPda({ owner: address(payTo), mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  const transaction = getBase64EncodedWireTransaction(await partiallySignTransaction([payer.keyPair], compileTransaction(
    appendTransactionMessageInstructions([
      getTransferCheckedInstruction({ source, mint, destination: payToAta, authority: payer, amount: 1_000_000n, decimals: 6 }),
      memoInstruction(memo),
    ], setTransactionMessageLifetimeUsingBlockhash(
      { blockhash: blockhash(DEVNET_BLOCKHASH.blockhash), lastValidBlockHeight: BigInt(DEVNET_BLOCKHASH.lastValidBlockHeight) },
      setTransactionMessageFeePayer(address(FEE_PAYER), createTransactionMessage({ version: 0 })),
    )))));
  const payments: PaymentPort = {
    async offer() { return { header: "offer", body: { x402Version: 2 } }; },
    async present(header) {
      return {
        network: SOLANA_DEVNET, key: { network: SOLANA_DEVNET, memo }, payer: payer.address, payTo, asset: USDC_SOLANA,
        amount: "1000000", payloadDigest: createHash("sha256").update(header).digest("hex"),
        payload: { x402Version: 2, payload: { transaction } }, requirement: {}, validUntil: null,
      };
    },
    async verify(payment) { return { valid: true, payer: payment.payer }; },
    async settle() { return { kind: "pending", transaction: null, reason: "FacilitatorTimeoutError" }; },
  };
  const storage = memoryStore(), ledger = memoryLedger();
  const deps: FundingDeps = { config: fundingConfig(1), payments, store: storage.store, ledger: ledger.ledger, now: () => NOW };
  const send = () => handleFunding(fundingRequest(REF, undefined, { headers: { "payment-signature": "c29sYW5hLXBheW1lbnQ=" } }), REF, deps);
  assert.equal((await send()).status, 202);

  // The backend that answers sits 88 slots behind the blockhash's slot (510254088), so the hash is unknown there.
  const created = NOW.getTime() / 1000;
  let landed = false;
  stubRpc(t, "https://api.devnet.solana.com", ({ method }) => {
    if (method === "isBlockhashValid") return { result: { context: { apiVersion: "4.4.0", slot: 510254000 }, value: false } };
    if (method === "getBlockTime") return { result: created - 40 };
    if (method === "getSignaturesForAddress") return { result: landed ? [listed(PAID, `[32] ${memo}`, null, created + 30)] : [] };
    if (method === "getTransaction")
      return { result: settled(payer.address, "1000000", { destination: String(payToAta), memo }) };
    throw new Error(`Unexpected ${method}`);
  });
  const id = intentId({ network: SOLANA_DEVNET, memo });
  const reconcile = () => reconcileIntents({
    store: storage.store, ledger: ledger.ledger, chains: { [SOLANA_DEVNET]: solanaDevnetReader(fast) },
    now: () => new Date(NOW.getTime() + 20_000), apply: true,
  });
  const early = (await reconcile()).intents;
  assert.deepEqual(early.map((entry) => entry.outcome), ["pending"]);
  assert.match(early[0].reason, /cannot prove expiry yet/);
  assert.equal(storage.json(recordPaths(id, "lighthouse").expired), null);
  assert.equal(await activeTopUps(storage.store, "lighthouse"), 1);
  // The payer is still told to wait, and nobody is offered a fresh payment.
  assert.equal((await send()).status, 202);
  assert.equal((await handleFunding(fundingRequest(), REF, deps)).status, 409);

  landed = true;
  const late = (await reconcile()).intents;
  assert.deepEqual(late.map((entry) => [entry.outcome, entry.transaction]), [["credited", PAID]]);
  assert.equal(ledger.refills.size, 1);
  assert.equal(ledger.rooms.lighthouse.deliveryLimit, 5);
  assert.equal(storage.json(recordPaths(id, "lighthouse").receipt).source, "reconciler");
});

// ---- scripts/x402-reconcile.ts, run offline: every request is refused ----

const RECONCILE_SCRIPT = fileURLToPath(new URL("../../scripts/x402-reconcile.ts", import.meta.url));
const OFFLINE = `data:text/javascript,${encodeURIComponent('globalThis.fetch = async () => { throw new Error("offline test: blocked"); };')}`;
async function reconcileScript(args: string[], settings: Record<string, string> = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of ["NODE_TEST_CONTEXT", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY"]) delete env[name];
  Object.assign(env, settings);
  try {
    const { stdout, stderr } = await promisify(execFile)(process.execPath, ["--import", OFFLINE, RECONCILE_SCRIPT, ...args], { env });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const { code, stdout, stderr } = error as { code: number; stdout: string; stderr: string };
    return { code, stdout, stderr };
  }
}
const DRY_RUN_FAILED = "Nothing was written.\n";
const APPLY_FAILED = "Intents processed before the failure keep their records; re-running is safe.\n";

test("the reconcile script refuses unknown arguments with its usage line, and accepts the -- that pnpm forwards", async () => {
  const usage = "Usage: npm run x402:reconcile [-- --apply]\n";
  const [unknown, extra, forwarded, alone] = await Promise.all([
    reconcileScript(["--bogus"]),
    reconcileScript(["--", "--apply", "now"]),
    reconcileScript(["--", "--apply"]),
    reconcileScript(["--"]),
  ]);
  for (const run of [unknown, extra]) assert.deepEqual(run, { code: 1, stdout: "", stderr: usage });
  // Past the arguments, both stop at the missing Supabase settings.
  const unconfigured = "x402 reconcile failed: Generation storage is not configured.\n";
  assert.deepEqual(forwarded, { code: 1, stdout: "", stderr: unconfigured + APPLY_FAILED });
  assert.deepEqual(alone, { code: 1, stdout: "", stderr: unconfigured + DRY_RUN_FAILED });
});

test("a reconcile run that cannot reach storage fails in one clean line that says what was written", async () => {
  const settings = { NEXT_PUBLIC_SUPABASE_URL: "https://reconcile-test.supabase.co", SUPABASE_SECRET_KEY: "test-only" };
  const [dryRun, applied] = await Promise.all([reconcileScript([], settings), reconcileScript(["--apply"], settings)]);
  const unreachable = "x402 reconcile failed: Could not list x402 records.\n";
  assert.deepEqual(dryRun, { code: 1, stdout: "", stderr: unreachable + DRY_RUN_FAILED });
  assert.deepEqual(applied, { code: 1, stdout: "", stderr: unreachable + APPLY_FAILED });
});
