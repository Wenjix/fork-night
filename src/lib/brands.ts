/**
 * Chains, tokens, protocols, wallets, models and providers that Fork Night names on screen.
 * One entry per brand; `BrandBadge` renders them so every surface shows a brand the same way.
 * Official marks live in public/brands (their sources and terms are in docs/submission/BRAND-ASSETS.md). A brand without
 * one gets a neutral monogram or glyph tile, and gains its mark the moment a file is added and `mark` is set.
 */
export type BrandKind = "chain" | "token" | "protocol" | "wallet" | "auth" | "model" | "provider";

export type Brand = {
  name: string;
  kind: BrandKind;
  /** Public path of an official mark. Without one the badge draws a monogram or a glyph. */
  mark?: string;
  /** `bleed` when the mark is already a filled square that should be the whole tile. */
  fit?: "contain" | "bleed";
  /**
   * The mark is a wide logotype, shown as supplied on a plate of its own colour. It stands in for the name, which stays in the
   * page for screen readers; `word` is what the logotype spells, so a model version after it ("K3") can still be shown as text.
   * `plate` is the ground the file was drawn for: `dark` for a wordmark with white letters.
   */
  lockup?: { width: number; height: number; plate: "light" | "dark"; word: string };
  /** Load the mark lazily: the file is large. */
  lazy?: boolean;
  /** One or two characters drawn on the tile when there is no mark. */
  monogram?: string;
  /** Tint for the monogram or glyph tile, as a hex colour. Neutral ink unless the brand's colour is certain. */
  accent?: string;
  /** What kind of network a chain is. Shown beside the chain so "testnet" never goes missing. */
  net?: string;
};

const INK = "#202039";

export const BRANDS = {
  monad: { name: "Monad", kind: "chain", mark: "/brands/networks/monad.svg", accent: "#6e54ff", net: "Testnet" },
  solana: { name: "Solana", kind: "chain", mark: "/brands/networks/solana.svg", accent: "#9945ff", net: "Devnet" },
  base: { name: "Base", kind: "chain", mark: "/brands/networks/base.svg", accent: "#0000ff", net: "Sepolia" },
  tempo: { name: "Tempo", kind: "chain", mark: "/brands/networks/tempo.svg", accent: INK, net: "Moderato testnet" },
  mon: { name: "MON", kind: "token", mark: "/brands/networks/monad.svg", accent: "#6e54ff" },
  pathusd: { name: "pathUSD", kind: "token", mark: "/brands/networks/tempo.svg", accent: INK },
  x402: { name: "x402", kind: "protocol", mark: "/brands/x402.svg", lockup: { width: 156, height: 48, plate: "dark", word: "x402" }, accent: INK },
  mpp: { name: "MPP", kind: "protocol", mark: "/brands/mpp.svg", lockup: { width: 81.2195, height: 18, plate: "light", word: "MPP" }, accent: INK },
  // public/brands/squads.svg is the safety-zone diagram from Squads' brand page, not the logo, so Squads keeps a neutral tile.
  squads: { name: "Squads", kind: "protocol", monogram: "Sq", accent: INK },
  erc8004: { name: "ERC-8004", kind: "protocol", accent: INK },
  privy: { name: "Privy", kind: "auth", mark: "/brands/privy-symbol-black.svg", accent: "#010110" },
  google: { name: "Google", kind: "auth", mark: "/brands/google-g.png", accent: "#4285f4" },
  metamask: { name: "MetaMask", kind: "wallet", mark: "/brands/metamask-fox.svg", accent: "#f6851b" },
  phantom: { name: "Phantom", kind: "wallet", mark: "/brands/phantom.svg", fit: "bleed", accent: "#ab9ff2" },
  kimi: { name: "Kimi K3", kind: "model", mark: "/brands/kimi.svg", lockup: { width: 118, height: 40, plate: "light", word: "Kimi" }, lazy: true, accent: INK },
  hunyuan: { name: "Hunyuan", kind: "model", mark: "/brands/hunyuan.png", fit: "bleed", accent: INK },
  wan: { name: "Wan", kind: "model", monogram: "W", accent: INK },
  tokenrouter: { name: "TokenRouter", kind: "provider", monogram: "TR", accent: INK },
  gmi: { name: "GMI Cloud", kind: "provider", monogram: "G", accent: INK },
} as const satisfies Record<string, Brand>;

export type BrandId = keyof typeof BRANDS;
