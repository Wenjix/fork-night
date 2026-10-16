# Cloudflare recovery timer

This Worker sends one authenticated clock notification per minute to the ordinary Production Trigger task `fork-night-reconcile`. Trigger performs the existing bounded recovery scan; Supabase retains jobs, receipts and budget controls. The timer has no database/provider credential, storage binding or public endpoint. It starts disabled and does not replace the generation worker.

## Local verification

From this directory, use the pinned tools, independently of the web application's dependencies:

```sh
npm ci
npm run check
npm test
npm run build
```

`check` generates binding/runtime types from the Wrangler config before checking JavaScript. `test` executes the actual scheduled handler in Miniflare, intercepting all outbound traffic with fixtures. It checks retry identity and refuses a redirect without contacting its destination. It creates no real Trigger run and makes no provider call. Both require local loopback sockets. Generated types and build output are ignored. The repository's main test command covers failure paths and read-only readiness projections too.

The compatibility date is `2026-10-08`, the latest date supported by the pinned runtime. Keep the deployed config and runtime test on this same date; advancing it requires a compatible runtime and a passing scheduled-event test. The CLI deployment dry run alone does not start the runtime.

## Deploy disabled, then activate

First complete the database cutover and deploy the matching Trigger and web source following [the hosting guide](../../docs/submission/HOSTING.md). Use the same prepared source for this Worker. Keep room creation disabled until the existing-room rehearsal passes.

1. Authenticate the local CLI using `npx --no-install wrangler login` and inspect `npx --no-install wrangler whoami`. Select the intended account explicitly through `CLOUDFLARE_ACCOUNT_ID`. Verify available Cron capacity and keep the current account plan. Deployment needs Workers Scripts Write; a separate readiness token needs Workers Scripts Read. The account ID and Cloudflare management token belong to the operator, not Worker bindings. [Permissions](https://developers.cloudflare.com/workers/authorization/workers/)
2. In the existing Trigger project, create a separate named **Production** API key for this timer. Prefer trigger-only access restricted to `fork-night-reconcile` if the dashboard permits it on the current plan; paid-only presets are not assumed available. Keep the generation worker's own run-read/enqueue credentials. [Trigger API keys](https://trigger.dev/docs/apikeys)
3. Save the timer key as `PILOT_TIMER_TRIGGER_SECRET_KEY` in the ignored Production settings and run `npm run hosting:prepare` at the repository root. Its separate `timer.production.secrets.json` contains only the renamed `TRIGGER_SECRET_KEY`. Alternatively, fill that field in the already prepared private file. Confirm `missingTimer` is empty before uploading. Never pass a key as a command argument or copy the full web/worker env file into Cloudflare.
4. From the prepared `source/workers/recovery-timer/` directory, install/check the pinned package, then deploy disabled with the private secrets file outside the source:

```sh
npm run deploy:disabled -- --secrets-file ../../../timer.production.secrets.json
```

The reviewed Worker name is `fork-night-recovery-timer`. Check for an existing Worker with that name before deploying; do not overwrite an unrelated deployment. The config owns its one `* * * * *` Cron Trigger, UTC, with `workers.dev`, previews and routes disabled. `PILOT_TIMER_ENABLED=0` suppresses all Trigger requests while staging. Required secrets are uploaded encrypted with the version. [Secret deployment](https://developers.cloudflare.com/workers/configuration/secrets/)

5. Confirm Production `fork-night-reconcile` is registered as an ordinary task, its database migration/environment is ready, and its worker can read runs and enqueue generation. Set Trigger worker `PILOT_RECONCILE_ENABLED=1` through its hosted settings/deployment path. Ensure no native Trigger schedule or second external timer also targets this task. Then enable the Cloudflare timer:

```sh
npm run deploy:enabled
```

The enabled command explicitly overrides the safe default. Every later enabled deployment must use that command; a plain deploy disables enqueueing. Cron updates can take up to 15 minutes to propagate. [Cron configuration](https://developers.cloudflare.com/workers/configuration/cron-triggers/)

## Verify and monitor

Observe a real clock event in Cloudflare logs with `state: accepted` and its run ID, then match that ID to a completed Production recovery run. Check that its output represents an enabled scan and that Supabase `last_reconcile_at` advances. The root `pilot:readiness` command reads the Cloudflare schedule/settings when given an operator `CLOUDFLARE_ACCOUNT_ID` and read-only `CLOUDFLARE_API_TOKEN`, checks for conflicting native Trigger schedules, lists recent tagged recovery runs and reports checkpoint freshness. Missing access is unverified, not a pass. Keep custom routes disabled in the dashboard too.

A recent checkpoint can include unavailable job checks; inspect those counts and overdue dispatches. Exercise an actual saved dispatch after closing the originating browser, with unchanged paid-panel identities and budget holds. An empty scan alone does not prove generation recovery. Complete the agreed existing-room rehearsal before enabling room creation. This pilot used a founder-confirmed two-account walkthrough, as recorded in the [hosting guide](../../docs/submission/HOSTING.md).

Each tick has a global SHA-256 idempotency key based on its original UTC minute and Production environment, retained for one hour. Lost replies reuse the identical body/key, at most two attempts with a ten-second timeout per attempt. Authentication/rate-limit/redirect HTTP refusals are not immediately retried. Old notifications over five minutes and future notifications over one minute are skipped; the next timely scan checks all due database work. The Trigger queue remains concurrency one with a five-minute TTL and one attempt. No exact delivery guarantee or repair-within-60-seconds promise is made.

The request uses `redirect: "manual"` and rejects non-success responses, including redirects. The Workers runtime rejects `redirect: "error"` before sending a request, even though Node accepts that option. Keep this boundary covered by the actual runtime test.

The timer fits Free capacity in principle, but measure its CPU usage against the 10 ms limit. Trigger run and compute charges still consume shared credits; exhausted Trigger Free credits stop tasks. Record observed empty-scan duration and account usage before leaving it running continuously. The separate image-dollar ceiling is unchanged. [Cloudflare limits](https://developers.cloudflare.com/workers/platform/limits/), [Trigger pricing](https://trigger.dev/pricing/)

To stop enqueueing, run `npm run deploy:disabled` from the same reviewed directory/account. Already accepted runs can still execute, so also disable Trigger's `PILOT_RECONCILE_ENABLED` and apply that setting if recovery itself is faulty. Preserve saved work and holds. The optional older signup Worker is separate and is not modified by these commands.
