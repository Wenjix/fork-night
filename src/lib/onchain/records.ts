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

/** Prepared Kessler scenes, Burkes's continuation and Wren's six scenes; verified October 19, 2026 UTC. */
export const KESSLER_REGISTRATIONS = [
  { sceneId: "0xff4259d58e631bf760831dd44e6912ba095653a161b0bdb5c32b441979731fd9", transactionHash: "0xda8a88345044588d75a57352836332b7b6436de48bc2c5e1809e538a95afbff0", block: 72255227 },
  { sceneId: "0x9aee0e6b5cb45f1a47fa3c61c8f73cd7105367cde2ab6218ba787d0b0b9ce918", transactionHash: "0x9c2265037f5ae3fba2e6514a8e8445c3f65d75d8f1542537da22ec2a4d4a383c", block: 72255259 },
  { sceneId: "0xf43e5e79de75b9136aba0a3ab0e9dc9a2bfbf071830f9ed4d8f9dee3447ebc35", transactionHash: "0x287ae9f657e2076713a5bf558cc87ceda796b8a1d6603faa32bd35864cfab4b0", block: 72255288 },
  { sceneId: "0x0301600ecaf60e854346874ceba0027203cdc9292cc46348e000fa8fc264805d", transactionHash: "0xaa326836e47e746e61d4f59a5fd3423de1a90627f27486b2d3fb16201c4798e9", block: 72255321 },
  { sceneId: "0x649fcb0a85f1a032357846e0328d240f69fa0bb8ff7855a6e43fc10836676be2", transactionHash: "0xc0da76792243f23b26a2548e4c359794a99b93c6136f3ed1fc36fecc43239977", block: 72255354 },
  { sceneId: "0x3a971e261e0fd800c83d001481d82e0784b453ff9214adf3cd5ade013bb80ad3", transactionHash: "0xf33ee7895819332d1c122b5177e1e6f9cc1b77994a88ee9c892b28e17a85ba4e", block: 72255382 },
  { sceneId: "0xf995a9d6645b52985fddb3c931ff8efbd60ccc5e5c6d2f8316b642cd4bdfbb1b", transactionHash: "0xd94579d19b1f22bf6930f522c6bcbc29dcf1b5754a76603afc564470805abf4b", block: 72255463 },
  { sceneId: "0x859c2ffb8cb05e1fae68b6ee6a1c31f9aed8fbea9d3b23db77f9fdc900dc0a01", transactionHash: "0x78674fb6cb4cb907d7c322b1fc3a4f3f1e5ad542c69a01051fb002149fd0a2d0", block: 72255503 },
  { sceneId: "0x9a13e10e9a05704a553a4366c536427a792bf59f460daa5978eaab3100151a87", transactionHash: "0xbfd5d815b0a20b9db26d3f5f6dfb2205001199a28b1688f8bbe182c9541d9284", block: 72255535 },
  { sceneId: "0x70c1f36cd47037cd10c5859b1fd1add2a97189991538d2caf62f8bb22100234b", transactionHash: "0xeaa381c58f2dd5e1759a98266191c4e43342f18e7cadd8d85f3b49a158c87cbb", block: 72255562 },
  { sceneId: "0x10d60da20e51cb234be4b083afa4600219404850653bd7b14062e1a3925019e0", transactionHash: "0x4fd8ed69706c2ff3e5175558e6c09da6ff88623bdc339e40b9fd26e32da1cb7c", block: 72255587 },
  { sceneId: "0x22680a32a3a1e211df2091c298e5b0678dc061db0a4c9c43e8449daa1ddd00ea", transactionHash: "0x47276d3456d289e1338579aaf0f7a9aa5d959a241612f9dacc3d65267b39ce25", block: 72258517 },
  { sceneId: "0x4b5b00ed87f5e9c2a9ffbe6eef57d97c5011fb15adcc8f3f89f951ace1ed0d9c", transactionHash: "0x70a564a00693c8aefc06b59766c4e2b8384ce172d3c727be059a31ed5781329c", block: 72266786 },
  { sceneId: "0xd3aae76e53f3c89b0b18973aaae5362beaf4e812e741a109c39cd26066d61d5a", transactionHash: "0x6f135c481ab09792729cd053c7e15178a55e607d4855375ffa7cdb3e7417eeda", block: 72266845 },
  { sceneId: "0x76e2b1617de714ddbf567e629c1185c81b1ab78390a83e7f0877d4b0369d7f2f", transactionHash: "0x4c1c3eb7ceb76a8b5d7466580967dc4dadfd820c1a5a6b5b036a4a702df69a19", block: 72266903 },
  { sceneId: "0x63de8f80c15530039e80841880fc5fc8a8514cc1ade5bc67bd835dd55d98b731", transactionHash: "0x0a70214578b5ca4cdda048fa638805438f8308e57bdf79cce7dd94703234038e", block: 72275623 },
  { sceneId: "0x0abb27f852b64f791aa605fbe7ff32031a4b29f7c7a2ec472919982d7aeb0cc0", transactionHash: "0xe2d081f1db78a25f963e6ac57ce6db0a125fb40e81e6ffe7755d8e6602bb0185", block: 72275682 },
  { sceneId: "0x676402c3f338c65cc0849544fb3dc5fa463833b0a2fae0b197ff1f4b4db29e0b", transactionHash: "0x53c48bff67cb88577c7e005ce7cc23355a31b7c70c983371c30635d4e56d4507", block: 72275740 },
] as const;

/** The registration receipt of an archived scene, only on the chain and contract that recorded it. */
export function registrationTransaction(chainId: number, contract: string, sceneId: string): string | undefined {
  if (chainId !== MIDNIGHT_SIGNAL_RELEASE_PROOF.chainId || contract.toLowerCase() !== MONAD_RELEASE_CONTRACT.toLowerCase()) return undefined;
  return MIDNIGHT_SIGNAL_REGISTRATIONS.find(entry => entry.sceneId === sceneId.toLowerCase())?.transactionHash
    ?? KESSLER_REGISTRATIONS.find(entry => entry.sceneId === sceneId.toLowerCase())?.transactionHash;
}

/** A dated snapshot: the release has taken more test support and claims since, so its live balances differ. */
export const MIDNIGHT_SIGNAL_RELEASE_PROOF_LINE =
  "This story paid its makers on Monad: 1 MON split across 4 wallets, all claimed (its six-scene release, Oct 12 test rehearsal)";
