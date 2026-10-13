import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { generateKeyPairSigner } from "@solana/kit";
import { decodePaymentRequiredHeader, decodePaymentSignatureHeader, encodePaymentRequiredHeader } from "@x402/core/http";
import type { FacilitatorClient } from "@x402/core/server";
import type { PaymentRequired, PaymentRequirements, SupportedResponse } from "@x402/core/types";
import { verifyTypedData } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { AGENT_TOKEN_HEADER } from "../../src/x402/config.ts";
import { handleFunding } from "../../src/x402/funding.ts";
import { BASE_SEPOLIA, SOLANA_DEVNET, TESTNET_USDC, explorerUrl, recordPaths } from "../../src/x402/ids.ts";
import { createPaymentPort } from "../../src/x402/payment.ts";
import { recordBytes } from "../../src/x402/store.ts";
import { chooseOffer, fundRoom, resumeAttempt, type PayerSigner, type PaymentAttempt } from "../../src/x402/payer.ts";
import { OTHER_REF, PAY_TO, REF, STEWARD, fundingConfig, memoryLedger, memoryStore } from "./x402-fakes.ts";

// The local agent token setup creates; the test room refuses any request without it, as the route does.
const TOKEN = randomBytes(32).toString("base64url");

const FEE_PAYER = "CKPKJWNdJEqa81x7CkZ14BVPiY6y16Sxs7owznqtWYp5";
// x402.org /supported as read on 2026-10-12, reduced to the two reviewed testnets.
const SUPPORTED: SupportedResponse = {
  kinds: [
    { x402Version: 2, scheme: "exact", network: BASE_SEPOLIA },
    { x402Version: 2, scheme: "exact", network: SOLANA_DEVNET, extra: { feePayer: FEE_PAYER, features: { smartWalletSupported: true } } },
  ],
  extensions: ["builder-code", "eip2612GasSponsoring", "erc20ApprovalGasSponsoring"],
  signers: { "eip155:*": ["0xd407e409E34E0b9afb99EcCeb609bDbcD5e7f1bf"], "solana:*": [FEE_PAYER] },
};
type Authorization = { from: `0x${string}`; to: `0x${string}`; value: string; validAfter: string; validBefore: string; nonce: `0x${string}` };

/** Fails the test on any request that would leave this machine (facilitator, RPC, Supabase). */
function offline(t: TestContext) {
  const real = globalThis.fetch;
  const blocked: string[] = [];
  t.mock.method(globalThis, "fetch", (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === "127.0.0.1") return real(input, init);
    blocked.push(url.host);
    return Promise.reject(new Error(`offline test: blocked ${url.host}`));
  });
  return blocked;
}

async function recordTexts(directory: string): Promise<string[]> {
  const names = (await readdir(directory).catch(() => [] as string[])).filter((name) => name.endsWith(".json")).sort();
  return Promise.all(names.map((name) => readFile(join(directory, name), "utf8")));
}
const records = async (directory: string): Promise<PaymentAttempt[]> =>
  (await recordTexts(directory)).map((text) => JSON.parse(text));

