# Treasury hops: a guild allowance and a Safe fund the x402 payer (testnet)

Two rehearsals show a shared treasury paying for a Fork Night room top-up through a payer wallet. A **Squads** multisig on **Solana devnet** and a **Safe** on **Base Sepolia** each send 1.00 test USDC, under their own approval rules, to a fresh payer wallet that holds nothing else. That wallet then pays the room's [x402 top-up](X402.md) in the usual way and buys **5 test credits**. The treasury steps are scripts run beside the app; only the final payment goes through the app's x402 route.

What this proves: **a guild allowance funded the payer wallet that paid through x402 (Squads v4 on Solana devnet), and a 2-of-3 Safe funded the payer wallet that paid the room's x402 door on Base Sepolia; test credits only.** The treasuries never pay the x402 route themselves. Room credits are one pooled count, so a top-up explains a credit change, not a particular image, and continuations run on the operator's approved allowance. Test tokens are free from faucets, so this proves the approval path and the payment rail, not real backing. No mainnet funds moved.

All keys are throwaway testnet keys held by the founder. That covers the three Squads stewards, the three Safe owners, the two patron wallets that seeded the treasuries (one per network), and both payer wallets, so the approvals show the treasury rules working, not independent people agreeing. The Squads program used is the public devnet deployment of Squads v4 (`SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf`). That deployment is upgradeable, and its bytecode differs from the audited mainnet program.

## Read the recorded funding in the room

This build includes a read-only history at `/pilot?room=paper-moon&view=treasury`. Paper Moon’s compact funding summary opens the five recorded steps: deposit, steward approval, withdrawal to the authorized payer, the payer’s x402 payment, and the app’s +5-credit entry. The inspector also shows the later allowance removal and its receipts. Current room credits and generation activity remain separate from these historical amounts. Earlier ordinary Solana and Base receipts remain under “Other recorded funding.”

The local Paper Lantern hall links to this shared pilot in a new tab. Its sample people do not represent the actual steward keys, and its local account and project membership are not transferred. Reading the history requires no wallet signature. Treasury proposal, approval and withdrawal scripts still run outside the app; the hosted x402 funding endpoint remains disabled.

## Squads on Solana devnet

A 2-of-3 multisig approves a one-time spending limit for one spender. That spender is the payer wallet, which is not a multisig member, and its only allowed destination is the payer's own wallet. The payer draws within the limit and pays the room.

