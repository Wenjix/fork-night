begin;

-- Interest only, not an Auth account or a verified mailing-list subscription.
create table if not exists public.waitlist_signups (
  email text primary key check (
    email = lower(btrim(email)) and char_length(email) between 3 and 254
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  created_at timestamptz not null default now(),
  source text not null check (source in ('demo', 'signup')),
  consent_version text not null check (consent_version = 'fork-night-updates-2026-10-05')
);

alter table public.waitlist_signups enable row level security;
revoke all on table public.waitlist_signups from public, anon, authenticated;
grant select, insert, delete on table public.waitlist_signups to service_role;
comment on table public.waitlist_signups is 'Private Fork Night waitlist. Server-only writes; no public read or email lookup. Email ownership is unverified.';

commit;
