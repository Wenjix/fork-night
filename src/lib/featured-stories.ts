import privyRehearsal from "../../docs/submission/PRIVY-REHEARSAL.json";
import monadDeployment from "../../docs/submission/MONAD-TESTNET.json";
import { WREN, WREN_TOP_UPS, txUrl } from "./agents/wren";
import { getRecordedGuildFunding, fundingExplorerUrl } from "./guild-funding";
import { KESSLER_ROOM_ID } from "./kessler-room";

export const KESSLER_CTA_ROOM_ID = KESSLER_ROOM_ID;
const tempoTopUp = WREN_TOP_UPS.at(-1);

export const featuredStoryLinks = {
  midnight: "/pilot?room=midnight-signal&moment=a386d392-f289-4b4e-a901-d6cfd827edd5",
  nightShift: `/pilot?room=${WREN.roomId}${tempoTopUp?.momentId ? `&moment=${tempoTopUp.momentId}` : ""}`,
  kessler: `/pilot?room=${KESSLER_CTA_ROOM_ID}`,
  paperMoonGuild: "/pilot?room=paper-moon&view=treasury",
} as const;

const release = privyRehearsal.release;
const guild = getRecordedGuildFunding("paper-moon");

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

export const featuredRooms = [
  {
    id: KESSLER_ROOM_ID,
    title: "Kessler Ward",
    focus: "Branching stories · Monad contributions · Wren",
    stack: [],
    status: "Read, branch and trace a story together",
    description: "A blackout, an insulin case and eighty-one floors before dawn. Choose a path, add a scene, and follow the people behind it.",
    artwork: "/art/night-shift-neon.webp#frame=0",
    artworkDescription: "Mika stands above the towers of Kessler Ward during a blackout.",
    href: featuredStoryLinks.kessler,
    action: "Enter Kessler Ward",
    record: undefined,
  },
  {
    id: "midnight-signal",
    title: "The midnight signal",
    focus: "Monad releases · Privy wallets",
    stack: [{ brand: "monad", role: "releases" }, { brand: "privy", role: "wallets" }],
    status: "Recorded Oct 12",
    description: `${monadProof.paidTestMon.replace(/\.0$/, "")} test MON split across ${monadProof.walletCount} wallets, all claimed. ${monadProof.makerCount} maker bylines in the recorded story.`,
    artwork: "/art/midnight-story.webp#frame=0",
    artworkDescription: "A keeper approaches a lighthouse above the harbour.",
    href: featuredStoryLinks.midnight,
    action: "View Monad release",
    record: { label: "Contract record", href: monadProof.contractUrl, brand: "monad" as const },
  },
  {
    id: WREN.roomId,
    title: WREN.roomTitle,
    focus: "Tempo · MPP agent payments",
    stack: [{ brand: "tempo" }, { brand: "mpp", role: "agent payments" }],
    status: tempoProof?.label ?? "Agent payment limits",
    description: tempoProof
      ? "Wren paid for a room-credit top-up within its testnet allowance."
      : "Explore Wren’s room and its bounded payment policy.",
    artwork: "/art/midnight-story.webp#frame=5",
    artworkDescription: "A lighthouse beam reaches across the harbour.",
    href: featuredStoryLinks.nightShift,
    action: "See Wren’s recorded turn",
    record: tempoProof ? { label: "Tempo receipt", href: tempoProof.receiptUrl, brand: "tempo" as const } : undefined,
  },
  {
    id: "paper-moon",
    title: guild?.roomTitle ?? "Paper Moon",
    focus: "Solana · Squads guild funding",
    stack: [{ brand: "solana" }, { brand: "squads", role: "guild funding" }],
    status: "Recorded Oct 12",
    description: guild
      ? `${guild.governance.threshold} of ${guild.governance.stewardWallets} steward wallets approved funding. A separate payment added ${guild.appCredit.added} room credits.`
      : "Explore the room’s recorded guild funding.",
    artwork: "/art/midnight-story.webp#frame=3",
    artworkDescription: "A keeper looks toward a map of constellations above the harbour.",
    href: featuredStoryLinks.paperMoonGuild,
    action: "View guild funding",
    record: guildProof ? { label: "Solana receipt", href: guildProof.solanaReceiptUrl, brand: "solana" as const } : undefined,
  },
] as const;

export const proofRoomIds = new Set(["midnight-signal", "paper-moon", WREN.roomId]);

/** What the rooms are built with. Each links to the page that shows it working: Privy and Monad on the Night Watch, Tempo on Wren's page, Solana on the Paper Moon guild's treasury. */
export const builtWith = [
  { brand: "monad", href: "/night-watch-privy" },
  { brand: "tempo", href: "/tempo" },
  { brand: "solana", href: featuredStoryLinks.paperMoonGuild },
  { brand: "privy", href: "/night-watch-privy" },
  { brand: "kimi", href: "/kimi" },
  { brand: "hunyuan", href: "/hunyuan" },
] as const;
