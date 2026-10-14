import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { getAddress, Interface, Transaction, Wallet, ZeroHash, type AbstractProvider, type TransactionLike } from "ethers";
import sharp from "sharp";
import { releaseAbi } from "../../src/lib/onchain/abi.ts";
import { ReleaseClient } from "../../src/lib/onchain/client.ts";
import type { ReleaseConfig } from "../../src/lib/onchain/config.ts";
import { prepareRelease, sceneManifest } from "../../src/lib/onchain/model.ts";
import { isUuid, pilotPanels, type PilotMoment } from "../../src/lib/pilot.ts";
import type { UnsignedEvmTransaction } from "../../src/privy/rest.ts";
import { ClaimRefused, readClaim, runClaim, type ClaimHelper } from "../../src/night-watch/claim-helper.ts";
import { editionFor } from "../../src/night-watch/edition.ts";
import { NightWatchError } from "../../src/night-watch/http.ts";
import {
  agentUri,
  decodeAgentUri,
  IDENTITY_NOTE,
  IDENTITY_REGISTRY,
  identityInterface,
  IdentityRefused,
  readIdentity,
  registerIdentity,
  registrationFile,
} from "../../src/night-watch/identity.ts";
import { jobEventsPath, jobPath, type CandidateRecord, type JobRecord } from "../../src/night-watch/job-types.ts";
import {
  listPublishedMoments,
  momentIdForJob,
  nightWatchWorldMoment,
  publishCandidate,
  readMomentImage,
  toPilotMoment,
  type NightWatchMoment,
} from "../../src/night-watch/publish.ts";
import { fileNightWatchStore, type NightWatchStore } from "../../src/night-watch/store.ts";
import { readWorld, RELEASE_PATH_TIP, type WorldSource } from "../../src/night-watch/world.ts";
import { CURRENT_KIT, kitDigest } from "../../src/night-watch/world-kit.ts";

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const ROOM = "midnight-signal";
const MAKER = "30000000-0000-4000-8000-000000000001";
const OTHER_MAKER = "30000000-0000-4000-8000-000000000002";
const ROOT_ID = "10000000-0000-4000-8000-000000000001";
const JOB = `nwj_${"a".repeat(32)}`;
const CURATOR = "0x0000000000000000000000000000000000000001";
const CONTRACT = "0x0000000000000000000000000000000000000004";
const A = getAddress("0x00000000000000000000000000000000000000a1");
const B = getAddress("0x00000000000000000000000000000000000000b2");
const STRANGER = getAddress("0x00000000000000000000000000000000000000c3");
const RELEASE_ID = `0x${"ab".repeat(32)}`;
const ONE = 10n ** 18n;
const config: ReleaseConfig = { chainId: 10143, rpcUrl: "https://example.invalid", address: CONTRACT, curator: CURATOR, explorer: "https://testnet.monadscan.com", name: "Monad testnet" };
const releaseInterface = new Interface(releaseAbi);

