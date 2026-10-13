import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { readFile } from "node:fs/promises";
import { BrowserProvider, ContractFactory, ZeroHash } from "ethers";
import { createHardhatRuntimeEnvironment } from "hardhat/hre";
import { operationArgs, parseTransaction, ReleaseClient, transactionStorageKey, type StoragePort, type WalletProvider } from "../../src/lib/onchain/client.ts";
import { DEFAULT_SUPPORT_MON, prepareRelease, supportAmount } from "../../src/lib/onchain/model.ts";
import type { PilotMoment } from "../../src/lib/pilot.ts";

const artifact = JSON.parse(await readFile(".local/contracts/ForkNightReleases.json", "utf8"));
const hre = await createHardhatRuntimeEnvironment({ networks: { simulation: { type: "edr-simulated", chainType: "l1", chainId: 31337 } } });
function memoryStorage(): StoragePort {
  const values = new Map<string, string>();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
}
async function fixture(t: TestContext) {
  const connection = await hre.network.connect("simulation"); t.after(() => connection.close());
  const provider = new BrowserProvider(connection.provider, undefined, { cacheTimeout: -1 }); provider.pollingInterval = 10;
  const signer = await provider.getSigner(0), curator = await signer.getAddress();
  const contract = await new ContractFactory(artifact.abi, artifact.bytecode, signer).deploy(); await contract.waitForDeployment();
  const config = { chainId: 31337 as const, address: await contract.getAddress(), curator, rpcUrl: "http://127.0.0.1:8545", name: "Local test network", explorer: "" };
  const scene = (id: string, parent: string | null): PilotMoment => ({ id, parent_id: parent, room_id: "midnight-signal", maker_id: null,
    maker_label: "Declared seed maker", title: "The midnight signal", panels: [{ caption: "A light returns.", imageUrl: "/art/midnight-story.webp#frame=0" }],
    created_at: "2026-10-10T12:00:00Z", source_kind: "prepared", source_idea_id: null, source_idea_label: null, source_idea_body: null });
  const moments = [scene("00000000-0000-4000-8000-000000000001", null)];
  const prepared = prepareRelease(moments, "midnight-signal", moments[0].id, curator);
  const client = new ReleaseClient(config, provider);
  t.after(() => client.destroy());
  const storage = memoryStorage();
  let broadcastCount = 0, failAfterBroadcast = false, failBeforeBroadcast = false;
  const wallet: WalletProvider = { request: async ({ method, params }) => {
    if (method === "eth_requestAccounts" || method === "eth_accounts") return [curator];
    if (method === "eth_sendTransaction") {
      broadcastCount++;
      if (failBeforeBroadcast) throw new Error("Disconnected before submission.");
      const hash = await connection.provider.request({ method, params: params as unknown[] });
      if (failAfterBroadcast) throw new Error("Disconnected after submission.");
      return hash;
    }
    return connection.provider.request({ method, params: params as unknown[] });
  } };
  async function execute(operation: Parameters<typeof operationArgs>[1], index = 0, address = curator, value = 0n) {
    return client.execute(prepared, wallet, curator, storage, operation, operationArgs(prepared, operation, index, address), value);
  }
  async function release() { await execute("create"); await execute("approve"); await execute("register"); await execute("release"); }
  return { client, config, curator, prepared, wallet, storage, execute, release, contract,
    get broadcasts() { return broadcastCount; }, failBefore() { failBeforeBroadcast = true; }, failAfter() { failAfterBroadcast = true; }, restore() { failBeforeBroadcast = false; failAfterBroadcast = false; } };
}

test("wallet client reads actual committed scenes and settlement on the local EVM", async t => {
  const f = await fixture(t); await f.release();
  await f.execute("support", 0, f.curator, 19n);
  const snapshot = await f.client.load(f.prepared);
  assert.equal(snapshot.termsMatch, true);
  assert.equal(snapshot.scenes[0].matches, true);
  assert.equal(snapshot.release.received, 19n);
  assert.equal(snapshot.release.beneficiaries[0].claimable, 19n);
  await f.execute("claim");
  assert.equal((await f.client.load(f.prepared)).release.beneficiaries[0].claimable, 0n);
});

test("an empty wallet stops before saving or submitting an action and can proceed after funding", async t => {
  const f = await fixture(t);
  await f.wallet.request({ method: "hardhat_setBalance", params: [f.curator, "0x0"] });
  await assert.rejects(f.execute("create"), { code: "INSUFFICIENT_FUNDS" });
  assert.equal(f.broadcasts, 0);
  assert.equal(f.storage.getItem(transactionStorageKey(f.config, f.curator, f.prepared.projectId)), null);
  await f.wallet.request({ method: "hardhat_setBalance", params: [f.curator, "0x8ac7230489e80000"] });
  await f.execute("create");
  assert.equal(f.broadcasts, 1);
  assert.equal((await f.client.load(f.prepared)).termsMatch, true);
});

