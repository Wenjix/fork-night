import { WREN, WREN_TOP_UPS, txUrl } from "./agents/wren.ts";
import { MIDNIGHT_SIGNAL_RELEASE_PROOF_LINE, MONAD_RELEASE_CONTRACT, MONAD_EXPLORER } from "./onchain/records.ts";

export const NETWORK_BRANDS = {
  monad: { name: "Monad", testnet: "Testnet", mark: "/brands/networks/monad.svg", currency: "test MON" },
  solana: { name: "Solana", testnet: "Devnet", mark: "/brands/networks/solana.svg", currency: "test USDC" },
  base: { name: "Base", testnet: "Sepolia", mark: "/brands/networks/base.svg", currency: "test USDC" },
  tempo: { name: "Tempo", testnet: "Moderato testnet", mark: "/brands/networks/tempo.svg", currency: "test pathUSD" },
} as const;

export type NetworkBrand = keyof typeof NETWORK_BRANDS;
export type RoomNetworkDemo = {
  network: NetworkBrand;
  summary: string;
  proof: { label: string; href: string };
  related?: { label: string; href: string };
};

const MONAD_RELEASE: RoomNetworkDemo = {
  network: "monad",
  summary: `${MIDNIGHT_SIGNAL_RELEASE_PROOF_LINE} ·`,
  proof: {
    label: "View on MonadScan ↗",
    href: `${MONAD_EXPLORER}/address/${MONAD_RELEASE_CONTRACT}`,
  },
};

const PAPER_MOON_TOP_UPS: readonly RoomNetworkDemo[] = [
  {
    network: "solana",
    summary: "Recorded: 1 test USDC for 5 room credits.",
    proof: {
      label: "View Solana receipt",
      href: "https://explorer.solana.com/tx/2YHSYXPTzJUMmaoV2MHKHxzW5Lwx44zvhgaKnrQWq9F5vAHcdA6fhvBVjifVmP7B9fzWktG4k9eqLDJztTQ1BfSJ?cluster=devnet",
    },
  },
  {
    network: "base",
    summary: "Recorded: 1 test USDC for 5 room credits.",
    proof: {
      label: "View Base receipt",
      href: "https://sepolia.basescan.org/tx/0xd5e58832014d09ae1bad68daec8ad9377287fd9e349b0d59fab38766a1fd4d2d",
    },
  },
];

/** Public, dated demo evidence. Room credits remain a pooled count across payment rails. */
export function getRoomNetworkShowcase(roomId: string): readonly RoomNetworkDemo[] {
  if (roomId === "kessler-ward") return [{ ...MONAD_RELEASE, summary: "Register story ancestry and creator wallet credits. Signatures are separate from publishing a scene." }];
  if (roomId === "midnight-signal") return [MONAD_RELEASE];
  if (roomId === "paper-moon") return PAPER_MOON_TOP_UPS;
  if (roomId === WREN.roomId) {
    const topUp = WREN_TOP_UPS.at(-1);
    return [{
      network: "tempo",
      summary: topUp
        ? `Recorded: ${topUp.amount} for ${topUp.credits} room credits.`
        : "Wren’s steward sets its spending limit and allowed payment.",
      proof: topUp
        ? { label: "View Tempo receipt", href: txUrl(topUp.txHash) }
        : { label: "View Wren’s allowance", href: "/agents#allowance" },
      related: topUp ? { label: "Wren’s allowance", href: "/agents#allowance" } : undefined,
    }];
  }
  return [];
}
