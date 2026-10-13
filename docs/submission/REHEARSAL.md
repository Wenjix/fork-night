# Three-wallet collaborative rehearsal

One founder operates the existing curator and two fresh maker sessions. The original opening belongs to the curator wallet, so the new three-scene path has three distinct payout recipients. Fund each test wallet with **20 test MON**. Each wallet supports the release once with **1 test MON**, making **3 test MON** total and an exact **1 test MON** claim per wallet, with gas paid separately. This is a founder-operated test of the collaborative journey, not evidence of three independent users.

The [completed live Privy rehearsal](PRIVY-REHEARSAL.json) used an existing branch extended to six scenes and four wallets. At block 70416466, all scenes matched, the release had received and paid 1 test MON, each wallet had claimed 0.25, and contract balance/liability were zero. Both in-app wallets completed their claims. The fresh three-scene scenario below is a separate planned test.

Use the original **Midnight Signal** room. Its [deployed contract and equal-wallet policy](ONCHAIN.md) remain fixed. Start a new branch from the original opening; keep the previous frozen release and its approved bylines intact.

## Prepare the sessions

Keep the existing curator's Ethereum-compatible browser wallet. Makers can use their Google-linked in-app wallets or separate browser wallets. Create three separate browser profiles or use browsers with independent account storage:

| Session | Storyteller identity | Connected wallet | Role |
| --- | --- | --- | --- |
| Curator | Optional; no new contribution required | Existing curator, `0x744D5A0D982752DBd1414Aa2898d57Da9E30645B` | Approves new wallets, freezes the release, claims for the opening |
| Maker A | Fresh storyteller named Rehearsal A | A separate funded in-app or browser wallet | Publishes and registers the first new scene |
| Maker B | Fresh storyteller named Rehearsal B | Another separate funded in-app or browser wallet | Publishes and registers its continuation |

Tabs in the same browser profile share account identity. Private windows in the same private session also share storage. Guests return to the same original profile to recover their drafts; entering the same name elsewhere creates a different guest. Google-linked storytellers return with the same Google sign-in; unsent local ideas still belong to their original browser.

For Google-linked makers, follow [the onboarding guide](ONBOARDING.md). **Use different Google accounts for Maker A and Maker B**: signing in with the same account restores the same storyteller and wallet. First confirm that Maker A's wallet returns in a second browser profile, then fund its address with 20 test MON. Prepare Maker B separately. Keep the curator profile available for approvals.

Connecting a wallet selects a testnet role; it does not switch the storyteller identity. Each transaction sender needs test MON for gas. The app uses the existing public contract configuration and needs no new deployer key for this rehearsal.

For the local pilot, run the app and development worker in separate terminals:

```sh
pnpm run dev --port 3005
```

```sh
pnpm run dev:worker
```

Open `http://localhost:3005/pilot?room=midnight-signal`. All three sessions on the same computer can use that address. The full hosted app and cloud worker must be deployed before inviting people on other computers. Generation still uses the operator's existing enabled allowance.

## Make a fresh branch together

1. In Maker A's profile, open **Story so far** and read the original **The midnight signal** opening. Choose **Add the next part**, join as **Rehearsal A**, and write a short continuation. Check the source shown in the composer: it should be the original opening.
2. Choose **Preview my idea**, edit the panel plan, then choose **Generate 1 panel** for a small test. The saved request distinguishes waiting, generating, needing a check and ready to review. Refresh or use **Check saved result** to recover that request. Complete delivery consumes the quoted room credit even if you discard it.
3. Review the private preview and choose **Publish my moment**. Choose **Invite the next storyteller** and copy the displayed moment link. It remains selectable if the browser cannot share or copy automatically.
4. Open that link in Maker B's profile. Join as **Rehearsal B**, make one continuation, review it and publish it. Share Maker B's published link with the curator session. The chosen path should contain exactly the opening, Maker A and Maker B.

