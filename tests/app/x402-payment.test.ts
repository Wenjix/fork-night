import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import {
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
  decodePaymentSignatureHeader,
  encodePaymentSignatureHeader,
} from "@x402/core/http";
import { FacilitatorTimeoutError, type FacilitatorClient } from "@x402/core/server";
import {
  SettleError,
  type PaymentPayload,
  type PaymentRequired,
  type PaymentRequirements,
  type SettleResponse,
  type SupportedResponse,
  type VerifyResponse,
} from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import {
  address,
  appendTransactionMessageInstructions,
  blockhash,
  createKeyPairFromPrivateKeyBytes,
  createKeyPairSignerFromBytes,
  createTransactionMessage,
  getAddressEncoder,
  getAddressFromPublicKey,
  getBase58Decoder,
  getBase64EncodedWireTransaction,
  partiallySignTransactionMessageWithSigners,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type KeyPairSigner,
} from "@solana/kit";
import { findAssociatedTokenPda, getTransferCheckedInstruction, getTransferInstruction, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { FundingConfig } from "../../src/x402/config.ts";
import {
  handleFunding,
  type FundingDeps,
  type PresentedPayment,
  type ResourceInfo,
  type Settlement,
  type Verification,
} from "../../src/x402/funding.ts";
import {
  BASE_SEPOLIA, MEMO_PATTERN, SOLANA_DEVNET, TESTNET_USDC,
  intentId, recordPaths, refillRequestId, type IntentKey,
} from "../../src/x402/ids.ts";
import { createPaymentPort } from "../../src/x402/payment.ts";
import { OTHER_REF, PAY_TO, REF, fundingConfig, fundingRequest, memoryLedger, memoryStore } from "./x402-fakes.ts";
import { DEVNET_BLOCKHASH, devnetFetch } from "./x402-solana-fixture.ts";

const FEE_PAYER = "CKPKJWNdJEqa81x7CkZ14BVPiY6y16Sxs7owznqtWYp5";
const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const WRAPPED_SOL = "So11111111111111111111111111111111111111112";
// The testnet kinds and signers from GET https://x402.org/facilitator/supported on 2026-10-12.
const SUPPORTED: SupportedResponse = {
  kinds: [
    { x402Version: 2, scheme: "exact", network: BASE_SEPOLIA },
    {
      x402Version: 2, scheme: "exact", network: SOLANA_DEVNET,
      extra: { feePayer: FEE_PAYER, features: { smartWalletSupported: true } },
    },
  ],
  extensions: ["builder-code", "eip2612GasSponsoring", "erc20ApprovalGasSponsoring"],
  signers: { "eip155:*": ["0xd407e409E34E0b9afb99EcCeb609bDbcD5e7f1bf"], "solana:*": [FEE_PAYER] },
};
const EVM_TX = `0x${"5e".repeat(32)}`;
const SOLANA_TX = getBase58Decoder().decode(new Uint8Array(64).fill(7));

const resourceFor = (ref: string): ResourceInfo => ({
  url: `http://127.0.0.1:3005/api/x402/fund/${ref}`,
  description: "Fork Night room top-up: 5 test credits (testnet)",
  mimeType: "application/json",
});
const RESOURCE = resourceFor(REF);
/** What the facilitator receives: the signed payload with the bare route in place of the room's funding link. */
const sentToFacilitator = (payload: unknown) => {
  const { resource, ...signed } = payload as PaymentPayload;
  return { ...signed, resource: { ...resource!, url: "http://127.0.0.1:3005/api/x402/fund" } };
};

/** Keeps a test offline: only the captured devnet lookups are answered, and any other request throws. */
function offline(t: TestContext) {
  const rpc: string[] = [];
  t.mock.method(globalThis, "fetch", devnetFetch(rpc));
  return rpc;
}

type Step<T> = T | Error;
/** A scripted FacilitatorClient: /supported answers like x402.org; verify and settle answer only what a test queues. */
function stubFacilitator() {
  const script = { supported: [] as Step<SupportedResponse>[], verify: [] as Step<VerifyResponse>[], settle: [] as Step<SettleResponse>[] };
  type Call = { payload: PaymentPayload; requirements: PaymentRequirements };
  const calls = { supported: 0, verify: [] as Call[], settle: [] as Call[] };
  const next = <T>(steps: Step<T>[], fallback?: T): T => {
    const step = steps.length ? steps.shift() : fallback;
    if (step === undefined) throw new Error("The stub facilitator has no scripted answer.");
    if (step instanceof Error) throw step;
    return structuredClone(step);
  };
  const client: FacilitatorClient = {
    async getSupported() { calls.supported += 1; return next(script.supported, SUPPORTED); },
    async verify(payload, requirements) { calls.verify.push({ payload, requirements }); return next(script.verify); },
    async settle(payload, requirements) { calls.settle.push({ payload, requirements }); return next(script.settle); },
  };
  return { client, script, calls };
}

function seller(config: FundingConfig = fundingConfig(), now?: () => number) {
  const facilitator = stubFacilitator();
  return { facilitator, port: createPaymentPort(config, { facilitator: facilitator.client, now }) };
}

/** A throwaway Solana payer from a freshly generated 64-byte secret (seed followed by its public key). */
async function solanaSigner() {
  const seed = crypto.getRandomValues(new Uint8Array(32));
  const { publicKey } = await createKeyPairFromPrivateKeyBytes(seed);
  const secret = new Uint8Array([...seed, ...getAddressEncoder().encode(await getAddressFromPublicKey(publicKey))]);
  return createKeyPairSignerFromBytes(secret);
}

/**
 * A transaction shaped like the exact client's (fee payer slot unsigned, payer's TransferChecked, then memos),
 * built by hand so a test can vary what the client never would: the mint, the number of transfers or memos.
 */
async function handBuiltTransaction(
  signer: KeyPairSigner,
  payTo: string,
  memos: string[],
  { mint = TESTNET_USDC[SOLANA_DEVNET], transfers = 1, extraTransferTo = "" } = {},
) {
  const usdc = address(TESTNET_USDC[SOLANA_DEVNET]);
  const tokenAccount = async (owner: string) =>
    (await findAssociatedTokenPda({ owner: address(owner), mint: usdc, tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0];
  const transfer = getTransferCheckedInstruction({
    source: await tokenAccount(signer.address), mint: address(mint), destination: await tokenAccount(payTo),
    authority: signer, amount: 1_000_000n, decimals: 6,
  });
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(address(FEE_PAYER), m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({
      blockhash: blockhash(DEVNET_BLOCKHASH.blockhash),
      lastValidBlockHeight: BigInt(DEVNET_BLOCKHASH.lastValidBlockHeight),
    }, m),
    (m) => appendTransactionMessageInstructions([
      ...Array.from({ length: transfers }, () => transfer),
      // A plain (unchecked) SPL transfer moving more of the payer's tokens elsewhere.
      ...(extraTransferTo ? [getTransferInstruction({
        source: transfer.accounts[0].address, destination: extraTransferTo as Address, authority: signer, amount: 5_000_000n,
      })] : []),
      ...memos.map((memo) => ({ programAddress: address(MEMO_PROGRAM), data: new TextEncoder().encode(memo) })),
    ], m),
  );
  return getBase64EncodedWireTransaction(await partiallySignTransactionMessageWithSigners(message));
}

/** Real x402 payers, each registered for exactly one testnet. */
async function payers() {
  const account = privateKeyToAccount(generatePrivateKey());
  const signer = await solanaSigner();
  return {
    account, signer,
    evm: new x402Client().register(BASE_SEPOLIA, new ExactEvmScheme(account)),
    svm: new x402Client().register(SOLANA_DEVNET, new ExactSvmScheme(signer)),
  };
}

const offerOf = async (port: ReturnType<typeof createPaymentPort>, error?: string) =>
  decodePaymentRequiredHeader((await port.offer(RESOURCE, error)).header);
const sign = async (client: x402Client, offer: PaymentRequired) =>
  encodePaymentSignatureHeader(await client.createPaymentPayload(offer));
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64");
function tampered(header: string, change: (payload: PaymentPayload) => void) {
  const payload = decodePaymentSignatureHeader(header);
  change(payload);
  return encodePaymentSignatureHeader(payload);
}
const authorizationOf = (header: string) =>
  decodePaymentSignatureHeader(header).payload.authorization as Record<string, string>;

function presented(result: PresentedPayment | { invalid: string }) {
  if ("invalid" in result) assert.fail(`Unexpected refusal: ${result.invalid}`);
  return result;
}
async function assertRefusals(
  port: ReturnType<typeof createPaymentPort>,
  cases: [name: string, header: string, refusal: RegExp, resource?: ResourceInfo][],
) {
  for (const [name, header, refusal, resource = RESOURCE] of cases) {
    const result = await port.present(header, resource);
    assert("invalid" in result, `${name} should be refused`);
    assert.match(result.invalid, refusal, name);
  }
}

test("offer() advertises Solana devnet then Base Sepolia at 1.00 test USDC, with a fresh memo each time", async (t) => {
  offline(t);
  const { port, facilitator } = seller();
  const first = await port.offer(RESOURCE);
  const offered = decodePaymentRequiredHeader(first.header);
  assert.deepEqual(offered, JSON.parse(JSON.stringify(first.body)));
  assert.equal(offered.x402Version, 2);
  assert.equal(offered.error, undefined);
  assert.equal(offered.extensions, undefined);
  assert.deepEqual(offered.resource, RESOURCE);
  const memo = offered.accepts[0].extra.memo;
  assert.match(String(memo), MEMO_PATTERN);
  assert.deepEqual(offered.accepts, [
    {
      scheme: "exact", network: SOLANA_DEVNET, amount: "1000000", asset: TESTNET_USDC[SOLANA_DEVNET],
      payTo: PAY_TO[SOLANA_DEVNET], maxTimeoutSeconds: 120, extra: { memo, feePayer: FEE_PAYER },
    },
    {
      scheme: "exact", network: BASE_SEPOLIA, amount: "1000000", asset: TESTNET_USDC[BASE_SEPOLIA],
      payTo: PAY_TO[BASE_SEPOLIA], maxTimeoutSeconds: 120, extra: { name: "USDC", version: "2" },
    },
  ]);

  const again = await offerOf(port, "Only x402 version 2 payments are accepted.");
  assert.equal(again.error, "Only x402 version 2 payments are accepted.");
  assert.match(String(again.accepts[0].extra.memo), MEMO_PATTERN);
  assert.notEqual(again.accepts[0].extra.memo, memo);
  assert.deepEqual(again.accepts[1], offered.accepts[1]);
  assert.equal(facilitator.calls.supported, 1);
  assert.deepEqual([facilitator.calls.verify.length, facilitator.calls.settle.length], [0, 0]);
});

test("present() reads real client-signed payments on both networks without contacting the facilitator", async (t) => {
  const rpc = offline(t);
  const { port, facilitator } = seller();
  const { account, signer, evm, svm } = await payers();
  const offer = await offerOf(port);

  const evmHeader = await sign(evm, offer);
  const authorization = authorizationOf(evmHeader);
  assert.equal(authorization.from, account.address);
  const base = presented(await port.present(evmHeader, RESOURCE));
  assert.deepEqual(base, {
    network: BASE_SEPOLIA,
    key: { network: BASE_SEPOLIA, payer: account.address.toLowerCase(), nonce: authorization.nonce.toLowerCase() },
    payer: account.address,
    validUntil: new Date(Number(authorization.validBefore) * 1000).toISOString(),
    payTo: PAY_TO[BASE_SEPOLIA],
    asset: TESTNET_USDC[BASE_SEPOLIA],
    amount: "1000000",
    payloadDigest: base.payloadDigest,
    payload: decodePaymentSignatureHeader(evmHeader),
    requirement: offer.accepts[1],
  });

  const svmHeader = await sign(svm, offer);
  assert.deepEqual(rpc, ["getAccountInfo", "getLatestBlockhash"]);
  const solana = presented(await port.present(svmHeader, RESOURCE));
  assert.deepEqual(solana, {
    network: SOLANA_DEVNET,
    key: { network: SOLANA_DEVNET, memo: offer.accepts[0].extra.memo },
    // The transfer authority, i.e. the client's own signer; the facilitator pays the fee.
    payer: signer.address,
    validUntil: null,
    payTo: PAY_TO[SOLANA_DEVNET],
    asset: TESTNET_USDC[SOLANA_DEVNET],
    amount: "1000000",
    payloadDigest: solana.payloadDigest,
    payload: decodePaymentSignatureHeader(svmHeader),
    requirement: offer.accepts[0],
  });

  // The digest identifies the signed payload: stable across presentations and key order, distinct per payment.
  for (const [header, payment] of [[evmHeader, base], [svmHeader, solana]] as const) {
    assert.match(payment.payloadDigest, /^[a-f0-9]{64}$/);
    assert.equal(presented(await port.present(header, RESOURCE)).payloadDigest, payment.payloadDigest);
    const reordered = Object.fromEntries(Object.entries(decodePaymentSignatureHeader(header)).reverse());
    assert.equal(presented(await port.present(encode(reordered), RESOURCE)).payloadDigest, payment.payloadDigest);
  }
  assert.notEqual(
    presented(await port.present(await sign(evm, offer), RESOURCE)).payloadDigest,
    base.payloadDigest,
  );
  assert.equal(facilitator.calls.supported, 1);
  assert.deepEqual([facilitator.calls.verify.length, facilitator.calls.settle.length], [0, 0]);
});

test("present() refuses undecodable, non-v2, unoffered and misdirected payments", async (t) => {
  offline(t);
  const { port, facilitator } = seller();
  const { evm, svm } = await payers();
  const offer = await offerOf(port);
  const evmHeader = await sign(evm, offer);
  const svmHeader = await sign(svm, offer);
  await assertRefusals(port, [
    ["not base64", "not base64!!", /could not be decoded/],
    ["truncated JSON", "eyJ4", /could not be decoded/],
    ["empty", "", /could not be decoded/],
    ["an empty object", encode({}), /version 2/],
    ["a v1 payload", encode({ x402Version: 1, scheme: "exact", network: "base-sepolia", payload: decodePaymentSignatureHeader(evmHeader).payload }), /version 2/],
    // Core matches v1 payloads on scheme and network alone, so a v1 label must never reach matching.
    ["a v2 body relabelled v1 with a lower amount", tampered(evmHeader, (p) => { p.x402Version = 1; p.accepted.amount = "1"; }), /version 2/],
    ["Base mainnet", tampered(evmHeader, (p) => { p.accepted.network = "eip155:8453"; }), /not offered/],
    ["Solana mainnet", tampered(svmHeader, (p) => { p.accepted.network = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"; }), /not offered/],
    ["another scheme", tampered(evmHeader, (p) => { p.accepted.scheme = "upto"; }), /not offered/],
    ["another room's funding link", evmHeader, /different funding link/, resourceFor(OTHER_REF)],
    ["another room's funding link (Solana)", svmHeader, /different funding link/, resourceFor(OTHER_REF)],
    ["no echoed resource", tampered(svmHeader, (p) => { delete p.resource; }), /different funding link/],
    ["an unparseable resource", tampered(evmHeader, (p) => { p.resource = { url: "not a url" }; }), /different funding link/],
  ]);

  // A seller configured only for Solana offers Solana alone and refuses a Base Sepolia payment.
  const solanaOnly = seller({ ...fundingConfig(), payTo: { [SOLANA_DEVNET]: PAY_TO[SOLANA_DEVNET] } });
  assert.deepEqual((await offerOf(solanaOnly.port)).accepts.map((accept) => accept.network), [SOLANA_DEVNET]);
  await assertRefusals(solanaOnly.port, [["unconfigured Base Sepolia", evmHeader, /not offered/]]);
  for (const { calls } of [facilitator, solanaOnly.facilitator])
    assert.deepEqual([calls.verify.length, calls.settle.length], [0, 0]);
});

test("present() refuses Base Sepolia payments that are not exactly this offer's EIP-3009 authorization", async (t) => {
  offline(t);
  let clock = Date.now();
  const { port, facilitator } = seller(fundingConfig(), () => clock);
  const { evm } = await payers();
  const offer = await offerOf(port);
  const base = offer.accepts[1];
  // Signs against an altered offer but echoes the genuine one, so only the signed authorization differs.
  const signedAgainst = async (alter: (requirement: PaymentRequirements) => void) => {
    const altered = structuredClone(base);
    alter(altered);
    return tampered(await sign(evm, { ...offer, accepts: [altered] }), (p) => { p.accepted = base; });
  };

  const permit2 = await signedAgainst((requirement) => { requirement.extra.assetTransferMethod = "permit2"; });
  assert.deepEqual(Object.keys(decodePaymentSignatureHeader(permit2).payload).sort(), ["permit2Authorization", "signature"]);
  const genuine = await sign(evm, offer);
  await assertRefusals(port, [
    ["a Permit2 authorization", permit2, /EIP-3009/],
    // The facilitator routes on the presence of permit2Authorization, so a hybrid must be refused too.
    ["EIP-3009 with a Permit2 rider", tampered(genuine, (p) => {
      p.payload.permit2Authorization = decodePaymentSignatureHeader(permit2).payload.permit2Authorization;
    }), /EIP-3009/],
    ["no signature", tampered(genuine, (p) => { delete p.payload.signature; }), /EIP-3009/],
    ["a malformed nonce", tampered(genuine, (p) => { (p.payload.authorization as Record<string, string>).nonce = "0x01"; }), /EIP-3009/],
    ["an authorization to another payee", await signedAgainst((requirement) => {
      requirement.payTo = privateKeyToAccount(generatePrivateKey()).address;
    }), /does not pay this offer/],
    ["an authorization for 0.999999 USDC", await signedAgainst((requirement) => { requirement.amount = "999999"; }), /does not pay this offer/],
  ]);

  // The validity window is checked against the port's clock: validAfter <= now and now + 6 <= validBefore <= now + 150.
  // Outside it the payment is still identified but marked stale, so a recorded one can get its stored outcome.
  const validBefore = Number(authorizationOf(genuine).validBefore);
  const at = (seconds: number) => { clock = seconds * 1000; };
  const stale = "The authorization's validity window does not match this offer.";
  at(validBefore - 120);
  const inWindow = presented(await port.present(genuine, RESOURCE));
  for (const [now, accepted] of [
    [validBefore - 120, true], [validBefore - 150, true], [validBefore - 151, false],
    [validBefore - 6, true], [validBefore - 5, false], [validBefore + 60, false],
  ] as const) {
    at(now);
    const result = presented(await port.present(genuine, RESOURCE));
    assert.deepEqual(result, accepted ? inWindow : { ...inWindow, stale }, `validBefore - now = ${validBefore - now}s`);
  }
  at(validBefore - 120);
  const startingAt = (seconds: number) => tampered(genuine, (p) => {
    (p.payload.authorization as Record<string, string>).validAfter = String(seconds);
  });
  assert.equal("stale" in presented(await port.present(startingAt(validBefore - 120), RESOURCE)), false);
  assert.equal(presented(await port.present(startingAt(validBefore - 119), RESOURCE)).stale, stale, "validAfter in the future");
  assert.deepEqual([facilitator.calls.verify.length, facilitator.calls.settle.length], [0, 0]);
});

test("present() refuses Solana transactions that do not carry this offer's memo and transfer", async (t) => {
  offline(t);
  const { port, facilitator } = seller();
  const { signer, svm } = await payers();
  const offer = await offerOf(port);
  const solana = offer.accepts[0];
  const genuine = await sign(svm, offer);

  // Hand-built shapes the client never produces; the first is accepted, so each refusal isolates one difference.
  const memo = String(solana.extra.memo);
  const carrying = async (memos: string[], options?: { mint?: string; transfers?: number; extraTransferTo?: string }) => {
    const transaction = await handBuiltTransaction(signer, solana.payTo, memos, options);
    return tampered(genuine, (p) => { p.payload.transaction = transaction; });
  };
  assert.equal(presented(await port.present(await carrying([memo]), RESOURCE)).payer, signer.address);
  await assertRefusals(port, [
    ["two transfers", await carrying([memo], { transfers: 2 }), /does not pay this offer/],
    ["two memos", await carrying([memo, memo]), /does not pay this offer/],
    ["no memo instruction", await carrying([]), /does not pay this offer/],
    ["another mint into this offer's token account", await carrying([memo], { mint: WRAPPED_SOL }), /does not pay this offer/],
    ["an extra plain SPL transfer elsewhere", await carrying([memo], { extraTransferTo: (await solanaSigner()).address }), /does not pay this offer/],
  ]);

  // An offer from another seller's configuration pays another token account.
  const elsewhere = seller({ ...fundingConfig(), payTo: { [SOLANA_DEVNET]: (await solanaSigner()).address } });
  const paysElsewhere = await sign(svm, await offerOf(elsewhere.port));
  const underpaid = tampered(await sign(svm, { ...offer, accepts: [{ ...solana, amount: "999999" }] }), (p) => {
    p.accepted = solana;
  });
  await assertRefusals(port, [
    ["the memo changed after signing", tampered(genuine, (p) => { p.accepted.extra.memo = randomBytes(16).toString("hex"); }), /does not pay this offer/],
    ["a memo that is not 32 lowercase hex", tampered(genuine, (p) => { p.accepted.extra.memo = "0123456789ABCDEF0123456789ABCDEF"; }), /malformed/],
    ["no memo", tampered(genuine, (p) => { delete p.accepted.extra.memo; }), /malformed/],
    ["no transaction", tampered(genuine, (p) => { p.payload = {}; }), /malformed/],
    ["an oversized transaction", tampered(genuine, (p) => { p.payload.transaction = "A".repeat(1704); }), /malformed/],
    ["an undecodable transaction", tampered(genuine, (p) => { p.payload.transaction = "AAAA"; }), /could not be decoded/],
    ["a transfer to another seller", paysElsewhere, /does not pay this offer/],
    ["a transfer to another seller echoing this offer", tampered(paysElsewhere, (p) => { p.accepted.payTo = solana.payTo; }), /does not pay this offer/],
    ["a transfer of 0.999999 USDC", underpaid, /does not pay this offer/],
  ]);
  presented(await port.present(genuine, RESOURCE));
  for (const { calls } of [facilitator, elsewhere.facilitator])
    assert.deepEqual([calls.verify.length, calls.settle.length], [0, 0]);
});

test("present() refuses a payment whose echoed requirement differs from the rebuilt offer", async (t) => {
  offline(t);
  const { port, facilitator } = seller();
  const { evm, svm } = await payers();
  const offer = await offerOf(port);
  const evmHeader = await sign(evm, offer);
  const svmHeader = await sign(svm, offer);
  await assertRefusals(port, [
    ["Base Sepolia maxTimeoutSeconds", tampered(evmHeader, (p) => { p.accepted.maxTimeoutSeconds = 121; }), /does not match/],
    ["Solana maxTimeoutSeconds", tampered(svmHeader, (p) => { p.accepted.maxTimeoutSeconds = 121; }), /does not match/],
    ["the EIP-712 token name", tampered(evmHeader, (p) => { p.accepted.extra.name = "NotUSDC"; }), /does not match/],
    ["the payee's checksum casing", tampered(evmHeader, (p) => { p.accepted.payTo = p.accepted.payTo.toLowerCase(); }), /does not match/],
    ["an added requirement field", tampered(evmHeader, (p) => { Object.assign(p.accepted, { note: "free" }); }), /does not match/],
    ["another fee payer", tampered(svmHeader, (p) => { p.accepted.extra.feePayer = PAY_TO[SOLANA_DEVNET]; }), /does not match/],
  ]);
  assert.deepEqual([facilitator.calls.verify.length, facilitator.calls.settle.length], [0, 0]);
});

test("verify() sends the rebuilt requirement to the facilitator and checks the payer it reports", async (t) => {
  offline(t);
  const { port, facilitator } = seller();
  const { account, signer, evm, svm } = await payers();
  const offer = await offerOf(port);
  const base = presented(await port.present(await sign(evm, offer), RESOURCE));
  const solana = presented(await port.present(await sign(svm, offer), RESOURCE));
  const cases: [PresentedPayment, VerifyResponse, Verification][] = [
    [base, { isValid: false, invalidReason: "invalid_exact_evm_signature", payer: account.address }, { valid: false, reason: "invalid_exact_evm_signature" }],
    [base, { isValid: false }, { valid: false, reason: "invalid_payment" }],
    [base, { isValid: true, payer: privateKeyToAccount(generatePrivateKey()).address }, { valid: false, reason: "payer_mismatch" }],
    // EVM addresses compare case-insensitively; the payload's own casing is kept.
    [base, { isValid: true, payer: account.address.toLowerCase() }, { valid: true, payer: account.address }],
    [base, { isValid: true }, { valid: true, payer: account.address }],
    [solana, { isValid: false, invalidReason: "invalid_exact_svm_payload_memo_mismatch" }, { valid: false, reason: "invalid_exact_svm_payload_memo_mismatch" }],
    [solana, { isValid: true, payer: FEE_PAYER }, { valid: false, reason: "payer_mismatch" }],
    [solana, { isValid: true, payer: signer.address }, { valid: true, payer: signer.address }],
  ];
  for (const [payment, answer, expected] of cases) {
    facilitator.script.verify.push(answer);
    assert.deepEqual(await port.verify(payment), expected);
  }
  // The facilitator gets the signed payload and the rebuilt requirement, never the room's funding link.
  assert.deepEqual(
    facilitator.calls.verify.map(({ payload, requirements }) => [payload, requirements]),
    cases.map(([payment]) => [sentToFacilitator(payment.payload), payment.requirement]),
  );
  for (const call of facilitator.calls.verify) assert(!JSON.stringify(call).includes(REF));
  assert(JSON.stringify(base.payload).includes(REF), "the presented payment keeps the full signed payload");
  // The Solana memo travels in the requirement, so the facilitator enforces it.
  assert.equal(facilitator.calls.verify.at(-1)?.requirements.extra.memo, offer.accepts[0].extra.memo);

  facilitator.script.verify.push(new Error("facilitator unreachable"));
  await assert.rejects(port.verify(base), /facilitator unreachable/);
  assert.equal(facilitator.calls.settle.length, 0);
});

test("settle() reports settled only for a confirmed success, failed only for a malformed request, otherwise pending", async (t) => {
  offline(t);
  const { port, facilitator } = seller();
  const { account, signer, evm, svm } = await payers();
  const offer = await offerOf(port);
  const base = presented(await port.present(await sign(evm, offer), RESOURCE));
  const solana = presented(await port.present(await sign(svm, offer), RESOURCE));
  const evmSuccess: SettleResponse = { success: true, transaction: EVM_TX, network: BASE_SEPOLIA, payer: account.address };
  const svmSuccess: SettleResponse = { success: true, transaction: SOLANA_TX, network: SOLANA_DEVNET, payer: signer.address };
  const pending: SettleResponse = {
    success: false, errorReason: "settlement_pending", errorMessage: "receipt wait timed out",
    transaction: EVM_TX, network: BASE_SEPOLIA, payer: account.address,
  };
  const failure = (errorReason?: string): SettleResponse =>
    ({ success: false, ...(errorReason ? { errorReason } : {}), transaction: "", network: BASE_SEPOLIA });
  const settled = (response: SettleResponse) => ({ kind: "settled", transaction: response.transaction, response });
  const cases: [string, PresentedPayment, Step<SettleResponse>[], Settlement | ReturnType<typeof settled>, number][] = [
    ["Base Sepolia success", base, [evmSuccess], settled(evmSuccess), 1],
    ["Solana success", solana, [svmSuccess], settled(svmSuccess), 1],
    ["success on another network", base, [{ ...evmSuccess, network: SOLANA_DEVNET }], { kind: "pending", transaction: EVM_TX, reason: "unconfirmed" }, 1],
    ["success with a malformed hash", base, [{ ...evmSuccess, transaction: "0x1234" }], { kind: "pending", transaction: "0x1234", reason: "unconfirmed" }, 1],
    ["success with an EVM hash for Solana", solana, [{ ...svmSuccess, transaction: EVM_TX }], { kind: "pending", transaction: EVM_TX, reason: "unconfirmed" }, 1],
    ["success without a transaction", base, [{ ...evmSuccess, transaction: "" }], { kind: "pending", transaction: null, reason: "unconfirmed" }, 1],
    // The SDK retries settlement_pending exactly once when it carries a transaction.
    ["pending twice", base, [pending, pending], { kind: "pending", transaction: EVM_TX, reason: "settlement_pending" }, 2],
    ["pending, then success", base, [pending, evmSuccess], settled(evmSuccess), 2],
    ["pending without a transaction", base, [{ ...pending, transaction: "" }], { kind: "pending", transaction: null, reason: "settlement_pending" }, 1],
    ["a definite-looking failure", base, [failure("invalid_exact_evm_nonce_already_used")], { kind: "pending", transaction: null, reason: "invalid_exact_evm_nonce_already_used" }, 1],
    // A retry served by another facilitator instance can lose the first attempt's hash.
    ["pending, then a definite-looking failure", base, [pending, failure("invalid_exact_evm_nonce_already_used")], { kind: "pending", transaction: null, reason: "invalid_exact_evm_nonce_already_used" }, 2],
    ["a failure without a reason", base, [failure()], { kind: "pending", transaction: null, reason: "unconfirmed" }, 1],
    ["a timeout", base, [new FacilitatorTimeoutError("settle", 90_000)], { kind: "pending", transaction: null, reason: "FacilitatorTimeoutError" }, 1],
    ["a network failure", solana, [new TypeError("fetch failed")], { kind: "pending", transaction: null, reason: "TypeError" }, 1],
    ["a facilitator 500", base, [new SettleError(500, failure("unexpected_error"))], { kind: "pending", transaction: null, reason: "SettleError" }, 1],
    ["a thrown pending, twice", base, [new SettleError(500, pending), new SettleError(500, pending)], { kind: "pending", transaction: EVM_TX, reason: "SettleError" }, 2],
    ["a 400 that is not a malformed request", base, [new SettleError(400, failure("invalid_exact_evm_signature"))], { kind: "pending", transaction: null, reason: "SettleError" }, 1],
    ["a malformed request", base, [new SettleError(400, failure("invalid_json"))], { kind: "failed", reason: "invalid_json" }, 1],
    ["missing parameters", solana, [new SettleError(400, failure("missing_parameters"))], { kind: "failed", reason: "missing_parameters" }, 1],
  ];
  for (const [name, payment, steps, expected, attempts] of cases) {
    facilitator.calls.settle.length = 0;
    facilitator.script.settle.push(...steps);
    const result = await port.settle(payment);
    if (result.kind === "settled") {
      const { header, ...rest } = result;
      assert.deepEqual(rest, expected, name);
      assert.deepEqual(decodePaymentResponseHeader(header), result.response, name);
      assert.equal(decodePaymentResponseHeader(header).transaction, result.transaction, name);
    } else assert.deepEqual(result, expected, name);
    assert.equal(facilitator.calls.settle.length, attempts, `${name}: settle attempts`);
    assert.equal(facilitator.script.settle.length, 0, `${name}: unused answers`);
    for (const call of facilitator.calls.settle) {
      assert.deepEqual(call.payload, sentToFacilitator(payment.payload), name);
      assert.equal(call.requirements, payment.requirement, name);
      assert(!JSON.stringify(call).includes(REF), name);
    }
  }
  // Settlement, like verification, carries the Solana memo in the requirement.
  assert.equal((solana.requirement as PaymentRequirements).extra.memo, offer.accepts[0].extra.memo);
  assert.equal(facilitator.calls.verify.length, 0);
});

test("the facilitator's supported kinds load once, and a failed load is retried by the next request", async (t) => {
  offline(t);
  const warnings = t.mock.method(console, "warn", () => {});
  const { port, facilitator } = seller();
  facilitator.script.supported.push(new Error("facilitator unreachable"));
  await assert.rejects(port.offer(RESOURCE), /Failed to initialize/);
  assert.equal(warnings.mock.callCount(), 1);
  const offers = [await offerOf(port)];
  offers.push(...await Promise.all([offerOf(port), offerOf(port), offerOf(port, "retry")]));
  const { evm } = await payers();
  presented(await port.present(await sign(evm, offers[0]), RESOURCE));
  assert.equal(facilitator.calls.supported, 2);
  assert.equal(new Set(offers.map((offer) => offer.accepts[0].extra.memo)).size, offers.length);

  // Concurrent first requests share one load.
  const fresh = seller();
  await Promise.all([offerOf(fresh.port), offerOf(fresh.port), offerOf(fresh.port)]);
  assert.equal(fresh.facilitator.calls.supported, 1);
});

for (const [network, name] of [[SOLANA_DEVNET, "Solana devnet"], [BASE_SEPOLIA, "Base Sepolia"]] as const) {
  test(`a ${name} payment goes through the route once: offer, sign, verify, settle, credit, replay`, async (t) => {
    const rpc = offline(t);
    const storage = memoryStore(), ledger = memoryLedger();
    const { port, facilitator } = seller();
    const deps: FundingDeps = {
      config: fundingConfig(), payments: port, store: storage.store, ledger: ledger.ledger,
      now: () => new Date("2026-10-12T12:00:00.000Z"),
    };
    const { account, signer, evm, svm } = await payers();

    const unpaid = await handleFunding(fundingRequest(), REF, deps);
    assert.equal(unpaid.status, 402);
    assert.equal(storage.objects.size, 0);
    const client = new x402HTTPClient(network === SOLANA_DEVNET ? svm : evm);
    const required = client.getPaymentRequiredResponse((name) => unpaid.headers.get(name), await unpaid.json());
    const payload = await client.createPaymentPayload(required);
    assert.equal(payload.accepted.network, network);
    const header = client.encodePaymentSignatureHeader(payload)["PAYMENT-SIGNATURE"];
    const paidRequest = () => fundingRequest(REF, undefined, { headers: { "payment-signature": header } });
    const payer = network === SOLANA_DEVNET ? signer.address : account.address;
    const transaction = network === SOLANA_DEVNET ? SOLANA_TX : EVM_TX;
    assert.deepEqual(rpc, network === SOLANA_DEVNET ? ["getAccountInfo", "getLatestBlockhash"] : []);

    facilitator.script.verify.push({ isValid: true, payer });
    facilitator.script.settle.push({ success: true, transaction, network, payer });
    const paid = await handleFunding(paidRequest(), REF, deps);
    assert.equal(paid.status, 200);
    const body = await paid.json();
    assert.deepEqual(
      [body.status, body.added, body.replayed, body.network, body.transaction],
      ["credited", 5, false, network, transaction],
    );
    const paymentResponse = paid.headers.get("PAYMENT-RESPONSE");
    assert.deepEqual(decodePaymentResponseHeader(paymentResponse ?? ""), { success: true, transaction, network, payer });

    // The facilitator saw the signed payload and the offer it accepted (memo included on Solana), but never the
    // room's funding reference: only resource.url differs, and only the record keeps the full payload.
    for (const call of [...facilitator.calls.verify, ...facilitator.calls.settle]) {
      assert.deepEqual(call.payload, sentToFacilitator(decodePaymentSignatureHeader(header)));
      assert.deepEqual(call.requirements, payload.accepted);
      assert(!JSON.stringify(call).includes(REF), `${network}: the facilitator saw the funding reference`);
    }
    const key: IntentKey = network === SOLANA_DEVNET
      ? { network, memo: String(payload.accepted.extra.memo) }
      : { network, payer: account.address.toLowerCase(), nonce: authorizationOf(header).nonce.toLowerCase() };
    const paths = recordPaths(intentId(key), "lighthouse");
    const intent = storage.json(paths.intent), receipt = storage.json(paths.receipt);
    assert.deepEqual([intent.roomId, intent.payer, intent.requirement], ["lighthouse", payer, payload.accepted]);
    assert.deepEqual(intent.payload, decodePaymentSignatureHeader(header));
    assert.equal(receipt.transaction, transaction);
    assert.equal(receipt.source, "route");
    assert.equal(receipt.paymentResponse, paymentResponse);
    assert.equal(receipt.refillRequestId, refillRequestId(network, transaction));
    assert.deepEqual([...ledger.refills.keys()], [refillRequestId(network, transaction)]);
    assert.equal(ledger.rooms.lighthouse.deliveryLimit, 5);

    const replayed = await handleFunding(paidRequest(), REF, deps);
    assert.equal(replayed.status, 200);
    assert.equal((await replayed.json()).replayed, true);
    assert.equal(replayed.headers.get("PAYMENT-RESPONSE"), paymentResponse);
    assert.deepEqual([facilitator.calls.verify.length, facilitator.calls.settle.length], [1, 1]);
    assert.equal(ledger.calls.filter((call) => call.startsWith("refill")).length, 1);
    assert.equal(ledger.rooms.lighthouse.deliveryLimit, 5);
  });
}

test("a Base Sepolia payment re-sent after its validity window gets its stored outcome, never a fresh offer", async (t) => {
  offline(t);
  let clock = Date.now();
  const storage = memoryStore(), ledger = memoryLedger(), config = fundingConfig(5);
  const { port, facilitator } = seller(config, () => clock);
  const deps: FundingDeps = {
    config, payments: port, store: storage.store, ledger: ledger.ledger, now: () => new Date(clock),
  };
  const { account, evm } = await payers();
  const offer = await offerOf(port);
  const send = (header: string) =>
    handleFunding(fundingRequest(REF, undefined, { headers: { "payment-signature": header } }), REF, deps);
  const signed = async () => { clock = Date.now(); return sign(evm, offer); };
  const afterWindow = (header: string) => { clock = (Number(authorizationOf(header).validBefore) + 60) * 1000; };

  // Credited, then the same header re-sent a minute after validBefore: the receipt answers.
  const credited = await signed();
  facilitator.script.verify.push({ isValid: true, payer: account.address });
  facilitator.script.settle.push({ success: true, transaction: EVM_TX, network: BASE_SEPOLIA, payer: account.address });
  const paid = await send(credited);
  assert.equal(paid.status, 200);
  afterWindow(credited);
  const replayed = await send(credited);
  assert.equal(replayed.status, 200);
  assert.equal((await replayed.json()).replayed, true);
  assert.equal(replayed.headers.get("PAYMENT-RESPONSE"), paid.headers.get("PAYMENT-RESPONSE"));

  // Recorded but unresolved, then re-sent late: it may have settled, so no fresh offer.
  const unresolved = await signed();
  facilitator.script.verify.push({ isValid: true, payer: account.address });
  facilitator.script.settle.push({
    success: false, errorReason: "settlement_pending", transaction: "", network: BASE_SEPOLIA, payer: account.address,
  });
  assert.equal((await send(unresolved)).status, 202);
  afterWindow(unresolved);
  const pending = await send(unresolved);
  assert.equal(pending.status, 202);
  assert.equal(pending.headers.get("PAYMENT-REQUIRED"), null);
  assert.equal((await pending.json()).status, "pending");

  // Never presented and already stale: a fresh offer says why, and nothing is recorded.
  const late = await signed();
  afterWindow(late);
  const refused = await send(late);
  assert.equal(refused.status, 402);
  assert.equal(decodePaymentRequiredHeader(refused.headers.get("PAYMENT-REQUIRED") ?? "").error,
    "The authorization's validity window does not match this offer.");
  assert.equal(storage.paths("x402/intents/").length, 2);
  // One verify and one settle per payment that was in its window when first presented; none for late re-sends.
  assert.deepEqual([facilitator.calls.verify.length, facilitator.calls.settle.length], [2, 2]);
  assert.equal(ledger.refills.size, 1);
});
