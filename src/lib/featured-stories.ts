import privyRehearsal from "../../docs/submission/PRIVY-REHEARSAL.json";
import monadDeployment from "../../docs/submission/MONAD-TESTNET.json";
import { WREN, WREN_TOP_UPS, txUrl } from "./agents/wren";
import { getRecordedGuildFunding, fundingExplorerUrl } from "./guild-funding";

export const KESSLER_CTA_ROOM_ID = WREN.roomId;

export const featuredStoryLinks = {
  midnight: "/pilot?room=midnight-signal",
  nightShift: `/pilot?room=${WREN.roomId}`,
  kessler: `/pilot?room=${KESSLER_CTA_ROOM_ID}`,
  paperMoonGuild: "/pilot?room=paper-moon&view=treasury",
} as const;

const release = privyRehearsal.release;
const guild = getRecordedGuildFunding("paper-moon");
const tempoTopUp = WREN_TOP_UPS.at(-1);

export const monadProof = {
  makerCount: release.distinctBylines,
  walletCount: release.beneficiaries.length,
  paidTestMon: release.paidTestMon,
  contractUrl: monadDeployment.sourceVerificationUrl,
  releaseRoomUrl: featuredStoryLinks.midnight,
} as const;

export const tempoProof = tempoTopUp
  ? {
      label: "Recorded Oct 12",
      receiptUrl: txUrl(tempoTopUp.txHash),
      roomUrl: featuredStoryLinks.nightShift,
    }
  : undefined;

export const guildProof = guild
  ? {
      roomUrl: featuredStoryLinks.paperMoonGuild,
      solanaReceiptUrl: fundingExplorerUrl(guild.receipts.payment.signature),
    }
  : undefined;

export const kesslerPowerChips = [
  { label: "MONAD releases", href: featuredStoryLinks.midnight },
  { label: "TEMPO agent top-ups", href: tempoProof?.receiptUrl ?? featuredStoryLinks.nightShift },
  { label: "SOLANA guild funding", href: guildProof?.roomUrl ?? featuredStoryLinks.paperMoonGuild },
  { label: "PRIVY wallets", href: featuredStoryLinks.midnight },
] as const;

export const proofRoomIds = new Set(["midnight-signal", "paper-moon", WREN.roomId]);
