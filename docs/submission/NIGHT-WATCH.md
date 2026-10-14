# Night Watch and Privy

Night Watch prepares private story candidates for a maker. The maker authorizes a temporary signer on their embedded Privy wallet. The local runner can continue after the maker closes the browser.

## Privy pitch

Fork Night lets people and AI agents build stories together. Privy lets a creator give Night Watch a limited spending permission, close the tab, and return to private story drafts. The agent can buy test credits within approved payment rules. The creator decides what gets published and can revoke further signing. A separate Privy wallet can also pay the gas to deliver a creator's share on Monad. These testnet integrations connect creative work, controlled agent spending and payouts in one experience.

## Wallet permissions

Privy checks each payment authorization against the selected chain, test-USDC contract, recipient, maximum amount and signing deadline. Fork Night tracks the cumulative allowance, number of top-ups and room binding. The runner buys test credits through the local Base Sepolia x402 door only when the room needs capacity.

The maker controls publication. Revocation removes the additional signer and changes its session policy to deny new requests. An authorization signed before revocation can still settle.

A separate Privy server wallet can sign a Monad release claim and pay its gas. The release contract sends the share to the fixed beneficiary. This helper does not receive the maker's publication permission.

## Local setup

Use the account settings in [ONBOARDING.md](ONBOARDING.md), the payment setup in [X402.md](X402.md) and an approved operator inference allowance. Set `PILOT_LOCAL_CONTROLS=1` only on the operator's machine. Configure `NEXT_PUBLIC_PRIVY_APP_ID` and the private `PRIVY_APP_SECRET`. The embedded wallet must support Privy additional signers.

`scripts/night-watch-privy.ts` creates and checks the local signer, policies and helper wallet. `scripts/night-watch-runner.ts` runs the jobs. Their command comments describe setup and execution. Keep generated authorization keys, wallet state and run records local under `.local/night-watch`.

Optional Kimi planning, candidate review and desk assistance use `TOKENROUTER_API_KEY`. Set `NIGHT_WATCH_BRAIN=1` to enable planning in the runner. Provider expenses remain separate from test-credit payments.

Both interactive routes are local-only. `/night-watch` is the regular experience. `/night-watch-privy` adds provider marks and numbered explanations to the same controls and receipts. Hosted visitors receive an explanation of the local demonstration.

## Two-minute Privy recording

1. Open `/night-watch-privy` with the maker already signed in. Identify their embedded wallet.
2. Show the brief, attempt allowance, payment limit and expiry. Authorize Night Watch.
3. Close the tab. Return to the completed job. Show its actual payment receipt if a top-up occurred, then the private candidates.
4. Show the maker's separate publication decision.
5. Revoke Night Watch. Show a new signing request refused by Privy.

Use the optional helper claim only after its transaction has completed. Keep the main release ceremony in the main product demo.

Testnet only. Test credits represent application capacity. The operator pays for image inference. A job with enough credits makes no payment; captions do not establish that a payment, claim or recording occurred.
