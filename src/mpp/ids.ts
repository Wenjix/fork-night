import { createHash } from "node:crypto";
import { INTENT_ID_PATTERN, TOP_UP, uuidv5 } from "../x402/ids.ts";

// Testnet-only identifiers for the local MPP room top-up: Tempo Moderato, nothing else.
export const TEMPO_MODERATO = "eip155:42431";
export const MODERATO_CHAIN_ID = 42431;
export const MODERATO_RPC = "https://rpc.moderato.tempo.xyz";
export const MODERATO_EXPLORER = "https://explore.testnet.tempo.xyz";

/** Moderato faucet test dollars (TIP-20, six decimals). pathUSD is also the default fee token. */
export const PATHUSD = "0x20c0000000000000000000000000000000000000";
export const MODERATO_TEST_TOKENS: Record<string, string> = {
  pathUSD: PATHUSD,
  alphaUSD: "0x20c0000000000000000000000000000000000001",
  betaUSD: "0x20c0000000000000000000000000000000000002",
  thetaUSD: "0x20c0000000000000000000000000000000000003",
};
export const TOKEN_DECIMALS = 6;

/** One top-up: 1.00 test USD (mppx amount "1" at six decimals) for the five test credits pilot_refill_room adds. */
export const MPP_TOP_UP = { amount: "1", atomic: TOP_UP.atomic, credits: TOP_UP.credits, price: "1.00 test USD" } as const;

/**
 * The challenge realm. mppx hashes it into every on-chain memo (keccak256(realm)[0..9]), so it is a
 * constant that names no room, guest or funding reference.
 */
export const MPP_REALM = "fork-night-mpp-door";

/** The node admits an expiring-nonce transaction only while validBefore >= now + 2 s. */
export const MIN_VALIDITY_SECONDS = 3;
/** mppx clients sign for at most 25 s (or the challenge expiry); a longer window is refused before any record. */
export const MAX_VALIDITY_SECONDS = 60;
/** The reconciler declares a payment expired only once the chain head is this far past validBefore. */
export const EXPIRY_MARGIN_SECONDS = 120;

export const TRANSACTION_PATTERN = /^0x[0-9a-f]{64}$/;
/** TIP-20 transferWithMemo(address,uint256,bytes32): the one call a door payment makes (checked against the adapter in tests). */
export const TRANSFER_WITH_MEMO_SELECTOR = "0x95777d59";
export const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
export { INTENT_ID_PATTERN };

/** EVM hashes are case-insensitive hex: every record and every refill ID uses the lowercase form. */
export const normalizeHash = (transaction: string) => transaction.toLowerCase();

/** The refill request ID, so the route and the reconciler converge on one credit (same namespace as x402). */
export const mppRefillRequestId = (transaction: string) =>
  uuidv5(`${TEMPO_MODERATO}:${normalizeHash(transaction)}`);

/** One MPP challenge is one payment: the HMAC-bound challenge ID keys the intent. */
export const mppIntentId = (challengeId: string) =>
  createHash("sha256").update(["mpp", TEMPO_MODERATO, challengeId].join("|")).digest("hex");

export const mppExplorerUrl = (transaction: string) => `${MODERATO_EXPLORER}/tx/${normalizeHash(transaction)}`;

/** Write-once records in the private pilot-receipts bucket, never under x402/. */
export const mppRecordPaths = (id: string, roomId: string) => ({
  intent: `mpp/intents/${id}.json`,
  roomIndex: `mpp/rooms/${roomId}/${id}.json`,
  receipt: `mpp/receipts/${id}.json`,
  // Written after a confirmed transfer and before the refill.
  settlement: `mpp/settlements/${id}.json`,
  // Written only by the reconciler once the chain shows the payment can no longer land.
  expired: `mpp/expired/${id}.json`,
  events: `mpp/events/${id}`,
});

/**
 * The operator commands. The root package.json stays byte-identical (no mpp:* scripts), so every message
 * names the direct form, which reads .env.local exactly as the x402 npm scripts do.
 */
export const MPP_COMMANDS = {
  setup: "node --env-file-if-exists=.env.local scripts/mpp-setup.ts",
  fund: "node --env-file-if-exists=.env.local scripts/mpp-fund-room.ts",
  reconcile: "node --env-file-if-exists=.env.local scripts/mpp-reconcile.ts",
  status: "node --env-file-if-exists=.env.local scripts/mpp-status.ts",
} as const;

export const sameAddress = (a: unknown, b: unknown) =>
  typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
