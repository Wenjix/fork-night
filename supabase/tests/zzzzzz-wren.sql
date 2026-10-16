reset role;
begin;
insert into auth.users(id) values('90000000-0000-4000-8000-000000000101'),('90000000-0000-4000-8000-000000000102');
update public.pilot_generation_budget set enabled=true,execution_environment='PRODUCTION',cap_micro=10000000,max_requests=100;
update public.pilot_wren_limits set enabled=true;
update public.pilot_room_capacity set delivery_limit=12,guest_attempt_limit=4 where room_id='kessler-ward';
select set_config('test.wren_parent',(select id::text from public.pilot_moments where room_id='kessler-ward' and parent_id is null),true);
set role authenticated;
set request.jwt.claim.sub='90000000-0000-4000-8000-000000000101';
select public.pilot_set_display_name('Wren requester');
select public.pilot_request_wren('90000000-0000-4000-8000-000000000201','kessler-ward',current_setting('test.wren_parent')::uuid,'Mika asks a neighbor for help.');
select public.pilot_request_wren('90000000-0000-4000-8000-000000000201','kessler-ward',current_setting('test.wren_parent')::uuid,'Mika asks a neighbor for help.');
do $$ begin
  if (select count(*) from public.pilot_wren_requests)<>1 then raise exception 'Duplicate Wren request'; end if;
  begin perform public.pilot_request_wren('90000000-0000-4000-8000-000000000201','kessler-ward',current_setting('test.wren_parent')::uuid,'Different brief'); raise exception 'Changed replay accepted';
  exception when raise_exception then if sqlerrm<>'Request ID belongs to different inputs' then raise; end if; end;
  begin perform public.pilot_request_wren('90000000-0000-4000-8000-000000000202','kessler-ward',current_setting('test.wren_parent')::uuid,'Another scene'); raise exception 'Second active request accepted';
  exception when raise_exception then if sqlerrm<>'Finish or check your current Wren request first' then raise; end if; end;
  begin perform public.pilot_admit_wren('90000000-0000-4000-8000-000000000201',gen_random_uuid()); raise exception 'Authenticated worker access';
  exception when insufficient_privilege then null; end;
  begin update public.pilot_wren_limits set enabled=true; raise exception 'Guest raised allowance'; exception when insufficient_privilege then null; end;
end $$;
select set_config('test.manual_operation',(public.pilot_save_continuation('90000000-0000-4000-8000-000000000301','kessler-ward',current_setting('test.wren_parent')::uuid,'Manual race','A different manual thought','["A neighbor opens the door."]')).id::text,true);
do $$ begin
  begin perform public.pilot_request_generation(current_setting('test.manual_operation')::uuid); raise exception 'Manual generation raced the Wren request';
  exception when raise_exception then if sqlerrm<>'Finish or check your active Wren request before generating another continuation' then raise; end if; end;
end $$;
set request.jwt.claim.sub='90000000-0000-4000-8000-000000000102';
select public.pilot_set_display_name('Other storyteller');
do $$ begin
  if exists(select 1 from public.pilot_wren_requests) then raise exception 'Private Wren request leaked'; end if;
  begin perform public.pilot_refresh_wren_request('90000000-0000-4000-8000-000000000201'); raise exception 'Other maker checked private request';
  exception when raise_exception then if sqlerrm<>'That private request is unavailable' then raise; end if; end;
  begin perform public.pilot_request_wren(gen_random_uuid(),'kessler-ward','10000000-0000-4000-8000-000000000002','Wrong room parent'); raise exception 'Cross-room parent accepted';
  exception when raise_exception then if sqlerrm<>'Choose a published moment in Kessler Ward' then raise; end if; end;
end $$;
reset role;
set role service_role;
select public.pilot_claim_wren_request('90000000-0000-4000-8000-000000000201','90000000-0000-4000-8000-000000000401','PRODUCTION','run-wren-proof',1);
select public.pilot_save_wren_plan('90000000-0000-4000-8000-000000000201','90000000-0000-4000-8000-000000000401','{"title":"The next landing","caption":"A neighbor opens the door and offers Mika a light."}');
do $$ begin
  begin perform public.pilot_admit_wren('90000000-0000-4000-8000-000000000201','90000000-0000-4000-8000-000000000402'); raise exception 'Wrong claim accepted';
  exception when raise_exception then if sqlerrm<>'The Wren request claim expired' then raise; end if; end;