Inspecting an earlier scene keeps the full chosen path's release. Choosing a different branch in the map or publishing a new tip selects that branch's release. The release header states how many scenes are included.

## Approve, register and freeze

1. Activate [shared wallet requests](WALLET-REQUESTS.md#activate-shared-storage) before this new rehearsal. In each maker profile, expand **Release and support this story** below the story actions. For an in-app wallet, select **In-app wallet** and click **Use my in-app wallet**; for a browser wallet, select that option and connect the extension. Confirm the displayed address and role, choose **Request wallet approval**, then sign the request. Its address is filled automatically from that wallet.
2. In the curator profile, connect the curator wallet and review **Wallet requests** in the room's release panel. Choose **Approve** for each new maker, inspect the full address in the confirmation, then confirm the curator transaction. Reviewing another branch selects its source path; after both approvals, open Maker B's final link again. The project permanently binds each byline to its approved wallet. The original opening is already registered from the earlier rehearsal; reuse it.
3. In Maker A's original profile, open Maker B's final moment link so the release includes the complete three-scene path. Reconnect Maker A's approved wallet if needed and refresh. Accept the terms and choose **Register scene** beside Maker A's scene. Approval and scene registration are separate states.
4. In Maker B's profile, refresh, accept the terms and register its scene after Maker A's. A disabled action names its prerequisite. Changing the wallet or chosen release clears consent, so review and accept again.
5. In the curator profile, refresh the complete three-scene path. Confirm three scenes registered and three distinct recipient wallets, then choose **Freeze this release**. Its ancestry, recipient list and equal split are now fixed.

## Support, claim and verify

1. Save **Download exact release record** under **Terms, addresses and release record** as `fork-night-three-wallet-release.json`. Use this new record rather than the earlier rehearsal's download.
2. Open Maker B's final moment link in each original profile and check that the release includes all three scenes. In the curator, Maker A and Maker B sessions, enter **1** and choose **Support this release** once from each wallet. Confirm and refresh after each payment. The app defaults to 1 test MON and retains its 10 test MON per-payment limit. Three payments make **3 test MON** total, leaving **1 test MON** claimable for each recipient. This support does not buy generation credits.
3. In the curator, Maker A and Maker B sessions, connect each recipient and choose **Claim my 1.0 test MON**. Claims go to their registered destinations. In-app wallets request transaction approval inside the application. For browser-wallet changes, switch in the extension and reconnect in the app; the storyteller name stays the same.
4. If confirmation is interrupted, use **Check saved action** before sending again. Check a known transaction's receipt while it is awaiting confirmation. For an insufficient-balance failure, fund the same testnet wallet and reconnect; after checking the unconfirmed action, choose **Retry saved action**. A retry keeps the original action and payment key. Keep the browser's saved action until it is reconciled. See [in-app wallet recovery](ONBOARDING.md#rehearse-the-journey).
5. Run the read-only checker with both new public addresses, replacing the placeholders below:

```sh
pnpm run contracts:check --wallet 0xMAKER_A --wallet 0xMAKER_B --record "$HOME/Downloads/fork-night-three-wallet-release.json"
```

Expect `runtimeVerified` and `policyVerified` to be true, all three scenes to match, the release to be frozen, **3.0** received and paid, **1.0** claimed by each recipient, no remaining claimable amount, and `fundedAndFullyClaimed: true`. Check that the beneficiaries are the three intended addresses. Contract balance and total liability also include any other releases.

The first 1 test MON payment is divided across three wallets to the nearest wei. After all three payments, each cumulative share is exactly 1 test MON. Approval, registration, freezing and claiming pay network gas; they do not attach a fixed 1 test MON payment.

Keep the checker report and explorer transaction links as evidence. The UI refinements have automated state and rendering checks; the completed four-wallet proof above records the actual live test. Record a separate checker if running this fresh three-scene scenario.

[Demo](DEMO.md) · [Monad release proof](ONCHAIN.md) · [Hosting](HOSTING.md)
