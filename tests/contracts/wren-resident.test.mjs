import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { BrowserProvider, ContractFactory, Wallet, parseEther } from "ethers";
import { createHardhatRuntimeEnvironment } from "hardhat/hre";
import { compileContracts } from "../../scripts/compile-contracts.mjs";
import { residentRegistrar } from "../../agents/wren/resident-monad.mjs";
import { ReleaseClient, operationArgs } from "../../src/lib/onchain/client.ts";
import { prepareRelease, TERMS_HASH, makerKey } from "../../src/lib/onchain/model.ts";
import { WREN } from "../../src/lib/agents/wren.ts";

const artifact = await compileContracts();
// Everything runs inside the local EVM, using testnet's chain ID to exercise the exact signed payload.
const hre = await createHardhatRuntimeEnvironment({ networks: { resident: { type: "edr-simulated", chainType: "l1", chainId: 10143 } } });

async function fixture(t) {
  const connection = await hre.network.connect("resident"); t.after(() => connection.close());
  const provider = new BrowserProvider(connection.provider, undefined, { cacheTimeout: -1 }); provider.pollingInterval = 10;
  const curator = await provider.getSigner(), curatorAddress = await curator.getAddress();
  const contract = await new ContractFactory(artifact.abi, artifact.bytecode, curator).deploy(); await contract.waitForDeployment();
  const config = { chainId: 10143, address: await contract.getAddress(), curator: curatorAddress, name: "Local EVM", rpcUrl: "unused", explorer: "" };
  const wallet = Wallet.createRandom();
  await connection.provider.request({ method: "hardhat_setBalance", params: [wallet.address, "0xde0b6b3a7640000"] });
  const root = { id: randomUUID(), room_id: "kessler-ward", parent_id: null, maker_id: null, maker_label: "Prepared story", title: "Kessler Ward",
    panels: [{ caption: "Mika waits.", imageUrl: "/art/night-shift-neon.webp#frame=0" }], created_at: "2026-10-18T00:00:00+00:00" };
  const moments = [root], state = { turns: [] };
  for (let i = 0; i < 3; i++) {
    const moment = { id: randomUUID(), room_id: root.room_id, parent_id: moments.at(-1).id, maker_id: WREN.profileId, maker_label: WREN.displayName,
      title: `Radio ${i + 1}`, panels: [{ caption: `Mika listens for a neighbor, beat ${i + 1}.`, imagePath: `${randomUUID()}/1.webp`, sha256: "a".repeat(64) }], created_at: `2026-10-19T02:0${i}:00+00:00` };
    moments.push(moment);
    state.turns.push({ number: i + 1, parentId: moment.parent_id, momentId: moment.id, plan: { title: moment.title, caption: moment.panels[0].caption }, previewHash: "a".repeat(64), review: { ok: true } });
  }
  const prepared = prepareRelease(moments, root.room_id, root.id, curatorAddress);
  await (await contract.createProject(...operationArgs(prepared, "create"))).wait();
  await (await contract.approveMaker(...operationArgs(prepared, "approve", 0, curatorAddress))).wait();
  await (await contract.registerMoment(...operationArgs(prepared, "register"))).wait();
  const policy = { roomId: root.room_id, makerId: WREN.profileId, byline: WREN.displayName, wallet: wallet.address, chainId: 10143,
    contract: config.address, curator: curatorAddress, maxScenes: 3, maxGasWei: parseEther("0.1").toString(), termsHash: TERMS_HASH };
  const client = new ReleaseClient(config, provider); t.after(() => client.destroy());
  let saved, saves = 0;
  const save = async value => { saved = structuredClone(value); saves++; };
  const register = residentRegistrar({ policy, client, wallet, readMoments: async () => moments });
  const approve = async () => (await contract.approveMaker(prepared.projectId, makerKey(WREN.profileId), wallet.address)).wait();
  const mine = () => connection.provider.request({ method: "evm_mine", params: [] });
  return { state, policy, wallet, moments, prepared, contract, provider, client, register, save, approve, mine, get saved() { return saved; }, get saves() { return saves; } };
}

test("Wren registers three real contract moments after one admission, saving before a lost broadcast reply", async t => {
  const f = await fixture(t), original = f.provider.broadcastTransaction.bind(f.provider);
  let broadcasts = 0, loseReply = true;
  f.provider.broadcastTransaction = async raw => {
    broadcasts++;
    assert.ok(f.saved.turns.some(turn => turn.registration?.raw === raw), "signed transaction must be saved before submission");
    const tx = await original(raw);
    if (loseReply) { loseReply = false; throw Error("RPC acknowledgement lost"); }
    return tx;
  };
  await assert.rejects(f.register(f.state.turns[0], f.state, f.save, () => {}), /not approved/);
  assert.equal(broadcasts, 0); await f.approve();
  for (const turn of f.state.turns) {
    assert.equal(await f.register(turn, f.state, f.save, () => {}), false);
    await f.mine();
    assert.equal(await f.register(turn, f.state, f.save, () => {}), true);
  }
  assert.equal(broadcasts, 3);
  for (const turn of f.state.turns) assert.equal(await f.register(turn, f.state, f.save, () => {}), true);
  assert.equal(broadcasts, 3, "confirmed registrations are read, never sent again");
  assert.equal(await f.provider.getTransactionCount(f.wallet.address), 3);
  const snapshot = await f.client.load(prepareRelease(f.moments, f.policy.roomId, f.moments.at(-1).id, f.policy.curator));
  assert.equal(snapshot.scenes.filter(s => s.matches).length, 4);
  assert.ok(snapshot.scenes.slice(1).every(s => s.maker === f.wallet.address));
  assert.equal(snapshot.release.exists, false, "the mission never freezes a release");
  assert.ok(f.state.turns.every(turn => turn.registration.block && BigInt(turn.registration.feeWei) > 0n));
});

test("the registration gas cap and a missing parent stop before signing or broadcasting", async t => {
  const f = await fixture(t); await f.approve();
  await assert.rejects(f.register(f.state.turns[1], f.state, f.save, () => {}), /parent path/);
  f.policy.maxGasWei = "1";
  await assert.rejects(f.register(f.state.turns[0], f.state, f.save, () => {}), /gas cap/);
  assert.equal(f.saves, 0); assert.equal(await f.provider.getTransactionCount(f.wallet.address), 0);
});

test("a stop at the signing boundary leaves no transaction", async t => {
  const f = await fixture(t); await f.approve(); let gates = 0;
  await assert.rejects(f.register(f.state.turns[0], f.state, f.save, () => { if (++gates === 2) throw Error("mission expired"); }), /expired/);
  assert.equal(f.saves, 0); assert.equal(await f.provider.getTransactionCount(f.wallet.address), 0);
});
