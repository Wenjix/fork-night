import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { AbiCoder, concat, FetchRequest, id, Interface, toUtf8Bytes, toUtf8String } from "ethers";
import { releaseAbi } from "../../src/lib/onchain/abi.ts";
import { ReleaseClient, type WalletProvider } from "../../src/lib/onchain/client.ts";
import { sameAddress, TERMS_HASH } from "../../src/lib/onchain/model.ts";
import { ReleaseSession } from "../../src/lib/onchain/session.ts";
import { config, curator, makerWallet, prepared } from "./release-fixtures.ts";

const MULTICALL = "0xcA11bde05977b3631167028862bE2a173976CA11";
const releaseInterface = new Interface(releaseAbi);
// Multicall3's canonical aggregate3, written out independently of the client.
const multicallInterface = new Interface(["function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)"]);
const wallets = [curator, curator, curator, makerWallet];
type Call = ReturnType<typeof releaseInterface.parseTransaction> & {};
type Fault = { matches: (call: Call) => boolean; revert?: string; returns?: string };
type JsonRpc = { id: number; method: string; params: unknown[] };

// A Monad-like JSON-RPC endpoint for the client's own provider. Multicall3 has code unless the URL says "direct".
function chain(t: TestContext, fault?: Fault, aggregateError?: { code: number; message: string }) {
  const sent: { url: string; method: string; params: unknown[] }[] = [], batches: unknown[] = [];
  const aggregates: { target: string; allowFailure: boolean; call: string }[][] = [];
  function answer(data: string): [boolean, string] {
    const call = releaseInterface.parseTransaction({ data })!, [key, other] = call.args;
    if (fault?.matches(call)) return fault.revert === undefined ? [true, fault.returns!] : [false, fault.revert];
    const scene = call.name === "makers" ? prepared.scenes.findIndex(item => item.makerId === other) : prepared.scenes.findIndex(item => item.id === key);
    const values = call.name === "projects" ? [curator, TERMS_HASH, prepared.scenes[0].id]
      : call.name === "getRelease" ? [prepared.projectId, prepared.tipId, prepared.hash, 7n, 2n, [curator, makerWallet]]
      : call.name === "moments" ? [prepared.projectId, prepared.scenes[scene].parentId, prepared.scenes[scene].hash, prepared.scenes[scene].makerId, wallets[scene], BigInt(scene + 1)]
      : call.name === "makers" ? [wallets[scene]]
      : call.name === "claimable" ? [sameAddress(other, curator) ? 3n : 2n] : [sameAddress(other, curator) ? 1n : 0n];
    return [true, releaseInterface.encodeFunctionResult(call.name, values)];
  }
  function respond(url: string, { method, params }: JsonRpc) {
    sent.push({ url, method, params });
    if (method === "eth_chainId") return { result: "0x279f" };
    if (method === "eth_blockNumber") return { result: "0x2a" };
    if (method === "eth_getCode") return { result: sameAddress(String(params[0]), MULTICALL) && !url.includes("direct") ? "0x6080" : "0x" };
    const { to, data } = params[0] as { to: string; data: string };
    if (method !== "eth_call") return { error: { code: -32601, message: `Unexpected ${method}` } };
    if (sameAddress(to, MULTICALL)) {
      if (aggregateError) return { error: aggregateError };
      const [calls] = multicallInterface.decodeFunctionData("aggregate3", data);
      aggregates.push(calls.map(([target, allowFailure, callData]: [string, boolean, string]) => {
        const call = releaseInterface.parseTransaction({ data: callData })!;
        return { target, allowFailure, call: `${call.name}(${call.args.join(",")})` };
      }));
      return { result: multicallInterface.encodeFunctionResult("aggregate3", [calls.map(([, , callData]: [string, boolean, string]) => answer(callData))]) };
    }
    const [success, result] = answer(data);
    return success ? { result } : { error: { code: 3, message: "execution reverted", data: result } };
  }
  FetchRequest.registerGetUrl(async request => {
    const body = JSON.parse(toUtf8String(request.body!)) as JsonRpc | JsonRpc[];
    if (Array.isArray(body)) batches.push(body);
    const replies = (Array.isArray(body) ? body : [body]).map(payload => ({ jsonrpc: "2.0", id: payload.id, ...respond(request.url, payload) }));
    return { statusCode: 200, statusMessage: "OK", headers: { "content-type": "application/json" }, body: toUtf8Bytes(JSON.stringify(Array.isArray(body) ? replies : replies[0])) };
  });
  t.after(() => FetchRequest.registerGetUrl(FetchRequest.createGetUrlFunc()));
  return { sent, batches, aggregates };
}
function reader(t: TestContext, rpcUrl = "https://batched.invalid") {
  const client = new ReleaseClient({ ...config, rpcUrl });
  let verified = 0;
  // The fake chain has no bytecode to hash, so verification keeps its network check and is counted.
  client.verify = async () => { verified++; assert.equal((await client.provider.getNetwork()).chainId, BigInt(config.chainId)); };
  t.after(() => client.destroy());
  return { client, verified: () => verified };
}
type CallError = Error & { code?: string; revert?: { args: unknown[] } | null; invocation?: { args: unknown[] } | null };
// Every field ethers sets on a call or data error, with decoded arguments as plain arrays.
function shape(error: unknown) {
  const e = error as CallError;
  return { ...e, message: e.message, revert: e.revert && { ...e.revert, args: [...e.revert.args] }, invocation: e.invocation && { ...e.invocation, args: [...e.invocation.args] } };
}