end $$;
reset role;
update public.pilot_wren_requests set lease_until=now()-interval '1 second' where id='90000000-0000-4000-8000-000000000201';
set role service_role;
do $$ begin
  begin perform public.pilot_admit_wren('90000000-0000-4000-8000-000000000201','90000000-0000-4000-8000-000000000401'); raise exception 'Expired claim accepted';
  exception when raise_exception then if sqlerrm<>'The Wren request claim expired' then raise; end if; end;
end $$;
reset role;
update public.pilot_wren_requests set lease_until=now()+interval '5 minutes' where id='90000000-0000-4000-8000-000000000201';
update public.pilot_generation_budget set cap_micro=0;
set role service_role;
do $$ begin
  begin perform public.pilot_admit_wren('90000000-0000-4000-8000-000000000201','90000000-0000-4000-8000-000000000401'); raise exception 'Wren bypassed the image dollar cap';
  exception when raise_exception then if sqlerrm<>'The generation allowance has been used for this rehearsal' then raise; end if; end;
  if auth.uid()<>'90000000-0000-4000-8000-000000000102'::uuid then raise exception 'Failed admission leaked the requester claim'; end if;
end $$;
reset role;
update public.pilot_generation_budget set cap_micro=10000000;
set role service_role;
select set_config('test.wren_admission',public.pilot_admit_wren('90000000-0000-4000-8000-000000000201','90000000-0000-4000-8000-000000000401')::text,true);
select public.pilot_admit_wren('90000000-0000-4000-8000-000000000201','90000000-0000-4000-8000-000000000401');
do $$ begin
  if auth.uid()<>'90000000-0000-4000-8000-000000000102'::uuid then raise exception 'Admission leaked the requester claim'; end if;
  if (select count(*) from public.pilot_jobs where operation_id=(current_setting('test.wren_admission')::jsonb->>'operation_id')::uuid)<>1 then raise exception 'Duplicate image admission'; end if;
  if not exists(select 1 from public.pilot_operations where id=(current_setting('test.wren_admission')::jsonb->>'operation_id')::uuid and maker_id='90000000-0000-4000-8000-000000000101' and parent_id=current_setting('test.wren_parent')::uuid and requested_captions='["A neighbor opens the door and offers Mika a light."]') then raise exception 'Wren changed ownership or ancestry'; end if;
  if exists(select 1 from public.pilot_moments where maker_id='90000000-0000-4000-8000-000000000101') then raise exception 'Wren auto-published a private request'; end if;
end $$;
set role anon;
do $$ begin
  if exists(select 1 from public.pilot_wren_assistance('kessler-ward')) then raise exception 'Private Wren provenance leaked'; end if;
end $$;
reset role;
-- Simulate delivery only; no provider or payment is called by this database proof.
update public.pilot_jobs set state='delivered',held_micro=0 where operation_id=(current_setting('test.wren_admission')::jsonb->>'operation_id')::uuid;
update public.pilot_operations set status='delivered',source_kind='fixture',panels='[{"caption":"A neighbor offers Mika a light.","imageUrl":"/art/night-shift-neon.webp#frame=0"}]'
  where id=(current_setting('test.wren_admission')::jsonb->>'operation_id')::uuid;
set role authenticated;
set request.jwt.claim.sub='90000000-0000-4000-8000-000000000101';
select public.pilot_refresh_wren_request('90000000-0000-4000-8000-000000000201');
do $$ begin
  if not exists(select 1 from public.pilot_operations where id=(current_setting('test.wren_admission')::jsonb->>'operation_id')::uuid and status='delivered') then raise exception 'Requester cannot read private preview'; end if;
end $$;
select public.pilot_publish((current_setting('test.wren_admission')::jsonb->>'operation_id')::uuid);
set role anon;
do $$ begin
  if (select count(*) from public.pilot_wren_assistance('kessler-ward'))<>1 then raise exception 'Published assistance provenance missing'; end if;
  if exists(select 1 from public.pilot_wren_assistance('paper-moon')) then raise exception 'Assistance crossed room'; end if;
end $$;
reset role;
rollback;
