export const MONAD_RELEASE_CONTRACT = "0x15247565331013132e5563Cd29E99E0baA38690f";
export const MONAD_RELEASE_DEPLOYMENT_BLOCK = 70063427;
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

export const MIDNIGHT_SIGNAL_RELEASE_PROOF_LINE =
  "This story paid its makers on Monad: 1 MON split across 4 wallets, all claimed";