| Step | Transaction |
| --- | --- |
| 1. Create a 2-of-3 multisig: three steward keys, no config authority | [4Wz3Q4vR…](https://explorer.solana.com/tx/4Wz3Q4vRVFvhMPVV1oPkY1La2xaSYxvyGytdRLh163SRZQvrDeg41VLgzoKm6aabpUerQNpEMKDFWjFYGcGqaRyt?cluster=devnet) |
| 2. The patron wallet deposits 5 devnet USDC into the vault | [8am75Hgw…](https://explorer.solana.com/tx/8am75HgwckBxoBpxzRwehdnddmPuvmWoPdPBaDXj6aCEfD13ytL9LB8xCbsNLQcdgbgVEigPPzeX3MU8YmbpsWs?cluster=devnet) |
| 3. Steward 1 proposes a spending limit: 3 USDC, one time, one spender, one destination | [4qBGrGKH…](https://explorer.solana.com/tx/4qBGrGKH9fGSP3gPPoWs56ogWGyzuC2y86LzWLM2DRd3er4bTfW9d4zsuGv7voRKpufAqJJK6wJLnekLYtcXQ5bs?cluster=devnet) |
| 4. Stewards 1 and 2 approve | [cLFvnQxQ…](https://explorer.solana.com/tx/cLFvnQxQdvk2EG6q2DeqgesdX1mT9Siaj3bH8LgbTkG2Q8jYqmZavGjip7NxkBxPVEc7bbSedpX1h5bjeQTkpii?cluster=devnet), [3XKXtuSg…](https://explorer.solana.com/tx/3XKXtuSgvMq355JMEJRnU5XtVQkEbwyVVQuXk7WmqrX7GGh4TriTRogJ8AwwhpksvDNmE5baZY8UyhJuoYzMfB1A?cluster=devnet) |
| 5. Execute: the spending limit is created | [Cj5cawMt…](https://explorer.solana.com/tx/Cj5cawMtpzGQu3P89ZGTQAycst6rtAynSM8YobTvXu37rFHB3ERcT77mZW3mPjHayQYdPKMdLJNgoSSiPgtB8TG?cluster=devnet) |
| 6. Create the payer's USDC account | [3fLaYHts…](https://explorer.solana.com/tx/3fLaYHtstnCDgFKtc5xGgWVXrrJqgJLiDHASFQAfXNtYuDMgW37Qb7dE4547mtQEcus5yZvmUXkCuCBaaJ3Kejmz?cluster=devnet) |
| 7. The payer draws 1 USDC within the limit (vault 5 → 4, payer 0 → 1) | [2DqxTydd…](https://explorer.solana.com/tx/2DqxTyddDx9DE4gDKcFNWWB7kunnm7dfPdt4hftH17492cfceAzx4off7WSy9ZcU1DyVxVnvtGzK7BgYc5bXgXcr?cluster=devnet) |
| 8. The payer pays the room's x402 top-up on Solana devnet (payer 1 → 0; room 19 → 24 test credits) | [2AFKQZCE…](https://explorer.solana.com/tx/2AFKQZCEDJdcpAqBcy5uMMKW3XViNjJmXSrWYymCBDPJTwdmkaTr7q7h7UQP2DUjG6BGXxUmsya9HtpZUri3KYdz?cluster=devnet) |

Accounts:
- Multisig [`9Hwpbq8g…cReA`](https://explorer.solana.com/address/9Hwpbq8gkoCGSb5wBog9QwczeiCc1d1cXp78m8UfcReA?cluster=devnet)
- Vault `6LGvFZbMoWyWsNjayMi4FeAQMLNAXEVFJbGzeSPE52RW`
- Spending limit [`6ygdeiwJ…CKnaM`](https://explorer.solana.com/address/6ygdeiwJEvAfBNMVgSX5NPTQ7XfjLUPk8UqdahDCKnaM?cluster=devnet), removed after the demo by a second 2-of-3 vote with 2 USDC unused. The vote: propose [2wPP9GYY…](https://explorer.solana.com/tx/2wPP9GYYjWvPKNRJij5ut7U2nd7eT7zdtxyYdKJJEYdc2i69YLummuXiXeDDU1a9r24kqmTYMAVLBWt6g8y1XeJG?cluster=devnet); approve [in2M2gHF…](https://explorer.solana.com/tx/in2M2gHFBa8caXUErp5BxMcWydtVothfHuJnHTAQJ7DMKdhotMcMA4CZnDmE3wCz3dD86UsntLCGyffpg5untDW?cluster=devnet) and [3CgxgHUf…](https://explorer.solana.com/tx/3CgxgHUfMXuDhkMUvSiDBFADkFyzAS9QPejVdm9jwAzQsouBYZcPQwMh2VgBKvfTEV9ABekpQqeqYVisMzj4NC7p?cluster=devnet); execute [39QCnEAZ…](https://explorer.solana.com/tx/39QCnEAZNp3NiSx3PtCs9uSXavasaUax4L2pg2uuYLG7iqXkD1FZtY3YjxenrVPSizSgKWVaGxcJ5k4HthvmHuSg?cluster=devnet), on Oct 13. A draw simulated afterwards fails with `AccountNotInitialized`, and the vault's remaining 4 USDC stays under 2-of-3 control.
- Payer `EFpvKAoQ6tAFDyNFtdfrF3i3nHRwZdrYtKFR1q3j7MXL`

Right after the draw, four refusals were simulated against the live multisig (2 USDC left on the limit), and none was broadcast:

| Attempt | Program error |
| --- | --- |
| A draw one base unit above the remaining allowance | `SpendingLimitExceeded` |
| A draw to a wallet that is not on the destination list | `InvalidDestination` |
| A draw signed by a steward who is not the limit's spender | `Unauthorized` |
| Executing a proposal with only one approval | `InvalidProposalStatus` |

A control draw within the allowance succeeded in the same simulation.

## Safe on Base Sepolia

A 2-of-3 Safe (v1.5.0, L2 singleton, created through the canonical proxy factory) holds test USDC. Two owners sign one transfer of 1.00 USDC to a fresh payer wallet. The payer pays the room through x402's EIP-3009 flow, so it needs no ETH.

| Step | Transaction |
| --- | --- |
| 1. Deploy the Safe [`0xCf3c…0595`](https://sepolia.basescan.org/address/0xCf3c5C477807840a5a533a9849D09583deF90595) with three owner keys and threshold 2 | [0xbea4a7b9…](https://sepolia.basescan.org/tx/0xbea4a7b9fbdd68e645c578f9750a20a0654e13e738a5532036991ca8e13c05dd) |
| 2. The patron wallet deposits 5 test USDC into the Safe | [0xc64d2be1…](https://sepolia.basescan.org/tx/0xc64d2be108a78731e386ebeeeb8a70290ab99d26aafcc8907f333ffa8e2dc1ea) |
| 3. Owners 1 and 2 sign (EIP-712) a 1.00 USDC transfer to the payer; it executes with `ExecutionSuccess` | [0x970c47c6…](https://sepolia.basescan.org/tx/0x970c47c6d6311d69fc9d35ac080cd547baa554d760762bebdf9796b24ad9e711) |
| 4. The payer pays the room's x402 top-up on Base Sepolia (payer 1 → 0; room 24 → 29 test credits) | [0xa124d811…](https://sepolia.basescan.org/tx/0xa124d8117048e27f3686da98a5f07908d9998c765c45fcb25a455d6d3ac02ace) |

The payer is `0x4Da3b4d10F455001D965124f1c56C395D5f8AbF0`; its only USDC came from the Safe. Three negative checks were simulated against the deployed Safe and not broadcast:
- the same transfer with one owner's signature reverts with "Signatures data too short";
- a set that includes a non-owner's signature is rejected;
- replaying the executed transaction is rejected.

## What the app saw

Each final payment is an ordinary x402 top-up: 1.00 test USDC to the room's receiving address, settled by the public `x402.org` facilitator, which paid the network fee. The route credited the room through the pilot's existing refill, and each top-up produced one refill row whose request ID is `UUIDv5(network:transaction)`. The operator's $10 dollar ceiling was unchanged, and the reconciler found nothing outstanding. Room and guest identifiers never reach a treasury, the facilitator or a chain.

The final payments use the app's own agent payer, pointed at the payer wallet's directory:

```sh
X402_WALLET_DIR=<payer wallet dir> npm run x402:fund -- --network solana --room <roomId>
X402_WALLET_DIR=<payer wallet dir> npm run x402:fund -- --network base --room <roomId>
```

The treasury steps are standalone scripts and are not part of this repository; every step above can be checked on the public explorers. A room's x402 top-ups stay capped by its steward's limit.

## Not included

A treasury paying the x402 route directly is later work. That means a Squads vault paying through `spending_limit_use` with a custom x402 client, or a Safe acting as the x402 payer, which the default x402 client cannot sign for. Also later work: proposing or approving treasury spending in the app, treasury-funded budgets with refunds, independent stewards, and mainnet custody. Each needs its own decisions about real funds, refunds and accounting.
