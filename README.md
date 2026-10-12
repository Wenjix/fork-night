# Fork Night

Make illustrated, branching stories together. Discover a public creative room, return to a guild or friends' clubhouse, and experiment on a personal desk before contributing a new moment.

Brainstorming began on **September 27, 2026**. [The development process](docs/submission/PROCESS.md) follows the early concepts, product iterations and demo feedback.

This repository contains a **local preview** at `/` and a **shared development pilot** at `/pilot`. The preview uses sample collaborators, fixture generation and simulated credits. The pilot connects named Supabase guests, shared stories, attributed ideas, OpenAI image generation and a Trigger.dev development worker. Its shared story table includes a path recap, large panel reading and direct moment links. The composer supports attributed idea handoffs, optional Cartesia Ink-2 speech input and a freeform idea space with editable one-to-three-panel previews. The original Midnight Signal room demonstrates an explicitly disclosed **equal-wallet release policy**, with its contract deployed on Monad testnet and verified as Exact Match on MonadScan. A founder-operated browser rehearsal completed four scene registrations, a frozen release, 1.0 test MON support and two separate 0.5 claims. See [the onchain guide](docs/submission/ONCHAIN.md).

## Run

Use Node.js 22.18 or newer:

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:3000`. No credentials are needed for the local preview.

For the shared pilot, copy `.env.example` to an ignored `.env.local` and configure the public Supabase URL/key plus server-only Supabase, OpenAI and Trigger development keys. Apply all Supabase migrations and the seed to a dedicated project with anonymous sign-in enabled. The public Trigger project reference is already in [trigger.config.ts](trigger.config.ts); a separate `PROJECT_REF` environment variable is not required. Log in to the Trigger CLI once, then run the worker in another terminal:

```sh
npx --no-install trigger login
npm run dev:worker
```

Open `http://127.0.0.1:3000/pilot`. Keep both development processes running. The database starts with generation disabled and a zero budget. The explicit operator script [activate-pilot-budget.ts](scripts/activate-pilot-budget.ts) transfers an existing, resolved local $10 experiment ledger into shared accounting and disables further local paid dispatch. It does not create a new allowance. A fresh deployment needs its own deliberately configured budget.

The worker launcher uses the installed, pinned CLI and disables Node's experimental server-side Web Storage when supported. This avoids a dependency's `localStorage` warning during indexing; browser guest sessions still use browser storage. **Local worker ready** confirms the worker started. It does not establish that an image request ran or completed.

If port 3000 is occupied, use `npm run dev -- --port 3005` and open `http://localhost:3005/pilot?room=midnight-signal`. The image worker still runs separately with `npm run dev:worker`. Room activity distinguishes queued requests, generation and requests needing a check; reserved credits describe unfinished requests, not the number of images currently generating. The operator can run `npm run pilot:status` to inspect existing `tester` requests without submitting generation or printing prompts. Optional arguments select a room and guest display name: `npm run pilot:status -- midnight-signal tester`. A guest's identity belongs to its browser session; entering the same name in another browser does not restore that account.

The optional voice/text helpers use `CARTESIA_API_KEY` and the existing `OPENAI_API_KEY`, with separate allowances that start disabled. After deciding the permitted usage, an operator can configure cumulative request totals:

```sh
node --env-file=.env.local scripts/configure-pilot-assist.ts --status
node --env-file=.env.local scripts/configure-pilot-assist.ts --voice-total 5 --shape-total 10
node --env-file=.env.local scripts/configure-pilot-assist.ts --pause
```

These example totals admit up to five voice credentials and ten shaping requests globally; failures also count. Default guest limits are five voice credentials and ten shaping requests. The browser stops recordings at 30 seconds and uses 60-second STT-only access tokens. Request limits and token expiry are **not provider-enforced audio-duration or dollar caps**. Use supervised sessions and suitable provider account limits before public use. A pause stops new admissions; already-issued credentials or active sessions are not revoked. Writing, optional prompts for a different angle, and previewing one’s own words remain available while helpers are paused. A moment can contain one to three panels: one/two panels use one room credit, three use two; only complete delivery is charged. No helper action automatically generates images.

Trigger SDK, build and CLI are pinned together at 4.6.4. At setup, the registry's 4.7.2 packages depended on an unpublished matching core package; the compatible published set was used.

## Selected documentation

