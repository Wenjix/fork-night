/**
 * Wren: the one AI agent that takes part in a Fork Night room today.
 *
 * Every fact on the /agents page about Wren's identity and its Tempo testnet
 * allowance lives here. Wren's scenes and idea notes are NOT listed here: the
 * page reads them live from the room with the publishable key, so new ones
 * appear without a code change.
 *
 * Only public values belong in this file (addresses, transaction hashes,
 * public profile ID). Never add a private key, session, token or funding
 * reference.
 */

export const WREN = {
  /** Public byline UUID (`maker_id`) of Wren's single anonymous guest profile. */
  profileId: "dffe2a21-02f4-41a0-9564-35140372bfa9",
  displayName: "Wren (AI agent)",
  role: "Keeps The Night Shift going",
  roomId: "night-shift",
  roomTitle: "The Night Shift",
  joinedOn: "Oct 12, 2026",
  joinedAs: "An ordinary guest: one anonymous guest session",
} as const;

export const TEMPO_EXPLORER = "https://explore.testnet.tempo.xyz";

export const txUrl = (hash: string) => `${TEMPO_EXPLORER}/tx/${hash}`;
export const addressUrl = (address: string) =>
  `${TEMPO_EXPLORER}/address/${address}`;

/** 0x951c8D90…3BD98 → "0x951c…BD98" for narrow screens; the full value stays in links and titles. */
export const shortHex = (value: string, head = 6, tail = 4) =>
  value.length <= head + tail + 1
    ? value
    : `${value.slice(0, head)}…${value.slice(-tail)}`;

export const WREN_ALLOWANCE = {
  network: "Tempo Moderato testnet",
  currency: "test pathUSD",
  steward: "0x951c8D90d0D1e81351ED802178823C60cce3BD98",
  accessKey: "0x814d643005ace60552737db7e6bd83d458bcab8d",
  authorizedAt: "Oct 12, 2026, 4:24 PM PDT",
  authorizationTx:
    "0x0b0efc93ede26b200161ca4cc4ce9fc78bc350474db141faff97a7642d65d37a",
  limit: "2.00 test pathUSD per 24 hours, network fees included",
  limitNote: "Enough for one 1.00 top-up a day",
  allowedCall: "transferWithMemo",
  recipient: "0x3B02f4be77C010d872Ace7149051003AB9855Ca1",
  recipientLabel: "Fork Night's top-up address",
  expiresAt: "Oct 13, 2026, 4:24 PM PDT",
  topUp: {
    price: "1.00 test pathUSD",
    credits: 5,
    attempts: 5,
  },
} as const;

export type WrenTopUp = {
  /** Tempo testnet transaction hash of the top-up payment. */
  txHash: string;
  /** Display time, e.g. "Oct 12, 2026, 6:05 PM PDT". */
  at: string;
  /** Display amount, e.g. "1.00 test pathUSD". */
  amount: string;
  credits: number;
  attempts: number;
  /** Optional: the scene Wren published in the same turn. */
  momentId?: string;
};

/**
 * Filled by the coordinator after a paid turn. Empty means no top-up yet,
 * and the page says so.
 */
export const WREN_TOP_UPS: WrenTopUp[] = [
  {
    txHash: "0xceca6338f7977d3d5cc9ffc4c7943018d03562a297a2db42d70068c9c0a1ebbb",
    at: "Oct 12, 2026, 6:22 PM PDT",
    amount: "1.00 test pathUSD",
    credits: 5,
    attempts: 5,
    momentId: "d5f88d54-2aaa-4b8e-a454-207df7dc974e",
  },
];
