begin;
set local role service_role;
insert into public.waitlist_signups(email, source, consent_version)
values ('waitlist-proof@example.com', 'demo', 'fork-night-updates-2026-10-05') on conflict(email) do nothing;
insert into public.waitlist_signups(email, source, consent_version)
values ('waitlist-proof@example.com', 'signup', 'fork-night-updates-2026-10-05') on conflict(email) do nothing;
do $$ begin
  if (select count(*) from public.waitlist_signups where email = 'waitlist-proof@example.com') <> 1 then raise exception 'Duplicate signup'; end if;
  if (select source from public.waitlist_signups where email = 'waitlist-proof@example.com') <> 'demo' then raise exception 'Retry changed original consent/source'; end if;
end $$;
reset role;
set local role anon;
do $$ begin
  begin perform * from public.waitlist_signups; raise exception 'Anonymous email read allowed'; exception when insufficient_privilege then null; end;
  begin insert into public.waitlist_signups values ('attacker@example.com', now(), 'demo', 'fork-night-updates-2026-10-05'); raise exception 'Anonymous write allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
do $$ begin
  begin perform * from public.waitlist_signups; raise exception 'Guest email read allowed'; exception when insufficient_privilege then null; end;
  begin delete from public.waitlist_signups; raise exception 'Guest email delete allowed'; exception when insufficient_privilege then null; end;
end $$;
rollback;
