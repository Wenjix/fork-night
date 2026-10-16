import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { encodeFunctionData, encodeFunctionResult, decodeFunctionData } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import { Abis, Addresses } from "viem/tempo";
import { WREN_FUNDING, type WrenFundingPolicy } from "../../src/generation/wren-funding.ts";
import { WREN_SIGNER_SHA256 } from "../../src/generation/wren-funding-runtime.ts";
import { loadMppAdapter, type Eip1193Request, type MppAdapter, type MppChallenge } from "../../src/mpp/adapter.ts";
import { createChargePort } from "../../src/mpp/charge.ts";
import { blockNetwork, CHALLENGE_KEY, fakeModerato } from "./mpp-fakes.ts";

blockNetwork();
const when = Math.floor(Date.now() / 1000) * 1000;
// Public, disposable test input. It has no funds or live authorization.
const fixtureKey = `0x${"11".repeat(32)}` as const;
const keyAddress = privateKeyToAddress(fixtureKey);
const blockHash = `0x${"12".repeat(32)}` as const;
const authorizationHash = `0x${"34".repeat(32)}` as const;
const policy = (): WrenFundingPolicy => ({ enabled: true, room_id: "kessler-ward", network: "eip155:42431", steward: WREN_FUNDING.steward,
  pay_to: WREN_FUNDING.payTo, currency: WREN_FUNDING.currency, access_key: keyAddress, authorized_at: new Date(when - 3600_000).toISOString(),
  expires_at: new Date(when + 23 * 3600_000).toISOString(), authorization_tx: authorizationHash, allowance_atomic: 2000000, period_seconds: 86400, topups_per_day: 1 });

type HostedSigner = {
  assertWrenChallenge(challenge: MppChallenge, policy: WrenFundingPolicy, now?: number): void;
  createWrenPayment(options: { key: string; policy: WrenFundingPolicy; challenge: MppChallenge; request: Eip1193Request; now: number }): Promise<string>;
};
let adapter: MppAdapter | null = null, signer: HostedSigner | null = null, missing = "";
try {
  adapter = await loadMppAdapter();
  const path = new URL("../../vendor/mpp-adapter/wren.mjs", import.meta.url);
  assert.equal(createHash("sha256").update(await readFile(path)).digest("hex"), WREN_SIGNER_SHA256);
  signer = await import(path.href) as HostedSigner;
} catch (error) { missing = (error as Error).message; }

