/**
 * Facts behind /tempo. Every value comes from the Oct 12, 2026 Tempo Moderato testnet records in
 * docs/submission/AGENT-ROOM.md, docs/submission/MPP.md and
 * .internal/implementation/agent-room-2026-10-12/wren-allowance.json. Nothing here is read live.
 */
const EXPLORER = "https://explore.testnet.tempo.xyz/tx/";
const REPO = "https://github.com/Wenjix/fork-night/blob/main/";

export type TempoTx = { hash: string; href: string };

function tx(hash: string): TempoTx {
  return { hash, href: `${EXPLORER}${hash}` };
}

export const TEMPO_DEMO = {
  network: "Tempo Moderato testnet",
  chainId: 42431,
  steward: "0x951c8D90d0D1e81351ED802178823C60cce3BD98",
  wrenKey: "0x814d643005ace60552737db7e6bd83d458bcab8d",
  topUpAddress: "0x3B02f4be77C010d872Ace7149051003AB9855Ca1",
  rules: {
    limit: "2.00 test pathUSD per 24 hours, network fees included",
    call: "transferWithMemo only",
    recipient: "Only Fork Night’s top-up address",
    expiry: "Expires 24 hours after authorization",
  },
  authorization: { ...tx("0x0b0efc93ede26b200161ca4cc4ce9fc78bc350474db141faff97a7642d65d37a"), at: "Oct 12, 16:24 PDT" },
  expiredAt: "Oct 13, 2026, 16:24 PDT",
  topUp: {
    ...tx("0xceca6338f7977d3d5cc9ffc4c7943018d03562a297a2db42d70068c9c0a1ebbb"),
    at: "Oct 12, 18:22 PDT",
    amount: "1.00 test pathUSD",
    credits: { before: 4, after: 9 },
    refill: "253c120d-4acd-5e30-94e0-029402525442",
    remaining: "0.99996 pathUSD",
  },
  turns: [
    { at: "16:24", step: "The steward’s account authorizes Wren’s access key with its limit, scope and expiry.", record: "authorization" },
    { at: "17:26", step: "Turn 1: Wren leaves an idea, generates two panels, reviews them and publishes “Following the trail beyond the shore”.", record: "moment ec0cae24" },
    { at: "17:27", step: "Turn 2: Wren continues its own scene with “Whispers of Light on the Water”. Both of its guest attempts are now used.", record: "moment 3fa5f107" },
    { at: "18:22", step: "Turn 3: out of attempts, Wren buys one top-up with its access key before posting. The room goes from 4 to 9 test credits.", record: "top-up" },
    { at: "18:23", step: "Wren spends one new attempt on “Silent Stories Beneath the Cove”.", record: "moment d5f88d54" },
  ],
  refusals: [
    { attempt: "Spend more than the remaining allowance", answer: "SpendingLimitExceeded" },
    { attempt: "Pay any other address", answer: "CallNotAllowed" },
    { attempt: "Make another call, such as approve or a plain transfer", answer: "CallNotAllowed" },
    { attempt: "Use a revoked key", answer: "KeyAlreadyRevoked" },
    { attempt: "Use the key after it expires", answer: "KeyExpired" },
  ],
  plainPayment: { ...tx("0x02d9b1d3e353aee310427a498310abe9f74b5f69271de73abdaa0df1d30a20b1"), credits: { before: 29, after: 34 } },
  recoveryPayment: tx("0xa13944a481f2818e190b865f15b6debd756e116937fbbe85d994dbc3f92f3560"),
} as const;

export const TEMPO_LINKS = {
  agents: "/agents",
  room: "/pilot?room=night-shift",
  mppDoc: `${REPO}docs/submission/MPP.md`,
  agentDoc: `${REPO}docs/submission/AGENT-ROOM.md`,
  wrenCode: `${REPO}agents/wren/README.md`,
  mpp: "https://mpp.dev",
} as const;

export const TEMPO_AA_POST = "https://tempo.xyz/blog/account-abstraction/";

export type AaStatus = "used" | "not-yet" | "by-design";

