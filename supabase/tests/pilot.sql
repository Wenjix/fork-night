-- Executed in the isolated database after the Supabase Auth test shim is installed.
insert into auth.users values ('20000000-0000-4000-8000-000000000001'), ('20000000-0000-4000-8000-000000000002');
set role authenticated;
set request.jwt.claim.sub = '20000000-0000-4000-8000-000000000001';
select public.pilot_set_display_name('Alice');
select public.pilot_save_draft('30000000-0000-4000-8000-000000000001', 'midnight-signal', '10000000-0000-4000-8000-000000000001', 'A new door', 'Mira opens a door of light.');
select public.pilot_save_draft('30000000-0000-4000-8000-000000000001', 'midnight-signal', '10000000-0000-4000-8000-000000000001', 'A new door', 'Mira opens a door of light.');
do $$ begin
  if (select count(*) from public.pilot_operations) <> 1 then raise exception 'Duplicate draft'; end if;
  begin
    perform public.pilot_save_draft('30000000-0000-4000-8000-000000000001', 'midnight-signal', '10000000-0000-4000-8000-000000000001', 'Changed input', 'Different prompt');
    raise exception 'Changed request was accepted';
  exception when raise_exception then if sqlerrm <> 'Request ID belongs to different inputs' then raise; end if; end;
  begin
    perform public.pilot_save_draft('30000000-0000-4000-8000-000000000009', 'paper-moon', '10000000-0000-4000-8000-000000000001', 'Foreign parent', 'Cross-room parent');
    raise exception 'Foreign parent was accepted';
  exception when raise_exception then if sqlerrm <> 'Choose a published moment in this room' then raise; end if; end;
  begin
    perform public.pilot_publish((select id from public.pilot_operations limit 1));
    raise exception 'Undelivered draft was published';
  exception when raise_exception then if sqlerrm <> 'A complete delivered result is required' then raise; end if; end;
end $$;

set request.jwt.claim.sub = '20000000-0000-4000-8000-000000000002';
select public.pilot_set_display_name('Bob');
do $$ begin
  if (select count(*) from public.pilot_operations) <> 0 then raise exception 'Another guest draft leaked'; end if;
  if (select count(*) from public.pilot_profiles) <> 1 then raise exception 'Another guest profile leaked'; end if;
  if (select count(*) from public.pilot_moments) <> 3 then raise exception 'Published seeds not shared'; end if;
end $$;
reset role;
select set_config('test.alice_operation', (select id::text from public.pilot_operations limit 1), false);
set role authenticated;
do $$ begin
  begin
    perform public.pilot_publish(current_setting('test.alice_operation')::uuid);
    raise exception 'Another maker operation was published';
  exception when raise_exception then if sqlerrm <> 'Contribution is unavailable' then raise; end if; end;
  begin
    update public.pilot_operations set status = 'delivered';
    raise exception 'Guest could forge delivery';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
-- Trusted delivery fixture only; this is not a worker or actual generated output.
update public.pilot_operations set status = 'delivered', source_kind = 'fixture', panels =
 '[{"imageUrl":"/art/midnight-story.webp#frame=0","caption":"One."},{"imageUrl":"/art/midnight-story.webp#frame=1","caption":"Two."}]';
set role authenticated;
set request.jwt.claim.sub = '20000000-0000-4000-8000-000000000001';
select public.pilot_publish(current_setting('test.alice_operation')::uuid);
select public.pilot_publish(current_setting('test.alice_operation')::uuid);
select public.pilot_set_display_name('Alice renamed');
do $$ begin
  if (select count(*) from public.pilot_moments) <> 4 then raise exception 'Duplicate publication'; end if;
  if (select maker_label from public.pilot_moments where maker_id = auth.uid()) <> 'Alice' then raise exception 'Published credit changed'; end if;
  begin
    update public.pilot_moments set maker_label = 'Stolen';
    raise exception 'Published work was editable';
  exception when insufficient_privilege then null; end;
end $$;
set request.jwt.claim.sub = '20000000-0000-4000-8000-000000000002';
select public.pilot_save_draft('30000000-0000-4000-8000-000000000002', 'midnight-signal',
 (select id from public.pilot_moments where maker_label = 'Alice'), 'Bob continues', 'The room fills with paper stars.');
do $$ begin
  if (select count(*) from public.pilot_operations) <> 1 then raise exception 'Guest ownership isolation failed'; end if;
end $$;
reset role;
update public.pilot_rooms set is_open = false where id = 'midnight-signal';
set role authenticated;
do $$ begin
  if (select count(*) from public.pilot_operations) <> 0 then raise exception 'Closed-room operation leaked'; end if;
  if (select count(*) from public.pilot_moments where room_id = 'midnight-signal') <> 0 then raise exception 'Closed-room media metadata leaked'; end if;
end $$;
reset role;
set role anon;
do $$ begin
  if (select count(*) from public.pilot_rooms) <> 2 then raise exception 'Public room visibility failed'; end if;
  begin
    perform public.pilot_set_display_name('Forged');
    raise exception 'Anonymous HTTP role could claim identity';
  exception when insufficient_privilege then null; end;
end $$;
