# Wallet requests and curator review

Makers can authenticate directly with a browser wallet or use Google with a Privy in-app wallet. The joining form uses the supplied Google logo, and the identity and release controls identify Privy as the in-app wallet provider. Guests can still join without a wallet. Direct wallet login needs the hosted Supabase Ethereum Auth provider enabled; see [onboarding](ONBOARDING.md).

A published maker now chooses **Request wallet approval**. The address comes from the connected wallet. The maker signs a message covering the project, contract, network, terms, published scene, maker identity, request ID and timestamp. Requesting approval uses no gas and does not approve a payout link. The maker's published byline and requested address are visible in the public room; Auth tokens, private drafts and raw signatures are not included in the room projection.

The curator connects its existing wallet and opens **Wallet requests** in the room's release panel. Requests include the published byline, source scene and submitted address. **Approve** opens a confirmation with the full checksum address and permanent payout-policy explanation. Confirming sends the existing onchain approval. **Deny** opens a separate confirmation and asks for a curator signature; it closes the shared request without a gas payment. A denied maker can submit a new request. Denial does not revoke an approval recorded onchain.

Reviewing an approval from another branch selects that maker's published path before sending the transaction. This keeps scene indices and saved-action recovery aligned. After approvals, return to the intended final scene before freezing the complete release. Approval and scene registration remain separate actions, and registered wallets still receive equal shares under the deployed policy.

## Activate shared storage

The [additive migration](../../supabase/migrations/202610120010_wallet_requests.sql) adds a service-only request table and submission function. It preserves existing rooms, scenes, bylines and release records. The server uses the existing `SUPABASE_SECRET_KEY`, Supabase URL and public contract configuration; no new secret or deployer key is needed.

1. In the project terminal, run the isolated database proof:

   ```sh
   pnpm run test:pilot-db
   ```

   This creates a temporary PostgreSQL cluster with a test Auth shim. It applies the migrations and SQL proofs, including [wallet-request ownership, permissions and replay checks](../../supabase/tests/wallet-requests.sql). It does not connect to the hosted project or dispatch generation.

2. After that passes, copy the migration in your terminal:

   ```sh
   pbcopy < supabase/migrations/202610120010_wallet_requests.sql
   ```

3. Open the existing Supabase project's **SQL Editor**, paste the migration into a new query and run it once. Use only the migration, not the SQL test fixtures. If a migration manager has already applied it, do not apply it again.
4. Refresh the local pilot at `http://localhost:3005/pilot?room=midnight-signal`. Connect the curator and choose **Check wallet requests**. With no new requests, expect **No wallet requests waiting.**

## Rehearse the request flow

Use a fresh storyteller with an owned, published scene. The earlier rehearsal's bylines already have permanent wallet links and cannot request replacements. Makers can use either a Google-linked Privy wallet or an external browser wallet.

1. In the maker's original session, open the chosen scene's release panel, connect the intended wallet and choose **Request wallet approval**. Check the full displayed address and sign the request. Expect **Your request is with the curator** after it is saved. If the answer is interrupted, check the room before sending again; the same pending request is reused.
2. In the curator's session, open the original room and connect the curator. Requests refresh every eight seconds; the refresh button checks sooner. To exercise denial and approval with one new scene, first choose **Deny**, read the full-address confirmation and sign with the curator. The maker should see **Your wallet request was denied**.
3. In the maker's session, review the connected address and choose **Send a new wallet request**. In the curator's queue, choose **Approve**, inspect the full address, byline and network, then confirm the curator transaction. A busy or unresolved saved wallet action blocks another approval. Denial must precede approval in this test because it cannot revoke an approved onchain link.
4. In the maker's session, refresh the release, accept the terms and choose **Register scene**. Approving a wallet does not register its scene. Follow the existing [release rehearsal](REHEARSAL.md) for ancestors, freezing, support and claims. The previous frozen release retains its recorded split and claims.

## Verification status

Automated HTTP and crypto tests cover authenticated identity, wallet ownership, signed scene/project inputs, expiry, closed rooms, immutable approved wallets, curator authority and onchain confirmation. Component checks cover full-address review, disabled confirmation and approval/denial labels; the existing wallet-session and local-EVM checks preserve registration and payment recovery. The production build includes the new route.

The operator's `pnpm run test:pilot-db` passed on October 12, including the new wallet-request SQL checks for service-only access, published-scene ownership, preserved attribution, identical retries, a single pending request, resubmission after denial and closed-room rejection. The database uses a test Auth shim; wallet signatures and bearer-token handling are covered separately by the HTTP tests.

The operator then applied the migration successfully in hosted Supabase and confirmed **No wallet requests waiting** in the curator's local app. The same screen still showed six registered scenes, 0.25 test MON previously claimed and no share awaiting claim. This verifies user-reported hosted activation and the empty-queue read. Fresh desktop/phone captures and a live request, denial, resubmission and approval remain pending. The [completed earlier payout proof](PRIVY-REHEARSAL.json) remains evidence for the existing contract and Privy transaction journey; it does not verify those new request actions.

[Onboarding](ONBOARDING.md) · [Release contract](ONCHAIN.md) · [Architecture](ARCHITECTURE.md)