async function fixture() {
  const scopes = [{ target: WREN_FUNDING.currency as `0x${string}`, selectorRules: [{ selector: "0x95777d59" as const,
    recipients: [WREN_FUNDING.payTo as `0x${string}`] }] }];
  const p = policy();
  const grant = { expiry: BigInt(Date.parse(p.expires_at) / 1000), enforceLimits: true,
    limits: [{ token: WREN_FUNDING.currency as `0x${string}`, amount: 2000000n, period: 86400n }], allowAnyCalls: false, allowedCalls: scopes };
  const script = { revoked: false, scoped: true, remaining: 2000000n, grantAmount: 2000000n, grantPeriod: 86400n, scopePayTo: WREN_FUNDING.payTo as string };
  const rpc = fakeModerato(adapter!, { clock: () => when });
  const request: Eip1193Request = async ({ method, params }) => {
    const args = params as unknown[];
    if (method === "eth_call") {
      const call = args[0] as { data: `0x${string}` };
      const decoded = decodeFunctionData({ abi: Abis.accountKeychain, data: call.data });
      if (decoded.functionName === "getKey") return encodeFunctionResult({ abi: Abis.accountKeychain, functionName: "getKey",
        result: { keyId: keyAddress, signatureType: 0, expiry: grant.expiry, enforceLimits: true, isRevoked: script.revoked } });
      if (decoded.functionName === "getRemainingLimitWithPeriod") return encodeFunctionResult({ abi: Abis.accountKeychain,
        functionName: "getRemainingLimitWithPeriod", result: [script.remaining, BigInt((when + 23 * 3600_000) / 1000)] });
      if (decoded.functionName === "getAllowedCalls") return encodeFunctionResult({ abi: Abis.accountKeychain, functionName: "getAllowedCalls",
        result: [script.scoped, [{ ...scopes[0], selectorRules: [{ selector: "0x95777d59", recipients: [script.scopePayTo as `0x${string}`] }] }]] });
      throw new Error("Unexpected read call");
    }
    if (method === "eth_getTransactionByHash") return {
      from: WREN_FUNDING.steward, to: Addresses.accountKeychain, hash: authorizationHash, blockHash, blockNumber: "0x1", transactionIndex: "0x0",
      type: "0x2", chainId: "0xa5bf", nonce: "0x0", gas: "0x123456", value: "0x0", gasPrice: "0x1", accessList: [],
      maxFeePerGas: "0x1", maxPriorityFeePerGas: "0x0", r: `0x${"56".repeat(32)}`, s: `0x${"78".repeat(32)}`, v: "0x0",
      input: encodeFunctionData({ abi: Abis.accountKeychain, functionName: "authorizeKey", args: [keyAddress, 0,
        { ...grant, limits: [{ ...grant.limits[0], amount: script.grantAmount, period: script.grantPeriod }] }] }),
    };
    if (method === "eth_getTransactionReceipt") return {
      status: "0x1", from: WREN_FUNDING.steward, to: Addresses.accountKeychain, transactionHash: authorizationHash, blockHash, blockNumber: "0x1",
      transactionIndex: "0x0", gasUsed: "0x123", cumulativeGasUsed: "0x123", effectiveGasPrice: "0x1", logs: [], logsBloom: `0x${"00".repeat(256)}`, type: "0x2", contractAddress: null,
    };
    if (method === "eth_getBlockByHash") return {
      hash: blockHash, number: "0x1", timestamp: `0x${(Date.parse(p.authorized_at) / 1000).toString(16)}`, gasLimit: "0xffffff", gasUsed: "0x123",
      size: "0x100", transactions: [], baseFeePerGas: "0x1", parentHash: blockHash, sha3Uncles: blockHash, transactionsRoot: blockHash,
      stateRoot: blockHash, receiptsRoot: blockHash, logsBloom: `0x${"00".repeat(256)}`, miner: WREN_FUNDING.steward, difficulty: "0x0", totalDifficulty: "0x0", extraData: "0x", nonce: "0x0000000000000000", uncles: [],
    };
    return rpc.request({ method, params });
  };
  const charges = createChargePort({ network: "eip155:42431", recipient: WREN_FUNDING.payTo, currency: WREN_FUNDING.currency,
    rooms: { "kessler-ward": { maxTopUps: 1 } } }, { adapter: adapter!, challengeKey: CHALLENGE_KEY, rpc: request, now: () => when });
  const room = { roomId: "kessler-ward", stewardProfileId: "95000000-0000-4000-8000-000000000002", maxTopUps: 1 };
  const offer = await charges.offer(room);
  const challenge = adapter!.parseChallengeHeader(offer.header);
  return { p, script, rpc, request, charges, room, challenge };
}

test("reviewed hosted signer makes one real access-key pull credential offline and never broadcasts", adapter && signer ? {} : { skip: missing }, async () => {
  const f = await fixture();
  const credential = await signer!.createWrenPayment({ key: fixtureKey, policy: f.p, challenge: f.challenge, request: f.request, now: when });
  const presented = await f.charges.present(credential, f.room);
  assert(!("invalid" in presented), "existing seller accepts the real native access-key credential");
  if ("invalid" in presented) return;
  assert.equal(presented.payer.toLowerCase(), WREN_FUNDING.steward.toLowerCase());
  assert.equal(presented.amount, "1000000"); assert.equal(f.rpc.sentRaw.length, 0);
});

test("real signer refuses revoked, unscoped, widened, underfunded and changed-period allowances before broadcast", adapter && signer ? {} : { skip: missing }, async () => {
  for (const change of [{ revoked: true }, { scoped: false }, { remaining: 1000000n }, { grantAmount: 3000000n },
    { grantPeriod: 3600n }, { scopePayTo: `0x${"22".repeat(20)}` }]) {
    const f = await fixture(); Object.assign(f.script, change);
    await assert.rejects(signer!.createWrenPayment({ key: fixtureKey, policy: f.p, challenge: f.challenge, request: f.request, now: when }), /allowance|access key/);
    assert.equal(f.rpc.sentRaw.length, 0);
  }
});
