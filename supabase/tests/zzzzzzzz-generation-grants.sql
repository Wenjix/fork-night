reset role;
begin;
insert into auth.users(id) values('98000000-0000-4000-8000-000000000001'),('98000000-0000-4000-8000-000000000002');
update public.pilot_generation_budget set enabled=true,execution_environment='PRODUCTION',cap_micro=10000000,max_requests=100;
update public.pilot_room_capacity set delivery_limit=3,guest_attempt_limit=0 where room_id='kessler-ward';
create function pg_temp.generation_denied(op uuid, message text) returns void language plpgsql as $$ begin
  begin perform public.pilot_request_generation(op); raise exception 'Unexpected admission';
  exception when raise_exception then if sqlerrm<>message then raise; end if; end;
end $$;
set role authenticated;
set request.jwt.claim.sub='98000000-0000-4000-8000-000000000001';
select public.pilot_set_display_name('Continuing resident');
select set_config('test.grant_a',(public.pilot_save_continuation('98100000-0000-4000-8000-000000000001','kessler-ward','15000000-0000-4000-8000-000000000001','First new event','Fixture','["Mika starts the lift."]')).id::text,true);
select pg_temp.generation_denied(current_setting('test.grant_a')::uuid,'You have used your attempts for this rehearsal');
do $$ begin
  begin insert into public.pilot_generation_grants(request_id,mission_id,maker_id,room_id,parent_id,expires_at)
    values(gen_random_uuid(),gen_random_uuid(),auth.uid(),'kessler-ward','15000000-0000-4000-8000-000000000001',clock_timestamp()+interval '10 minutes');
    raise exception 'Guest granted itself extra attempts'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.pilot_generation_grants; raise exception 'Grant details leaked'; exception when insufficient_privilege then null; end;
end $$;
reset role;
insert into public.pilot_generation_grants(request_id,mission_id,maker_id,room_id,parent_id,parent_request_id,created_at,expires_at) values
  ('98100000-0000-4000-8000-000000000001','98200000-0000-4000-8000-000000000001','98000000-0000-4000-8000-000000000001','kessler-ward','15000000-0000-4000-8000-000000000001',null,clock_timestamp(),clock_timestamp()+interval '10 minutes'),
  ('98100000-0000-4000-8000-000000000002','98200000-0000-4000-8000-000000000001','98000000-0000-4000-8000-000000000001','kessler-ward',null,'98100000-0000-4000-8000-000000000001',clock_timestamp(),clock_timestamp()+interval '10 minutes'),
  ('98100000-0000-4000-8000-000000000003','98200000-0000-4000-8000-000000000001','98000000-0000-4000-8000-000000000001','kessler-ward',null,'98100000-0000-4000-8000-000000000002',clock_timestamp()-interval '2 minutes',clock_timestamp()-interval '1 minute');
do $$ begin
  begin insert into public.pilot_generation_grants(request_id,mission_id,maker_id,room_id,parent_id,expires_at)
    values(gen_random_uuid(),gen_random_uuid(),'98000000-0000-4000-8000-000000000001','kessler-ward','15000000-0000-4000-8000-000000000001',clock_timestamp()+interval '2 hours');
    raise exception 'Unlimited grant'; exception when check_violation then null; end;
end $$;
set role service_role;
do $$ begin
  begin update public.pilot_generation_grants set expires_at=clock_timestamp()+interval '15 minutes'; raise exception 'Service extended an existing grant'; exception when insufficient_privilege then null; end;
