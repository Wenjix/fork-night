# Monad release proof

The original **Midnight Signal** room at `/pilot?room=midnight-signal` has an onchain release flow. The Solidity contract and wallet integration are implemented and locally tested, and the contract is deployed on Monad testnet. MonadScan source verification is confirmed as Exact Match from the supplied explorer screenshot. A founder-operated browser rehearsal completed registration of four scenes, freezing the release, 1.0 test MON support and two separate 0.5 claims. The user-run checker confirms the final state at block **70298300**, with zero remaining contract balance or liability. This demonstrates two-wallet settlement; both wallets and all test bylines were founder operated.

This proof covers one consenting production group's release agreement within the public room. Each participating maker accepts the fixed policy before registering: every distinct wallet on the selected ancestry receives an equal share. Equal sharing is an option for small collaborating groups; the broader product's public projects, guild productions and solo work can have different agreed arrangements. The deployed contract implements only this ancestry-based rule, without configurable splits or a public/private room distinction. Off-path collaborators are outside its recipient list, and a source-project licensing contribution would be a separate future mechanism.

For the hackathon, this demo starts with an explicitly disclosed **equal-wallet policy**. Several bylines sharing one registered wallet count as one recipient. A future policy could identify separately entitled creators or organizations and route their agreed shares to shared payout destinations; the deployed demo retains its fixed wallet-based terms.

## Current testnet deployment

The dedicated deployer submitted the contract on October 11, 2026. The deployment script confirmed the transaction and matched its runtime bytecode to the compiled contract. The [public deployment record](MONAD-TESTNET.json) contains its receipt fields.

