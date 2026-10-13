import { AbiCoder, getAddress, id, keccak256, parseEther, toUtf8Bytes, ZeroHash } from "ethers";
import { pilotPanels, pilotPath, type PilotMoment } from "../pilot.ts";

export const RELEASE_TERMS = "fork-night/testnet-release/v1: Original or permitted public work only. Each admitted maker registers from their own wallet and authorizes inclusion in a selected release. Each distinct registered wallet in the complete ancestry receives an equal cumulative share of native testnet payments. Curating or funding alone earns no share. Wallets do not prove distinct people or copyright. Admission is attested by the curator. Frozen releases and beneficiaries cannot be changed. Test tokens have no redemption value. This does not grant franchise rights or commercial rights outside this testnet release.";
export const TERMS_HASH = id(RELEASE_TERMS);
export const POLICY_HASH = id("fork-night/equal-wallets/v1");
export const ORIGINAL_ROOM = "midnight-signal";
export const ORIGINAL_ART_SHA256 = "47bcf853fe971bb0e88ae6d4d22f9d929b81f8b0736fd69423fea329033b5b45";
export const DEFAULT_SUPPORT_MON = "1";
export const MAX_SUPPORT_MON = "10";
export const MAX_SUPPORT_WEI = parseEther(MAX_SUPPORT_MON);
const coder = AbiCoder.defaultAbiCoder();
export const sourceKey = (sourceId: string) => id(`fork-night/source/${sourceId}`);
export const makerKey = (makerId: string | null) => id(`fork-night/maker/${makerId ?? "declared-original-seed"}`);
export const projectKey = (curator: string, roomId: string) => keccak256(coder.encode(["address", "bytes32"], [getAddress(curator), sourceKey(roomId)]));
export const momentKey = (projectId: string, makerId: string | null, momentId: string) => keccak256(coder.encode(["bytes32", "bytes32", "bytes32"], [projectId, makerKey(makerId), sourceKey(momentId)]));
export const releaseKey = (projectId: string, tipId: string, hash: string) => keccak256(coder.encode(["bytes32", "bytes32", "bytes32"], [projectId, tipId, hash]));

export function sceneManifest(moment: PilotMoment) {
  const panels = pilotPanels(moment.panels).map(panel => {
    if (panel.imageUrl && panel.imageUrl.split("#")[0] !== "/art/midnight-story.webp") throw new Error("This prepared artwork is outside the original release proof.");
    return { ...panel, sha256: panel.sha256 ?? ORIGINAL_ART_SHA256 };
  });
  return { version: "fork-night/moment/v1", roomId: moment.room_id, id: moment.id, parentId: moment.parent_id,
    makerId: moment.maker_id, makerLabel: moment.maker_label, title: moment.title,
    panels, publishedAt: moment.created_at, termsHash: TERMS_HASH };
}
export const manifestHash = (manifest: unknown) => keccak256(toUtf8Bytes(JSON.stringify(manifest)));
export function prepareRelease(moments: PilotMoment[], roomId: string, tip: string, curator: string) {
  if (roomId !== ORIGINAL_ROOM) throw new Error("The testnet release flow is available for the original Midnight Signal room.");
  const path = pilotPath(moments, roomId, tip);
  if (!path.length) throw new Error("Select a complete published story path.");
  const projectId = projectKey(curator, roomId);
  const scenes = path.map((moment, index) => ({ moment, sourceKey: sourceKey(moment.id), id: momentKey(projectId, moment.maker_id, moment.id),
    parentId: index > 0 ? momentKey(projectId, path[index - 1].maker_id, path[index - 1].id) : ZeroHash,
    makerId: makerKey(moment.maker_id), hash: manifestHash(sceneManifest(moment)) }));
  const manifest = { version: "fork-night/release/v1", projectId, policyHash: POLICY_HASH, termsHash: TERMS_HASH,
    scenes: path.map(sceneManifest) };
  const hash = manifestHash(manifest), tipId = scenes.at(-1)!.id;
  return { projectId, tipId, scenes, manifest, hash, id: releaseKey(projectId, tipId, hash) };
}
export type PreparedRelease = ReturnType<typeof prepareRelease>;
export function supportAmount(value: string): bigint {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value)) throw new Error("Enter a positive test MON amount with up to 18 decimal places.");
  const amount = parseEther(value);
  if (amount <= 0n || amount > MAX_SUPPORT_WEI) throw new Error(`Choose more than zero and at most ${MAX_SUPPORT_MON} test MON for this rehearsal.`);
  return amount;
}
export function sameAddress(a: string, b: string) { return a.toLowerCase() === b.toLowerCase(); }
