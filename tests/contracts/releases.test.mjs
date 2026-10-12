import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { BrowserProvider, ContractFactory, id, ZeroHash } from "ethers";
import { createHardhatRuntimeEnvironment } from "hardhat/hre";
import { compileContracts } from "../../scripts/compile-contracts.mjs";

const artifact = await compileContracts();
const receiverArtifact = (await compileContracts({ "contracts/test/ClaimReceiver.sol": { content: await readFile("contracts/test/ClaimReceiver.sol", "utf8") } })).contracts["contracts/test/ClaimReceiver.sol"].ClaimReceiver;
const hre = await createHardhatRuntimeEnvironment({ networks: { simulation: { type: "edr-simulated", chainType: "l1", chainId: 31337 } } });
const terms = id("accepted-test-release-terms"), commitment = id("complete-snapshot");
async function fixture(t, rootName = "root", rootMaker = 0) {
  const connection = await hre.network.connect("simulation");
  t.after(() => connection.close());
  const provider = new BrowserProvider(connection.provider);
  provider.pollingInterval = 10;
  const signers = await Promise.all([0, 1, 2, 3].map(i => provider.getSigner(i)));
  const addresses = await Promise.all(signers.map(s => s.getAddress()));
  const contract = await new ContractFactory(artifact.abi, artifact.bytecode, signers[0]).deploy();
  await contract.waitForDeployment();
  async function send(method, args = [], signer = 0, value = 0n) {
    const tx = await contract.connect(signers[signer]).getFunction(method)(...args, { value });
    return tx.wait();
  }
  const project = await contract.projectKey(addresses[0], id("room"));
  await send("createProject", [id("room"), terms, id(`maker-${rootMaker}`), id(rootName)]);
  for (let i = 0; i < 3; i++) await send("approveMaker", [project, id(`maker-${i}`), addresses[i]]);
  async function moment(name, parent = ZeroHash, maker = 0, projectId = project, accepted = terms) {
    await send("registerMoment", [projectId, id(name), parent, id(`maker-${maker}`), id(`manifest-${name}`), accepted], maker);
    return contract.momentKey(projectId, id(`maker-${maker}`), id(name));
  }
  async function release(tip, hash = commitment, projectId = project) {
    await send("publishRelease", [projectId, tip, hash]);
    return contract.releaseKey(projectId, tip, hash);
  }
  return { provider, connection, signers, addresses, contract, project, send, moment, release };
}
async function rejects(contract, method, args, error, signer) {
  const target = signer ? contract.connect(signer) : contract;
  await assert.rejects(target.getFunction(method).staticCall(...args), value => {
    assert.equal(value.revert?.name, error, value.shortMessage); return true;
  });
}

test("selected full ancestry determines recipients; siblings and repeated wallets do not add shares", async t => {
  const f = await fixture(t);
  const root = await f.moment("root");
  const middle = await f.moment("middle", root, 1);
  const tip = await f.moment("tip", middle, 0);
  await f.moment("sibling", root, 2);
  const release = await f.release(tip);
  const record = await f.contract.getRelease(release);
  assert.deepEqual([...record.beneficiaries].map(a => a.toLowerCase()), f.addresses.slice(0, 2).map(a => a.toLowerCase()).sort());
  assert.equal(record.tipId, tip);
  assert.equal(record.manifestHash, commitment);
  assert.equal(await f.contract.claimable(release, f.addresses[2]), 0n);
});

test("admission binds the maker ID; forged registration, curator actions and changed terms are rejected", async t => {
  const f = await fixture(t);
  await rejects(f.contract, "registerMoment", [f.project, id("forged"), ZeroHash, id("maker-1"), commitment, terms], "NotMaker");
  await rejects(f.contract, "approveMaker", [f.project, id("other"), f.addresses[3]], "NotCurator", f.signers[1]);
  await rejects(f.contract, "approveMaker", [f.project, id("maker-0"), f.addresses[3]], "AlreadyExists");
  await rejects(f.contract, "registerMoment", [f.project, id("root"), ZeroHash, id("maker-0"), commitment, id("new-terms")], "InvalidCommitment");
  const root = await f.moment("root");
  await rejects(f.contract, "publishRelease", [f.project, root, commitment], "NotCurator", f.signers[1]);
  await rejects(f.contract, "registerMoment", [f.project, id("other-root"), ZeroHash, id("maker-0"), commitment, terms], "InvalidParent");
  await rejects(f.contract, "registerMoment", [f.project, id("root"), ZeroHash, id("maker-0"), id("changed"), terms], "AlreadyExists");
});

