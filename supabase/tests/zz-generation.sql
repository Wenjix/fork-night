reset role;
begin;
update public.pilot_rooms set is_open=true where id='midnight-signal';
insert into auth.users values('21000000-0000-4000-8000-000000000001'),('21000000-0000-4000-8000-000000000002');
update public.pilot_generation_budget set execution_environment='DEVELOPMENT',enabled=true,cap_micro=2038871,imported_expense_micro=38871,imported_requests=2;
set role authenticated;
set request.jwt.claim.sub='21000000-0000-4000-8000-000000000001';
select public.pilot_set_display_name('Generation Alice');
select set_config('test.gen_op',(public.pilot_save_continuation('31000000-0000-4000-8000-000000000001','midnight-signal','10000000-0000-4000-8000-000000000001','A whale','The signal takes shape.','["A whale appears.","The sea answers."]')).id::text,true);
select public.pilot_request_generation(current_setting('test.gen_op')::uuid);
select public.pilot_request_generation(current_setting('test.gen_op')::uuid);
do $$ begin
  if (select count(*) from public.pilot_jobs)<>1 then raise exception 'Duplicate generation hold'; end if;
  begin
    perform public.pilot_claim_execution(current_setting('test.gen_op')::uuid,'41000000-0000-4000-8000-000000000001',1,'DEVELOPMENT','run-initial');
    raise exception 'Guest claimed worker job';
  exception when insufficient_privilege then null; end;
  begin
    perform public.pilot_save_continuation('31000000-0000-4000-8000-000000000001','midnight-signal','10000000-0000-4000-8000-000000000001','A whale','The signal takes shape.','["Changed.","Changed again."]');
    raise exception 'Changed beats accepted';
  exception when raise_exception then if sqlerrm<>'Request ID belongs to a different sequence' then raise; end if; end;
end $$;
set request.jwt.claim.sub='21000000-0000-4000-8000-000000000002';
select public.pilot_set_display_name('Generation Bob');
select set_config('test.gen_other',(public.pilot_save_continuation('31000000-0000-4000-8000-000000000002','paper-moon','10000000-0000-4000-8000-000000000002','A moon','The moon folds.','["It folds.","It flies."]')).id::text,true);
do $$ begin
  if (select count(*) from public.pilot_jobs)<>0 then raise exception 'Another maker job leaked'; end if;
  begin
    perform public.pilot_request_generation(current_setting('test.gen_op')::uuid);
    raise exception 'Guest could spend for another maker';
  exception when raise_exception then if sqlerrm<>'Contribution is unavailable' then raise; end if; end;
  begin
    perform public.pilot_request_generation(current_setting('test.gen_other')::uuid);
    raise exception 'Shared budget overspent across rooms';
  exception when raise_exception then if sqlerrm<>'The generation allowance has been used for this rehearsal' then raise; end if; end;
end $$;
reset role;
set role service_role;
do $$ begin
  if not public.pilot_claim_execution(current_setting('test.gen_op')::uuid,'41000000-0000-4000-8000-000000000001',1,'DEVELOPMENT','run-initial') then raise exception 'Could not claim job'; end if;
  if public.pilot_claim_execution(current_setting('test.gen_op')::uuid,'41000000-0000-4000-8000-000000000002',1,'DEVELOPMENT','run-initial') then raise exception 'Duplicate worker claimed'; end if;
  if not public.pilot_begin_panel(current_setting('test.gen_op')::uuid,1,repeat('a',64),'41000000-0000-4000-8000-000000000001') then raise exception 'Could not begin panel'; end if;
  if public.pilot_begin_panel(current_setting('test.gen_op')::uuid,1,repeat('a',64),'41000000-0000-4000-8000-000000000001') then raise exception 'Duplicate paid dispatch'; end if;