test("a release read is one Multicall3 eth_call per round after one verification, with no JSON-RPC batches", async t => {
  const rpc = chain(t), { client, verified } = reader(t);
  await client.load(prepared);
  assert.equal(id("aggregate3((address,bool,bytes)[])").slice(0, 10), "0x82ad56cb");
  assert.deepEqual(rpc.sent.filter(request => request.method === "eth_call").map(({ params: [call, block] }) => [(call as { to: string }).to, (call as { data: string }).data.slice(0, 10), block]),
    [[MULTICALL.toLowerCase(), "0x82ad56cb", "0x2a"], [MULTICALL.toLowerCase(), "0x82ad56cb", "0x2a"]]);
  assert.ok(rpc.aggregates.flat().every(call => call.target === config.address && call.allowFailure));
  assert.deepEqual(rpc.aggregates.map(round => round.map(item => item.call)), [
    [`projects(${prepared.projectId})`, `getRelease(${prepared.id})`, ...prepared.scenes.flatMap(scene => [`moments(${scene.id})`, `makers(${prepared.projectId},${scene.makerId})`])],
    [curator, makerWallet].flatMap(address => [`claimable(${prepared.id},${address})`, `claimed(${prepared.id},${address})`]),
  ]);
  const first = rpc.sent.length;
  await client.load(prepared); await client.load(prepared);
  assert.deepEqual(rpc.sent.slice(first).map(request => request.method), ["eth_blockNumber", "eth_call", "eth_call", "eth_blockNumber", "eth_call", "eth_call"]);
  assert.equal(rpc.sent.filter(request => request.method === "eth_getCode").length, 1);
  assert.equal(verified(), 1);
  assert.deepEqual(rpc.batches, []);
});

test("Multicall3 results decode to the snapshot that direct contract calls give", async t => {
  const rpc = chain(t);
  const batched = await reader(t).client.load(prepared), direct = await reader(t, "https://direct.invalid").client.load(prepared);
  assert.deepEqual(batched, direct);
  assert.deepEqual(batched.release, { exists: true, received: 7n, paid: 2n, beneficiaries: [{ address: curator, claimable: 3n, claimed: 1n }, { address: makerWallet, claimable: 2n, claimed: 0n }] });
  assert.deepEqual(batched.scenes.map(scene => [scene.maker, scene.registered, scene.matches]), wallets.map(wallet => [wallet, true, true]));
  const calls = rpc.sent.filter(request => request.method === "eth_call" && request.url.includes("direct"));
  assert.equal(calls.length, 2 + 2 * prepared.scenes.length + 2 * 2);
  assert.ok(calls.every(request => sameAddress((request.params[0] as { to: string }).to, config.address)));
});

