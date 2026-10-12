# Cloudflare demo closing screen and waitlist

This deployment serves `/demo`, `/signup` and `/api/waitlist`; `/` redirects to signup. The full source repository also includes the local story demos and shared pilot. They are not included in this deployment selection.

The two pages share the existing application source and styles. The build copies only their required files into a fresh directory, supplies a Cloudflare bindings adapter and builds a Worker with vinext. The existing `npm run dev` and `npm run build` continue using Next.js.

## Connect GitHub

In Cloudflare **Workers & Pages**, create a **Worker** and import `Wenjix/web3-hackathon` from GitHub. Select the clean `fork-night-cloudflare` branch and configure:

| Setting | Value |
| --- | --- |
| Worker name | `fork-night-waitlist` |
| Production branch | `fork-night-cloudflare` |
| Root directory | Repository root (leave blank) |
| Build command | `npm run build:cloudflare` |
| Deploy command | `npm run deploy:cloudflare` |
| Build variable | `NODE_VERSION=22.18.0` or a newer Node 22 release |
| Preview branches | Disabled for this initial deployment |

Workers Builds installs the root package dependencies automatically. The build command creates a fresh, selected application, installs its Cloudflare toolchain with `npm ci` from the checked-in [deployment lockfile](../../config/waitlist-cloudflare/package-lock.json), runs `vinext check`, then builds the Worker. Deployment consumes only the last successful output. No `.env` file or local working archive is copied. Both lockfiles use the official npm registry; the exporter rejects deployment dependency pins that no longer match the resolved lockfile.

The configuration uses the supported Wrangler integration with Cloudflare Vite plugin v1. It creates no KV, R2, Durable Object or image-optimization bindings. Supabase remains the email store. This is a Worker with an API, so do not select an assets-only Pages deployment.

## Configure email storage

For a new Supabase project, apply [the waitlist migration](../../supabase/migrations/202610050001_waitlist.sql) in its SQL editor. It creates a private `waitlist_signups` table; it is safe to run again. The existing development project's table has been confirmed, with hosted save, duplicate and anonymous-access checks passing. The public/anonymous/authenticated roles cannot read or write it. The server key handles signup insertion, normalized addresses are unique, and duplicates preserve the original signup record.

In the deployed Worker's **Settings → Variables & Secrets**, add these runtime settings:

| Name | Type | Value |
| --- | --- | --- |
| `SUPABASE_URL` | Text | The existing Supabase project URL |
| `SUPABASE_SECRET_KEY` | Secret | The existing server secret key |
| `FORK_NIGHT_PUBLIC_URL` | Text | The Worker's full public HTTPS origin, without a path |

Use the real `workers.dev` URL Cloudflare gives you. These are runtime bindings, **not build-only variables**. Publish the settings change. `keep_vars` preserves dashboard-managed text variables on subsequent deploys; secrets remain server-side. Do not add OpenAI, Cartesia, Trigger or local refill configuration to this Worker.

For local presentations, also set `FORK_NIGHT_PUBLIC_URL` in the main project's ignored `.env.local` and restart Next.js. Its `/demo` QR will then send attendees to the hosted signup. Until the origin is configured, `/demo` shows a setup state rather than a localhost QR. Until storage is configured, signup is unavailable rather than pretending to save.

Emails are stored directly in Supabase. No Resend or Airtable account is needed. This flow does not verify ownership, create an account or send a confirmation email.

## Verify the first release

1. Confirm the build and Worker deployment both succeed.
2. Open the public `/demo` and `/signup` in a signed-out browser, and scan the QR from a phone.
3. Submit a test address you control. Confirm the saved row in Supabase, repeat with different casing and confirm there is one row, then remove the test row.
4. Confirm the signup reports a storage failure truthfully if the table or credentials are missing. Check desktop and mobile layout.
5. Make the corresponding source for the deployed version accessible from the published project, as described in the [license section](../../README.md#license).

The locked Cloudflare build and Wrangler deployment dry run pass. `vinext check` reports zero issues and one partial App Router Strict Mode difference. The deployed artifact is about 906 KiB before compression and 273 KiB compressed. The Cloudflare Vite plugin and Wrangler are pinned together at 1.62.5 and 4.147.0, supporting the configured October 5 compatibility date.

The built Worker has also run locally: its pages and client assets load, a signup persists in hosted Supabase, a case-normalized duplicate preserves the original row, and the temporary test row is removed. Missing runtime settings produce the setup state and a truthful storage error. The ordinary Next.js build, 164 tests and TypeScript check also pass. **Cloudflare's hosted deployment, desktop/mobile browser checks and a physical phone QR scan remain to be verified.**

## CLI alternative

On a machine with network access, after installing the repository dependencies:

```sh
npm run build:cloudflare
npx wrangler login
npm run deploy:cloudflare
```

The GitHub connection manages deployment authentication for Workers Builds; it does not require this local login.

References: [Cloudflare Next.js guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/), [vinext Wrangler setup](https://github.com/cloudflare/vinext/blob/main/.agents/skills/migrate-to-vinext/references/config-examples.md), [Workers build settings](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/).