async function tempStore(t: TestContext): Promise<NightWatchStore> {
  const root = await mkdtemp(join(tmpdir(), "nw-edition-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return fileNightWatchStore(root);
}

function row(id: string, parent: string | null, makerId: string | null, label: string, createdAt: string, panels: unknown[]): PilotMoment {
  return {
    id, room_id: ROOM, parent_id: parent, maker_id: makerId, maker_label: label, title: `${label}'s scene`, panels: panels as PilotMoment["panels"],
    created_at: createdAt, source_kind: "openai", source_idea_id: null, source_idea_label: null, source_idea_body: null,
  };
}

const seed = row(ROOT_ID, null, null, "Room starter", "2026-10-02T11:44:53.927271+00:00", [
  { caption: "At midnight, the lighthouse blinked for the first time in years.", imageUrl: "/art/midnight-story.webp#frame=0" },
  { caption: "Mira found a note beneath the lamp: someone out there was waiting.", imageUrl: "/art/midnight-story.webp#frame=1" },
]);

const png = (blue: number) => sharp({ create: { width: 16, height: 16, channels: 3, background: { r: 20, g: 40, b: blue } } }).png().toBuffer();

function candidate(number: number, state: CandidateRecord["state"], imageFile: string | null = null, digest: string | null = null): CandidateRecord {
  return { number, state, caption: "Mira and the Dokkaebi find a second lighthouse that answers the first.", requestDigest: null, imageFile, sha256: digest, expenseUsd: state === "delivered" ? "0.25" : null, error: null, charged: false, refunded: false };
}

async function readyJob(store: NightWatchStore, overrides: Partial<JobRecord> = {}): Promise<JobRecord> {
  const bytes = await png(120);
  const file = `job-files/${JOB}/candidate-1.png`;
  await mkdir(join(store.root, "job-files", JOB), { recursive: true });
  await writeFile(join(store.root, file), bytes);
  const at = "2026-10-13T08:00:00.000Z";
  const job: JobRecord = {
    version: 1, id: JOB, makerId: MAKER, makerLabel: "Wenjie", sessionId: `nws_${"b".repeat(32)}`, roomId: ROOM,
    forkPointId: ROOT_ID, forkPoint: { id: ROOT_ID, title: "The midnight signal", makerLabel: "Room starter" },
    brief: "Mira and the Dokkaebi find a second lighthouse that answers the first.", attempts: 2,
    kit: { id: CURRENT_KIT.id, version: CURRENT_KIT.version, digest: kitDigest(CURRENT_KIT) },
    state: "ready", message: "2 private candidates ready for your review.", createdAt: at, runAfter: at, updatedAt: at,
    capacity: { neededCredits: 2, availableAtCheck: 5, charged: 0, refunded: 0 }, reservationId: null, paymentRecordFile: null,
    candidates: [candidate(1, "delivered", file, sha256(bytes)), candidate(2, "failed")], publishedMomentId: null,
    ...overrides,
  };
  await store.write(jobPath(JOB), job);
  return job;
}

const now = () => new Date("2026-10-13T09:00:00.000Z");

// ---------- publish ----------

test("publishing needs the job's maker, a ready job and a delivered candidate, and otherwise changes nothing", async (t) => {
  const store = await tempStore(t);
  await readyJob(store);
  const refused = (status: number, code: string) => (error: unknown) => error instanceof NightWatchError && error.status === status && error.code === code;

  await assert.rejects(publishCandidate({ store, now }, { id: OTHER_MAKER }, JOB, 1), refused(404, "not_found"));
  await assert.rejects(publishCandidate({ store, now }, { id: MAKER }, JOB, 2), refused(409, "not_delivered"));
  await assert.rejects(publishCandidate({ store, now }, { id: MAKER }, JOB, 3), refused(409, "not_delivered"));
  await assert.rejects(publishCandidate({ store, now }, { id: MAKER }, "nwj_nope", 1), refused(404, "not_found"));
  await readyJob(store, { state: "generating" });
  await assert.rejects(publishCandidate({ store, now }, { id: MAKER }, JOB, 1), refused(409, "not_ready"));

  assert.deepEqual(await listPublishedMoments(store), []);
  assert.equal((await store.read<JobRecord>(jobPath(JOB)))?.publishedMomentId, null);
});

test("a candidate whose bytes changed after delivery is not published", async (t) => {
  const store = await tempStore(t);
  await readyJob(store);
  await writeFile(join(store.root, "job-files", JOB, "candidate-1.png"), await png(30));
  await assert.rejects(publishCandidate({ store, now }, { id: MAKER }, JOB, 1), (error: unknown) => error instanceof NightWatchError && error.code === "candidate_changed");
  assert.deepEqual(await listPublishedMoments(store), []);
});

test("a published candidate is a release-ready moment, and publishing again returns the same moment", async (t) => {
  const store = await tempStore(t);
  await readyJob(store);
  const [first, concurrent] = await Promise.all([
    publishCandidate({ store, now }, { id: MAKER }, JOB, 1),
    publishCandidate({ store, now }, { id: MAKER }, JOB, 1),
  ]);
  assert.equal(first.id, momentIdForJob(JOB));
  assert.equal(concurrent.id, first.id);
  assert(isUuid(first.id));
  assert.deepEqual(
    { room: first.room_id, parent: first.parent_id, maker: first.maker_id, label: first.maker_label, nightWatch: first.nightWatch, created: first.created_at },
    { room: ROOM, parent: ROOT_ID, maker: MAKER, label: "Wenjie", nightWatch: { jobId: JOB, kitVersion: "1", candidate: 1 }, created: now().toISOString() },
  );
  assert(first.title.length <= 160);

  // The stored panel is exactly what the release proof accepts: a storage-style path and a digest, no packaged art URL.
  const [panel] = first.panels;
  assert.equal(panel.imagePath, `${first.id}/1.webp`);
  assert.equal("imageUrl" in panel, false);
  const image = await readMomentImage(store, first.id);
  assert(image);
  assert.equal(image.contentType, "image/webp");
  assert.equal(image.bytes.subarray(8, 12).toString("ascii"), "WEBP");
  assert.equal(sha256(image.bytes), panel.sha256);

  const job = await store.read<JobRecord>(jobPath(JOB));
  assert.equal(job?.state, "published");
  assert.equal(job?.publishedMomentId, first.id);
  const events = await store.readEvents(jobEventsPath(JOB));
  assert.equal(events.filter((event) => event.step === "published").length, 1);

  // Asking again, even for another candidate, returns the job's one moment.
  assert.equal((await publishCandidate({ store, now }, { id: MAKER }, JOB, 1)).id, first.id);
  assert.equal((await publishCandidate({ store, now }, { id: MAKER }, JOB, 2)).id, first.id);
  assert.equal((await listPublishedMoments(store)).length, 1);

  const moment = toPilotMoment(first);
  assert.deepEqual(pilotPanels(moment.panels), [{ caption: panel.caption, imagePath: panel.imagePath, sha256: panel.sha256 }]);
  const manifest = sceneManifest(moment);
  assert.deepEqual(manifest.panels, [{ caption: panel.caption, imagePath: panel.imagePath, sha256: panel.sha256 }]);
  const prepared = prepareRelease([seed, moment], ROOM, moment.id, CURATOR);
  assert.equal(prepared.scenes.length, 2);
  assert.equal(prepared.scenes[1].moment.id, first.id);
  assert.equal(prepared.manifest.scenes[1].panels[0].sha256, panel.sha256);

  const view = nightWatchWorldMoment(first);
  assert.equal(view.source, "night-watch");
  assert.equal(view.panels[0].imageUrl, `/api/night-watch/moments/${first.id}/image`);
});

test("an interrupted publish finishes with the moment it already wrote", async (t) => {
  const store = await tempStore(t);
  const job = await readyJob(store);
  const moment = await publishCandidate({ store, now }, { id: MAKER }, JOB, 1);
  // As if the process stopped after writing the moment and before updating the job.
  await store.write(jobPath(JOB), job);
  const again = await publishCandidate({ store, now }, { id: MAKER }, JOB, 1);
  assert.equal(again.id, moment.id);
  assert.equal(again.panels[0].sha256, moment.panels[0].sha256);
  assert.equal((await store.read<JobRecord>(jobPath(JOB)))?.publishedMomentId, moment.id);
  assert.equal((await listPublishedMoments(store)).length, 1);
});

// ---------- world ----------

const MAKERS = { ada: "6affb211-2319-4aab-a0b2-cc3bb7fe636a", bea: "80f06437-ae86-4da3-84a5-909dd69c8c6c", burkes: "6dab7153-79de-4f22-a73e-9ae5395e493e",
  tester: "65e3288d-baf0-4545-8c0e-3afffdaa18c9", newGuy: "2483f0c1-da0f-4b30-8c60-1cc515c272d5", ergo: "a0a42bf2-d2d4-434b-8a5c-5f3b0be045d3" };
const stored = (path: string, digit: string) => ({ caption: "A generated beat.", imagePath: path, sha256: digit.repeat(64) });
const roomRows = [
  seed,
  row("d75621be-9a2a-4c6a-8da8-db081d2d5a9e", ROOT_ID, MAKERS.ada, "Pilot Ada", "2026-10-03T07:46:43.59214+00:00", [stored("eb76a4ed-087a-4956-9eb3-4b1273b48dde/1.webp", "1")]),
  row("49a3df62-7338-48a8-b8ba-7e0043a8701e", "d75621be-9a2a-4c6a-8da8-db081d2d5a9e", MAKERS.burkes, "Burkes", "2026-10-03T08:23:48.814235+00:00", [stored("7bac09bf-4367-41ed-b2fa-aebac974bdce/1.webp", "2")]),
  row("76abea9a-7906-451e-9cb4-d196aca5da4f", "49a3df62-7338-48a8-b8ba-7e0043a8701e", MAKERS.tester, "Tester", "2026-10-12T03:16:42.510216+00:00", [stored("b3ec48cd-a8fa-4fe6-b46f-755e4c37a342/1.webp", "3")]),
  row("994974a3-880d-4432-8f82-8b81e1043322", "76abea9a-7906-451e-9cb4-d196aca5da4f", MAKERS.newGuy, "NewGuy", "2026-10-12T12:42:24.635007+00:00", [stored("ed8a6b77-ac5a-4c70-8641-8fa12692a215/1.webp", "4")]),
  row(RELEASE_PATH_TIP, "994974a3-880d-4432-8f82-8b81e1043322", MAKERS.ergo, "ErgoProxy", "2026-10-12T13:03:26.474119+00:00", [stored("92054894-e02f-4236-8089-7116c6113189/1.webp", "5")]),
  row("213c57f3-007e-4aa8-bbc4-88d90083be69", RELEASE_PATH_TIP, MAKERS.ergo, "ErgoProxy", "2026-10-13T06:36:37.39449+00:00", [stored("3fe0b9cd-6114-48f3-9771-9ac74a425192/1.webp", "6")]),
  // A newer side branch by someone else, off the release path.
  row("0781d532-6ad8-409c-8cc9-4c348ddf1013", "d75621be-9a2a-4c6a-8da8-db081d2d5a9e", MAKERS.bea, "Pilot Bea", "2026-10-13T07:00:00.000000+00:00", [stored("288882d4-fd42-4be1-b4cc-a9be35d71e9f/1.webp", "7")]),
];

function worldSource(rows: PilotMoment[], overrides: Partial<WorldSource> = {}): WorldSource & { signedPaths: string[][] } {
  const signedPaths: string[][] = [];
  return {
    signedPaths,
    room: async () => ({ id: ROOM, title: "The midnight signal", description: "A lighthouse. A missing keeper. A story we make together." }),
    moments: async () => rows,
    credits: async () => ({ limit: 14, used: 9, reserved: 0, available: 5, enabled: true }),
    async signedUrls(paths) {
      signedPaths.push(paths);
      // One path stays unsigned, as when storage refuses it.
      return new Map(paths.filter((path) => !path.startsWith("7bac09bf")).map((path) => [path, `https://storage.example/sign/pilot-media/${path}?token=t`]));
    },
    ...overrides,
  };
}

test("the world maps panels to page URLs and pins the kit", async (t) => {
  const store = await tempStore(t);
  const source = worldSource(roomRows);
  const world = await readWorld({ source, store });

  assert.deepEqual(world.room, { id: ROOM, title: "The midnight signal", description: "A lighthouse. A missing keeper. A story we make together." });
  assert.equal(world.kit.digest, kitDigest(CURRENT_KIT));
  assert.equal(world.kit.version, CURRENT_KIT.version);
  assert.deepEqual(world.kit.references.map((reference) => reference.imageUrl), ["/api/night-watch/art/0", "/api/night-watch/art/1", "/api/night-watch/art/2", "/api/night-watch/art/5"]);
  assert.deepEqual(world.credits, { limit: 14, used: 9, reserved: 0, available: 5, enabled: true });

  const byId = new Map(world.moments.map((moment) => [moment.id, moment]));
  assert.deepEqual(byId.get(ROOT_ID)?.panels.map((panel) => panel.imageUrl), ["/api/night-watch/art/0", "/api/night-watch/art/1"]);
  assert.equal(byId.get("d75621be-9a2a-4c6a-8da8-db081d2d5a9e")?.panels[0].imageUrl, "https://storage.example/sign/pilot-media/eb76a4ed-087a-4956-9eb3-4b1273b48dde/1.webp?token=t");
  assert.equal(byId.get("d75621be-9a2a-4c6a-8da8-db081d2d5a9e")?.panels[0].sha256, "1".repeat(64));
  assert.equal(byId.get("49a3df62-7338-48a8-b8ba-7e0043a8701e")?.panels[0].imageUrl, null);
  assert.equal(byId.get(ROOT_ID)?.source, "pilot");
  assert.equal(source.signedPaths.length, 1);
  assert.equal(source.signedPaths[0].length, 7);
  const times = world.moments.map((moment) => Date.parse(moment.createdAt));
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
});

test("the world defaults to the registered path and credits the newest other maker on it", async (t) => {
  const store = await tempStore(t);
  const world = await readWorld({ source: worldSource(roomRows), store });
  assert.equal(world.defaultForkPointId, RELEASE_PATH_TIP);
  // The side branch is newer but off the path; the starter has no maker.
  assert.deepEqual(world.friendContribution, { momentId: RELEASE_PATH_TIP, makerLabel: "ErgoProxy" });

  const asErgo = await readWorld({ source: worldSource(roomRows), store }, { viewerId: MAKERS.ergo });
  assert.deepEqual(asErgo.friendContribution, { momentId: "994974a3-880d-4432-8f82-8b81e1043322", makerLabel: "NewGuy" });

  const withoutPath = roomRows.filter((moment) => moment.id !== RELEASE_PATH_TIP && moment.parent_id !== RELEASE_PATH_TIP);
  const fallback = await readWorld({ source: worldSource(withoutPath), store });
  assert.equal(fallback.defaultForkPointId, "0781d532-6ad8-409c-8cc9-4c348ddf1013");
  assert.deepEqual(fallback.friendContribution, { momentId: "0781d532-6ad8-409c-8cc9-4c348ddf1013", makerLabel: "Pilot Bea" });

  const starterOnly = await readWorld({ source: worldSource([seed]), store });
  assert.equal(starterOnly.defaultForkPointId, ROOT_ID);
  assert.equal(starterOnly.friendContribution, null);

  const noCredits = await readWorld({ source: worldSource(roomRows, { credits: async () => { throw new Error("rpc down"); } }), store });
  assert.equal(noCredits.credits, null);
  await assert.rejects(readWorld({ source: worldSource(roomRows, { room: async () => null }), store }), (error: unknown) => error instanceof NightWatchError && error.status === 503);
});

test("the world lists published Night Watch moments after the room's own", async (t) => {
  const store = await tempStore(t);
  await readyJob(store, { forkPointId: RELEASE_PATH_TIP });
  const published = await publishCandidate({ store, now }, { id: MAKER }, JOB, 1);
  const world = await readWorld({ source: worldSource(roomRows), store });
  const last = world.moments.at(-1)!;
  assert.equal(last.id, published.id);
  assert.equal(last.source, "night-watch");
  assert.equal(last.parentId, RELEASE_PATH_TIP);
  assert.deepEqual(last.nightWatch, { jobId: JOB, kitVersion: "1", candidate: 1 });
  assert.deepEqual(last.panels, [{ caption: published.panels[0].caption, imageUrl: `/api/night-watch/moments/${published.id}/image`, sha256: published.panels[0].sha256 }]);
  // The default fork point stays on the registered path.
  assert.equal(world.defaultForkPointId, RELEASE_PATH_TIP);
});

// ---------- a fake Monad testnet ----------

type FakeRelease = { projectId: string; tipId: string; manifestHash: string; received: bigint; paid: bigint; beneficiaries: string[] };
type FakeReceipt = { status: number; blockNumber: number; blockHash: string; logs: { address: string; topics: string[]; data: string }[] };

function fakeChain() {
  const state = {
    block: 100,
    finalized: 100,
    releases: new Map<string, FakeRelease>(),
    claimable: new Map<string, bigint>(),
    claimed: new Map<string, bigint>(),
    /** Claimable at the latest block when it differs from the finalized one (a claim in flight). */
    latestClaimable: new Map<string, bigint>(),
    balances: new Map<string, bigint>(),
    defaultBalance: 5n * ONE,
    nonces: new Map<string, number>(),
    receipts: new Map<string, FakeReceipt>(),
    broadcasts: [] as string[],
    failNextBroadcasts: 0,
    agents: new Map<bigint, { owner: string; uri: string }>(),
    nextAgentId: 2312n,
  };
  const key = (releaseId: string, address: string) => `${releaseId.toLowerCase()}:${getAddress(address)}`;
  const claimableAt = (releaseId: string, address: string, latest: boolean) =>
    (latest ? state.latestClaimable.get(key(releaseId, address)) : undefined) ?? state.claimable.get(key(releaseId, address)) ?? 0n;

  function mine(raw: string) {
    const tx = Transaction.from(raw);
    const from = getAddress(tx.from!);
    state.nonces.set(from, (state.nonces.get(from) ?? 0) + 1);
    state.block += 1;
    const logs: FakeReceipt["logs"] = [];
    let status = 1;
    if (getAddress(tx.to!) === CONTRACT) {
      const call = releaseInterface.parseTransaction({ data: tx.data })!;
      if (call.name === "claim") {
        const [releaseId, beneficiary] = [String(call.args[0]), getAddress(String(call.args[1]))];
        const amount = claimableAt(releaseId, beneficiary, true);
        if (amount === 0n) status = 0;
        else {
          state.claimable.set(key(releaseId, beneficiary), 0n);
          state.latestClaimable.delete(key(releaseId, beneficiary));
          state.claimed.set(key(releaseId, beneficiary), (state.claimed.get(key(releaseId, beneficiary)) ?? 0n) + amount);
          const log = releaseInterface.encodeEventLog("Claimed", [releaseId, beneficiary, amount]);
          logs.push({ address: CONTRACT, topics: log.topics, data: log.data });
        }
      }
    } else if (getAddress(tx.to!) === IDENTITY_REGISTRY) {
      const call = identityInterface.parseTransaction({ data: tx.data })!;
      const agentId = state.nextAgentId++;
      state.agents.set(agentId, { owner: from, uri: String(call.args[0]) });
      const log = identityInterface.encodeEventLog("Registered", [agentId, String(call.args[0]), from]);
      logs.push({ address: IDENTITY_REGISTRY, topics: log.topics, data: log.data });
    }
    state.receipts.set(tx.hash!, { status, blockNumber: state.block, blockHash: `0x${state.block.toString(16).padStart(64, "0")}`, logs });
    state.finalized = state.block;
  }

  const provider = {
    getNetwork: async () => ({ chainId: 10143n }),
    getBlock: async (tag: string | number) => ({ number: tag === "finalized" ? state.finalized : state.block }),
    getBalance: async (address: string) => state.balances.get(getAddress(address)) ?? state.defaultBalance,
    getTransactionCount: async (address: string) => state.nonces.get(getAddress(address)) ?? 0,
    getFeeData: async () => ({ gasPrice: 102_000_000_000n, maxFeePerGas: 202_000_000_000n, maxPriorityFeePerGas: 2_000_000_000n }),
    getTransaction: async (hash: string) => (state.receipts.has(hash) ? { hash } : null),
    getTransactionReceipt: async (hash: string) => state.receipts.get(hash) ?? null,
    async broadcastTransaction(raw: string) {
      state.broadcasts.push(raw);
      if (state.failNextBroadcasts > 0) {
        state.failNextBroadcasts -= 1;
        throw new Error("socket hang up");
      }
      const tx = Transaction.from(raw);
      if (tx.nonce !== (state.nonces.get(getAddress(tx.from!)) ?? 0)) throw new Error("nonce too low");
      mine(raw);
      return { hash: Transaction.from(raw).hash };
    },
    async estimateGas(tx: { to: string; data: string }) {
      if (getAddress(tx.to) === IDENTITY_REGISTRY) return 600_000n;
      const call = releaseInterface.parseTransaction({ data: tx.data })!;
      if (call.name === "claim" && claimableAt(String(call.args[0]), String(call.args[1]), true) === 0n) {
        throw Object.assign(new Error("execution reverted"), { code: "CALL_EXCEPTION", data: releaseInterface.encodeErrorResult("NothingToClaim", []) });
      }
      return 110_000n;
    },
    async call(tx: { to: string; data: string; blockTag?: string | number }) {
      const latest = tx.blockTag === undefined || tx.blockTag === "latest";
      if (getAddress(tx.to) === IDENTITY_REGISTRY) {
        const call = identityInterface.parseTransaction({ data: tx.data })!;
        const agent = state.agents.get(BigInt(call.args[0]));
        if (!agent) throw Object.assign(new Error("execution reverted"), { code: "CALL_EXCEPTION" });
        return identityInterface.encodeFunctionResult(call.name, [call.name === "ownerOf" ? agent.owner : agent.uri]);
      }
      const call = releaseInterface.parseTransaction({ data: tx.data })!;
      if (call.name === "getRelease") {
        const release = state.releases.get(String(call.args[0]).toLowerCase());
        return releaseInterface.encodeFunctionResult("getRelease", release
          ? [release.projectId, release.tipId, release.manifestHash, release.received, release.paid, release.beneficiaries]
          : [ZeroHash, ZeroHash, ZeroHash, 0n, 0n, []]);
      }
      if (call.name === "claimable") return releaseInterface.encodeFunctionResult("claimable", [claimableAt(String(call.args[0]), String(call.args[1]), latest)]);
      if (call.name === "claimed") return releaseInterface.encodeFunctionResult("claimed", [state.claimed.get(key(String(call.args[0]), String(call.args[1]))) ?? 0n]);
      throw new Error(`Unexpected call ${call.name}`);
    },
    destroy() {},
  };

  function addRelease(id: string, beneficiaries: string[], received: bigint) {
    state.releases.set(id.toLowerCase(), { projectId: `0x${"11".repeat(32)}`, tipId: `0x${"22".repeat(32)}`, manifestHash: `0x${"33".repeat(32)}`, received, paid: 0n, beneficiaries });
    for (const address of beneficiaries) state.claimable.set(key(id, address), received / BigInt(beneficiaries.length));
  }

  const client = new ReleaseClient(config, provider as unknown as AbstractProvider);
  // The fake has no contract bytecode to hash; the code and policy check is the client's own concern.
  client.verify = async () => {};
  return { state, provider: provider as unknown as AbstractProvider, client, addRelease, key };
}

const helperWallet = new Wallet(`0x${"5a".repeat(32)}`);
const authorizationKey = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey;

function fakePrivy(tamper?: (tx: TransactionLike) => TransactionLike) {
  const calls: { walletId: string; request: UnsignedEvmTransaction; idempotencyKey?: string }[] = [];
  return {
    calls,
    privy: {
      async signTransaction(walletId: string, request: UnsignedEvmTransaction, _keys: unknown[], idempotencyKey?: string) {
        calls.push({ walletId, request, idempotencyKey });
        const tx: TransactionLike = {
          type: 2, to: request.to, data: request.data, value: BigInt(request.value ?? "0x0"), chainId: request.chain_id, nonce: request.nonce,
          gasLimit: BigInt(request.gas_limit!), maxFeePerGas: BigInt(request.max_fee_per_gas!), maxPriorityFeePerGas: BigInt(request.max_priority_fee_per_gas!),
        };
        return helperWallet.signTransaction(tamper ? tamper(tx) : tx);
      },
    },
  };
}

function claimHelper(store: NightWatchStore, chain: ReturnType<typeof fakeChain>, privy = fakePrivy()): ClaimHelper & { calls: ReturnType<typeof fakePrivy>["calls"] } {
  return {
    config, walletId: "privy-helper-wallet", address: helperWallet.address, authorizationKey, privy: privy.privy, client: chain.client, store,
    now, timing: { pollMs: 1, receiptTimeoutMs: 30, finalizedTimeoutMs: 30 }, calls: privy.calls,
  };
}

// ---------- claim helper ----------

test("the claim helper refuses a wallet that is not a frozen recipient, or has nothing to claim, without signing", async (t) => {
  const store = await tempStore(t);
  const chain = fakeChain();
  chain.addRelease(RELEASE_ID, [A, B], 2n * ONE);
  const helper = claimHelper(store, chain);
  const refused = (code: string, message: RegExp) => (error: unknown) => error instanceof ClaimRefused && error.code === code && message.test(error.message);

  await assert.rejects(runClaim(helper, RELEASE_ID, STRANGER), refused("not_beneficiary", /not a frozen recipient/));
  await assert.rejects(runClaim(helper, `0x${"cd".repeat(32)}`, A), refused("unknown_release", /not frozen/));
  chain.state.claimable.set(chain.key(RELEASE_ID, A), 0n);
  await assert.rejects(runClaim(helper, RELEASE_ID, A), refused("nothing_to_claim", /nothing left to claim/));
  // Claimable at the finalized block but already claimed in a newer block: still nothing to sign.
  chain.state.latestClaimable.set(chain.key(RELEASE_ID, B), 0n);
  await assert.rejects(runClaim(helper, RELEASE_ID, B), refused("nothing_to_claim", /nothing left to claim/));
  chain.state.latestClaimable.clear();
  chain.state.balances.set(helperWallet.address, 0n);
  await assert.rejects(runClaim(helper, RELEASE_ID, B), refused("helper_unfunded", /no test MON for gas/));

  assert.equal(helper.calls.length, 0);
  assert.equal(chain.state.broadcasts.length, 0);
});

test("the claim helper refuses a signed transaction that differs from the claim it asked for", async (t) => {
  const store = await tempStore(t);
  const chain = fakeChain();
  chain.addRelease(RELEASE_ID, [A, B], 2n * ONE);
  const redirect = releaseInterface.encodeFunctionData("claim", [RELEASE_ID, STRANGER]);
  const cases: [string, (tx: TransactionLike) => TransactionLike][] = [
    ["another beneficiary", (tx) => ({ ...tx, data: redirect })],
    ["a larger gas limit", (tx) => ({ ...tx, gasLimit: BigInt(tx.gasLimit!) * 10n })],
    ["another nonce", (tx) => ({ ...tx, nonce: Number(tx.nonce) + 1 })],
  ];
  for (const [label, tamper] of cases) {
    const helper = claimHelper(store, chain, fakePrivy(tamper));
    await assert.rejects(runClaim(helper, RELEASE_ID, A), (error: unknown) => error instanceof ClaimRefused && error.code === "signature_mismatch", label);
    assert.equal(helper.calls.length, 1, label);
  }
  assert.equal(chain.state.broadcasts.length, 0);
  assert.equal(await readClaim(store, RELEASE_ID, A), null);
});

test("a claim whose broadcast was lost is re-sent from the saved bytes, never signed again", async (t) => {
  const store = await tempStore(t);
  const chain = fakeChain();
  chain.addRelease(RELEASE_ID, [A, B], 2n * ONE);
  const helper = claimHelper(store, chain);

  chain.state.failNextBroadcasts = 1;
  await assert.rejects(runClaim(helper, RELEASE_ID, A), (error: unknown) => error instanceof ClaimRefused && error.code === "broadcast_failed");
  const saved = await readClaim(store, RELEASE_ID, A);
  assert.equal(saved?.state, "signed");
  assert.equal(helper.calls.length, 1);
  assert.match(helper.calls[0].idempotencyKey ?? "", /^nw-claim-[a-f0-9]{32}$/);

  const claim = await runClaim(helper, RELEASE_ID, A);
  assert.equal(helper.calls.length, 1, "the retry must not ask Privy for a second signature");
  assert.deepEqual(chain.state.broadcasts, [saved!.rawTransaction, saved!.rawTransaction]);
  assert.equal(claim.hash, saved!.hash);
  assert.equal(claim.state, "finalized");
  assert.equal(claim.claimedWei, ONE.toString());
  assert.equal(claim.amountWei, ONE.toString());
  assert.equal(claim.finalizedBlock, chain.state.finalized);

  // A repeat finds nothing left and sends nothing.
  await assert.rejects(runClaim(helper, RELEASE_ID, A), (error: unknown) => error instanceof ClaimRefused && error.code === "nothing_to_claim");
  assert.equal(helper.calls.length, 1);
  assert.equal(chain.state.broadcasts.length, 2);
  const events = await store.readEvents("claims/events");
  assert.deepEqual(events.map((event) => event.event), ["signed", "finalized"]);
});

test("claims for two recipients at once take turns on the helper wallet, so their nonces never collide", async (t) => {
  const store = await tempStore(t);
  const chain = fakeChain();
  chain.addRelease(RELEASE_ID, [A, B], 2n * ONE);
  const helper = claimHelper(store, chain);
  const [first, second] = await Promise.all([runClaim(helper, RELEASE_ID, A), runClaim(helper, RELEASE_ID, B)]);
  assert.deepEqual([first.state, second.state], ["finalized", "finalized"]);
  assert.deepEqual([first.nonce, second.nonce].sort(), [0, 1]);
  assert.equal(helper.calls.length, 2);
  assert.equal(chain.state.broadcasts.length, 2);
});

// ---------- edition ----------

test("the edition returns the path rows, the release at the finalized block and the saved claims", async (t) => {
  const store = await tempStore(t);
  await readyJob(store);
  const published = await publishCandidate({ store, now }, { id: MAKER }, JOB, 1);
  const chain = fakeChain();
  const prepared = prepareRelease([seed, toPilotMoment(published)], ROOM, published.id, CURATOR);
  chain.addRelease(prepared.id, [A, B], ONE);
  await store.write("privy/setup", {
    version: 1, appId: "app", keyQuorumId: "quorum", publicKey: "key", createdAt: now().toISOString(),
    claimHelper: { walletId: "privy-helper-wallet", address: helperWallet.address, policyId: "policy", createdAt: now().toISOString() },
  });
  const claim = await runClaim(claimHelper(store, chain), prepared.id, B);
  assert.equal(claim.state, "finalized");

  const deps = { store, pilotMoments: async () => [seed], config, client: chain.client };
  const edition = await editionFor(deps, published.id);
  assert.equal(edition.tipId, published.id);
  assert.deepEqual(edition.moments.map((moment) => moment.id), [ROOT_ID, published.id]);
  assert.deepEqual(edition.moments[1], toPilotMoment(published));
  assert.deepEqual(edition.release, {
    id: prepared.id, projectId: prepared.projectId, tipId: prepared.tipId, manifestHash: prepared.hash,
    beneficiaries: [
      { address: A, claimableWei: (ONE / 2n).toString(), claimedWei: "0" },
      { address: B, claimableWei: "0", claimedWei: (ONE / 2n).toString() },
    ],
    receivedWei: ONE.toString(), paidWei: "0", exists: true, finalizedBlock: chain.state.finalized,
  });
  assert.deepEqual(edition.claims, [{
    releaseId: prepared.id, beneficiary: B, state: "finalized", hash: claim.hash, amountWei: (ONE / 2n).toString(), claimedWei: (ONE / 2n).toString(),
    explorerUrl: `https://testnet.monadscan.com/tx/${claim.hash}`, updatedAt: claim.updatedAt,
  }]);
  assert.deepEqual(edition.helper, { address: helperWallet.address, balanceWei: (5n * ONE).toString() });

  await assert.rejects(editionFor(deps, "not-a-moment"), (error: unknown) => error instanceof NightWatchError && error.status === 400);
  await assert.rejects(editionFor(deps, "20000000-0000-4000-8000-000000000009"), (error: unknown) => error instanceof NightWatchError && error.status === 404);
  const unconfigured = await editionFor({ ...deps, config: null }, published.id);
  assert.equal(unconfigured.release, null);
  assert.equal(unconfigured.moments.length, 2);

  // An unreadable chain keeps the rows and reports no release rather than failing the page.
  const offline = fakeChain();
  offline.client.verify = async () => {
    throw new Error("network down");
  };
  const quiet = t.mock.method(console, "error", () => {});
  const withoutChain = await editionFor({ ...deps, client: offline.client }, published.id);
  quiet.mock.restore();
  assert.equal(withoutChain.release, null);
  assert.equal(withoutChain.helper, null);
  assert.equal(withoutChain.moments.length, 2);
  assert.equal(withoutChain.claims.length, 1);
});

// ---------- identity ----------

test("the registration file is an ERC-8004 registration with one web service and no payment claim", () => {
  const file = registrationFile();
  assert.deepEqual(Object.keys(file), ["type", "name", "description", "services", "x402Support", "active", "supportedTrust"]);
  assert.equal(file.type, "https://eips.ethereum.org/EIPS/eip-8004#registration-v1");
  assert.equal(file.name, "Night Watch");
  assert.deepEqual(file.services, [{ name: "web", endpoint: "http://127.0.0.1:3005/night-watch" }]);
  assert.equal(file.x402Support, false);
  assert.equal(file.active, true);
  assert.deepEqual(file.supportedTrust, ["reputation"]);
  assert.match(file.description, /testnet/);
  assert.doesNotMatch(file.description, /mainnet|audited|real money|funded credits|patron paid/i);
  assert.equal(registrationFile({ image: "https://example.com/night-watch.png" }).image, "https://example.com/night-watch.png");

  const uri = agentUri(file);
  assert.match(uri, /^data:application\/json;base64,[A-Za-z0-9+/]+=*$/);
  assert.deepEqual(JSON.parse(Buffer.from(uri.split(",")[1], "base64").toString("utf8")), file);
  assert.deepEqual(decodeAgentUri(uri), file);
  assert.equal(decodeAgentUri("https://example.com/agent.json"), null);
});

test("the companion registers once from the helper wallet and reads back as an identity card", async (t) => {
  const store = await tempStore(t);
  const chain = fakeChain();
  const privy = fakePrivy();
  const signer = { walletId: "privy-helper-wallet", address: helperWallet.address, authorizationKey, privy: privy.privy };
  const timing = { pollMs: 1, receiptTimeoutMs: 30, finalizedTimeoutMs: 30 };

  const record = await registerIdentity({ store, provider: chain.provider, signer, steward: "Wenjie", now, timing });
  assert.equal(record.state, "finalized");
  assert.equal(record.agentId, "2312");
  assert.equal(record.owner, helperWallet.address);
  assert.equal(privy.calls.length, 1);
  assert.equal(getAddress(privy.calls[0].request.to), IDENTITY_REGISTRY);
  assert.deepEqual([...identityInterface.decodeFunctionData("register", privy.calls[0].request.data!)], [agentUri(registrationFile())]);

  await assert.rejects(registerIdentity({ store, provider: chain.provider, signer, now, timing }), (error: unknown) => error instanceof IdentityRefused && error.code === "already_registered");
  assert.equal(privy.calls.length, 1);
  assert.equal(chain.state.broadcasts.length, 1);

  const card = await readIdentity({ store, provider: chain.provider });
  assert.equal(card.registered, true);
  assert.equal(card.chainId, 10143);
  assert.equal(card.registry, IDENTITY_REGISTRY);
  assert.equal(card.agentId, "2312");
  assert.equal(card.owner, helperWallet.address);
  assert.equal(card.agentURI, record.agentURI);
  assert.equal(card.transaction, record.hash);
  assert.equal(card.explorerUrl, `https://testnet.monadscan.com/tx/${record.hash}`);
  assert.equal(card.note, IDENTITY_NOTE);
  assert.equal(card.note, "An identity registration on a draft standard. It does not prove quality, ownership or trust.");
  assert.equal(card.card.steward, "Wenjie");
  assert.equal(card.card.service, "http://127.0.0.1:3005/night-watch");
  assert.equal(card.card.kitVersion, `${CURRENT_KIT.id}@${CURRENT_KIT.version}`);
  assert.deepEqual(card.card.capabilities, [
    "can plan a night with Kimi K3 and have it check its own plan against the world kit (via TokenRouter); otherwise it uses the plain prompts",
    "prepares private candidates",
    "buys one capped room top-up with a maker-approved Privy signer",
    "pays gas to deliver release claims",
  ]);

  // Someone else's token, or a changed URI, is not this registration.
  chain.state.agents.set(2312n, { owner: STRANGER, uri: record.agentURI });
  assert.equal((await readIdentity({ store, provider: chain.provider })).registered, false);

  const empty = await readIdentity({ store: await tempStore(t), provider: null, helperAddress: helperWallet.address });
  assert.equal(empty.registered, false);
  assert.equal(empty.agentId, null);
  assert.equal(empty.transaction, null);
  assert.equal(empty.card.name, "Night Watch");
  assert(empty.card.evidence.some((item) => item.url.endsWith(helperWallet.address)));
});

// ---------- routes ----------

/** Sets environment variables for one test (undefined deletes one) and restores them afterwards. */
function withEnv(t: TestContext, values: Record<string, string | undefined>) {
  const set = (entries: [string, string | undefined][]) => {
    for (const [key, value] of entries) if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };
  const saved = Object.keys(values).map((key) => [key, process.env[key]] as [string, string | undefined]);
  t.after(() => set(saved));
  set(Object.entries(values));
}

/** Resolves the app's "@/" alias as Next does. */
function aliases(t: TestContext) {
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (!specifier.startsWith("@/")) return next(specifier, context);
      return next(new URL(`../../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    },
  });
  t.after(() => hooks.deregister());
}

const local = (method: string, path: string, headers: Record<string, string> = {}, origin = "http://127.0.0.1:3005") => {
  const url = new URL(path, origin);
  return new Request(url, { method, headers: { host: url.host, ...headers }, ...(method === "POST" ? { body: "{}" } : {}) });
};

async function myRoutes(momentId = momentIdForJob(JOB)): Promise<[string, string, (request: Request) => Promise<Response>][]> {
  const world = await import("../../src/app/api/night-watch/world/route.ts");
  const publish = await import("../../src/app/api/night-watch/jobs/[id]/publish/route.ts");
  const image = await import("../../src/app/api/night-watch/moments/[id]/image/route.ts");
  const art = await import("../../src/app/api/night-watch/art/[frame]/route.ts");
  const edition = await import("../../src/app/api/night-watch/edition/route.ts");
  const claims = await import("../../src/app/api/night-watch/claims/route.ts");
  const identity = await import("../../src/app/api/night-watch/identity/route.ts");
  for (const module of [world, publish, image, art, edition, claims, identity]) assert.equal(module.runtime, "nodejs");
  return [
    ["GET", "/api/night-watch/world", (request) => world.GET(request)],
    ["POST", `/api/night-watch/jobs/${JOB}/publish`, (request) => publish.POST(request, { params: Promise.resolve({ id: JOB }) })],
    ["GET", `/api/night-watch/moments/${momentId}/image`, (request) => image.GET(request, { params: Promise.resolve({ id: momentId }) })],
    ["GET", "/api/night-watch/art/0", (request) => art.GET(request, { params: Promise.resolve({ frame: "0" }) })],
    ["GET", `/api/night-watch/edition?tip=${ROOT_ID}`, (request) => edition.GET(request)],
    ["POST", "/api/night-watch/claims", (request) => claims.POST(request)],
    ["GET", "/api/night-watch/identity", (request) => identity.GET(request)],
  ];
}

test("every route looks absent unless local controls are on and the request is loopback", async (t) => {
  aliases(t);
  withEnv(t, { PILOT_LOCAL_CONTROLS: undefined, VERCEL: undefined });
  const routes = await myRoutes();
  for (const [method, path, call] of routes) {
    const response = await call(local(method, path));
    assert.equal(response.status, 404, `${path} with local controls off`);
    assert.deepEqual(await response.json(), { error: "Not found." });
  }
  withEnv(t, { PILOT_LOCAL_CONTROLS: "1" });
  for (const [method, path, call] of routes) {
    assert.equal((await call(local(method, path, {}, "http://night-watch.example.com"))).status, 404, `${path} from another host`);
    assert.equal((await call(local(method, path, { origin: "https://elsewhere.example" }))).status, 404, `${path} from another site`);
  }
  withEnv(t, { VERCEL: "1" });
  for (const [method, path, call] of routes) assert.equal((await call(local(method, path))).status, 404, `${path} on Vercel`);
});

test("publishing and claiming need a signed-in maker", async (t) => {
  aliases(t);
  withEnv(t, { PILOT_LOCAL_CONTROLS: "1", VERCEL: undefined });
  const routes = new Map((await myRoutes()).map(([method, path, call]) => [`${method} ${path.split("?")[0]}`, call]));
  for (const key of [`POST /api/night-watch/jobs/${JOB}/publish`, "POST /api/night-watch/claims"]) {
    const [method, path] = key.split(" ");
    const response = await routes.get(key)!(local(method, path));
    assert.equal(response.status, 401, key);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await response.json()).code, "sign_in");
  }
});

test("a published moment's image and the kit's art frames are served locally without sign-in", async (t) => {
  aliases(t);
  const store = await tempStore(t);
  withEnv(t, { PILOT_LOCAL_CONTROLS: "1", VERCEL: undefined, NIGHT_WATCH_DIR: store.root });
  await readyJob(store);
  const moment = await publishCandidate({ store, now }, { id: MAKER }, JOB, 1);
  const routes = await myRoutes(moment.id);
  const call = (path: string) => routes.find(([, candidate]) => candidate === path)![2];

  const image = await call(`/api/night-watch/moments/${moment.id}/image`)(local("GET", `/api/night-watch/moments/${moment.id}/image`));
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/webp");
  assert.equal(image.headers.get("cache-control"), "no-store");
  assert.equal(sha256(Buffer.from(await image.arrayBuffer())), moment.panels[0].sha256);

  const { GET: imageRoute } = await import("../../src/app/api/night-watch/moments/[id]/image/route.ts");
  for (const id of ["20000000-0000-4000-8000-000000000009", "../../privy/setup"]) {
    const missing = await imageRoute(local("GET", "/api/night-watch/moments/x/image"), { params: Promise.resolve({ id }) });
    assert.equal(missing.status, 404, id);
  }

  const frame = await call("/api/night-watch/art/0")(local("GET", "/api/night-watch/art/0"));
  assert.equal(frame.status, 200);
  assert.equal(frame.headers.get("content-type"), "image/png");
  assert.equal(Buffer.from(await frame.arrayBuffer()).subarray(1, 4).toString("ascii"), "PNG");
  const { GET: artRoute } = await import("../../src/app/api/night-watch/art/[frame]/route.ts");
  for (const value of ["6", "-1", "01", "x"]) {
    assert.equal((await artRoute(local("GET", `/api/night-watch/art/${value}`), { params: Promise.resolve({ frame: value }) })).status, 404, value);
  }
});

test("the moment id publish derives from a job is a stable UUID the release code accepts", () => {
  const id = momentIdForJob(JOB);
  assert.equal(id, momentIdForJob(JOB));
  assert.notEqual(id, momentIdForJob(`nwj_${"c".repeat(32)}`));
  assert(isUuid(id));
  const panel: NightWatchMoment["panels"][number] = { caption: "A beat.", imagePath: `${id}/1.webp`, sha256: "f".repeat(64) };
  assert.deepEqual(pilotPanels([panel]), [panel]);
});