test("retry keeps the saved payment when its balance leaves no gas and settles it once after funding", async t => {
  const f = await fixture(t); await f.release(); f.failBefore();
  const value = supportAmount(DEFAULT_SUPPORT_MON);
  await assert.rejects(f.execute("support", 0, f.curator, value));
  f.restore();
  const key = transactionStorageKey(f.config, f.curator, f.prepared.projectId);
  const saved = f.storage.getItem(key), before = f.broadcasts;
  await f.wallet.request({ method: "hardhat_setBalance", params: [f.curator, `0x${value.toString(16)}`] });
  await assert.rejects(f.client.retry(f.prepared, f.wallet, f.curator, f.storage), { code: "INSUFFICIENT_FUNDS" });
  assert.equal(f.broadcasts, before);
  assert.equal(f.storage.getItem(key), saved);
  await f.wallet.request({ method: "hardhat_setBalance", params: [f.curator, "0x8ac7230489e80000"] });
  await f.client.retry(f.prepared, f.wallet, f.curator, f.storage);
  assert.equal((await f.client.load(f.prepared)).release.received, value);
  assert.equal(f.storage.getItem(key), null);
  const after = f.broadcasts;
  assert.equal((await f.client.recover(f.prepared, f.curator, f.storage)).complete, true);
  assert.equal(f.broadcasts, after);
});

test("lost submission response restores from confirmed payment state without sending again", async t => {
  const f = await fixture(t); await f.release(); f.failAfter();
  await assert.rejects(f.execute("support", 0, f.curator, 7n));
  const before = f.broadcasts;
  const result = await f.client.recover(f.prepared, f.curator, f.storage);
  assert.equal(result.complete, true);
  assert.equal(f.broadcasts, before);
  assert.equal((await f.client.load(f.prepared)).release.received, 7n);
  assert.equal(f.storage.getItem(transactionStorageKey(f.config, f.curator, f.prepared.projectId)), null);
});

test("support recovery uses exact settled payment when the original receipt hash is unavailable", async t => {
  const f = await fixture(t); await f.release(); f.failAfter();
  await assert.rejects(f.execute("support", 0, f.curator, 7n));
  const key = transactionStorageKey(f.config, f.curator, f.prepared.projectId);
  const pending = JSON.parse(f.storage.getItem(key)!);
  const before = f.broadcasts;
  // Model a saved original hash with no receipt after an otherwise settled/repriced action.
  f.storage.setItem(key, JSON.stringify({ ...pending, hash: ZeroHash, value: "8" }));
  assert.equal((await f.client.recover(f.prepared, f.curator, f.storage)).complete, false);
  assert.notEqual(f.storage.getItem(key), null);
  f.storage.setItem(key, JSON.stringify({ ...pending, hash: ZeroHash }));
  const recovered = await f.client.recover(f.prepared, f.curator, f.storage);
  assert.equal(recovered.complete, true);
  assert.equal(recovered.hash, undefined);
  assert.equal(f.storage.getItem(key), null);
  assert.equal(f.broadcasts, before);
  assert.equal((await f.client.load(f.prepared)).release.received, 7n);
});

test("a dropped 1 MON submission retries its original payment ID, then a second retry sends nothing", async t => {
  const f = await fixture(t); await f.release(); f.failBefore();
  const value = supportAmount(DEFAULT_SUPPORT_MON);
  await assert.rejects(f.execute("support", 0, f.curator, value));
  assert.equal((await f.client.recover(f.prepared, f.curator, f.storage)).complete, false);
  f.restore();
  await f.client.retry(f.prepared, f.wallet, f.curator, f.storage);
  assert.equal((await f.client.load(f.prepared)).release.received, value);
  const before = f.broadcasts;
  assert.equal((await f.client.recover(f.prepared, f.curator, f.storage)).complete, true);
  assert.equal(f.broadcasts, before);
});

test("receipt journals reject another chain, account, contract or project", async t => {
  const f = await fixture(t); await f.release(); f.failBefore();
  await assert.rejects(f.execute("support", 0, f.curator, 11n));
  const key = transactionStorageKey(f.config, f.curator, f.prepared.projectId), pending = JSON.parse(f.storage.getItem(key)!);
  for (const change of [{ chainId: 10143 }, { address: "0x0000000000000000000000000000000000000001" }, { account: "0x0000000000000000000000000000000000000001" }, { projectId: ZeroHash }]) {
    assert.throws(() => parseTransaction(JSON.stringify({ ...pending, ...change }), f.config, f.curator, f.prepared.projectId));
  }
});

test("an edited publication cannot be presented as the registered immutable scene", async t => {
  const f = await fixture(t); await f.release();
  const changed = { ...f.prepared.scenes[0].moment, title: "A different scene" };
  const prepared = prepareRelease([changed], "midnight-signal", changed.id, f.curator);
  await assert.rejects(f.client.load(prepared), /registered scene differs/);
});

test("a wrong configured contract is rejected before wallet submission", async t => {
  const f = await fixture(t);
  const incorrect = new ReleaseClient({ ...f.config, address: f.curator }, f.client.provider);
  await assert.rejects(incorrect.execute(f.prepared, f.wallet, f.curator, f.storage, "create", operationArgs(f.prepared, "create")), /could not be verified/);
  assert.equal(f.broadcasts, 0);
});