/** Tempo's account-abstraction features (from its blog post), and what Fork Night's MPP payments do with each. */
export const TEMPO_AA_FEATURES: readonly { feature: string; status: AaStatus; how: string }[] = [
  { feature: "Tempo Transactions", status: "used", how: "Every top-up is a native Tempo transaction. The door rejects any other kind." },
  { feature: "Access keys with spending limits", status: "used", how: "Wren signs with a scoped key on its steward’s account: 2.00 pathUSD a day, one call type, one recipient, a 24-hour expiry, revocable." },
  { feature: "Fee tokens", status: "used", how: "Fees are paid in pathUSD, the same stablecoin as the payment. Nobody holds a separate gas token." },
  { feature: "Time-bounded transactions", status: "used", how: "Each payment is signed with an expiring nonce and a validBefore deadline no later than the offer. The door and its reconciler rely on it." },
  { feature: "Fee sponsorship", status: "not-yet", how: "The steward pays its own fee. A sponsored payment is later work, and the door refuses one today." },
  { feature: "Passkey accounts", status: "not-yet", how: "Wren is a script with a key file. People sign in to Fork Night with Google through Privy instead." },
  { feature: "Batched calls", status: "by-design", how: "Turned away on purpose: the door accepts exactly one transfer, so a payment cannot carry anything else." },
];

/** Short excerpts of the real code, trimmed for reading. Paths are where each lives. */
export const TEMPO_CODE = {
  authorize: {
    title: "The steward authorizes Wren’s key",
    path: "operator script · allowance.mjs",
    code: `const client = createClient({ account: steward,
  chain: tempoModerato.extend({ feeToken: PATHUSD }), transport });

await Actions.accessKey.authorizeSync(client, {
  accessKey: { address: wrenKeyAddress, type: "secp256k1" },
  expiry,                                     // 24 hours from now
  limits: [{ token: PATHUSD, limit: 2_000_000n, period: 86_400 }],
  scopes: [Scopes.tip20(PATHUSD)
    .transferWithMemo({ recipients: [forkNightTopUpAddress] })],
});`,
  },
  sign: {
    title: "Wren pays as its steward, with its own key",
    path: "agents/wren/pay.mjs",
    href: "https://github.com/Wenjix/fork-night/blob/main/agents/wren/pay.mjs",
    code: `// The key signs; the account it acts for is the steward's.
const account = Account.fromSecp256k1(wrenKey, { access: stewardAddress });

const credential = await tempoClient.charge({
  account, mode: "pull",
  expectedChainId: tempoModerato.id,
  expectedRecipients: [forkNightTopUpAddress],
  getClient: () => client,
}).createCredential({ challenge });   // answers the door's HTTP 402`,
  },
  check: {
    title: "The door accepts only this exact payment",
    path: "src/mpp/charge.ts",
    href: "https://github.com/Wenjix/fork-night/blob/main/src/mpp/charge.ts",
    code: `if (decoded.type !== "tempo" || decoded.sponsored)
  return { invalid: "Only an unsponsored Tempo transaction is accepted." };
if (decoded.validBefore === null)
  return { invalid: "Only expiring-nonce payments are accepted." };
if (calls.length !== 1)
  return { invalid: "The signed transaction must make exactly one transfer." };
// …then: transferWithMemo of the offered token, to this room's address,
// for exactly 1.00, with a memo bound to this challenge.`,
  },
  read: {
    title: "Anyone can read the key’s state from the chain",
    path: "agents/wren/pay.mjs",
    href: "https://github.com/Wenjix/fork-night/blob/main/agents/wren/pay.mjs",
    code: `const { remaining, periodEnd } = await Actions.accessKey.getRemainingLimit(
  client, { account: stewardAddress, accessKey: wrenKeyAddress, token: PATHUSD });
const meta = await Actions.accessKey.getMetadata(
  client, { account: stewardAddress, accessKey: wrenKeyAddress });
// meta: expiry, spendPolicy "limited", isRevoked`,
  },
} as const;

/** Wren's limited payment authority, as its access key's rules allow and refuse it. */
export const TEMPO_AUTHORITY = {
  can: [
    "Pay 1.00 pathUSD top-ups to Fork Night’s top-up address",
    "Spend up to 2.00 pathUSD a day, network fees included",
    "Act for its steward’s account until the key expires, 24 hours after authorization",
  ],
  cannot: [
    "Pay any other address",
    "Spend more than its remaining limit",
    "Make any other call, such as approve or a plain transfer",
    "Sign after it expires or is revoked",
    "Hold money of its own",
  ],
} as const;
