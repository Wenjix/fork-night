import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { readFile } from "node:fs/promises";
import { BrowserProvider, ContractFactory, keccak256, ZeroHash } from "ethers";
import { createHardhatRuntimeEnvironment } from "hardhat/hre";
import { operationArgs, parseTransaction, ReleaseClient, transactionStorageKey, type StoragePort, type WalletProvider } from "../../src/lib/onchain/client.ts";
import { DEFAULT_SUPPORT_MON, prepareRelease, supportAmount } from "../../src/lib/onchain/model.ts";
import type { PilotMoment } from "../../src/lib/pilot.ts";

const artifact = JSON.parse(await readFile(".local/contracts/ForkNightReleases.json", "utf8"));
const hre = await createHardhatRuntimeEnvironment({ networks: { simulation: { type: "edr-simulated", chainType: "l1", chainId: 31337 } } });
// Multicall3 runtime as deployed at its canonical address on Monad testnet (eth_getCode, October 14, 2026).
const multicall3 = { address: "0xcA11bde05977b3631167028862bE2a173976CA11", code: "0x6080604052600436106100f35760003560e01c80634d2301cc1161008a578063a8b0574e11610059578063a8b0574e1461025a578063bce38bd714610275578063c3077fa914610288578063ee82ac5e1461029b57600080fd5b80634d2301cc146101ec57806372425d9d1461022157806382ad56cb1461023457806386d516e81461024757600080fd5b80633408e470116100c65780633408e47014610191578063399542e9146101a45780633e64a696146101c657806342cbb15c146101d957600080fd5b80630f28c97d146100f8578063174dea711461011a578063252dba421461013a57806327e86d6e1461015b575b600080fd5b34801561010457600080fd5b50425b6040519081526020015b60405180910390f35b61012d610128366004610a85565b6102ba565b6040516101119190610bbe565b61014d610148366004610a85565b6104ef565b604051610111929190610bd8565b34801561016757600080fd5b50437fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff0140610107565b34801561019d57600080fd5b5046610107565b6101b76101b2366004610c60565b610690565b60405161011193929190610cba565b3480156101d257600080fd5b5048610107565b3480156101e557600080fd5b5043610107565b3480156101f857600080fd5b50610107610207366004610ce2565b73ffffffffffffffffffffffffffffffffffffffff163190565b34801561022d57600080fd5b5044610107565b61012d610242366004610a85565b6106ab565b34801561025357600080fd5b5045610107565b34801561026657600080fd5b50604051418152602001610111565b61012d610283366004610c60565b61085a565b6101b7610296366004610a85565b610a1a565b3480156102a757600080fd5b506101076102b6366004610d18565b4090565b60606000828067ffffffffffffffff8111156102d8576102d8610d31565b60405190808252806020026020018201604052801561031e57816020015b6040805180820190915260008152606060208201528152602001906001900390816102f65790505b5092503660005b8281101561047757600085828151811061034157610341610d60565b6020026020010151905087878381811061035d5761035d610d60565b905060200281019061036f9190610d8f565b6040810135958601959093506103886020850185610ce2565b73ffffffffffffffffffffffffffffffffffffffff16816103ac6060870187610dcd565b6040516103ba929190610e32565b60006040518083038185875af1925050503d80600081146103f7576040519150601f19603f3d011682016040523d82523d6000602084013e6103fc565b606091505b50602080850191909152901515808452908501351761046d577f08c379a000000000000000000000000000000000000000000000000000000000600052602060045260176024527f4d756c746963616c6c333a2063616c6c206661696c656400000000000000000060445260846000fd5b5050600101610325565b508234146104e6576040517f08c379a000000000000000000000000000000000000000000000000000000000815260206004820152601a60248201527f4d756c746963616c6c333a2076616c7565206d69736d6174636800000000000060448201526064015b60405180910390fd5b50505092915050565b436060828067ffffffffffffffff81111561050c5761050c610d31565b60405190808252806020026020018201604052801561053f57816020015b606081526020019060019003908161052a5790505b5091503660005b8281101561068657600087878381811061056257610562610d60565b90506020028101906105749190610e42565b92506105836020840184610ce2565b73ffffffffffffffffffffffffffffffffffffffff166105a66020850185610dcd565b6040516105b4929190610e32565b6000604051808303816000865af19150503d80600081146105f1576040519150601f19603f3d011682016040523d82523d6000602084013e6105f6565b606091505b5086848151811061060957610609610d60565b602090810291909101015290508061067d576040517f08c379a000000000000000000000000000000000000000000000000000000000815260206004820152601760248201527f4d756c746963616c6c333a2063616c6c206661696c656400000000000000000060448201526064016104dd565b50600101610546565b5050509250929050565b43804060606106a086868661085a565b905093509350939050565b6060818067ffffffffffffffff8111156106c7576106c7610d31565b60405190808252806020026020018201604052801561070d57816020015b6040805180820190915260008152606060208201528152602001906001900390816106e55790505b5091503660005b828110156104e657600084828151811061073057610730610d60565b6020026020010151905086868381811061074c5761074c610d60565b905060200281019061075e9190610e76565b925061076d6020840184610ce2565b73ffffffffffffffffffffffffffffffffffffffff166107906040850185610dcd565b60405161079e929190610e32565b6000604051808303816000865af19150503d80600081146107db576040519150601f19603f3d011682016040523d82523d6000602084013e6107e0565b606091505b506020808401919091529015158083529084013517610851577f08c379a000000000000000000000000000000000000000000000000000000000600052602060045260176024527f4d756c746963616c6c333a2063616c6c206661696c656400000000000000000060445260646000fd5b50600101610714565b6060818067ffffffffffffffff81111561087657610876610d31565b6040519080825280602002602001820160405280156108bc57816020015b6040805180820190915260008152606060208201528152602001906001900390816108945790505b5091503660005b82811015610a105760008482815181106108df576108df610d60565b602002602001015190508686838181106108fb576108fb610d60565b905060200281019061090d9190610e42565b925061091c6020840184610ce2565b73ffffffffffffffffffffffffffffffffffffffff1661093f6020850185610dcd565b60405161094d929190610e32565b6000604051808303816000865af19150503d806000811461098a576040519150601f19603f3d011682016040523d82523d6000602084013e61098f565b606091505b506020830152151581528715610a07578051610a07576040517f08c379a000000000000000000000000000000000000000000000000000000000815260206004820152601760248201527f4d756c746963616c6c333a2063616c6c206661696c656400000000000000000060448201526064016104dd565b506001016108c3565b5050509392505050565b6000806060610a2b60018686610690565b919790965090945092505050565b60008083601f840112610a4b57600080fd5b50813567ffffffffffffffff811115610a6357600080fd5b6020830191508360208260051b8501011115610a7e57600080fd5b9250929050565b60008060208385031215610a9857600080fd5b823567ffffffffffffffff811115610aaf57600080fd5b610abb85828601610a39565b90969095509350505050565b6000815180845260005b81811015610aed57602081850181015186830182015201610ad1565b81811115610aff576000602083870101525b50601f017fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe0169290920160200192915050565b600082825180855260208086019550808260051b84010181860160005b84811015610bb1578583037fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe001895281518051151584528401516040858501819052610b9d81860183610ac7565b9a86019a9450505090830190600101610b4f565b5090979650505050505050565b602081526000610bd16020830184610b32565b9392505050565b600060408201848352602060408185015281855180845260608601915060608160051b870101935082870160005b82811015610c52577fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffa0888703018452610c40868351610ac7565b95509284019290840190600101610c06565b509398975050505050505050565b600080600060408486031215610c7557600080fd5b83358015158114610c8557600080fd5b9250602084013567ffffffffffffffff811115610ca157600080fd5b610cad86828701610a39565b9497909650939450505050565b838152826020820152606060408201526000610cd96060830184610b32565b95945050505050565b600060208284031215610cf457600080fd5b813573ffffffffffffffffffffffffffffffffffffffff81168114610bd157600080fd5b600060208284031215610d2a57600080fd5b5035919050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052604160045260246000fd5b7f4e487b7100000000000000000000000000000000000000000000000000000000600052603260045260246000fd5b600082357fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff81833603018112610dc357600080fd5b9190910192915050565b60008083357fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe1843603018112610e0257600080fd5b83018035915067ffffffffffffffff821115610e1d57600080fd5b602001915036819003821315610a7e57600080fd5b8183823760009101908152919050565b600082357fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc1833603018112610dc357600080fd5b600082357fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffa1833603018112610dc357600080fdfea2646970667358221220bb2b5c71a328032f97c676ae39a1ec2148d3e5d6f73d95e9b17910152d61f16264736f6c634300080c0033" };
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

