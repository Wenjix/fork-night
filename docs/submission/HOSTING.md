# Full shared pilot on Vercel and Trigger.dev

The complete Next.js app is deployed at [fork-night.vercel.app](https://fork-night.vercel.app), with the [shared Midnight Signal pilot](https://fork-night.vercel.app/pilot?room=midnight-signal) available at `/pilot`. Trigger Production version **20261013.1** has `fork-night-generate` registered, using the existing Supabase project for accounts, shared records and media.

The operator's deployment receipt on October 13, 2026 confirms HTTP 200 for the lobby, pilot, signup, QR presentation, world demo and creator demo, and HTTP 401 for an unsigned generation request. Worker registration was independently checked through Trigger. A hosted sign-in, complete preview generation and deliberate publication with the local worker stopped remain to be rehearsed. This checkpoint confirms deployment and HTTP access; it does not claim that final browser journey is verified.

The web app submits an admitted operation to `fork-night-generate`; the cloud worker performs image generation and saves the result. Running only Vercel with a Development Trigger key still depends on a local worker. Production needs a deployed task version and a Production key. [Trigger deployment guide](https://trigger.dev/docs/deployment/overview).

## Prepare the source and settings

From the working project:

```sh
npm run hosting:prepare
```

The command creates a fresh, ignored `.local/submission/fork-night-hosted-…` directory containing:

| File or folder | Purpose |
| --- | --- |
| `source/` | Complete allowlisted application source, runtime assets, tests and curated docs |
| `web.production.env` | Private settings for Vercel Production |
| `worker.production.env` | Private settings for the Trigger Production worker |
| `preparation.json` | Public-file hashes and missing-setting names; no secret values |

Deploy **only `source/`**. The two private settings files are outside it. They have owner-only file permissions, and the containing directory has owner-only access. The selection excludes the working archive, Git history, deployer private key and hosting credentials. The [Vercel ignore file](../../.vercelignore) also excludes local files from CLI uploads. [Vercel exclusions](https://vercel.com/docs/deployments/vercel-ignore).

Preparation reads `.env.local`, then `.env.production.local`, then process environment overrides. It preserves the input files. A Development Trigger key is omitted from the web settings and reported as missing. Local refill controls are forced off. Existing compute allowances and provider usage are not changed, and the command sends no network requests.

For repeatable preparation, put the Production `TRIGGER_SECRET_KEY` and chosen `FORK_NIGHT_PUBLIC_URL` in an ignored `.env.production.local`, then prepare a fresh bundle. Keep the Development Trigger key in `.env.local` for the local worker. Alternatively, fill the two missing values directly in the prepared web settings file before importing it.

## Deploy the cloud worker

In the existing Trigger project `proj_mgjcdpmejdtuazlikyzo`, select **Production**. Import or add the three settings from `worker.production.env` through its environment-variable settings:

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SECRET_KEY` as a secret
- `OPENAI_API_KEY` as a secret

The worker does not need a wallet key, Cartesia key or web Trigger key. Retain the current task's single concurrency, one attempt and paid-request recovery rules. All generation environments using this Supabase project share its existing budget records; they do not create separate allowances.

Enter the prepared `source/` directory and install its pinned packages:

```sh
pnpm install --frozen-lockfile
npx --no-install trigger deploy --env prod --skip-update-check
```

Use the existing CLI login. If it has expired, run `npx --no-install trigger login` in your own terminal. Confirm the Production version lists `fork-night-generate` and completes deployment. The [worker configuration](../../trigger.config.ts) includes the compressed seed artwork and Sharp dependency needed by cloud execution.

Create a named **Production / Trigger only** API key in that same Trigger project and put it in the web settings as `TRIGGER_SECRET_KEY`. The web app needs this key to submit runs; the worker gets its own Supabase/provider settings separately. A local CLI `--env-file` loads CLI settings; it does not automatically upload those settings into the cloud worker.

## Deploy the web app

### GitHub integration for ongoing deployment

The full application can deploy directly from a clean GitHub repository. Import it into Vercel, select the Next.js preset at the repository root and set the intended Production branch, commonly `main`. Configure the web environment settings in Vercel before building. Pushes and merges to the Production branch trigger web deployments; other configured branches can create previews. [Vercel Git deployment](https://vercel.com/docs/git).

Use the clean export to establish a repository with fresh history once, then develop and commit in that checkout. Local working archives and actual environment files can stay beside the source as ignored files. The legacy repository's earlier commits contain working material; a clean branch or a later deletion does not remove other historical contents before making the whole repository public.

Keep application/worker source, contracts, database migrations, tests, intentional fixtures, runtime assets, required licenses, build configuration and curated docs in Git. Store actual web secrets in Vercel and worker secrets in Trigger. Configure Preview settings separately from Production. The Trigger worker still needs its own deployment from the corresponding source revision; the Vercel Git integration does not deploy it automatically. [Trigger deployment](https://trigger.dev/docs/deployment/overview).

### CLI deployment alternative

Link the prepared `source/` directory to the intended Vercel account/project:

```sh
pnpm exec vercel link
```

Choose the account explicitly if several are available. Use the repository root inside `source/`, the Next.js framework preset, `pnpm install --frozen-lockfile` installation and `pnpm run build --webpack`. [vercel.json](../../vercel.json) records those settings. This uses the build path that passed the latest local checks. Select Node 24 in the project's settings and confirm the actual runtime in the deployment logs. [Vercel Node versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions).

In the linked project's **Settings → Environment Variables**, add the prepared `web.production.env` settings for **Production**. Store server credentials as sensitive values. Public Supabase and Monad settings are intentionally available to the browser; provider, server and Trigger keys are not. Set `FORK_NIGHT_PUBLIC_URL` to the project's chosen public HTTPS origin without a path. The optional Cartesia/OpenAI web keys preserve helper capability only within the existing database allowances; importing keys does not enable helpers.

Confirm all required settings are filled, then deploy from `source/`:

```sh
pnpm exec vercel --prod
```

Environment changes require a new deployment. Check the build output and actual deployment settings; a local build alone does not prove Vercel compatibility. Use an account plan suitable for the project. The Hobby plan is restricted to personal, non-commercial use. [Vercel Hobby](https://vercel.com/docs/plans/hobby).

CLI deployment does not publish or push a Git repository. For later Git integration, use the clean source and fresh submission history; the working repository's earlier private material remains in its history. Connect Vercel to the full application, rather than the limited Cloudflare signup branch.

## Allow sign-in from the hosted origin

After discovering the actual production domain, add that origin to the existing authentication settings before the browser walkthrough:

1. In **Supabase → Authentication → URL Configuration**, set Site URL to the public origin and allow redirects under that same origin, including `/pilot` with its room parameters. Keep the localhost entries used for local rehearsals. Both Google return URLs and signed Web3 login URIs must be allowed. [Supabase redirect configuration](https://supabase.com/docs/guides/auth/redirect-urls).
2. In the existing **Privy** app, add the public origin to its allowed domains. Preserve its App ID and custom JWT configuration. The current hackathon setup keeps that Privy app in Development mode; selecting Vercel Production does not itself change the Privy app's mode or purchase a plan. Confirm the dashboard permits the intended hosted domain and users.
3. In the existing **Google Web OAuth client**, add the origin under Authorized JavaScript origins. Retain the Supabase `/auth/v1/callback` redirect URI. If the OAuth audience remains in Testing, use allowed test accounts for Google checks. Guest and browser-wallet entry provide separate ways to access the product. [Google setup](ONBOARDING.md).

The server and browser continue using the same Supabase project. A returning Google or wallet account should recover its existing storyteller; a fresh guest on a different origin does not inherit a local anonymous session.

## Verify the hosted product

Stop the local worker and app for the hosted walkthrough. From the public `/pilot?room=midnight-signal`:

1. Join as a new guest, inspect the shared story and save an idea. New origins/browser sessions create new guest identities; matching a display name does not recover a previous account.
2. Within the existing allowance, generate one preview. Confirm a **Production** `fork-night-generate` run, the private delivered preview, and the recorded provider result. Recover an existing operation after uncertainty instead of submitting a new paid attempt.
3. Publish deliberately, open the shared moment link in a second browser, and verify attribution and a peer continuation.
4. Connect a Monad testnet wallet and inspect the original room's verified release. Confirm the accepted equal-wallet policy and current claims. The completed release is immutable; hosting does not create a new payment rehearsal or require a new contract.
5. Verify `/demo`, its public signup QR, `/signup` and waitlist persistence. Check desktop and phone views and judge access without a Vercel account.

Record the resulting URL, worker version and actual walkthrough evidence before calling the migration complete. Provide the running version's corresponding source as described in [the project license](../../README.md#license).

## Retire the boat deployment after cutover

Keep the [limited Cloudflare deployment](CLOUDFLARE.md) available until the hosted Vercel product and worker are verified. If a live Worker exists, replace any shared signup/QR links with the Vercel origin, then disable its automatic deployment and remove or redirect that specific Worker. Preserve its local configuration and verification history for now. No Supabase project or Monad contract is removed as part of the hosting switch.
