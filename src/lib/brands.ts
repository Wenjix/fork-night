/**
 * Chains, tokens, protocols, wallets and tools that Fork Night names on screen.
 * One entry per brand; `BrandBadge` renders them so every surface shows a brand the same way.
 */
export type BrandKind = "chain" | "token" | "protocol" | "wallet" | "auth" | "infra" | "model";

export type Brand = {
  name: string;
  kind: BrandKind;
  /** Public path of an official mark. Without one the badge draws a monogram or a glyph. */
  mark?: string;
  /** `bleed` when the mark is already a filled shape that should be the whole tile. */
  fit?: "contain" | "bleed";
  /** Letters drawn on the tile when there is no mark. */
  monogram?: string;
  /** Tint for the monogram tile, as a hex colour. */
  accent?: string;
  /** What kind of network a chain is. Shown beside the chain so "testnet" never goes missing. */
  net?: string;
};

export const BRANDS = {
  monad: { name: "Monad", kind: "chain", mark: "/brands/networks/monad.svg", accent: "#6e54ff", net: "Testnet" },
  solana: { name: "Solana", kind: "chain", mark: "/brands/networks/solana.svg", accent: "#9945ff", net: "Devnet" },
  base: { name: "Base", kind: "chain", mark: "/brands/networks/base.svg", accent: "#0000ff", net: "Sepolia" },
  tempo: { name: "Tempo", kind: "chain", mark: "/brands/networks/tempo.svg", accent: "#202039", net: "Moderato testnet" },
  usdc: { name: "USDC", kind: "token", mark: "/brands/networks/usdc.svg", fit: "bleed", accent: "#0b53bf" },
  pathusd: { name: "pathUSD", kind: "token", monogram: "$", accent: "#202039" },
  x402: { name: "x402", kind: "protocol", accent: "#202039" },
  mpp: { name: "MPP", kind: "protocol", accent: "#202039" },
  squads: { name: "Squads", kind: "protocol", monogram: "Sq", accent: "#202039" },
  privy: { name: "Privy", kind: "auth", mark: "/brands/privy-symbol-black.svg", accent: "#010110" },
  google: { name: "Google", kind: "auth", mark: "/brands/google-g.png", accent: "#4285f4" },
  metamask: { name: "MetaMask", kind: "wallet", accent: "#f6851b" },
  phantom: { name: "Phantom", kind: "wallet", accent: "#ab9ff2" },
  supabase: { name: "Supabase", kind: "infra", monogram: "Su", accent: "#3ecf8e" },
  trigger: { name: "Trigger.dev", kind: "infra", monogram: "T", accent: "#41ff54" },
  vercel: { name: "Vercel", kind: "infra", monogram: "V", accent: "#000000" },
  kimi: { name: "Kimi K3", kind: "model", monogram: "K", accent: "#1783ff" },
  hunyuan: { name: "Hunyuan", kind: "model", monogram: "HY", accent: "#0052d9" },
  tokenrouter: { name: "TokenRouter", kind: "infra", monogram: "TR", accent: "#202039" },
  gmi: { name: "GMI Cloud", kind: "infra", monogram: "G", accent: "#202039" },
} as const satisfies Record<string, Brand>;

export type BrandId = keyof typeof BRANDS;
