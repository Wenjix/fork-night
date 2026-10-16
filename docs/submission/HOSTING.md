# Full shared pilot on Vercel and Trigger.dev

The hosted app is [fork-night.vercel.app](https://fork-night.vercel.app), with the [shared Midnight Signal pilot](https://fork-night.vercel.app/pilot?room=midnight-signal). The October 14, 2026 checkpoint at **03:00 UTC** records enabled Production generation, text shaping, room creation and scheduled recovery. The verified Trigger Production version is **20261014.1**. The database migrations, matching web and worker release, and Cloudflare recovery timer are deployed.

**Source and deployment are at different stages.** The live web deployment is `dpl_6FRPvQk3UtAobXqmjMyaczZcZ7dp`, uploaded through the CLI. The [public source checkpoint](https://github.com/Wenjix/fork-night/tree/98c5196ebf58d411b4d5edf3b575c3a8001817a7) preserves its runtime files and the repository's standalone tools. It is not an exact copy of the deployment bundle. Its shared navigation, onboarding and account fixes are deployed.

Later commits add Kessler Ward, durable private Wren requests, capped funding and new entrance and agent-page designs. These changes are tested locally and remain undeployed. Their rollout needs the October 15 Wren, funding and Kessler migrations, matching worker/web source and configured testnet delegation. The procedures below describe the deployed shared-room baseline. Publishing source to GitHub does not complete this later rollout.

The founder confirmed the accepted two-account browser walkthrough. Production logs separately recorded two completed generation runs. Actual Cloudflare minute events also produced completed recovery scans and fresh database checkpoints. These observations do not independently verify every browser action or recovery of an interrupted generation.

At that checkpoint, room creation allowed one room per creator, three rooms total and twelve credits per room. The first new room and invitation had not yet been observed. The existing service needs no repeated activation. The procedures below support a new deployment or a planned upgrade.

The web app durably admits an operation and attempts to enqueue `fork-night-generate`; the cloud worker performs image generation and saves the result. The reconciler repairs interrupted dispatch and checks saved work independently of the browser. A small [Cloudflare minute timer](../../workers/recovery-timer/README.md) enqueues that ordinary Trigger task. Production needs matching deployed source and credentials. Vercel, Supabase and Trigger retain the web, storage and execution services; Cloudflare supplies the clock. This release needs no durable containers. [Trigger deployment guide](https://trigger.dev/docs/deployment/overview).

## Shared-room upgrade

Before deploying this source, apply the three additive migrations in order to the selected Supabase project:

1. [Execution and accounting](../../supabase/migrations/202610130001_job_execution.sql).
2. [Prepared rooms and participation](../../supabase/migrations/202610130002_shared_rooms.sql).
3. [Operator reviews and bounded rehearsal preparation](../../supabase/migrations/202610130003_pilot_operations.sql).

Schedule a short generation cutover. Inspect known running and legacy queued work first; let known paid work finish before pausing new spending. Preserve receipts, holds and published history. The migration disables the old claim function, leaves new admission unavailable until an execution environment is configured, and starts room creation disabled. An unfinished legacy request needs verified run evidence and the reviewed adoption/cancellation RPC; age alone does not justify releasing its hold. Use an isolated Supabase project/budget for Development paid work.

Legacy estimated expenses without an outbox need an audited terminal observation before cost review. Observation fences the old claim while retaining its hold; a separate billing adjustment preserves the original expense value. Adopting work with recorded intents requires both terminal evidence and settled cost, and recovery still cannot repurchase an existing panel.

Deploy matching web, Trigger worker and Cloudflare timer source, and configure `PRODUCTION` in the execution settings and database budget. `fork-night-reconcile` is an ordinary task with no native Trigger schedule. Both the Trigger `PILOT_RECONCILE_ENABLED` flag and Cloudflare `PILOT_TIMER_ENABLED` flag start at `0`. Follow the [timer activation procedure](../../workers/recovery-timer/README.md) to enable one Cloudflare minute schedule, observe its accepted Trigger run and a completed database checkpoint. Cloudflare supports minute Cron on Free; Trigger run/compute usage still consumes its shared credits. [Cloudflare Cron](https://developers.cloudflare.com/workers/configuration/cron-triggers/), [Trigger usage](https://trigger.dev/pricing/).

The [readiness command](../../scripts/check-pilot-readiness.ts) reports database allowances, unresolved work, Cloudflare timer settings, recent recovery runs and checkpoint freshness. It checks for conflicting native Trigger schedules too. Use reviewed Production service credentials and an operator Trigger key with run/schedule read access. Optional operator-only `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` enable the Cloudflare configuration read; missing access remains unverified. The [preparation command](../../scripts/prepare-judge-rehearsal.ts) prints a settings comparison and a once-only grant for review. It does not apply that grant. The grant requires existing $6 image headroom, retains the dollar cap and usage history, and targets at least 12 available room credits, 24 image-request slots, four per-maker room attempts and 36 additional global shaping claims, with nine shaping claims per fresh maker and voice off.

For a new deployment, check an existing room before enabling room creation. Defaults allow one room per maker, three rooms and 36 granted credits per campaign, using two prepared openings. New rooms are public through their links and omitted from the curated directory. Only the maker can view an unpublished preview. A copied opening receives no historical treasury evidence, wallet approval or release rights.

The hosted pilot used the accepted two-account walkthrough before enabling creation. For each deployment, agree on the test scope and record the actual results. Check peer branches, private-preview access and recovery after closing a browser. Recovery of an interrupted generation remains a separate check for this pilot.

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
| `timer.production.secrets.json` | Only the dedicated Production Trigger enqueue key for Cloudflare |
| `preparation.json` | Public-file hashes and missing-setting names; no secret values |

Deploy **only `source/`**. The three private settings files are outside it. They have owner-only file permissions, and the containing directory has owner-only access. The selection excludes the working archive, Git history, deployer private key and hosting credentials. The [Vercel ignore file](../../.vercelignore) also excludes local files from CLI uploads. [Vercel exclusions](https://vercel.com/docs/deployments/vercel-ignore).

Preparation reads `.env.local`, then `.env.production.local`, then process environment overrides. It preserves the input files. A Development Trigger key is omitted from web settings and reported as missing. Local refill controls are forced off, both execution environments are set to `PRODUCTION`, and reconciliation starts disabled. Existing compute allowances and provider usage are unchanged, and preparation sends no network requests.

For repeatable preparation, put the Production `TRIGGER_SECRET_KEY` and chosen `FORK_NIGHT_PUBLIC_URL` in an ignored `.env.production.local`, then prepare a fresh bundle. Keep the Development Trigger key in `.env.local` for the local worker. Alternatively, fill the two missing values directly in the prepared web settings file before importing it.

Supply the separate timer key as `PILOT_TIMER_TRIGGER_SECRET_KEY`. Preparation never copies the web key into the timer or imports Cloudflare management credentials into a hosted runtime. Check `missingTimer` before deploying the timer. Its package/lockfile live under `source/workers/recovery-timer/`; install and deploy it separately with the pinned Wrangler version.

## Deploy the cloud worker

In the existing Trigger project `proj_mgjcdpmejdtuazlikyzo`, select **Production**. Import the five settings from `worker.production.env` through its environment-variable settings:

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SECRET_KEY` as a secret
- `OPENAI_API_KEY` as a secret
- `PILOT_EXECUTION_ENV=PRODUCTION`
- `PILOT_RECONCILE_ENABLED=0` until coordinated timer activation

Retain the image task's single concurrency, one attempt and paid-request recovery rules. The reconciler uses a separate concurrency-one queue. Its runtime credential must read generation runs and enqueue recovery; verify this in the deployed worker instead of copying the web's trigger-only key into it. API keys can have different permissions even within the same environment. [Trigger API keys](https://trigger.dev/docs/apikeys). All jobs using the same Supabase project share its budget; Production and Development require separate databases for paid work.

Enter the prepared `source/` directory and install its pinned packages:

```sh
pnpm install --frozen-lockfile
npx --no-install trigger deploy --env prod --skip-update-check
```

Use the existing CLI login. If it has expired, run `npx --no-install trigger login` in your own terminal. Confirm the Production version lists `fork-night-generate`, `fork-night-reconcile` and the existing health task, and completes deployment. The [worker configuration](../../trigger.config.ts) includes the compressed seed artwork and Sharp dependency needed by cloud execution.

Use a named Production API key for the web's `TRIGGER_SECRET_KEY`, restricted to enqueueing where the plan permits that preset. The timer uses its own named key. A local CLI `--env-file` loads CLI settings; deployed worker variables still need to be imported through the dashboard or supported upload path. [Trigger environment variables](https://trigger.dev/docs/deploy-environment-variables).

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

Keep the [limited Cloudflare signup deployment](CLOUDFLARE.md) available until the hosted Vercel product and worker are verified. If that signup Worker exists, replace any shared signup/QR links with the Vercel origin, then disable its automatic deployment and remove or redirect that specific Worker. Preserve its local configuration and verification history for now. The separate `fork-night-recovery-timer` remains part of the full pilot. No Supabase project or Monad contract is removed as part of the hosting switch.