test("a failed or malformed Multicall3 result throws the error its direct call throws", async t => {
  const coder = AbiCoder.defaultAbiCoder(), third = prepared.scenes[2];
  const faults: [string, Fault][] = [
    ["custom error", { matches: call => call.name === "getRelease", revert: releaseInterface.encodeErrorResult("UnknownRelease", []) }],
    ["reason string", { matches: call => call.name === "moments" && call.args[0] === third.id, revert: concat(["0x08c379a0", coder.encode(["string"], ["missing moment"])]) }],
    ["panic", { matches: call => call.name === "claimable" && sameAddress(call.args[1], makerWallet), revert: concat(["0x4e487b71", coder.encode(["uint256"], [0x11])]) }],
    ["empty revert", { matches: call => call.name === "makers" && call.args[1] === third.makerId, revert: "0x" }],
    ["unknown error", { matches: call => call.name === "projects", revert: "0xdeadbeef" }],
    ["malformed data", { matches: call => call.name === "claimed" && sameAddress(call.args[1], curator), returns: "0x1234" }],
  ];
  for (const [label, fault] of faults) {
    chain(t, fault);
    const [batched, direct] = await Promise.all(["https://batched.invalid", "https://direct.invalid"].map(url =>
      reader(t, url).client.load(prepared).then(() => assert.fail(`${label} should reject`), shape)));
    assert.deepEqual(batched, direct, label);
    assert.equal(batched.code, fault.revert === undefined ? "BAD_DATA" : "CALL_EXCEPTION", label);
  }
});

test("a JSON-RPC error on the Multicall3 eth_call itself reads as the one-line network message", async t => {
  chain(t, undefined, { code: -32602, message: "Block requested not found. Request might be querying historical state that is not available. If possible, reformulate query to point to more recent blocks" });
  const { client } = reader(t);
  const error = await client.load(prepared).then(() => assert.fail("the read should fail"), (failure: Error & { code?: string; cause?: Error & { code?: string } }) => failure);
  assert.deepEqual([error.message, error.code, error.cause?.code], ["The testnet could not read this release.", "NETWORK_ERROR", "CALL_EXCEPTION"]);
  assert.match(String(error.cause?.message), /0x82ad56cb/);
  const session = new ReleaseSession(prepared, config, client, { wallet: () => undefined, storage: () => ({ getItem: () => null, setItem: () => {}, removeItem: () => {} }) });
  session.start(); t.after(() => session.stop());
  await session.refresh();
  assert.equal(session.getSnapshot().error, "The testnet connection was interrupted. Refresh the release and check any saved action.");
});

test("reads retry a failed verification, while wallet actions verify every time", async t => {
  chain(t);
  const { client, verified } = reader(t), verify = client.verify;
  let fail = true;
  client.verify = async () => { await verify(); if (fail) { fail = false; throw new Error("The configured payout contract could not be verified. No transaction was sent."); } };
  await assert.rejects(client.load(prepared), /could not be verified/);
  await client.load(prepared); await client.load(prepared);
  assert.equal(verified(), 2);
  const empty = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  assert.deepEqual(await client.recover(prepared, curator, empty), { complete: true, hash: undefined });
  const wallet: WalletProvider = { request: async () => assert.fail("no wallet request is expected") };
  await assert.rejects(client.execute(prepared, wallet, curator, { ...empty, getItem: () => "saved" }, "claim", [prepared.id, curator]), /Check the saved transaction/);
  assert.equal(verified(), 4);
  await client.load(prepared);
  assert.equal(verified(), 4);
});