test("reads through the deployed Multicall3 match direct reads at every release stage", async t => {
  const f = await fixture(t);
  assert.equal(keccak256(multicall3.code), "0xd5c15df687b16f2ff992fc8d767b4216323184a2bbc6ee2f9c398c318e770891");
  // This client finds no Multicall3 on its first read, so it keeps reading with direct calls.
  const direct = new ReleaseClient(f.config, f.client.provider), initial = await direct.load(f.prepared);
  await f.wallet.request({ method: "hardhat_setCode", params: [multicall3.address, multicall3.code] });
  const requests: { method: string; params?: unknown }[] = [];
  const provider = new BrowserProvider({ request: async request => { requests.push(request); return f.wallet.request(request); } }, undefined, { cacheTimeout: -1 });
  const batched = new ReleaseClient(f.config, provider);
  t.after(() => batched.destroy());
  assert.deepEqual(await batched.load(f.prepared), initial);
  const reads = async (released: boolean) => {
    const start = requests.length, snapshot = await batched.load(f.prepared);
    assert.deepEqual(snapshot, await direct.load(f.prepared));
    const sent = requests.slice(start).filter(request => request.method === "eth_call" || request.method === "eth_getCode");
    assert.deepEqual(sent.map(request => [request.method, (request.params as { to?: string }[])[0].to]), Array(released ? 2 : 1).fill(["eth_call", multicall3.address.toLowerCase()]));
    return snapshot;
  };
  await f.execute("create"); await reads(false);
  await f.execute("approve"); await reads(false);
  await f.execute("register"); assert.equal((await reads(false)).scenes[0].matches, true);
  await f.execute("release"); assert.equal((await reads(true)).release.exists, true);
  await f.execute("support", 0, f.curator, 19n); assert.equal((await reads(true)).release.beneficiaries[0].claimable, 19n);
  await f.execute("claim"); assert.equal((await reads(true)).release.beneficiaries[0].claimed, 19n);
  const changed = { ...f.prepared.scenes[0].moment, title: "A different scene" };
  const edited = prepareRelease([changed], "midnight-signal", changed.id, f.curator);
  const [batchedError, directError] = await Promise.all([batched, direct].map(client => client.load(edited).then(() => assert.fail("an edited scene should be rejected"), (error: Error) => error.message)));
  assert.match(batchedError, /registered scene differs/);
  assert.equal(batchedError, directError);
  const start = requests.length;
  await batched.recover(f.prepared, f.curator, f.storage);
  assert.equal(requests.slice(start).filter(request => request.method === "eth_getCode").length, 1);
});

test("a wrong configured contract is rejected before wallet submission", async t => {
  const f = await fixture(t);
  const incorrect = new ReleaseClient({ ...f.config, address: f.curator }, f.client.provider);
  await assert.rejects(incorrect.execute(f.prepared, f.wallet, f.curator, f.storage, "create", operationArgs(f.prepared, "create")), /could not be verified/);
  assert.equal(f.broadcasts, 0);
});
