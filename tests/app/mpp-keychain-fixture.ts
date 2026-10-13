// Wren's MPP top-up of Oct 12, 2026 (Tempo Moderato testnet), recorded for offline tests. These are public bytes:
// the transaction was broadcast and confirmed in block 39346678, so the signature cannot be replayed. Wren's access
// key signed it (a keychain signature) on behalf of its steward's account; see docs/submission/AGENT-ROOM.md.
export const KEYCHAIN_TOP_UP = {
  rawTransaction: "0x76f9011582a5bf018455d4a80183014b1ef87ef87c9420c000000000000000000000000000000000000080b86495777d590000000000000000000000003b02f4be77c010d872ace7149051003ab9855ca100000000000000000000000000000000000000000000000000000000000f4240ef1ed7120139fa2425af7e8af5346e0000000000000000000094afe2f5bae832c0a0ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff80846acd87e98447990b6a8080c0b85604951c8d90d0d1e81351ed802178823c60cce3bd98938e57038fd85ea9991fc5e01e8c4841771aaa7aea1291edb0a490945e5612566044fb826873e8a338e960bf2dd413626ba56389ff41c4bb0bf7561cf4716e861c",
  hash: "0xceca6338f7977d3d5cc9ffc4c7943018d03562a297a2db42d70068c9c0a1ebbb",
  block: 39346678,
  challengeId: "BcdBj2eqM5SPef2yOx3sx8lzAwj9m7fChAGoBSSD_Yc",
  steward: "0x951c8D90d0D1e81351ED802178823C60cce3BD98",
  accessKey: "0x814D643005acE60552737db7e6bd83D458BcAb8D",
  payTo: "0x3B02f4be77C010d872Ace7149051003AB9855Ca1",
  currency: "0x20c0000000000000000000000000000000000000",
  amount: 1000000n,
  validBefore: 1791854569,
} as const;