end $$;
reset role;
-- An exact grant still requires the original room credits and global inference headroom.
update public.pilot_generation_budget set cap_micro=0;
set role authenticated;
select pg_temp.generation_denied(current_setting('test.grant_a')::uuid,'The generation allowance has been used for this rehearsal');
reset role;
update public.pilot_generation_budget set cap_micro=10000000,max_requests=0;
set role authenticated;
select pg_temp.generation_denied(current_setting('test.grant_a')::uuid,'The generation allowance has been used for this rehearsal');
reset role;
update public.pilot_generation_budget set max_requests=100;
update public.pilot_room_capacity set delivery_limit=0 where room_id='kessler-ward';
set role authenticated;
select pg_temp.generation_denied(current_setting('test.grant_a')::uuid,'This room needs more generation credits');
reset role;
update public.pilot_room_capacity set delivery_limit=3 where room_id='kessler-ward';
-- Exact actor, room, parent and one-panel scope are enforced, not just the request ID.
update public.pilot_operations set requested_captions='["One","Two"]' where id=current_setting('test.grant_a')::uuid;
set role authenticated;
select pg_temp.generation_denied(current_setting('test.grant_a')::uuid,'You have used your attempts for this rehearsal');
reset role;
update public.pilot_operations set requested_captions='["Mika starts the lift."]',parent_id='15000000-0000-4000-8000-000000000008' where id=current_setting('test.grant_a')::uuid;
set role authenticated;
select pg_temp.generation_denied(current_setting('test.grant_a')::uuid,'You have used your attempts for this rehearsal');
reset role;
update public.pilot_operations set parent_id='15000000-0000-4000-8000-000000000001' where id=current_setting('test.grant_a')::uuid;
set role authenticated;
set request.jwt.claim.sub='98000000-0000-4000-8000-000000000002';
select public.pilot_set_display_name('Other resident');
reset role;
update public.pilot_generation_grants set maker_id='98000000-0000-4000-8000-000000000002' where request_id='98100000-0000-4000-8000-000000000001';
set role authenticated;
set request.jwt.claim.sub='98000000-0000-4000-8000-000000000001';
select pg_temp.generation_denied(current_setting('test.grant_a')::uuid,'You have used your attempts for this rehearsal');
reset role;
update public.pilot_generation_grants set maker_id='98000000-0000-4000-8000-000000000001',room_id='paper-moon' where request_id='98100000-0000-4000-8000-000000000001';
set role authenticated;
select pg_temp.generation_denied(current_setting('test.grant_a')::uuid,'You have used your attempts for this rehearsal');
reset role;
update public.pilot_generation_grants set room_id='kessler-ward' where request_id='98100000-0000-4000-8000-000000000001';
set role authenticated;
-- A later grant cannot be used before its predecessor is published.
select set_config('test.grant_b',(public.pilot_save_continuation('98100000-0000-4000-8000-000000000002','kessler-ward','15000000-0000-4000-8000-000000000001','Next new event','Fixture','["Mika reaches the landing."]')).id::text,true);
select pg_temp.generation_denied(current_setting('test.grant_b')::uuid,'You have used your attempts for this rehearsal');
select public.pilot_request_generation(current_setting('test.grant_a')::uuid);
select public.pilot_request_generation(current_setting('test.grant_a')::uuid);
reset role;
-- Simulate a completed preview; this test performs no provider or chain request.
update public.pilot_jobs set state='delivered',held_micro=0 where operation_id=current_setting('test.grant_a')::uuid;
update public.pilot_operations set status='delivered',charged_units=1,source_kind='fixture',panels='[{"caption":"Mika starts the lift.","imageUrl":"/art/night-shift-neon.webp#frame=0"}]' where id=current_setting('test.grant_a')::uuid;
set role authenticated;
select set_config('test.grant_parent',(public.pilot_publish(current_setting('test.grant_a')::uuid)).id::text,true);
reset role;
update public.pilot_operations set parent_id=current_setting('test.grant_parent')::uuid where id=current_setting('test.grant_b')::uuid;
set role authenticated;
select public.pilot_request_generation(current_setting('test.grant_b')::uuid);
reset role;
update public.pilot_jobs set state='delivered',held_micro=0 where operation_id=current_setting('test.grant_b')::uuid;
update public.pilot_operations set status='delivered',charged_units=1,source_kind='fixture',panels='[{"caption":"Mika reaches the landing.","imageUrl":"/art/night-shift-neon.webp#frame=0"}]' where id=current_setting('test.grant_b')::uuid;
set role authenticated;
select set_config('test.grant_parent',(public.pilot_publish(current_setting('test.grant_b')::uuid)).id::text,true);
select set_config('test.grant_c',(public.pilot_save_continuation('98100000-0000-4000-8000-000000000003','kessler-ward',current_setting('test.grant_parent')::uuid,'The new choice','Fixture','["Mika opens the door."]')).id::text,true);
select pg_temp.generation_denied(current_setting('test.grant_c')::uuid,'You have used your attempts for this rehearsal');
reset role;
update public.pilot_generation_grants set created_at=clock_timestamp(),expires_at=clock_timestamp()+interval '10 minutes' where request_id='98100000-0000-4000-8000-000000000003';
set role authenticated;
select public.pilot_request_generation(current_setting('test.grant_c')::uuid);
reset role;
update public.pilot_generation_grants set created_at=clock_timestamp()-interval '2 minutes',expires_at=clock_timestamp()-interval '1 minute';
set role authenticated;
-- Expiry stops new admissions but permits checking the same already-admitted job.
select public.pilot_request_generation(current_setting('test.grant_c')::uuid);
reset role;
do $$ begin
  if (select count(*) from public.pilot_jobs j join public.pilot_operations o on o.id=j.operation_id where o.maker_id='98000000-0000-4000-8000-000000000001')<>3 then raise exception 'Grant replay purchased another job'; end if;
  if (public.pilot_room_credits('kessler-ward')->>'available')::integer<>0 then raise exception 'Grant bypassed room credits'; end if;
  if (select guest_attempt_limit from public.pilot_room_capacity where room_id='kessler-ward')<>0 then raise exception 'Grant raised the shared attempt limit'; end if;
end $$;
rollback;