test("project and moment namespaces prevent cross-project ID squatting and invalid ancestry", async t => {
  const f = await fixture(t, "same-source");
  const root = await f.moment("same-source");
  const other = await f.contract.projectKey(f.addresses[0], id("other-room"));
  await f.send("createProject", [id("other-room"), terms, id("maker-0"), id("same-source")]);
  await f.send("approveMaker", [other, id("maker-0"), f.addresses[0]]);
  const secondRoot = await f.moment("same-source", ZeroHash, 0, other);
  assert.notEqual(root, secondRoot);
  await rejects(f.contract, "registerMoment", [other, id("bad-parent"), root, id("maker-0"), commitment, terms], "InvalidParent");
  await rejects(f.contract, "publishRelease", [other, root, commitment], "InvalidParent");
  await rejects(f.contract, "registerMoment", [f.project, id("missing"), id("absent"), id("maker-0"), commitment, terms], "InvalidParent");
});

test("frozen releases retain beneficiaries after later contributions; duplicate releases fail", async t => {
  const f = await fixture(t);
  const root = await f.moment("root"), first = await f.release(root);
  await f.moment("later", root, 1);
  assert.deepEqual([...((await f.contract.getRelease(first)).beneficiaries)], [f.addresses[0]]);
  await rejects(f.contract, "publishRelease", [f.project, root, commitment], "AlreadyExists");
});

test("payments accrue exact cumulative entitlements, independently claimed to fixed wallets", async t => {
  const f = await fixture(t);
  const root = await f.moment("root"), tip = await f.moment("tip", root, 1), release = await f.release(tip);
  await f.send("supportRelease", [release, id("payment")], 3, 10n);
  assert.equal(await f.contract.claimable(release, f.addresses[0]), 5n);
  assert.equal(await f.contract.claimable(release, f.addresses[1]), 5n);
  const before = BigInt(await f.connection.provider.request({ method: "eth_getBalance", params: [f.addresses[1], "latest"] }));
  await f.send("claim", [release, f.addresses[1]], 3);
  const after = BigInt(await f.connection.provider.request({ method: "eth_getBalance", params: [f.addresses[1], "latest"] }));
  assert.equal(after - before, 5n);
  assert.equal(await f.contract.claimable(release, f.addresses[1]), 0n);
  await rejects(f.contract, "claim", [release, f.addresses[1]], "NothingToClaim");
  await rejects(f.contract, "claim", [release, f.addresses[3]], "NothingToClaim");
  await f.send("supportRelease", [release, id("second")], 3, 6n);
  assert.equal(await f.contract.claimable(release, f.addresses[1]), 3n);
  await f.send("claim", [release, f.addresses[0]], 3);
  await f.send("claim", [release, f.addresses[1]], 3);
  assert.equal(await f.contract.liability(), 0n);
  assert.equal((await f.contract.getRelease(release)).paid, 16n);
});

test("tiny repeated payments preserve all funds and equal shares within one wei cumulatively", async t => {
  const f = await fixture(t);
  const root = await f.moment("root"), middle = await f.moment("middle", root, 1), tip = await f.moment("tip", middle, 2);
  const release = await f.release(tip);
  let total = 0n;
  for (let i = 0; i < 15; i++) {
    const amount = BigInt((i * 7) % 11 + 1); total += amount;
    await f.send("supportRelease", [release, id(`pay-${i}`)], 3, amount);
    const shares = await Promise.all(f.addresses.slice(0, 3).map(a => f.contract.claimable(release, a)));
    assert.equal(shares.reduce((a, b) => a + b, 0n), total);
    assert.ok(shares.every(a => shares.every(b => a - b <= 1n)));
    assert.equal(await f.contract.liability(), total);
  }
  for (const account of [f.addresses[2], f.addresses[0], f.addresses[1]]) await f.send("claim", [release, account], 3);
  assert.equal(await f.contract.liability(), 0n);
});

