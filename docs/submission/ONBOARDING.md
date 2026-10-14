# Sign-in and wallets

The shared `/pilot` offers EVM and Solana browser-wallet sign-in as well as Google and guest entry. **Sign in with wallet** opens a chooser grouped by Monad testnet and Solana devnet, then authenticates through Supabase before asking for a public storyteller name. Google accounts keep the existing Privy in-app wallet flow. Wallet-authenticated accounts never automatically create a Privy wallet. The dual-chain implementation is covered by SDK and component tests; live verification of the updated chooser and both wallet signatures remains pending.

The optional `/pilot` onboarding connects Google sign-in to the existing Supabase storyteller identity, then provisions a user wallet through Privy 3.48.1 on Monad testnet. The implementation uses network and native-token settings from [Monad's Next.js/Privy template](https://docs.monad.xyz/templates/next-serwist-privy-embedded-wallet), adapted to the existing application. It does not replace the app with the template's wallet dashboard.

The SDK integration and account safeguards are implemented. A user-run settings check confirms Google is enabled and Supabase advertises an ES256 public signing key. The operator subsequently confirmed live Google sign-in, wallet creation, second-profile recovery and scene registration through two Google-linked in-app wallets. The second registration succeeded after faucet funding, reconnection and a saved-action retry. Read-only Monad checks confirm the wallets' funding. The [archived user-run checker](PRIVY-REHEARSAL.json) at block 70416466 verifies six matching registered scenes and a fully settled four-wallet release. It received and paid 1.0 test MON; all four wallets claimed 0.25 each, including both Privy wallets. Contract balance and liability are zero. The exact release record is preserved locally; individual transaction links remain unarchived. Existing browser-wallet registration and the completed testnet release retain their original terms.

## Direct wallet sign-in

In the existing Supabase project, open **Authentication → Sign In / Providers → Web3 Wallet** and enable both **Ethereum** and **Solana**. In **URL Configuration**, allow `https://fork-night.vercel.app/**` for the live app, and `http://localhost:3005/**` and `http://127.0.0.1:3005/**` for local rehearsal. Supabase validates each signed message and its URI against the Auth URL configuration. The app uses the current origin with `/pilot` as that URI, without room parameters or tokens. A different preview domain needs its own allowlist entry. [Supabase Web3 authentication](https://supabase.com/docs/guides/auth/auth-web3).

The repository enables both wallet providers in the local Supabase configuration; this does not change the hosted project's settings. Direct wallet sign-in uses the existing public Supabase configuration. It needs no Privy setting, additional secret, faucet funding or contract transaction. The settings checker reports `ethereumWalletProvider` and `solanaWalletProvider` as `"confirm-in-dashboard"`; it does not infer hosted provider activation from public signing keys or Google availability.

1. In a fresh browser session, open [Midnight Signal](https://fork-night.vercel.app/pilot?room=midnight-signal) and choose **Sign in with wallet**. Under **Monad testnet**, choose MetaMask or another detected EVM wallet. Approve a network switch if needed, select the desired account and approve the sign-in message. Under **Solana devnet**, choose Phantom or Solflare and approve the sign-in message. No name is required and no gas is used. EVM wallets are discovered separately with [EIP-6963](https://eips.ethereum.org/EIPS/eip-6963), so a competing extension does not silently replace the chosen provider. Solana uses native SIWS when available, or connection followed by an adapted Ed25519 message signature. [Phantom signing interfaces](https://docs.phantom.com/solana/signing-a-message).
2. Read the room or make a continuation with either signed-in identity. Releases, support and claims still use the existing **Monad testnet** contract. An EVM sign-in retains its selected provider for release controls. A Solana storyteller can explicitly connect a separate EVM wallet, or choose an in-app wallet where Privy is configured, without changing its storyteller identity. With multiple EVM extensions, choose the desired **Browser wallet** in the release panel. Signing in does not approve a payout link or register a scene. Solana sign-in is not a Solana release contract; the separate [Solana devnet x402 funding experiment](X402.md) retains its documented scope.
3. When starting a continuation, choose a public name and select **Save my storyteller name**. It belongs to the already authenticated wallet account. Returning with the same wallet restores that account and saved byline.
4. For a new maker's payout wallet, follow the existing [signed request and curator review](WALLET-REQUESTS.md) before registering the scene. Accept the deployed equal-wallet policy separately.

Use **Midnight Signal** for the curator rehearsal. Select the configured curator's MetaMask account before signing in. The account menu should show **Signed in with your wallet** and that same sign-in address. The release panel should default to **Use a browser wallet**; connect it for Monad testnet actions. No in-app wallet is automatically prepared for wallet-authenticated users. Selecting **In-app wallet** explicitly remains available where Privy is configured; previously created wallets are preserved.

A cancelled signature or network switch can be retried. An already-open wallet request tells you to finish or dismiss that prompt first. A disabled wallet provider or a disallowed domain shows a host-setup error. These errors omit raw provider messages, signatures and tokens. For the live rehearsal, test each chain in a fresh or signed-out session, sign out, then return with the same address and confirm the same public byline and saved work. Never use a new wallet sign-in to replace an unsaved guest; sign out with the existing confirmation or keep that guest in another browser profile.

To switch accounts in the same browser, open **Making as → Sign out of this browser**. A saved Google or wallet account can return with its existing sign-in. Guests see a confirmation explaining that their published moments keep their byline, but an unsaved guest login cannot be recovered after sign-out. Choose **Keep this guest** to cancel, or **Sign out and switch accounts** to continue. Save a guest byline with Google first if you need to return to its private previews. Sign-out is disabled during generation, an unresolved wallet action or an unfinished continuation; finish, publish, discard or cancel the current work first.

After sign-out, **Sign in with wallet** appears in the header. No second browser profile is required. Using a separate profile remains an option for keeping an unsaved guest open. Wallet authentication will not silently merge that guest identity or recover it from an approved payout address. The guest can still connect MetaMask for release actions without changing its Auth identity. A MetaMask login is a separate account unless identity linking has explicitly been established.

## Google and Privy operator setup

Install the app with `pnpm install --frozen-lockfile`. Keep the following public settings in ignored `.env.local`; add them to the Vercel web settings when deploying:

```dotenv
NEXT_PUBLIC_PRIVY_APP_ID=your_public_app_id
NEXT_PUBLIC_PRIVY_CLIENT_ID=
```

The Client ID is optional. No Privy app secret or wallet private key is needed for this browser integration. [`.env.example`](../../.env.example) records the settings; [hosting preparation](HOSTING.md) includes them in the web settings and excludes them from the generation worker.

1. In Google Cloud's **Google Auth Platform**, configure the app's branding and audience, then create a **Web application** OAuth client under **Clients**. Add the app origins, `http://localhost:3005` and `http://127.0.0.1:3005` for this rehearsal, under **Authorized JavaScript origins**. Its **Authorized redirect URI** is the Supabase callback `https://<project-ref>.supabase.co/auth/v1/callback`. Put the Google Client ID and secret in **Supabase Authentication → Sign In / Providers → Google**, enable the provider and save, using the [Supabase Google guide](https://supabase.com/docs/guides/auth/social-login/auth-google). Keep the secret in that dashboard.
2. In Supabase Auth, enable **manual identity linking**. Google upgrades an existing guest with `linkIdentity`, preserving its UUID and published byline. [Guest account linking](https://supabase.com/docs/guides/auth/auth-anonymous). If Google is in testing mode, ensure the intended rehearsal accounts can use it.
3. In Supabase URL Configuration, allow the rehearsal origin and `/pilot` redirects with query parameters: `http://localhost:3005/**` and `http://127.0.0.1:3005/**`. Add the actual production `/pilot` URL when hosting. [Redirect configuration](https://supabase.com/docs/guides/auth/redirect-urls).
4. In Supabase **JWT Signing Keys**, confirm an active asymmetric signing key, ES256 or RS256. Its public JWKS endpoint is `https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json`. Existing legacy HS256 tokens cannot be verified through this endpoint; follow [Supabase's signing-key guide](https://supabase.com/docs/guides/auth/signing-keys) if migration is needed. Do not send the JWT signing secret to the browser or paste it into Privy.
5. In Privy's left sidebar, open **App settings → Integrations**, then **Built-in → Custom authentication**. Enable it, or request access if that is the available action. Once access is enabled, open **User management → Authentication → JWT integration**. Use the settings below, then save. Add the local origins and production origin to Privy's allowed origins. The **Add custom provider** form configures OAuth providers; this Supabase connection uses the JWT integration. [Privy JWT setup](https://docs.privy.io/authentication/user-authentication/jwt-based-auth/setup).

| Privy JWT field | Value |
| --- | --- |
| User ID claim | `sub` |
| Sub-user ID claim | Empty; each storyteller is an individual |
| Verification | JWKS endpoint |
| JWKS Endpoint | `https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json` |
| Authentication environment | Client side only |
| JWT aud claim | `authenticated` |
| Additional claim key / value | `iss` / `https://<project-ref>.supabase.co/auth/v1` |
| Require aud or an additional claim | Enabled |

These audience and issuer values follow [Supabase's JWT claims](https://supabase.com/docs/guides/auth/jwt-fields); substitute the actual project reference. An active public signing key is still required.

Google runs through Supabase; Privy subscribes to its verified JWT identity. Enabling Privy's ordinary Google login toggle alone does not configure this flow. The implementation explicitly creates the wallet after JWT authentication, because automatic creation through Privy's modal does not apply to this custom login path. [Supabase integration](https://docs.privy.io/recipes/authentication/using-supabase-for-custom-auth) · [JWT state subscription](https://docs.privy.io/authentication/user-authentication/jwt-based-auth/usage).

The operator's dashboard allows Custom authentication in Development and requires a paid tier to retain it in Production. Use Development for the current rehearsal; review that requirement before a production rollout. Production activation and its cost are not yet selected.

Check the public Supabase settings without creating a user, generating content or sending a transaction:

```sh
pnpm run onboarding:check
```

Look for `privyAppIdPresent: true`, `googleProviderEnabled: true`, `publicSigningKeysAvailable: true` and `connection: "checked"`. JWKS can include a standby key; separately confirm that Supabase's **Current/Active** key uses ES256 or RS256. The checker does not verify the Privy dashboard or a user's live signing flow. It prints no keys, tokens or private account data.

## Rehearse the journey

Use a regular browser at `http://localhost:3005/pilot?room=midnight-signal`; restart the development server after adding public environment settings if necessary.

1. Read a story without signing in. Choose a continuation, enter a storyteller name and select **Continue with Google**. Google links that guest's existing UUID. **Join as a guest** remains available.
2. For a guest who already published work, open **Making as → Save my byline with Google**. Confirm the existing attribution and saved preview remain attached to the same maker. An existing approved payout wallet is not replaced by the new embedded wallet.
3. Open the storyteller identity to copy the in-app wallet address. Fund a new rehearsal wallet with **20 test MON**. Wallet creation provides no test MON or gas sponsorship.
4. In the original-room release panel, select **In-app wallet** and click **Use my in-app wallet** to connect it. Choose **Request wallet approval** and sign its automatically filled address. The curator reviews it in the room, with a full-address confirmation before approval. After approval, accept the release terms and register the new contribution. [Activate and rehearse shared requests](WALLET-REQUESTS.md). Browser wallets remain available for previously approved bylines and the curator.
5. Follow the [three-wallet release guide](REHEARSAL.md) for freezing, support and claims. Each support payment is **1 test MON**; other actions pay gas. Wallets sign actions in the app, and the existing contract still verifies the signer and applies equal shares per distinct registered wallet.
6. On another browser/device, choose **Already joined? → Sign in with Google**. Confirm the same storyteller, wallet and saved preview return. Unsent local ideas remain in the original browser. Sign out through the storyteller identity when finished.

If Google is already attached to a different storyteller, the app preserves the guest and asks for a separate browser profile. It never merges bylines based on matching names or silently remaps a permanently approved payout address. Transaction recovery and wallet-switch consent resets apply to both wallet types.

If a transaction reports insufficient balance, fund that address on **Monad testnet**, then reconnect the in-app wallet. If a saved action remains, choose **Check saved action** first. Check a known transaction's receipt before sending again; if the action is unconfirmed, choose **Retry saved action** for a new wallet confirmation. A retry retains the original action and support payment key. Reconnecting clears release consent, so review and accept the terms again before a new registration. The early balance check catches empty wallets and payments leaving no gas; positive balances must still cover the actual fees.

The operator's successful Google sign-in, wallet creation, second-profile recovery, funding and two user-confirmed scene registrations are founder-operated checkpoints. Keep the registration transaction links and final checker report as evidence. The actual test extended the earlier branch to six scenes and four wallets. The [final checker](PRIVY-REHEARSAL.json) verifies a frozen release with 1.0 test MON received and paid, four equal 0.25 claims and zero remaining liability. Both in-app wallets completed their claims. This is a founder-operated rehearsal; a separate physical-device login has not been verified.
