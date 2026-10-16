# Contribution-derived release payouts

[ForkNightReleases.sol](ForkNightReleases.sol) runs on Monad testnet (10143) or a local EVM (31337). Its constructor rejects production networks. Payments use the network's native test token; they are separate from inference credits and have no redemption value.

This contract demonstrates a consenting production group's fixed release agreement. Equal shares are one option for small collaborating groups. Here, eligibility is specifically the distinct wallets on a selected ancestry; off-path team members are excluded. The contract has no room-visibility classification or configurable split. The app exposes this proof in the original public Midnight Signal room, with makers accepting its terms before registration. Broader room economics and source-project licensing contributions require separate mechanisms.

The curator creates a project with fixed terms and an explicit opening. Curator admission permanently binds a published maker ID to a wallet. Each admitted maker registers their exact public scene commitment directly. Moment IDs are scoped to project, maker and source, so another admitted maker cannot occupy that maker's scene ID. This is curator-attested identity and declared authorship, not proof of distinct people or copyright.

The curator releases a tip. The contract traverses the complete registered ancestry, includes every distinct wallet once and freezes recipients. A curator or funder has no automatic share. Cumulative equal allocation preserves all collected wei; sorted wallet order determines the remaining indivisible wei, with at most one wei difference between cumulative entitlements. Support payments have payer-scoped request IDs. Claims always transfer to the frozen recipient, and one rejecting recipient cannot prevent others claiming.

There is no upgrade, administrator withdrawal, wallet reassignment or release-edit function. Registering extra sibling scenes or continuing a released path does not change its split. The maximum registered path contains 32 scenes; exceeding it is rejected. The existing pilot has a smaller path limit.

Install Solidity **0.8.24** and set `SOLC_BIN` to its executable when it is not on PATH. Compilation uses optimization with 200 runs and the Paris EVM target. The compiler script also recognizes a cached svm installation on macOS. Hardhat 3.2.0 supplies the local EVM; it does not download a compiler for these tests.

```sh
pnpm install --frozen-lockfile
pnpm run contracts:compile
pnpm run contracts:test
```

Compilation writes the ABI/runtime commitment into the application and build/verification artifacts into ignored `.local/contracts/`. The tests deploy actual bytecode on a local EVM and exercise ancestry, authorization, namespaces, fixed shares, cumulative rounding, duplicate payments, receiver failure, reentrancy and interrupted wallet responses. Local results do not establish Monad deployment or a security audit.

Deployment, source verification, wallet setup and the shared-room walkthrough are in [the onchain guide](../docs/submission/ONCHAIN.md).
