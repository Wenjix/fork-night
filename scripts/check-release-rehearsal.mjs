import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { FetchRequest, formatEther, getAddress, JsonRpcProvider, ZeroAddress } from "ethers";
import { ReleaseClient } from "../src/lib/onchain/client.ts";
import { releaseConfig } from "../src/lib/onchain/config.ts";
import { makerKey, manifestHash, ORIGINAL_ROOM, prepareRelease, projectKey, releaseByline, releaseRoom, RELEASE_TERMS, sameAddress, TERMS_HASH } from "../src/lib/onchain/model.ts";

export function prepareReleaseRecord(record, config) {
  if (record?.chainId !== config.chainId || typeof record.contract !== "string" || !sameAddress(record.contract, config.address) || record.terms !== RELEASE_TERMS) {
    throw new Error("The release record has different network, contract or terms settings.");
  }
  const scenes = record.manifest?.scenes;
  if (!Array.isArray(scenes) || !scenes.length) throw new Error("The release record has no published path.");
  const roomId = scenes[0].roomId;
  if (!releaseRoom(roomId) || scenes.some(scene => scene.roomId !== roomId)) throw new Error("The release record must contain one permitted story room.");
  const moments = scenes.map(scene => ({
    id: scene.id, room_id: scene.roomId, parent_id: scene.parentId, maker_id: scene.makerId,
    maker_label: scene.makerLabel, title: scene.title, panels: scene.panels, created_at: scene.publishedAt,
    source_kind: "prepared", source_idea_id: null, source_idea_label: null, source_idea_body: null,
  }));
  const prepared = prepareRelease(moments, roomId, moments.at(-1).id, config.curator);
  if (manifestHash(record.manifest) !== prepared.hash || record.manifestHash !== prepared.hash || record.releaseId !== prepared.id) {
    throw new Error("The release record's ordered scenes, manifest hash or release ID do not match.");
  }
  return prepared;
}

export async function checkReleaseRehearsal(config, provider, { record, wallets = [] } = {}) {
  const client = new ReleaseClient(config, provider);
  const prepared = record ? prepareReleaseRecord(record, config) : null;
  let snapshot;
  if (prepared) snapshot = await client.load(prepared);
  else await client.verify();
  const block = snapshot?.block ?? await provider.getBlockNumber();
  const options = { blockTag: block }, projectId = prepared?.projectId ?? projectKey(config.curator, ORIGINAL_ROOM);
  const [project, openingMaker, liability, balance] = await Promise.all([
    client.contract.projects(projectId, options), client.contract.makers(projectId, makerKey(null), options),
    client.contract.liability(options), provider.getBalance(config.address, block),
  ]);
  const started = project.curator !== ZeroAddress;
  if (started && (!sameAddress(project.curator, config.curator) || project.termsHash !== TERMS_HASH)) {
    throw new Error("The recorded project has different curator or terms settings.");
  }
  if (balance < liability) throw new Error("The contract balance does not cover its recorded liability.");
  const addresses = [...new Set([config.curator, ...wallets, ...(snapshot?.release.beneficiaries ?? []).map(item => item.address)].map(address => getAddress(address).toLowerCase()))];
  const walletBalances = await Promise.all(addresses.map(async address => {
    const value = await provider.getBalance(address, block);
    return { address: getAddress(address), balanceWei: value.toString(), balanceTestMon: formatEther(value), hasTestMon: value > 0n };
  }));
  let release = null;
  if (snapshot) {
    const state = snapshot.release;
    const beneficiaries = state.beneficiaries.map(item => ({
      address: item.address, claimedWei: item.claimed.toString(), claimedTestMon: formatEther(item.claimed),
      claimableWei: item.claimable.toString(), claimableTestMon: formatEther(item.claimable),
    }));
    if (state.exists) {
      const expected = [...new Set(snapshot.scenes.map(scene => scene.maker.toLowerCase()))].sort();
      if (!snapshot.scenes.every(scene => scene.matches) || expected.length !== beneficiaries.length ||
        expected.some((address, index) => address !== beneficiaries[index].address.toLowerCase())) {
        throw new Error("The frozen recipients do not match the registered ancestry.");
      }
      const claimed = state.beneficiaries.reduce((sum, item) => sum + item.claimed, 0n);
      const unclaimed = state.beneficiaries.reduce((sum, item) => sum + item.claimable, 0n);
      if (claimed !== state.paid || claimed + unclaimed !== state.received) throw new Error("The release's received, claimed and claimable totals do not reconcile.");
    }
    release = {
      id: prepared.id, manifestHash: prepared.hash, frozen: state.exists,
      distinctBylines: new Set(prepared.scenes.map(scene => scene.makerId)).size,
      scenes: snapshot.scenes.map((scene, index) => ({ title: prepared.scenes[index].moment.title,
        makerId: prepared.scenes[index].moment.maker_id, makerLabel: releaseByline(prepared.scenes[index].moment),
        wallet: scene.maker, registered: scene.registered, matches: scene.matches })),
      receivedWei: state.received.toString(), receivedTestMon: formatEther(state.received),
      paidWei: state.paid.toString(), paidTestMon: formatEther(state.paid), beneficiaries,
      fundedAndFullyClaimed: state.exists && state.received > 0n && state.paid === state.received && state.beneficiaries.every(item => item.claimable === 0n),
    };
  }
  return {
    chainId: config.chainId, contract: config.address, block, runtimeVerified: true, policyVerified: true,
    project: { id: projectId, started, curator: started ? project.curator : config.curator,
      termsMatch: started ? project.termsHash === TERMS_HASH : null, root: project.root, openingMakerWallet: openingMaker },
    wallets: walletBalances, contractBalanceWei: balance.toString(), liabilityWei: liability.toString(), release,
  };
}

async function main() {
  const args = process.argv.slice(2), wallets = [];
  let recordPath;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--record" && args[index + 1] && !recordPath) recordPath = args[++index];
    else if (args[index] === "--wallet" && args[index + 1]) wallets.push(getAddress(args[++index]));
    else throw new Error("Usage: npm run contracts:check -- [--wallet 0x…] [--record /path/to/fork-night-release.json]");
  }
  const config = releaseConfig();
  if (!config || config.chainId !== 10143) throw new Error("Configure the public Monad testnet contract and curator settings in .env.local first.");
  const deployment = JSON.parse(await readFile(new URL("../docs/submission/MONAD-TESTNET.json", import.meta.url), "utf8"));
  if (!sameAddress(config.address, deployment.address) || !sameAddress(config.curator, deployment.curator)) throw new Error("The configured contract or curator differs from the recorded deployment.");
  const record = recordPath ? JSON.parse(await readFile(recordPath, "utf8")) : undefined;
  const request = new FetchRequest(config.rpcUrl);
  request.timeout = 10000;
  const provider = new JsonRpcProvider(request, config.chainId, { batchMaxCount: 1, cacheTimeout: -1 });
  try {
    const report = { checkedAt: new Date().toISOString(), ...await checkReleaseRehearsal(config, provider, { record, wallets }) };
    const output = `.local/contracts/rehearsal-check-${Date.now()}.json`;
    await mkdir(".local/contracts", { recursive: true });
    await writeFile(output, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
    console.log(JSON.stringify({ ...report, savedTo: output }, null, 2));
  } finally { provider.destroy(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await main(); }
  catch (error) {
    console.error(error instanceof Error && !error.code ? error.message : "Read-only check failed. Check the local configuration, file path and Monad RPC connection. No transaction was sent.");
    process.exitCode = 1;
  }
}