| Document | Purpose |
| --- | --- |
| [Project](docs/submission/PROJECT.md) | Product, implemented behavior and planned integrations |
| [Development process](docs/submission/PROCESS.md) | Early exploration, the selected Round 4 gallery and subsequent product iteration |
| [Boat demo feedback](docs/submission/BOAT-DEMO.md) | Audience interest recalled by the founder and the follow-up questions it raised |
| [Architecture](docs/submission/ARCHITECTURE.md) | Modules, persistence, accounting and ancestry rules |
| [Demo](docs/submission/DEMO.md) | A reproducible walkthrough for reviewers |
| [Artwork](docs/submission/ARTWORK.md) | Runtime illustrations and font attribution |
| [Full pilot hosting](docs/submission/HOSTING.md) | Selected Vercel app and Trigger cloud worker setup; deployment pending |
| [Cloudflare boat setup](docs/submission/CLOUDFLARE.md) | Preserved limited QR/signup deployment configuration |
| [Monad release proof](docs/submission/ONCHAIN.md) | Contract build, testnet setup, registered ancestry, release payments and independent claims |

The documentation describes the current implementation. Generative experiments and design mocks are separate from evidence of live functionality.

## Check

```sh
npm test
npm run typecheck
npm run build
npm run docs:check
```

The independent image experiment runner uses local fixtures:

```sh
npm run experiment -- list
```

OpenAI request preparation accepts an original PNG, JPEG or WebP reference:

```sh
npm run experiment:openai:prepare -- continuation /path/to/original.png first-continuation
```

This writes an immutable, private first-panel request bundle under `.local/experiments/openai-preflight/`. It sends no request and needs no API key. The second panel requires the saved first panel as an additional reference.

For an explicitly **paid** two-panel experiment, set `OPENAI_API_KEY` in the ignored `.env.local` file or your shell environment, then run:

```sh
npm run experiment:openai -- first-continuation fixtures/experiments/midnight-live.json
```

The live runner uses the pinned Flare model, actual reference pixels, sequential 1024-square low-quality outputs and a shared ledger under `.local/experiments/openai-live/`. Repeat the same command to recover saved output without generating again. Changed inputs require a new attempt ID. All attempts share a $10 admission budget and a ten-request limit; each request reserves $1 of headroom. Unknown usage or an uncertain response stops further dispatch, with no automatic retry. The reserve is conservative application accounting, **not a provider-enforced price cap**. Keep the ledger intact across runs.

One original local two-panel continuation was verified at 26.7 seconds of provider latency and $0.038871 calculated from returned usage. Those measurements are one sample, not a throughput forecast or an invoice reconciliation. After accounting is transferred to the shared pilot, this tool can recover existing results but cannot send new paid requests.

The shared-room database foundation is in [supabase](supabase/migrations/202610020001_public_pilot.sql). With PostgreSQL installed and `pg_config` available, run its isolated policy proof:

```sh
npm run test:pilot-db
```

The proof creates and removes its own temporary cluster. It checks draft isolation, author credit, repeat publication, saved-idea permissions, validation and quotas using a test identity shim. For a separate local Supabase stack, install the Supabase CLI and start Docker, then run `supabase start`. The checked-in configuration enables anonymous sign-in and loads three fixture rooms.

The separate hosted Auth/Data API proof is opt-in. On a dedicated Supabase test project, apply the migration and seed, enable anonymous sign-in and manual identity linking, and supply `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` and `FORK_NIGHT_TEST_PROJECT_REF` through your local environment. Never put the secret key in a `NEXT_PUBLIC_*` variable. Then run:

```sh
npm run test:pilot-live
```

This creates two temporary Auth guests and a labeled fixture room, verifies session recovery, draft privacy, forged-identity denial and concurrent publication, then removes its own records. It sends no email and makes no AI call. These checks have passed on the hosted development project. The [Supabase key guide](https://supabase.com/docs/guides/api/api-keys) explains retrieving the correct public and server keys.

## Prepare a submission copy

```sh
npm run submission:export
```

This creates a fresh source folder under `.local/submission/fork-night` from the [explicit file selection](config/submission-files.json). It includes the app, tests, required assets and the selected docs, without the working archive or Git history. Use `-- --out .local/submission/fork-night-review` for a different fresh destination.

## License

The project-owned software is licensed under the [GNU Affero General Public License, version 3 only](LICENSE) (`AGPL-3.0-only`). Preserve third-party license notices; see [artwork and fonts](docs/submission/ARTWORK.md). This software license does not determine the permissions for participant-created stories, uploads or private data.

For a modified version that supports remote network interaction, AGPL section 13 requires a prominent offer of its Corresponding Source to those users at no charge. A deployment should link to the source for its running version, including required build and installation material.

For local room refills, set `PILOT_LOCAL_CONTROLS=1` in `.env.local` and restart the server. **Add 5 test credits** appears beside the room balance after joining as a named guest. It also extends the test-attempt limits while preserving the existing API dollar ceiling and all usage. Keep the flag disabled on hosted environments; this is not a payment flow. Borrowing a saved note does not credit its author with the generated moment.
