import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { BrowserProvider, ContractFactory, id, parseEther } from "ethers";
import { createHardhatRuntimeEnvironment } from "hardhat/hre";
import { checkReleaseRehearsal, prepareReleaseRecord } from "../../scripts/check-release-rehearsal.mjs";
import { operationArgs } from "../../src/lib/onchain/client.ts";
import { prepareRelease, RELEASE_TERMS, sourceKey } from "../../src/lib/onchain/model.ts";

const artifact = JSON.parse(await readFile(".local/contracts/ForkNightReleases.json", "utf8"));
const hre = await createHardhatRuntimeEnvironment({ networks: { simulation: { type: "edr-simulated", chainType: "l1", chainId: 31337 } } });
async function fixture(t) {
  const connection = await hre.network.connect("simulation");
  t.after(() => connection.close());
  const requests = [];
  const provider = new BrowserProvider({ request: request => { requests.push(request.method); return connection.provider.request(request); } }, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 10;
  t.after(() => provider.destroy());
  const first = await provider.getSigner(0), second = await provider.getSigner(1);
  const curator = await first.getAddress(), collaborator = await second.getAddress();
  const contract = await new ContractFactory(artifact.abi, artifact.bytecode, first).deploy();
  await contract.waitForDeployment();
  const config = { chainId: 31337, address: await contract.getAddress(), curator, rpcUrl: "http://127.0.0.1:8545", name: "Local test network", explorer: "" };
  const root = { id: "00000000-0000-4000-8000-000000000001", parent_id: null, room_id: "midnight-signal", maker_id: null,
    maker_label: "Declared seed maker", title: "The midnight signal", panels: [{ caption: "A light returns.", imageUrl: "/art/midnight-story.webp#frame=0" }],
    created_at: "2026-10-11T12:00:00Z", source_kind: "prepared", source_idea_id: null, source_idea_label: null, source_idea_body: null };
  const child = { ...root, id: "00000000-0000-4000-8000-000000000002", parent_id: root.id,
    maker_id: "00000000-0000-4000-8000-000000000003", maker_label: "Second maker", title: "A continuation",
    panels: [{ caption: "Another signal answers.", imagePath: "00000000-0000-4000-8000-000000000002/1.webp", sha256: "a".repeat(64) }] };
  const prepared = prepareRelease([root, child], "midnight-signal", child.id, curator);
  const record = { manifest: prepared.manifest, manifestHash: prepared.hash, releaseId: prepared.id,
    chainId: config.chainId, contract: config.address, terms: RELEASE_TERMS };
  async function send(method, args, signer = first, overrides = {}) {
    await (await contract.connect(signer).getFunction(method)(...args, overrides)).wait();
  }
  async function check(options = {}) {
    requests.length = 0;
    const result = await checkReleaseRehearsal(config, provider, { record, wallets: [collaborator], ...options });
    assert.equal(requests.some(method => ["eth_sendTransaction", "eth_sendRawTransaction"].includes(method)), false);
    return result;
  }
  return { config, curator, collaborator, second, prepared, record, send, check };
}

test("read-only preflight checks the deployed code, project and both wallet balances", async t => {
  const f = await fixture(t);
  const result = await f.check({ record: undefined });
  assert.equal(result.runtimeVerified, true);
  assert.equal(result.policyVerified, true);
  assert.equal(result.project.started, false);
  assert.equal(result.project.termsMatch, null);
  assert.equal(result.wallets.length, 2);
  assert.ok(result.wallets.every(wallet => wallet.hasTestMon));
  assert.equal(result.release, null);
  await f.send("createProject", [sourceKey("midnight-signal"), id("wrong terms"), ...operationArgs(f.prepared, "create").slice(2)]);
  await assert.rejects(f.check({ record: undefined }), /different curator or terms/);
});

test("downloaded records reject changed scenes, ancestry, release IDs and network settings", async t => {
  const f = await fixture(t);
  assert.equal(prepareReleaseRecord(JSON.parse(JSON.stringify(f.record)), f.config).id, f.prepared.id);
  for (const change of [
    record => { record.chainId = 10143; },
    record => { record.contract = f.curator; },
    record => { record.terms += " edited"; },
    record => { record.manifest.scenes[1].panels[0].caption = "A changed caption"; },
    record => { record.manifest.scenes[1].panels[0].sha256 = "b".repeat(64); },
    record => { record.manifest.scenes[1].parentId = null; },
    record => { record.releaseId = id("a different release"); },
  ]) {
    const changed = JSON.parse(JSON.stringify(f.record)); change(changed);
    assert.throws(() => prepareReleaseRecord(changed, f.config));
  }
});

test("the checker distinguishes registration, funding and each independent claim on the local EVM", async t => {
  const f = await fixture(t);
  await f.send("createProject", operationArgs(f.prepared, "create"));
  for (const [index, wallet] of [[0, f.curator], [1, f.collaborator]]) await f.send("approveMaker", operationArgs(f.prepared, "approve", index, wallet));
  await f.send("registerMoment", operationArgs(f.prepared, "register", 0));
  const partial = await f.check();
  assert.equal(partial.release.distinctBylines, 2);
  assert.equal(partial.release.frozen, false);
  assert.deepEqual(partial.release.scenes.map(scene => scene.registered), [true, false]);
  await f.send("registerMoment", operationArgs(f.prepared, "register", 1), f.second);
  await f.send("publishRelease", operationArgs(f.prepared, "release"));
  assert.equal((await f.check()).release.fundedAndFullyClaimed, false);
  await f.send("supportRelease", [f.prepared.id, id("rehearsal payment")], undefined, { value: parseEther("0.01") });
  const funded = await f.check();
  assert.equal(funded.release.receivedTestMon, "0.01");
  assert.equal(funded.liabilityWei, parseEther("0.01").toString());
  assert.ok(funded.release.beneficiaries.every(maker => maker.claimableTestMon === "0.005"));
  await f.send("claim", [f.prepared.id, f.curator]);
  const firstClaim = await f.check();
  assert.equal(firstClaim.release.paidTestMon, "0.005");
  assert.equal(firstClaim.release.fundedAndFullyClaimed, false);
  await f.send("claim", [f.prepared.id, f.collaborator], f.second);
  const settled = await f.check();
  assert.equal(settled.release.paidTestMon, "0.01");
  assert.equal(settled.release.fundedAndFullyClaimed, true);
  assert.ok(settled.release.beneficiaries.every(maker => maker.claimedTestMon === "0.005" && maker.claimableWei === "0"));
  assert.equal(settled.liabilityWei, "0");
  assert.equal(settled.contractBalanceWei, "0");
});