| Field | Value |
| --- | --- |
| Network | Monad testnet, chain 10143 |
| Contract | [0x15247565331013132e5563Cd29E99E0baA38690f](https://testnet.monadscan.com/address/0x15247565331013132e5563Cd29E99E0baA38690f) |
| Deployment transaction | [0xb1563a4f9d373a40c55fe9df200cf561efe6bd32e2d82f9ed55564a445931967](https://testnet.monadscan.com/tx/0xb1563a4f9d373a40c55fe9df200cf561efe6bd32e2d82f9ed55564a445931967) |
| Confirmed block | 70063427 |
| Deployment gas used | 1241884 |
| Curator | `0x744D5A0D982752DBd1414Aa2898d57Da9E30645B` |
| Source verification | [Verified — Exact Match](https://testnet.monadscan.com/address/0x15247565331013132e5563Cd29E99E0baA38690f#code) |

To use this contract, set these public values in `.env.local` and restart/rebuild the app:

```dotenv
NEXT_PUBLIC_MONAD_CHAIN_ID=10143
NEXT_PUBLIC_MONAD_RELEASE_ADDRESS=0x15247565331013132e5563Cd29E99E0baA38690f
NEXT_PUBLIC_MONAD_CURATOR_ADDRESS=0x744D5A0D982752DBd1414Aa2898d57Da9E30645B
```

The curator must connect that wallet to create and curate the payout project. The deployer paid deployment gas and has no automatic project role or recipient share. Each wallet sending application transactions needs its own test MON for gas.

## Build and deploy

Use Node.js 22.18 or newer, install dependencies and install the pinned Solidity 0.8.24 compiler. Set `SOLC_BIN` to its executable if necessary. The [contract guide](../../contracts/README.md) documents the build and local tests.

```sh
npm run contracts:compile
npm run contracts:test
```

Set `MONAD_DEPLOYER_PRIVATE_KEY` in the ignored `.env.local` file to a dedicated wallet funded with test MON, then run:

```sh
npm run contracts:deploy
```

The script validates the local signer and curator settings before connecting, requires chain 10143, checks funds for estimated gas, persists deployment intent before submission, and refuses a second deployment while an intent/receipt exists. RPC requests time out after 10 seconds. An uncertain response requires inspecting the recorded predicted address and transaction; do not delete that intent and repeat blindly. Build artifacts, standard JSON verification input, deployment intent and receipt stay in `.local/contracts/`. No private key is included in those records or browser configuration.

Verify the deployed source on the testnet explorer using Solidity 0.8.24, optimization with 200 runs, Paris EVM and the exact saved standard JSON input. There are no constructor arguments. Record the verification result separately; matching bytecode is not itself explorer source verification. The browser also checks deployed runtime bytecode and policy before enabling an action.

For [MonadScan's verification form](https://testnet.monadscan.com/verifyContract), select **Solidity (Standard-Json-Input)**, compiler **v0.8.24+commit.e11b9ed9**, and **GNU AGPLv3** to match the source's `AGPL-3.0-only` license. For this local deployment, upload the preserved `.local/contracts/verification/standard-input.json`; it contains the exact deployed source, optimizer and EVM settings. The contract name is `contracts/ForkNightReleases.sol:ForkNightReleases`. The compiler's general output at `.local/contracts/standard-input.json` is rewritten by builds and contract tests, so archive it when deploying and retain the archived copy for verification. A fresh clone can reproduce the compiler output from the pinned source and compiler, then compare its runtime hash with the public deployment record. [MonadScan's guide](https://info.monadscan.com/how-to-verify-contracts/) explains the Standard JSON method and confirmation of the published contract details.

Copy the public addresses from `.local/contracts/public-settings.env` into the corresponding public settings in `.env.local`, then restart/rebuild the app. The script preserves an existing `NEXT_PUBLIC_MONAD_CURATOR_ADDRESS`, which can identify a different wallet from the deployer; that wallet must create and curate the project. It defaults to the deployer only when the curator setting is empty. Public settings are frozen into the Next.js build.

## Shared-room walkthrough

The shared pilot needs its existing Supabase setup. No new inference request is necessary for the financial proof: use already published original/permissioned scenes and two distinct participating wallets. Prepared activity and founder-operated wallets must be described accurately.

1. Open the original room, choose a published path and expand **Make this path a shared release**.
2. Connect the configured curator's wallet, accept the testnet terms and start the payout project. Approve the opening's actual declared maker wallet explicitly; it need not be the curator.
3. The curator approves each published byline's wallet. Each maker connects that approved wallet, accepts the terms and chooses **Register scene**. Registration follows the approved wallet even when its holder uses a different browser guest account; creation and publication still use guest permissions. The opening registers first; later scenes register after their parents. Disabled actions name the missing parent or other prerequisite. Admission is a curator attestation, not an independent identity check.
4. Return to the curator wallet and choose **Freeze this release** after the entire selected path matches its registered commitments.
5. A supporter connects a wallet funded with test MON and chooses **Support this release**. The displayed claims are read from confirmed contract state.
6. Each recipient reconnects their own wallet and chooses **Claim my … test MON**. Show the recipient's actual balance and explorer transaction alongside the app. Network gas is paid separately by the sending wallet.
7. Refresh after support/claim. If a response is interrupted, choose **Check saved action**. An explicit retry retains the original support-payment ID; the contract cannot collect it twice. A dropped action and an already settled action are distinguished using receipts or confirmed contract state.

The downloaded release record contains the exact ordered public scene manifests, caption and media-hash commitments, terms, chain, contract and release ID. It excludes private drafts, prompts and provider receipts. Generated media remains in existing durable Supabase storage; the prepared opening's artwork hash identifies the shipped original sheet. Keep the actual bytes available as well as their hashes.

## Read-only rehearsal check

Before the walkthrough, check the configured deployment and the curator's test MON balance. Include the second maker's public wallet address to check its balance too:

```sh
npm run contracts:check -- --wallet 0xYOUR_SECOND_MAKER_ADDRESS
```

The command checks the network, deployed runtime bytecode, policy, existing project terms, balances and contract liability. It submits no transactions, uses no private key and saves a timestamped public-state report under ignored `.local/contracts/`. A positive balance alone does not establish that a wallet has enough gas for every step.

Use **Download exact release record** in the selected path's release panel, then check that file before approving wallets and again after funding and claims:

```sh
npm run contracts:check -- --wallet 0xYOUR_SECOND_MAKER_ADDRESS --record "$HOME/Downloads/fork-night-release.json"
```

With a record, the command reconstructs the ordered scene commitments and release ID, compares registrations with contract state, checks frozen recipients against the complete ancestry, and reconciles received, claimed and claimable totals at one recorded block. `fundedAndFullyClaimed` is true only after the release has received a positive payment and all recorded funds have been claimed. Inspect the recipient addresses and amounts as well: the flag alone does not establish two distinct makers or that they used the browser. Two distinct wallets sharing a 0.01 test MON payment receive 0.005 each; sending transactions also consumes gas.

## Independent claims and limits

The [contract](../../contracts/ForkNightReleases.sol) exposes `claimable(releaseId, beneficiary)` and `claim(releaseId, beneficiary)`. A recipient can use its verified explorer interface or another compatible client without the Fork Night application. Anyone can trigger a claim, but its destination remains the frozen beneficiary. No caller-supplied list can omit an ancestor from a release.

The pilot uses one parent per moment and provisional equal wallet shares. Wallets do not prove unique humans, and the contract does not verify artistic value, lawful reuse, marketplace demand or whether a scene truly uses its declared parent. External media availability and curator byline admission remain application/community responsibilities. Generation funding, testnet payouts and future stable-asset balances are separate mechanisms. Token conversion, budget voting and mainnet payments are not implemented by this slice.
