import type { Snapshot } from "../../src/lib/onchain/client.ts";
import type { ReleaseConfig } from "../../src/lib/onchain/config.ts";
import { prepareRelease } from "../../src/lib/onchain/model.ts";
import type { PilotMoment } from "../../src/lib/pilot.ts";

export const curator = "0x0000000000000000000000000000000000000001";
export const makerWallet = "0x0000000000000000000000000000000000000002";
export const otherWallet = "0x0000000000000000000000000000000000000003";
export const config: ReleaseConfig = { chainId: 10143, address: "0x0000000000000000000000000000000000000004", curator, rpcUrl: "https://example.invalid", explorer: "", name: "Monad testnet" };
export const makers = [null, "20000000-0000-4000-8000-000000000001", "20000000-0000-4000-8000-000000000002", "20000000-0000-4000-8000-000000000003"];
export const moments: PilotMoment[] = ["Room starter", "Pilot Ada", "Burkes", "Tester"].map((label, index) => ({
  id: `10000000-0000-4000-8000-00000000000${index + 1}`,
  parent_id: index ? `10000000-0000-4000-8000-00000000000${index}` : null,
  room_id: "midnight-signal", maker_id: makers[index], maker_label: label, title: `${label}'s scene`,
  panels: [{ caption: "An original scene.", imageUrl: "/art/midnight-story.webp#frame=0" }],
  created_at: "2026-10-12T03:00:00Z", source_kind: "fixture", source_idea_id: null, source_idea_label: null, source_idea_body: null,
}));
export const prepared = prepareRelease(moments, "midnight-signal", moments.at(-1)!.id, curator);
export function snapshot({ registered = [true, false, false, false], wallets = [curator, curator, curator, makerWallet] } = {}): Snapshot {
  return { block: 100, curator, root: prepared.scenes[0].id, termsMatch: true,
    scenes: prepared.scenes.map((scene, index) => ({ id: scene.id, maker: wallets[index], registered: registered[index], matches: registered[index] })),
    release: { exists: false, received: 0n, paid: 0n, beneficiaries: [] } };
}
export const transactionHash = `0x${"1".repeat(64)}`;
