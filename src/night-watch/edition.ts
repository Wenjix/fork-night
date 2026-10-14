import { getAddress, ZeroHash } from "ethers";
import { ReleaseClient } from "../lib/onchain/client.ts";
import { releaseConfig, type ReleaseConfig } from "../lib/onchain/config.ts";
import { ORIGINAL_ROOM, prepareRelease, type PreparedRelease } from "../lib/onchain/model.ts";
import { isUuid, pilotPath, type PilotMoment } from "../lib/pilot.ts";
import type { EditionResponse } from "./api-types.ts";
import { claimView, listClaims } from "./claim-helper.ts";
import { NightWatchError } from "./http.ts";
import { errorText } from "./monad-tx.ts";
import { readPrivySetup } from "./privy-setup.ts";
import { listPublishedMoments, toPilotMoment } from "./publish.ts";
import { fileNightWatchStore, type NightWatchStore } from "./store.ts";
import { readPilotMoments } from "./world.ts";

/**
 * The morning edition behind GET /api/night-watch/edition?tip=<momentId>: the story path as the
 * PilotMoment rows `<TestnetRelease>` takes, and the release as Monad testnet reports it at the
 * finalized block, with the claim helper's saved claims. Server only; it reads and never sends.
 */

export type EditionDeps = {
  store: NightWatchStore;
  pilotMoments: () => Promise<PilotMoment[]>;
  config: ReleaseConfig | null;
  /** A ready client (tests pass one over a fake provider); otherwise one is built from `config`. */
  client?: ReleaseClient;
};

/** The shared room's moments plus the moments published here, as release rows. */
export async function editionRows(deps: Pick<EditionDeps, "store" | "pilotMoments">): Promise<PilotMoment[]> {
  const [pilot, published] = await Promise.all([deps.pilotMoments(), listPublishedMoments(deps.store)]);
  const rows = new Map<string, PilotMoment>();
  for (const moment of pilot) if (moment.room_id === ORIGINAL_ROOM) rows.set(moment.id, moment);
  for (const moment of published) if (!rows.has(moment.id)) rows.set(moment.id, toPilotMoment(moment));
  return [...rows.values()];
}

type ReleaseTuple = [string, string, string, bigint, bigint, string[]];

async function readRelease(client: ReleaseClient, prepared: PreparedRelease, helperAddress: string | null) {
  await client.verify();
  const finalized = await client.provider.getBlock("finalized");
  if (!finalized) throw new Error("Monad testnet did not report a finalized block.");
  const at = { blockTag: finalized.number };
  const release = (await client.contract.getRelease(prepared.id, at)) as ReleaseTuple;
  const exists = release[0] !== ZeroHash;
  const addresses = exists ? release[5].map((address) => getAddress(address)) : [];
  const beneficiaries = await Promise.all(
    addresses.map(async (address) => {
      const [claimable, claimed] = await Promise.all([client.contract.claimable(prepared.id, address, at), client.contract.claimed(prepared.id, address, at)]);
      return { address, claimableWei: BigInt(claimable).toString(), claimedWei: BigInt(claimed).toString() };
    }),
  );
  const helper = helperAddress ? { address: helperAddress, balanceWei: (await client.provider.getBalance(helperAddress, finalized.number)).toString() } : null;
  return {
    release: {
      id: prepared.id,
      projectId: prepared.projectId,
      tipId: prepared.tipId,
      manifestHash: prepared.hash,
      beneficiaries,
      receivedWei: BigInt(release[3]).toString(),
      paidWei: BigInt(release[4]).toString(),
      exists,
      finalizedBlock: finalized.number,
    },
    helper,
  };
}

/**
 * The edition for one tip. `release` is null when the release contract is not configured or Monad
 * testnet could not be read; the rows are returned either way so the page can still render the path.
 */
export async function editionFor(deps: EditionDeps, tipId: string): Promise<EditionResponse> {
  if (!isUuid(tipId)) throw new NightWatchError(400, "invalid_tip", "Choose a published moment for the edition.");
  const rows = await editionRows(deps);
  let path: PilotMoment[];
  try {
    path = pilotPath(rows, ORIGINAL_ROOM, tipId);
  } catch {
    throw new NightWatchError(404, "unknown_tip", "That moment is not part of The Midnight Signal's published story.");
  }
  const response: EditionResponse = { tipId, moments: path, release: null, claims: [], helper: null };
  if (!deps.config) return response;

  let prepared: PreparedRelease;
  try {
    prepared = prepareRelease(rows, ORIGINAL_ROOM, tipId, deps.config.curator);
  } catch (error) {
    throw new NightWatchError(409, "not_releasable", errorText(error));
  }
  response.claims = (await listClaims(deps.store, prepared.id)).map(claimView);
  const helperAddress = (await readPrivySetup(deps.store))?.claimHelper?.address ?? null;
  const client = deps.client ?? new ReleaseClient(deps.config);
  try {
    const onChain = await readRelease(client, prepared, helperAddress);
    response.release = onChain.release;
    response.helper = onChain.helper;
  } catch (error) {
    console.error("[night-watch] the edition could not read Monad testnet:", errorText(error).slice(0, 200));
  } finally {
    if (!deps.client) client.destroy();
  }
  return response;
}

export function localEditionDeps(): EditionDeps {
  return { store: fileNightWatchStore(), pilotMoments: () => readPilotMoments(), config: releaseConfig() };
}