end $$;
select public.pilot_record_panel(current_setting('test.gen_op')::uuid,1,'41000000-0000-4000-8000-000000000001','complete',repeat('b',64),current_setting('test.gen_op')||'/1.webp',repeat('c',64),15000,'req_one',1000,null);
select public.pilot_record_panel(current_setting('test.gen_op')::uuid,1,'41000000-0000-4000-8000-000000000001','complete',repeat('b',64),current_setting('test.gen_op')||'/1.webp',repeat('c',64),15000,'req_one',1000,null);
do $$ begin
  if (select held_micro from public.pilot_jobs where operation_id=current_setting('test.gen_op')::uuid)<>1000000 then raise exception 'Repeated receipt released hold twice'; end if;
end $$;
select public.pilot_begin_panel(current_setting('test.gen_op')::uuid,2,repeat('d',64),'41000000-0000-4000-8000-000000000001');
select public.pilot_record_panel(current_setting('test.gen_op')::uuid,2,'41000000-0000-4000-8000-000000000001','complete',repeat('e',64),current_setting('test.gen_op')||'/2.webp',repeat('f',64),24000,'req_two',1000,null);
select public.pilot_finish_job(current_setting('test.gen_op')::uuid,'41000000-0000-4000-8000-000000000001');
select public.pilot_finish_job(current_setting('test.gen_op')::uuid,'41000000-0000-4000-8000-000000000001');
insert into storage.objects(bucket_id,name) values('pilot-media',current_setting('test.gen_op')||'/1.webp');
reset role;
set role authenticated;
set request.jwt.claim.sub='21000000-0000-4000-8000-000000000002';
do $$ begin
  if exists(select 1 from storage.objects) then raise exception 'Draft image leaked'; end if;
end $$;
set request.jwt.claim.sub='21000000-0000-4000-8000-000000000001';
do $$ begin
  if (select count(*) from storage.objects)<>1 then raise exception 'Owner draft image missing'; end if;
  if (select charged_units from public.pilot_operations where id=current_setting('test.gen_op')::uuid)<>1 then raise exception 'Delivery credit wrong'; end if;
end $$;
select public.pilot_publish(current_setting('test.gen_op')::uuid);
set role anon;
do $$ begin
  if (select count(*) from storage.objects)<>1 then raise exception 'Published image unavailable'; end if;
end $$;
reset role;
update public.pilot_rooms set is_open=false where id='midnight-signal';
set role anon;
do $$ begin
  if exists(select 1 from storage.objects) then raise exception 'Closed room image leaked'; end if;
end $$;
reset role;
-- Unknown provider expense persists and prevents another room spending.
update public.pilot_generation_budget set cap_micro=10000000;
set role authenticated;
set request.jwt.claim.sub='21000000-0000-4000-8000-000000000002';
select public.pilot_request_generation(current_setting('test.gen_other')::uuid);
set role service_role;
select public.pilot_claim_execution(current_setting('test.gen_other')::uuid,'41000000-0000-4000-8000-000000000002',1,'DEVELOPMENT','run-initial');
select public.pilot_begin_panel(current_setting('test.gen_other')::uuid,1,repeat('a',64),'41000000-0000-4000-8000-000000000002');
select public.pilot_finish_job(current_setting('test.gen_other')::uuid,'41000000-0000-4000-8000-000000000002','Connection lost');
do $$ begin
  if (select held_micro from public.pilot_jobs where operation_id=current_setting('test.gen_other')::uuid)<>2000000 then raise exception 'Uncertain expense or continuation allowance released'; end if;
  if (select charged_units from public.pilot_operations where id=current_setting('test.gen_other')::uuid)<>0 then raise exception 'Incomplete result charged'; end if;
end $$;
set role authenticated;
select public.pilot_request_generation(current_setting('test.gen_other')::uuid);
set role service_role;
-- Browser checks retain the current fence. Only terminal evidence permits recovery.
select public.pilot_reconcile_execution(current_setting('test.gen_other')::uuid,1,'run-initial','FAILED',true);
select public.pilot_claim_execution(current_setting('test.gen_other')::uuid,'41000000-0000-4000-8000-000000000003',2,'DEVELOPMENT','run-recovery');
do $$ begin
  if public.pilot_begin_panel(current_setting('test.gen_other')::uuid,1,repeat('a',64),'41000000-0000-4000-8000-000000000003') then raise exception 'Recovery bought the panel again'; end if;
end $$;
reset role;
rollback;
