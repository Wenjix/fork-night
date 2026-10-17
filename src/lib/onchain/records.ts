export const MONAD_RELEASE_CONTRACT = "0x15247565331013132e5563Cd29E99E0baA38690f";
export const MONAD_EXPLORER = "https://testnet.monadscan.com";

/** The newest Midnight Signal moment whose complete ancestry has been released on Monad. */
export const MIDNIGHT_SIGNAL_RELEASE_TIP_ID = "a386d392-f289-4b4e-a901-d6cfd827edd5";

export const MIDNIGHT_SIGNAL_RELEASE_PROOF = {
  chainId: 10143,
  contract: MONAD_RELEASE_CONTRACT,
  checkedAt: "2026-10-12T14:03:49.936Z",
  block: 70416466,
  releaseId: "0x36ed82e67b03888c63b1b0ba0505a55c4495b37bdd0db9e3689d36430b620b2f",
  manifestHash: "0x5bca187f89d9e4f0449e05af6ec5cb044712234a1da3269586e8311cd8799daf",
  receivedTestMon: "1.0",
  paidTestMon: "1.0",
  walletCount: 4,
  claimCount: 4,
  fundedAndFullyClaimed: true,
  beneficiaries: [
    "0x56f30554D7d11B2807b87144e5559b267608Bea2",
    "0x744D5A0D982752DBd1414Aa2898d57Da9E30645B",
    "0x8ad41aB0aA52fEA34CefC784AB48fA59D768dBC9",
    "0xbBC7f42C81096CC584eCfD68558ae227A2C7a53E",
  ],
} as const;

/**
 * The release's six scene registrations in path order, read from the contract's MomentRegistered logs.
 * They are recorded here because the public RPC caps eth_getLogs at 100 blocks per call, far less than the
 * span since deployment, so a page cannot look them up. `sceneId` is the on-chain moment id.
 */
export const MIDNIGHT_SIGNAL_REGISTRATIONS = [
  { sceneId: "0x75a4a1bb815f07caaf4b291fd7bfb5d8ea509c0a747d2b19d90c99010d8654ea", transactionHash: "0xf4ec58c00dfe31180c5fd36502d83ede24fd6ab4243465b346d34bfbb24fa88f", block: 70291181 },
  { sceneId: "0x4eda5a764ff5a889e362ef09faf7cec98f1435e4755d58a26479bf636674a8aa", transactionHash: "0x5b69828794ebcd15a719a1942e881df027c8a726c4f9ffc1abfa5b779a3efe08", block: 70296785 },
  { sceneId: "0x24858c276d79d2371b0b6dd328adaf4c3e300aa7201aaf0e37f000071cda2ed5", transactionHash: "0x009bde3cd84b81e4ae3d5ff2014d70616ec007db7f4a97968d7d00112580c6f4", block: 70296816 },
  { sceneId: "0x5863bd0a83630af8f0192723ff30c6167e378d8c5bcf5654a4614f97d02f2811", transactionHash: "0xb7d1decb9f0460b5c938b351cc6208965d1820994a30c366a19be46cabc87858", block: 70296869 },
  { sceneId: "0x1f7ff13bdc5aee0078f312986bd9920621705f6722b2d27adfabfe1ec6987090", transactionHash: "0x4f6dbb71be2b5db9a697a0aab8a9ba30fae703d36d55ccfb83635abaa461902f", block: 70401671 },
  { sceneId: "0xdbc43591279f113aa27a8b3f2cbe114858bb8086bb766dd6cfaabb1b4b34106d", transactionHash: "0xc9c76cca9ebd256da8bf6a307bb5639aeb3aa309b2f4bd4007ed68c9fa0bca00", block: 70407043 },
] as const;

/** The registration receipt of an archived scene, only on the chain and contract that recorded it. */
export function registrationTransaction(chainId: number, contract: string, sceneId: string): string | undefined {
  if (chainId !== MIDNIGHT_SIGNAL_RELEASE_PROOF.chainId || contract.toLowerCase() !== MONAD_RELEASE_CONTRACT.toLowerCase()) return undefined;
  return MIDNIGHT_SIGNAL_REGISTRATIONS.find(entry => entry.sceneId === sceneId.toLowerCase())?.transactionHash;
}

/** A dated snapshot: the release has taken more test support and claims since, so its live balances differ. */
export const MIDNIGHT_SIGNAL_RELEASE_PROOF_LINE =
  "This story paid its makers on Monad: 1 MON split across 4 wallets, all claimed (Oct 12 test rehearsal)";
