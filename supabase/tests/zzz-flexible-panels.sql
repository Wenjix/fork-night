reset role;
begin;
update public.pilot_rooms set is_open=true where id='midnight-signal';
update public.pilot_generation_budget set enabled=true,cap_micro=10000000,imported_expense_micro=0,imported_requests=0,max_requests=3;
update public.pilot_room_capacity set delivery_limit=2,guest_attempt_limit=10 where room_id='midnight-signal';
insert into auth.users values('22000000-0000-4000-8000-000000000001'),('22000000-0000-4000-8000-000000000002');
set role authenticated;
set request.jwt.claim.sub='22000000-0000-4000-8000-000000000001';
select public.pilot_set_display_name('Flexible Alice');
select set_config('test.flex_one',(public.pilot_save_continuation(gen_random_uuid(),'midnight-signal','10000000-0000-4000-8000-000000000001','One scene','One scene','["The lighthouse waits."]')).id::text,true);
select set_config('test.flex_three',(public.pilot_save_continuation(gen_random_uuid(),'midnight-signal','10000000-0000-4000-8000-000000000001','A small journey','A small journey','["It waits.","A boat arrives.","They leave together."]')).id::text,true);
do $$ begin
  begin
    perform public.pilot_save_continuation(gen_random_uuid(),'midnight-signal','10000000-0000-4000-8000-000000000001','Four','Four','["A","B","C","D"]');
    raise exception 'Allowed four panels';
  exception when raise_exception then if sqlerrm<>'Choose one to three panels' then raise; end if; end;
end $$;
select public.pilot_request_generation(current_setting('test.flex_three')::uuid);
select public.pilot_request_generation(current_setting('test.flex_three')::uuid);
do $$ begin
  if (public.pilot_room_credits('midnight-signal')->>'reserved')::int<>2 then raise exception 'Three panels did not reserve two credits'; end if;
  if (select panel_count from public.pilot_jobs where operation_id=current_setting('test.flex_three')::uuid)<>3 then raise exception 'Wrong planned image count'; end if;
  if (select held_micro from public.pilot_jobs where operation_id=current_setting('test.flex_three')::uuid)<>3000000 then raise exception 'Wrong expense hold'; end if;
  begin
    perform public.pilot_request_generation(current_setting('test.flex_one')::uuid);
    raise exception 'Admitted more than three images';
  exception when raise_exception then if sqlerrm<>'The generation allowance has been used for this rehearsal' then raise; end if; end;
end $$;
reset role;
update public.pilot_generation_budget set max_requests=10;
set role authenticated;
do $$ begin
  begin
    perform public.pilot_request_generation(current_setting('test.flex_one')::uuid);
    raise exception 'Overspent weighted room credits';
  exception when raise_exception then if sqlerrm<>'This room needs more generation credits' then raise; end if; end;
end $$;
set role service_role;
select public.pilot_claim_job(current_setting('test.flex_three')::uuid,'42000000-0000-4000-8000-000000000001');
do $$ begin
  begin
    perform public.pilot_begin_panel(current_setting('test.flex_three')::uuid,3,repeat('a',64),'42000000-0000-4000-8000-000000000001');
    raise exception 'Started final panel before predecessors';
  exception when raise_exception then if sqlerrm<>'Save and account for the preceding panels first' then raise; end if; end;
end $$;
select public.pilot_begin_panel(current_setting('test.flex_three')::uuid,1,repeat('a',64),'42000000-0000-4000-8000-000000000001');
select public.pilot_record_panel(current_setting('test.flex_three')::uuid,1,'42000000-0000-4000-8000-000000000001','complete',repeat('b',64),current_setting('test.flex_three')||'/1.webp',repeat('c',64),10000,'req_one',1000,null);
select public.pilot_begin_panel(current_setting('test.flex_three')::uuid,2,repeat('d',64),'42000000-0000-4000-8000-000000000001');
select public.pilot_record_panel(current_setting('test.flex_three')::uuid,2,'42000000-0000-4000-8000-000000000001','complete',repeat('e',64),current_setting('test.flex_three')||'/2.webp',repeat('f',64),10000,'req_two',1000,null);
select public.pilot_begin_panel(current_setting('test.flex_three')::uuid,3,repeat('a',64),'42000000-0000-4000-8000-000000000001');
select public.pilot_finish_job(current_setting('test.flex_three')::uuid,'42000000-0000-4000-8000-000000000001','Lost third response');
reset role;
do $$ begin
  if (select charged_units from public.pilot_operations where id=current_setting('test.flex_three')::uuid)<>0 then raise exception 'Partial sequence was charged'; end if;
  if (select state from public.pilot_jobs where operation_id=current_setting('test.flex_three')::uuid)<>'uncertain' then raise exception 'Uncertain third panel was not held'; end if;
  if (public.pilot_room_credits('midnight-signal')->>'reserved')::int<>2 then raise exception 'Partial sequence released room reservation'; end if;
end $$;
set role authenticated;
do $$ begin
  begin
    perform public.pilot_publish(current_setting('test.flex_three')::uuid);
    raise exception 'Published incomplete sequence';
  exception when raise_exception then if sqlerrm<>'A complete delivered result is required' then raise; end if; end;
end $$;
select public.pilot_request_generation(current_setting('test.flex_three')::uuid);
set role service_role;
select public.pilot_claim_job(current_setting('test.flex_three')::uuid,'42000000-0000-4000-8000-000000000002');
do $$ begin
  if public.pilot_begin_panel(current_setting('test.flex_three')::uuid,3,repeat('a',64),'42000000-0000-4000-8000-000000000002') then raise exception 'Recovery bought third panel again'; end if;