/** The real route state machine and x402 seller on 127.0.0.1, with a stub facilitator and memory fakes. */
async function startRoom(t: TestContext, options: {
  recordDir?: string;
  tamper?: (offer: PaymentRequired) => void;
  dropPaidAnswers?: number;
  verify?: "valid" | "invalid";
  settle?: "success" | "pending";
} = {}) {
  const storage = memoryStore(), ledger = memoryLedger();
  const seen = { agents: [] as (string | null)[], paths: [] as string[], unpaid: 0, paidHeaders: [] as string[], recordsWhenPaid: [] as PaymentAttempt[][], settles: 0 };
  const facilitator: FacilitatorClient = {
    async getSupported() { return structuredClone(SUPPORTED); },
    async verify(payload, requirements) {
      const { authorization, signature } = payload.payload as { authorization: Authorization; signature: `0x${string}` };
      const signed = await verifyTypedData({
        address: authorization.from,
        domain: {
          name: String(requirements.extra.name),
          version: String(requirements.extra.version),
          chainId: 84532,
          verifyingContract: requirements.asset as `0x${string}`,
        },
        types: {
          TransferWithAuthorization: [
            { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
            { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
          ],
        },
        primaryType: "TransferWithAuthorization",
        message: {
          ...authorization,
          value: BigInt(authorization.value),
          validAfter: BigInt(authorization.validAfter),
          validBefore: BigInt(authorization.validBefore),
        },
        signature,
      });
      return signed && options.verify !== "invalid"
        ? { isValid: true, payer: authorization.from }
        : { isValid: false, invalidReason: "invalid_exact_evm_payload_signature", payer: authorization.from };
    },
    async settle(payload, requirements) {
      seen.settles += 1;
      const payer = (payload.payload as { authorization: Authorization }).authorization.from;
      const transaction = `0x${randomBytes(32).toString("hex")}`;
      return options.settle === "pending"
        ? { success: false, errorReason: "settlement_pending", transaction, network: requirements.network, payer }
        : { success: true, transaction, network: requirements.network, payer };
    },
  };
  const config = fundingConfig();
  const deps = { config, payments: createPaymentPort(config, { facilitator }), store: storage.store, ledger: ledger.ledger };
  let drops = options.dropPaidAnswers ?? 0;
  const server = createServer(async (incoming, outgoing) => {
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) if (typeof value === "string") headers.set(name, value);
    seen.agents.push(headers.get(AGENT_TOKEN_HEADER));
    seen.paths.push(incoming.url ?? "");
    for await (const chunk of incoming) assert.equal(chunk.length, 0, "the payer sends empty bodies");
    if (headers.get(AGENT_TOKEN_HEADER) !== TOKEN) {
      outgoing.writeHead(404, { "content-type": "application/json" });
      outgoing.end(JSON.stringify({ error: "Not found." }));
      return;
    }
    const signature = headers.get("payment-signature");
    if (signature) {
      seen.paidHeaders.push(signature);
      seen.recordsWhenPaid.push(options.recordDir ? await records(options.recordDir) : []);
    } else seen.unpaid += 1;
    const request = new Request(`http://${incoming.headers.host}${incoming.url}`, { method: incoming.method, headers });
    let response = await handleFunding(request, decodeURIComponent(incoming.url!.split("/").pop()!), deps);
    const offer = response.headers.get("PAYMENT-REQUIRED");
    if (offer && options.tamper) {
      const required = decodePaymentRequiredHeader(offer);
      options.tamper(required);
      const tampered = new Headers(response.headers);
      tampered.set("PAYMENT-REQUIRED", encodePaymentRequiredHeader(required));
      response = new Response(response.body, { status: response.status, headers: tampered });
    }
    if (signature && drops > 0) {
      drops -= 1;
      incoming.socket.destroy(); // The room handled the payment; its answer never arrives.
      return;
    }
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/api/x402/fund/${REF}`, port, seen, storage, ledger };
}

function evmPayer() {
  const account = privateKeyToAccount(generatePrivateKey());
  const counter = { signatures: 0 };
  const payer: PayerSigner = {
    network: BASE_SEPOLIA,
    signer: {
      address: account.address,
      async signTypedData(message) {
        counter.signatures += 1;
        return account.signTypedData(message as never);
      },
    },
  };
  return { payer, counter, address: account.address };
}

async function scratch(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "x402-payer-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, recordDir: join(directory, "payments") };
}

test("an agent funds a room once: offer, hygiene, one signature, a durable record before sending, then credit", async (t) => {
  const blocked = offline(t);
  const { recordDir } = await scratch(t);
  const room = await startRoom(t, { recordDir });
  const { payer, counter, address } = evmPayer();
  const summary = await fundRoom({ ...payer, agentToken: TOKEN, url: room.url, recordDir, expected: { payTo: PAY_TO[BASE_SEPOLIA] } });

  assert.equal(summary.status, 200);
  assert.equal(summary.outcome, "credited");
  assert.equal(summary.network, BASE_SEPOLIA);
  assert.match(summary.transaction ?? "", /^0x[0-9a-f]{64}$/);
  assert.equal(summary.explorerUrl, explorerUrl(BASE_SEPOLIA, summary.transaction!));
  assert.deepEqual(summary.credits, { added: 5, replayed: false, room: { limit: 5 } });
  assert.match(summary.message, /credited with 5 test credits/);
  assert.equal(counter.signatures, 1);
  assert.equal(room.seen.unpaid, 1);
  assert.equal(room.seen.paidHeaders.length, 1);
  assert.equal(room.seen.settles, 1);
  assert.equal(room.ledger.rooms.lighthouse.deliveryLimit, 5);

  // The signed payment was on disk, unsent, when the paid request reached the room.
  const [beforeSend] = room.seen.recordsWhenPaid;
  assert.equal(beforeSend.length, 1);
  assert.equal(beforeSend[0].state, "signed");
  assert.equal(beforeSend[0].header, room.seen.paidHeaders[0]);

  const [record] = await records(recordDir);
  assert.equal(summary.recordFile, join(recordDir, (await readdir(recordDir))[0]));
  assert.match(summary.recordFile!, /\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-base-sepolia\.json$/);
  assert.equal((await stat(summary.recordFile!)).mode & 0o777, 0o600);
  assert.equal((await stat(recordDir)).mode & 0o777, 0o700);
  assert.equal(record.state, "credited");
  assert.equal(record.lastStatus, 200);
  assert.equal(record.url, room.url);
  assert.equal(record.payer, address);
  assert.match(record.evmNonce ?? "", /^0x[0-9a-f]{64}$/);
  assert.equal(record.settlement?.success, true);
  assert.equal(record.settlement?.transaction, summary.transaction);
  const sent = decodePaymentSignatureHeader(record.header);
  assert.equal(sent.accepted.network, BASE_SEPOLIA);
  assert.equal(sent.accepted.amount, "1000000");
  const authorization = sent.payload.authorization as Authorization;
  assert.equal(authorization.nonce, record.evmNonce);
  assert.equal(authorization.validBefore, record.validBefore);
  assert.equal(Number(record.validBefore) - Math.floor(Date.parse(record.createdAt) / 1000) <= 121, true);
  assert.deepEqual(blocked, []);
});

test("a lost answer is re-sent with the identical header and replayed, never re-signed or settled twice", async (t) => {
  const blocked = offline(t);
  const { recordDir } = await scratch(t);
  const room = await startRoom(t, { recordDir, dropPaidAnswers: 1 });
  const { payer, counter } = evmPayer();
  const lost = await fundRoom({ ...payer, agentToken: TOKEN, url: room.url, recordDir });
  assert.equal(lost.outcome, "unknown");
  assert.equal(lost.status, null);
  assert.match(lost.message, /fetch failed/);
  assert.match(lost.message, new RegExp(`--resume ${lost.recordFile!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(lost.message, /do not sign a new one/);
  assert.equal((await records(recordDir))[0].state, "unknown");
  assert.equal(room.seen.settles, 1, "the room settled and credited the first send");

  const resumed = await resumeAttempt(lost.recordFile!, { agentToken: TOKEN });
  assert.equal(resumed.status, 200);
  assert.equal(resumed.outcome, "credited");
  assert.equal(resumed.credits?.replayed, true);
  assert.match(resumed.message, /nothing settled twice/);
  assert.equal(room.seen.paidHeaders.length, 2);
  assert.equal(room.seen.paidHeaders[0], room.seen.paidHeaders[1]);
  assert.equal(room.seen.paidHeaders[0], (await records(recordDir))[0].header);
  assert.equal(counter.signatures, 1);
  assert.equal(room.seen.settles, 1);
  assert.equal(room.ledger.refills.size, 1);
  const [record] = await records(recordDir);
  assert.equal(record.state, "credited");
  assert.equal(record.sends, 2);

  await assert.rejects(resumeAttempt(lost.recordFile!, { agentToken: TOKEN }), /already credited/);
  assert.equal(room.seen.paidHeaders.length, 2);
  assert.deepEqual(blocked, []);
});

test("a room that refuses, an unknown link and a stopped server are never signed for", async (t) => {
  offline(t);
  const { recordDir } = await scratch(t);
  const room = await startRoom(t, { recordDir });
  room.ledger.rooms.lighthouse.open = false;
  const { payer, counter } = evmPayer();
  const summary = await fundRoom({ ...payer, agentToken: TOKEN, url: room.url, recordDir });
  assert.equal(summary.status, 409);
  assert.equal(summary.outcome, "refused");
  assert.match(summary.message, /not open.*Nothing was signed/);
  assert.equal(summary.recordFile, null);

  const unknown = await fundRoom({ ...payer, agentToken: TOKEN, url: room.url.replace(REF, "ref_unknown_ccccccccccccccc"), recordDir });
  assert.equal(unknown.outcome, "not-offered");
  assert.match(unknown.message, /did not offer a payment \(HTTP 404: Not found\.\)\. Nothing was signed\. Check the funding link, and that the server runs with PILOT_LOCAL_CONTROLS=1 and this machine's agent token\.$/);

  const stopped = createServer();
  stopped.listen(0, "127.0.0.1");
  await once(stopped, "listening");
  const { port } = stopped.address() as AddressInfo;
  await new Promise((resolve) => stopped.close(resolve));
  await assert.rejects(fundRoom({ ...payer, agentToken: TOKEN, url: `http://127.0.0.1:${port}/api/x402/fund/${REF}`, recordDir }),
    /Could not reach .*ECONNREFUSED.*Nothing was signed/);
  await assert.rejects(fundRoom({ ...payer, agentToken: TOKEN, url: `https://example.com/api/x402/fund/${REF}`, recordDir }), /only pays rooms on this machine/);

  assert.equal(counter.signatures, 0);
  assert.deepEqual(room.seen.paidHeaders, []);
  assert.deepEqual(await records(recordDir), []);
});

test("offers that are not the reviewed testnet top-up are declined before signing", async (t) => {
  offline(t);
  const { recordDir } = await scratch(t);
  const onBase = (change: (accept: PaymentRequirements) => void) => (offer: PaymentRequired) =>
    change(offer.accepts.find((accept) => accept.network === BASE_SEPOLIA)!);
  const cases: [string, Parameters<typeof startRoom>[1], { payTo?: string }, RegExp][] = [
    ["another payee", {}, { payTo: "0x000000000000000000000000000000000000dEaD" }, /other than the configured payTo/],
    ["a payee swapped in by the server", { tamper: onBase((accept) => { accept.payTo = "0x000000000000000000000000000000000000dEaD"; }) },
      { payTo: PAY_TO[BASE_SEPOLIA] }, /other than the configured payTo/],
    ["mainnet USDC", { tamper: onBase((accept) => { accept.asset = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; }) }, {}, /not for Circle test USDC/],
    ["more than $1", { tamper: onBase((accept) => { accept.amount = "1000001"; }) }, {}, /at most 1000000/],
    ["a long-lived authorization", { tamper: onBase((accept) => { accept.maxTimeoutSeconds = 86_400; }) }, {}, /payment window/],
    ["a Permit2 transfer", { tamper: onBase((accept) => { accept.extra = { ...accept.extra, assetTransferMethod: "permit2" }; }) }, {}, /EIP-3009/],
    ["Base mainnet", { tamper: onBase((accept) => { accept.network = "eip155:8453"; }) }, {}, /no exact payment on eip155:84532/],
  ];
  for (const [name, roomOptions, expected, message] of cases) {
    const room = await startRoom(t, { recordDir, ...roomOptions });
    const { payer, counter } = evmPayer();
    const summary = await fundRoom({ ...payer, agentToken: TOKEN, url: room.url, recordDir, expected });
    assert.equal(summary.outcome, "declined", name);
    assert.equal(summary.status, 402, name);
    assert.match(summary.message, message, name);
    assert.match(summary.message, /Nothing was signed/, name);
    assert.equal(counter.signatures, 0, name);
    assert.deepEqual(room.seen.paidHeaders, [], name);
  }
  assert.deepEqual(await records(recordDir), []);
});

const MEMO = "0123456789abcdef0123456789abcdef";
const solanaAccept = (change: Partial<PaymentRequirements> = {}, extra: Record<string, unknown> = { feePayer: FEE_PAYER, memo: MEMO }) =>
  ({ scheme: "exact", network: SOLANA_DEVNET, asset: TESTNET_USDC[SOLANA_DEVNET], amount: "1000000",
    payTo: PAY_TO[SOLANA_DEVNET], maxTimeoutSeconds: 120, extra, ...change }) as PaymentRequirements;
const baseAccept = (change: Partial<PaymentRequirements> = {}) =>
  ({ scheme: "exact", network: BASE_SEPOLIA, asset: TESTNET_USDC[BASE_SEPOLIA], amount: "1000000",
    payTo: PAY_TO[BASE_SEPOLIA], maxTimeoutSeconds: 120, extra: { name: "USDC", version: "2" }, ...change }) as PaymentRequirements;
const offerOf = (...accepts: PaymentRequirements[]): PaymentRequired =>
  ({ x402Version: 2, resource: { url: `http://127.0.0.1:3005/api/x402/fund/${REF}` }, accepts });

test("Solana hygiene: the devnet offer must be test USDC, at most $1, to the configured payee, with a seller memo", () => {
  const payee = { payTo: PAY_TO[SOLANA_DEVNET] };
  const valid = solanaAccept();
  assert.deepEqual(chooseOffer(offerOf(baseAccept(), valid), SOLANA_DEVNET, payee), { accept: valid });
  const cheaper = solanaAccept({ amount: "250000" });
  assert.deepEqual(chooseOffer(offerOf(cheaper), SOLANA_DEVNET, payee), { accept: cheaper });
  const elsewhere = solanaAccept({ payTo: "4uxMGnZdLT6Jz2b4FtdBsB77DiobT5WvJsZp68XpGJsA" });
  assert.deepEqual(chooseOffer(offerOf(elsewhere), SOLANA_DEVNET), { accept: elsewhere }, "payTo is checked only when configured");

  const declined: [string, PaymentRequired, RegExp][] = [
    ["x402 v1", { ...offerOf(valid), x402Version: 1 }, /version 2/],
    ["no accepts", { ...offerOf(), accepts: null as unknown as PaymentRequirements[] }, /version 2/],
    ["mainnet only", offerOf(solanaAccept({ network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" })), /no exact payment on solana:EtWT/],
    ["another scheme", offerOf(solanaAccept({ scheme: "upto" })), /no exact payment/],
    ["mainnet USDC", offerOf(solanaAccept({ asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" })), /test USDC/],
    ["mint with changed case", offerOf(solanaAccept({ asset: TESTNET_USDC[SOLANA_DEVNET].toLowerCase() })), /test USDC/],
    ["over the cap", offerOf(solanaAccept({ amount: "1000001" })), /at most 1000000/],
    ["zero", offerOf(solanaAccept({ amount: "0" })), /at most 1000000/],
    ["not an integer", offerOf(solanaAccept({ amount: "1e6" })), /at most 1000000/],
    ["another payee", offerOf(elsewhere), /configured payTo/],
    ["payee with changed case", offerOf(solanaAccept({ payTo: PAY_TO[SOLANA_DEVNET].toLowerCase() })), /configured payTo/],
    ["long window", offerOf(solanaAccept({ maxTimeoutSeconds: 3600 })), /payment window/],
    ["no memo", offerOf(solanaAccept({}, { feePayer: FEE_PAYER })), /seller memo/],
    ["uppercase memo", offerOf(solanaAccept({}, { feePayer: FEE_PAYER, memo: MEMO.toUpperCase() })), /seller memo/],
    ["short memo", offerOf(solanaAccept({}, { feePayer: FEE_PAYER, memo: MEMO.slice(1) })), /seller memo/],
    ["no extra", offerOf(solanaAccept({ extra: undefined as unknown as Record<string, unknown> })), /seller memo/],
  ];
  for (const [name, offer, message] of declined) {
    const result = chooseOffer(offer, SOLANA_DEVNET, payee);
    assert.ok("declined" in result, name);
    assert.match(result.declined, message, name);
  }

  // EVM addresses compare without case; the first exact offer on the network is the one judged.
  const lower = baseAccept({ payTo: PAY_TO[BASE_SEPOLIA].toLowerCase(), asset: TESTNET_USDC[BASE_SEPOLIA].toLowerCase() });
  assert.deepEqual(chooseOffer(offerOf(valid, lower), BASE_SEPOLIA, { payTo: PAY_TO[BASE_SEPOLIA] }), { accept: lower });
  assert.ok("declined" in chooseOffer(offerOf(baseAccept({ amount: "2000000" }), baseAccept()), BASE_SEPOLIA));
});

test("a Solana payer declines a bad devnet offer before signing or contacting any RPC", async (t) => {
  const blocked = offline(t);
  const { recordDir } = await scratch(t);
  const signer = await generateKeyPairSigner();
  for (const [roomOptions, expected, message] of [
    [{}, { payTo: "4uxMGnZdLT6Jz2b4FtdBsB77DiobT5WvJsZp68XpGJsA" }, /configured payTo/],
    [{ tamper: (offer: PaymentRequired) => { offer.accepts.find((accept) => accept.network === SOLANA_DEVNET)!.extra.memo = "fn1.chosen-by-someone-else"; } },
      { payTo: PAY_TO[SOLANA_DEVNET] }, /seller memo/],
  ] as const) {
    const room = await startRoom(t, { recordDir, ...roomOptions });
    const summary = await fundRoom({ network: SOLANA_DEVNET, signer, agentToken: TOKEN, url: room.url, recordDir, expected });
    assert.equal(summary.outcome, "declined");
    assert.match(summary.message, message);
    assert.deepEqual(room.seen.paidHeaders, []);
  }
  assert.deepEqual(await records(recordDir), []);
  assert.deepEqual(blocked, []);
});

test("a pending payment tells the agent not to sign again", async (t) => {
  offline(t);
  const { recordDir } = await scratch(t);
  const { payer, counter } = evmPayer();

  const pendingRoom = await startRoom(t, { recordDir, settle: "pending" });
  const pending = await fundRoom({ ...payer, agentToken: TOKEN, url: pendingRoom.url, recordDir });
  assert.equal(pending.status, 202);
  assert.equal(pending.outcome, "pending");
  assert.match(pending.message, /may still settle: do not sign again; run npm run x402:reconcile\. Signing a new payment is safe once the reconciler marks this one expired\.$/);
  assert.equal(pending.credits, null);
  assert.equal((await records(recordDir))[0].state, "pending");

  const uncreditedRoom = await startRoom(t, { recordDir });
  uncreditedRoom.ledger.failNextRefills(new Error("database unavailable"));
  const uncredited = await fundRoom({ ...payer, agentToken: TOKEN, url: uncreditedRoom.url, recordDir });
  assert.equal(uncredited.status, 202);
  assert.equal(uncredited.outcome, "pending");
  assert.match(uncredited.message, /settled, but the room is not credited yet: do not sign again; run npm run x402:reconcile to credit it\.$/);
  assert.doesNotMatch(uncredited.message, /new payment is safe/, "a settled payment never invites a second one");
  assert.match(uncredited.transaction ?? "", /^0x[0-9a-f]{64}$/);
  assert.equal(uncredited.explorerUrl, explorerUrl(BASE_SEPOLIA, uncredited.transaction!));
  const record = (await records(recordDir)).find((item) => item.lastStatus === 202 && item.settlement);
  assert.equal(record?.settlement?.transaction, uncredited.transaction);
  assert.equal(counter.signatures, 2);
});

test("resume never re-sends a rejected, expired or non-local payment", async (t) => {
  offline(t);
  const { directory, recordDir } = await scratch(t);
  const { payer } = evmPayer();

  const rejectingRoom = await startRoom(t, { recordDir, verify: "invalid" });
  const rejected = await fundRoom({ ...payer, agentToken: TOKEN, url: rejectingRoom.url, recordDir });
  assert.equal(rejected.status, 402);
  assert.equal(rejected.outcome, "rejected");
  assert.match(rejected.message, /rejected this payment \(invalid_exact_evm_payload_signature\)\. It did not settle\./);
  await assert.rejects(resumeAttempt(rejected.recordFile!, { agentToken: TOKEN }), /rejected this payment, so re-sending it cannot succeed\. It did not settle\.$/);
  assert.equal(rejectingRoom.seen.paidHeaders.length, 1);

  const silentRoom = await startRoom(t, { recordDir, dropPaidAnswers: 1 });
  const lost = await fundRoom({ ...payer, agentToken: TOKEN, url: silentRoom.url, recordDir });
  assert.equal(lost.outcome, "unknown");
  const record = JSON.parse(await readFile(lost.recordFile!, "utf8")) as PaymentAttempt;
  const expired = new Date((Number(record.validBefore) - 5) * 1000);
  await assert.rejects(resumeAttempt(lost.recordFile!, { agentToken: TOKEN, now: () => expired }),
    /expired at .*, so re-sending cannot settle it: do not sign again; run npm run x402:reconcile to learn whether it was paid\. Signing a new payment is safe once the reconciler marks this one expired\.$/);

  const elsewhere = join(directory, "elsewhere.json");
  await writeFile(elsewhere, JSON.stringify({ ...record, url: "https://payments.example/api/x402/fund/x" }));
  await assert.rejects(resumeAttempt(elsewhere, { agentToken: TOKEN }), /only pays rooms on this machine/);
  const unsigned = join(directory, "unsigned.json");
  await writeFile(unsigned, JSON.stringify({ ...record, validBefore: undefined }));
  await assert.rejects(resumeAttempt(unsigned, { agentToken: TOKEN }), /No x402 payment record/);
  assert.equal(silentRoom.seen.paidHeaders.length, 1);
});

test("a payment record is never overwritten, and nothing is sent without one", async (t) => {
  offline(t);
  const { recordDir } = await scratch(t);
  const room = await startRoom(t, { recordDir });
  const { payer, counter } = evmPayer();
  const now = () => new Date("2026-10-12T12:00:00.000Z");
  const first = await fundRoom({ ...payer, agentToken: TOKEN, url: room.url, recordDir, now });
  assert.equal(first.outcome, "credited");
  const kept = await readFile(first.recordFile!, "utf8");
  await assert.rejects(fundRoom({ ...payer, agentToken: TOKEN, url: room.url, recordDir, now }), /already exists .*Nothing was sent/);
  assert.equal(counter.signatures, 2, "the second signature was made but never sent");
  assert.equal(room.seen.paidHeaders.length, 1);
  assert.equal(await readFile(first.recordFile!, "utf8"), kept);
  assert.deepEqual(await readdir(recordDir), [first.recordFile!.split("/").pop()]);
});

test("every request carries the local agent token, and no record or summary holds it", async (t) => {
  const blocked = offline(t);
  const { recordDir } = await scratch(t);
  const room = await startRoom(t, { recordDir, dropPaidAnswers: 1 });
  const { payer } = evmPayer();
  const lost = await fundRoom({ ...payer, agentToken: TOKEN, url: room.url, recordDir });
  assert.equal(lost.outcome, "unknown");
  const resumed = await resumeAttempt(lost.recordFile!, { agentToken: TOKEN });
  assert.equal(resumed.outcome, "credited");
  // The unpaid offer request, the paid POST whose answer was lost, and the --resume send.
  assert.deepEqual(room.seen.agents, [TOKEN, TOKEN, TOKEN]);
  assert.equal(room.seen.paidHeaders.length, 2);
  const texts = await recordTexts(recordDir);
  assert.equal(texts.length, 1);
  for (const text of [...texts, JSON.stringify(lost), JSON.stringify(resumed)]) assert.equal(text.includes(TOKEN), false);
  assert.deepEqual(blocked, []);
});

test("without a valid agent token nothing is requested, signed, recorded or re-sent", async (t) => {
  offline(t);
  const { recordDir } = await scratch(t);
  const room = await startRoom(t, { recordDir, dropPaidAnswers: 1 });
  const { payer, counter } = evmPayer();
  for (const agentToken of [undefined as unknown as string, "", "not-a-token", `${TOKEN}A`, `${TOKEN.slice(1)}.`])
    await assert.rejects(fundRoom({ ...payer, agentToken, url: room.url, recordDir }),
      /^Error: No valid local agent token\. Run npm run x402:setup -- init first; nothing was signed\.$/);
  assert.deepEqual(room.seen.agents, []);
  assert.equal(counter.signatures, 0);
  assert.deepEqual(await records(recordDir), []);

  const lost = await fundRoom({ ...payer, agentToken: TOKEN, url: room.url, recordDir });
  assert.equal(lost.outcome, "unknown");
  const kept = await readFile(lost.recordFile!, "utf8");
  await assert.rejects(resumeAttempt(lost.recordFile!, { agentToken: "" }), /Run npm run x402:setup -- init first; nothing was signed\./);
  assert.equal(room.seen.agents.length, 2, "the resume without a token sent nothing");
  assert.equal(await readFile(lost.recordFile!, "utf8"), kept);
});

test("a payment the reconciler marked expired is reported as uncharged, and a new payment is then safe", async (t) => {
  offline(t);
  const { recordDir } = await scratch(t);
  const room = await startRoom(t, { recordDir, settle: "pending" });
  const { payer, counter } = evmPayer();
  const pending = await fundRoom({ ...payer, agentToken: TOKEN, url: room.url, recordDir });
  assert.equal(pending.outcome, "pending");
  const settles = room.seen.settles;

  // reconcile --apply later shows the authorization can no longer settle and writes the marker.
  const [intentPath] = room.storage.paths("x402/intents/");
  const intent = room.storage.json(intentPath);
  await room.storage.store.create(recordPaths(intent.intentId, intent.roomId).expired, recordBytes({
    kind: "fork-night/x402-expired/v1", intentId: intent.intentId, roomId: intent.roomId, network: BASE_SEPOLIA,
    reason: "The authorization expired unused.", evidence: { authorizationState: false }, recordedAt: new Date().toISOString(),
  }));
  const expired = await resumeAttempt(pending.recordFile!, { agentToken: TOKEN });
  assert.equal(expired.status, 402);
  assert.equal(expired.outcome, "expired");
  assert.equal(expired.message, "This payment expired before it settled; nothing was charged. Signing a new payment is safe: run npm run x402:fund again.");
  assert.equal((await records(recordDir))[0].state, "expired");
  await assert.rejects(resumeAttempt(pending.recordFile!, { agentToken: TOKEN }),
    /^Error: This payment expired before it settled; nothing was charged and there is nothing to re-send\. Signing a new payment is safe: run npm run x402:fund again\.$/);
  assert.equal(room.seen.paidHeaders.length, 2);
  assert.equal(room.seen.settles, settles, "the expired payment was not settled again");
  assert.equal(counter.signatures, 1);
});

test("a re-sent payment the room rejects keeps the reconcile advice and says when a new payment is safe", async (t) => {
  offline(t);
  const { recordDir } = await scratch(t);
  const room = await startRoom(t, { recordDir, verify: "invalid", dropPaidAnswers: 1 });
  const { payer } = evmPayer();
  const lost = await fundRoom({ ...payer, agentToken: TOKEN, url: room.url, recordDir });
  assert.equal(lost.outcome, "unknown");
  const rejected = await resumeAttempt(lost.recordFile!, { agentToken: TOKEN });
  assert.equal(rejected.outcome, "rejected");
  assert.match(rejected.message,
    /An earlier send may have reached settlement: do not sign again; run npm run x402:reconcile\. Signing a new payment is safe once the reconciler marks this one expired\.$/);
  await assert.rejects(resumeAttempt(lost.recordFile!, { agentToken: TOKEN }),
    /If an earlier send may have settled, do not sign again; run npm run x402:reconcile\. Signing a new payment is safe once the reconciler marks this one expired\.$/);
  assert.equal(room.seen.paidHeaders.length, 2);
  assert.equal(room.seen.settles, 0);
});

/** A working directory laid out as setup leaves it, and the fund-room CLI run from it, offline. */
async function cliWorkspace(t: TestContext, rooms: Record<string, string>) {
  const { directory } = await scratch(t);
  const local = join(directory, ".local/x402");
  const key = generatePrivateKey();
  const address = privateKeyToAccount(key).address;
  await mkdir(join(local, "wallets"), { recursive: true, mode: 0o700 });
  await writeFile(join(local, "wallets/payer-base-sepolia.json"),
    JSON.stringify({ version: 1, kind: "evm", role: "payer", network: BASE_SEPOLIA, address, privateKey: key }), { mode: 0o600 });
  await writeFile(join(local, "funding.json"), JSON.stringify({
    version: 1, payTo: PAY_TO,
    rooms: Object.fromEntries(Object.entries(rooms).map(([ref, roomId]) => [ref, { roomId, stewardProfileId: STEWARD, maxTopUps: 2 }])),
  }));
  await writeFile(join(local, "agent-token"), `${TOKEN}\n`, { mode: 0o600 });
  const env = { ...process.env };
  for (const name of ["X402_FUNDING_CONFIG", "X402_WALLET_DIR", "X402_AGENT_TOKEN_FILE", "NODE_TEST_CONTEXT"]) delete env[name];
  // The child process gets the same guard: any request off this machine fails the run.
  const guard = `data:text/javascript,${encodeURIComponent(`const real = globalThis.fetch;
    globalThis.fetch = (input, init) => new URL(input instanceof Request ? input.url : String(input)).hostname === "127.0.0.1"
      ? real(input, init) : Promise.reject(new Error("offline test: blocked"));`)}`;
  const cli = (...args: string[]) => promisify(execFile)(process.execPath,
    ["--import", guard, fileURLToPath(new URL("../../scripts/x402-fund-room.ts", import.meta.url)), ...args], { cwd: directory, env });
  return { local, key, address, cli };
}
const failsWith = (pattern: RegExp) => (error: { code?: number; stderr?: string }) => error.code === 1 && pattern.test(error.stderr ?? "");
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("the CLI pays from the configured wallet and room, and prints no key, payment header or agent token", async (t) => {
  const { local, key, address, cli } = await cliWorkspace(t, { [REF]: "lighthouse" });
  const room = await startRoom(t, { recordDir: join(local, "payments") });

  const { stdout, stderr } = await cli("--network", "base", "--port", String(room.port));
  assert.match(stdout, new RegExp(`Funding room lighthouse at ${escape(room.url)} on ${BASE_SEPOLIA} as ${address}, paying only ${PAY_TO[BASE_SEPOLIA]}`));
  assert.match(stdout, /^Credited: The room was credited with 5 test credits\.$/m);
  const summary = JSON.parse(stdout.slice(stdout.indexOf("\n{") + 1));
  assert.equal(summary.outcome, "credited");
  assert.match(stdout, new RegExp(`^Explorer: ${summary.explorerUrl}$`, "m"));
  assert.equal(room.seen.settles, 1);
  assert.deepEqual(room.seen.agents, [TOKEN, TOKEN]);
  const [record] = await records(join(local, "payments"));
  assert.equal(summary.recordFile, join(await realpath(local), "payments", (await readdir(join(local, "payments")))[0]));
  for (const secret of [key, key.slice(2), record.header, record.header.slice(0, 80), TOKEN])
    assert.equal(`${stdout}${stderr}`.includes(secret), false);
  assert.equal((await recordTexts(join(local, "payments"))).some((text) => text.includes(TOKEN)), false);

  await assert.rejects(cli("--resume", summary.recordFile), failsWith(/already credited/));
  await assert.rejects(cli("--network", "mainnet"), failsWith(/--network solana or --network base/));
  await assert.rejects(cli("--network", "solana", "--port", String(room.port)), failsWith(/No usable solana:EtWT\w+ payer wallet in .*payer-solana-devnet\.json/));
  assert.equal(room.seen.unpaid, 1);
  assert.equal(room.seen.paidHeaders.length, 1);
});

test("the CLI funds the room named by --room, refuses to guess among several, and needs the agent token", async (t) => {
  const { local, cli } = await cliWorkspace(t, { [REF]: "lighthouse", [OTHER_REF]: "paper-moon" });
  const room = await startRoom(t, { recordDir: join(local, "payments") });
  const port = String(room.port);

  await assert.rejects(cli("--network", "base", "--port", port),
    failsWith(/^Several rooms are opted in \(lighthouse, paper-moon\); pass --room <roomId>\. Nothing was signed\.$/m));
  await assert.rejects(cli("--network", "base", "--port", port, "--room", "midnight-signal"),
    failsWith(/^Room midnight-signal is not opted in at .*funding\.json \(configured: lighthouse, paper-moon\)\. Nothing was signed\.$/m));
  await assert.rejects(cli("--network", "base", "--room", "paper-moon", "--url", room.url), failsWith(/Pass --room or --url, not both/));
  assert.deepEqual(room.seen.agents, [], "nothing reached a room");

  // pnpm forwards the "--" separator.
  const { stdout } = await cli("--", "--network", "base", "--port", port, "--room", "paper-moon");
  assert.match(stdout, new RegExp(`^Funding room paper-moon at ${escape(room.url.replace(REF, OTHER_REF))} on ${BASE_SEPOLIA} as `, "m"));
  assert.match(stdout, /^Credited: /m);
  assert.deepEqual(room.seen.paths, [`/api/x402/fund/${OTHER_REF}`, `/api/x402/fund/${OTHER_REF}`]);
  assert.equal(room.ledger.rooms["paper-moon"].deliveryLimit, 9);
  assert.equal(room.ledger.rooms.lighthouse.deliveryLimit, 0);
  const recordFile = join(local, "payments", (await readdir(join(local, "payments")))[0]);

  // Without the token that setup creates, nothing is requested, signed or re-sent.
  await rm(join(local, "agent-token"));
  const noToken = /^No valid agent token at .*agent-token\. Run npm run x402:setup -- init first; nothing was signed\.$/m;
  await assert.rejects(cli("--network", "base", "--port", port, "--room", "lighthouse"), failsWith(noToken));
  await assert.rejects(cli("--resume", recordFile), failsWith(noToken));
  await writeFile(join(local, "agent-token"), "not-a-token\n", { mode: 0o600 });
  await assert.rejects(cli("--network", "base", "--port", port, "--room", "lighthouse"), failsWith(noToken));
  assert.equal(room.seen.agents.length, 2);
  assert.equal((await readdir(join(local, "payments"))).length, 1);
});