test("a reused payment key cannot charge twice; another payer has an independent key", async t => {
  const f = await fixture(t), root = await f.moment("root"), release = await f.release(root);
  await f.send("supportRelease", [release, id("lost-response-key")], 3, 7n);
  await rejects(f.contract, "supportRelease", [release, id("lost-response-key"), { value: 7n }], "DuplicatePayment", f.signers[3]);
  await f.send("supportRelease", [release, id("lost-response-key")], 1, 3n);
  assert.equal((await f.contract.getRelease(release)).received, 10n);
  await rejects(f.contract, "supportRelease", [release, id("zero"), { value: 0n }], "InvalidPayment");
});

test("path bounds reject the next node, never silently drop ancestors", async t => {
  const f = await fixture(t);
  let tip = await f.moment("root");
  for (let i = 1; i < 32; i++) tip = await f.moment(`node-${i}`, tip, i % 3);
  const release = await f.release(tip);
  assert.equal((await f.contract.getRelease(release)).beneficiaries.length, 3);
  await rejects(f.contract, "registerMoment", [f.project, id("too-long"), tip, id("maker-0"), commitment, terms], "PathTooLong");
});

test("curating alone adds no share; the declared seed maker can be a different wallet", async t => {
  const f = await fixture(t, "root", 1);
  const root = await f.moment("root", ZeroHash, 1), tip = await f.moment("tip", root, 2), release = await f.release(tip);
  await f.send("supportRelease", [release, id("support")], 0, 12n);
  assert.equal(await f.contract.claimable(release, f.addresses[0]), 0n);
  assert.equal(await f.contract.claimable(release, f.addresses[1]), 6n);
  assert.equal(await f.contract.claimable(release, f.addresses[2]), 6n);
});

test("an admitted wallet cannot squat a different admitted maker's scene namespace", async t => {
  const f = await fixture(t), root = await f.moment("root");
  const attempted = await f.moment("same-published-id", root, 0);
  const rightful = await f.moment("same-published-id", root, 1);
  assert.notEqual(attempted, rightful);
  assert.equal((await f.contract.moments(rightful)).beneficiary, f.addresses[1]);
});

test("a rejecting recipient cannot block others; its accounting survives failure and later recovery", async t => {
  const f = await fixture(t), root = await f.moment("root");
  const receiver = await new ContractFactory(receiverArtifact.abi, `0x${receiverArtifact.evm.bytecode.object}`, f.signers[0]).deploy(await f.contract.getAddress());
  await receiver.waitForDeployment();
  const address = await receiver.getAddress(), maker = id("contract-maker"), source = id("contract-scene");
  await f.send("approveMaker", [f.project, maker, address]);
  await (await receiver.invoke(f.contract.interface.encodeFunctionData("registerMoment", [f.project, source, root, maker, commitment, terms]))).wait();
  const tip = await f.contract.momentKey(f.project, maker, source), release = await f.release(tip);
  await f.send("supportRelease", [release, id("support")], 3, 20n);
  await (await receiver.configure(1, release)).wait();
  await rejects(f.contract, "claim", [release, address], "TransferFailed");
  assert.equal(await f.contract.claimed(release, address), 0n);
  assert.equal(await f.contract.liability(), 20n);
  await f.send("claim", [release, f.addresses[0]], 3);
  assert.equal(await f.contract.claimable(release, address), 10n);
  await (await receiver.configure(2, release)).wait();
  await f.send("claim", [release, address], 3);
  assert.equal(await receiver.reentered(), false);
  assert.equal(await f.contract.claimed(release, address), 10n);
  assert.equal(await f.contract.liability(), 0n);
});

test("deployment on a production chain is rejected", async t => {
  const connection = await hre.network.connect({ network: "simulation", override: { chainId: 143 } });
  t.after(() => connection.close());
  const provider = new BrowserProvider(connection.provider), signer = await provider.getSigner(0);
  await assert.rejects(new ContractFactory(artifact.abi, artifact.bytecode, signer).deploy());
});