end $$;
select public.pilot_record_panel(current_setting('test.flex_three')::uuid,3,'42000000-0000-4000-8000-000000000002','complete',repeat('b',64),current_setting('test.flex_three')||'/3.webp',repeat('c',64),10000,'req_three',1000,null);
select public.pilot_finish_job(current_setting('test.flex_three')::uuid,'42000000-0000-4000-8000-000000000002');
select public.pilot_finish_job(current_setting('test.flex_three')::uuid,'42000000-0000-4000-8000-000000000002');
insert into storage.objects(bucket_id,name) values('pilot-media',current_setting('test.flex_three')||'/3.webp');
reset role;
do $$ begin
  if (select charged_units from public.pilot_operations where id=current_setting('test.flex_three')::uuid)<>2 then raise exception 'Three-panel charge wrong'; end if;
  if (public.pilot_room_credits('midnight-signal')->>'used')::int<>2 then raise exception 'Double charge or missing charge'; end if;
  if (public.pilot_room_credits('midnight-signal')->>'reserved')::int<>0 then raise exception 'Complete sequence retained room reservation'; end if;
end $$;
set role authenticated;
set request.jwt.claim.sub='22000000-0000-4000-8000-000000000002';
select public.pilot_set_display_name('Flexible Bob');
do $$ begin
  if exists(select 1 from storage.objects) then raise exception 'Third private panel leaked'; end if;
end $$;
set request.jwt.claim.sub='22000000-0000-4000-8000-000000000001';
do $$ begin
  if (select count(*) from storage.objects)<>1 then raise exception 'Maker cannot inspect third panel'; end if;
end $$;
select public.pilot_publish(current_setting('test.flex_three')::uuid);
set role anon;
do $$ begin
  if (select count(*) from storage.objects)<>1 then raise exception 'Published third panel unavailable'; end if;
end $$;
reset role;
update public.pilot_room_capacity set delivery_limit=3 where room_id='midnight-signal';
set role authenticated;
select public.pilot_request_generation(current_setting('test.flex_one')::uuid);
set role service_role;
select public.pilot_claim_job(current_setting('test.flex_one')::uuid,'42000000-0000-4000-8000-000000000003');
do $$ begin
  begin
    perform public.pilot_begin_panel(current_setting('test.flex_one')::uuid,2,repeat('a',64),'42000000-0000-4000-8000-000000000003');
    raise exception 'One-panel job admitted second call';
  exception when raise_exception then if sqlerrm<>'Panel is outside the saved sequence' then raise; end if; end;
end $$;
select public.pilot_begin_panel(current_setting('test.flex_one')::uuid,1,repeat('a',64),'42000000-0000-4000-8000-000000000003');
select public.pilot_record_panel(current_setting('test.flex_one')::uuid,1,'42000000-0000-4000-8000-000000000003','complete',repeat('b',64),current_setting('test.flex_one')||'/1.webp',repeat('c',64),10000,'req_single',1000,null);
select public.pilot_finish_job(current_setting('test.flex_one')::uuid,'42000000-0000-4000-8000-000000000003');
reset role;
do $$ begin
  if (select jsonb_array_length(panels) from public.pilot_operations where id=current_setting('test.flex_one')::uuid)<>1 then raise exception 'Single scene was not delivered'; end if;
  if (public.pilot_room_credits('midnight-signal')->>'used')::int<>3 then raise exception 'Single scene charge wrong'; end if;
end $$;
set role authenticated;
select public.pilot_publish(current_setting('test.flex_one')::uuid);
reset role;
-- A definitive third-panel failure releases the reservation, preserving expenses.
update public.pilot_room_capacity set delivery_limit=5 where room_id='midnight-signal';
set role authenticated;
select set_config('test.flex_fail',(public.pilot_save_continuation(gen_random_uuid(),'midnight-signal','10000000-0000-4000-8000-000000000001','Failure','Failure','["A","B","C"]')).id::text,true);
select public.pilot_request_generation(current_setting('test.flex_fail')::uuid);
set role service_role;
select public.pilot_claim_job(current_setting('test.flex_fail')::uuid,'42000000-0000-4000-8000-000000000004');
do $$ declare n integer; begin
  for n in 1..3 loop
    perform public.pilot_begin_panel(current_setting('test.flex_fail')::uuid,n,repeat('a',64),'42000000-0000-4000-8000-000000000004');
    perform public.pilot_record_panel(current_setting('test.flex_fail')::uuid,n,'42000000-0000-4000-8000-000000000004',case when n=3 then 'failed' else 'complete' end,repeat('b',64),case when n=3 then null else current_setting('test.flex_fail')||'/'||n||'.webp' end,case when n=3 then null else repeat('c',64) end,10000,'req_failure',1000,null);
  end loop;
end $$;
select public.pilot_finish_job(current_setting('test.flex_fail')::uuid,'42000000-0000-4000-8000-000000000004');
reset role;
do $$ begin
  if (select charged_units from public.pilot_operations where id=current_setting('test.flex_fail')::uuid)<>0 then raise exception 'Failed result charged'; end if;
  if (public.pilot_room_credits('midnight-signal')->>'available')::int<>2 then raise exception 'Failure did not release room credits'; end if;
  if (select sum(expense_micro) from public.pilot_panel_attempts where operation_id=current_setting('test.flex_fail')::uuid)<>30000 then raise exception 'Failure lost expense'; end if;
end $$;
reset role;
rollback;
