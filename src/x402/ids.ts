import { createHash } from "node:crypto";

// Testnet-only identifiers for the local x402 room top-up proof.
export const BASE_SEPOLIA = "eip155:84532";
export const SOLANA_DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
export const TESTNETS = [SOLANA_DEVNET, BASE_SEPOLIA] as const;
export type Testnet = (typeof TESTNETS)[number];
export const isTestnet = (value: unknown): value is Testnet =>
  TESTNETS.includes(value as Testnet);

/** Circle test USDC, six decimals on both networks. */
export const TESTNET_USDC: Record<Testnet, string> = {
  [BASE_SEPOLIA]: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  [SOLANA_DEVNET]: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
};

/** One top-up: 1.00 test USDC for the five test credits pilot_refill_room adds. */
export const TOP_UP = { price: "$1.00", atomic: "1000000", credits: 5 } as const;
export const MAX_TIMEOUT_SECONDS = 120;
export const MEMO_PATTERN = /^[a-f0-9]{32}$/;

// Fixed forever: changing it would let a reconciled payment credit twice.
const REFILL_NAMESPACE = "bb9e5c31-5e3f-4fb1-af58-efb407517d7f";

/** RFC 9562 name-based UUID (SHA-1, version 5). */
export function uuidv5(name: string, namespace = REFILL_NAMESPACE): string {
  const space = Buffer.from(namespace.replace(/-/g, ""), "hex");
  if (space.length !== 16) throw new Error("Invalid UUID namespace");
  const bytes = createHash("sha1").update(space).update(name, "utf8").digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** EVM hashes are case-insensitive hex; Solana signatures are case-sensitive base58. */
export const normalizeTransaction = (network: Testnet, transaction: string) =>
  network === BASE_SEPOLIA ? transaction.toLowerCase() : transaction;

/** The refill request ID, so the route and the reconciler converge on one credit. */
export const refillRequestId = (network: Testnet, transaction: string) =>
  uuidv5(`${network}:${normalizeTransaction(network, transaction)}`);

/** What makes one payment authorization unique on its network. */
export type IntentKey =
  | { network: typeof BASE_SEPOLIA; payer: string; nonce: string }
  | { network: typeof SOLANA_DEVNET; memo: string };

export function intentId(key: IntentKey): string {
  const parts = key.network === SOLANA_DEVNET
    ? ["svm", key.network, key.memo]
    : ["evm", key.network, key.payer.toLowerCase(), key.nonce.toLowerCase()];
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

export const explorerUrl = (network: Testnet, transaction: string) =>
  network === BASE_SEPOLIA
    ? `https://sepolia.basescan.org/tx/${transaction}`
    : `https://explorer.solana.com/tx/${transaction}?cluster=devnet`;

export const INTENT_ID_PATTERN = /^[a-f0-9]{64}$/;

/** Write-once records in the private pilot-receipts bucket. */
export const recordPaths = (id: string, roomId: string) => ({
  intent: `x402/intents/${id}.json`,
  roomIndex: `x402/rooms/${roomId}/${id}.json`,
  receipt: `x402/receipts/${id}.json`,
  // Written by the route after a confirmed settlement and before the refill.
  settlement: `x402/settlements/${id}.json`,
  // Written only by the reconciler after the chain shows the payment can no longer settle.
  expired: `x402/expired/${id}.json`,
  events: `x402/events/${id}`,
});
