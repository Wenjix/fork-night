reset role;
begin;
update public.pilot_rooms set is_open=true where id in ('midnight-signal','paper-moon');
insert into auth.users(id) values('83000000-0000-4000-8000-000000000001'),('83000000-0000-4000-8000-000000000002');
update public.pilot_generation_budget set enabled=true,execution_environment='DEVELOPMENT',cap_micro=10000000,max_requests=100;
set role authenticated;
set request.jwt.claim.sub='83000000-0000-4000-8000-000000000001';
select public.pilot_set_display_name('Execution Alice');
select set_config('test.exec_a',(public.pilot_save_continuation(gen_random_uuid(),'midnight-signal','10000000-0000-4000-8000-000000000001','First','First','["A"]')).id::text,true);
select public.pilot_request_generation(current_setting('test.exec_a')::uuid);
do $$ begin
  begin perform claim_token from public.pilot_jobs; raise exception 'Claim token leaked'; exception when insufficient_privilege then null; end;
  begin perform * from public.pilot_job_dispatches; raise exception 'Dispatch details leaked'; exception when insufficient_privilege then null; end;
end $$;
select set_config('test.exec_a2',(public.pilot_save_continuation(gen_random_uuid(),'paper-moon','10000000-0000-4000-8000-000000000002','Another room','Another room','["B"]')).id::text,true);
do $$ begin
  begin perform public.pilot_request_generation(current_setting('test.exec_a2')::uuid); raise exception 'One maker admitted twice';
  exception when raise_exception then if sqlerrm<>'Finish or check your existing generation before starting another' then raise; end if; end;
end $$;
set request.jwt.claim.sub='83000000-0000-4000-8000-000000000002';
select public.pilot_set_display_name('Execution Bob');
select set_config('test.exec_b',(public.pilot_save_continuation(gen_random_uuid(),'midnight-signal','10000000-0000-4000-8000-000000000001','Sibling','Sibling','["C"]')).id::text,true);
set role service_role;
do $$ begin
  if public.pilot_claim_execution(current_setting('test.exec_a')::uuid,'84000000-0000-4000-8000-000000000001',1,'PRODUCTION','run-a') then raise exception 'Wrong environment claimed'; end if;
  if not public.pilot_claim_execution(current_setting('test.exec_a')::uuid,'84000000-0000-4000-8000-000000000001',1,'DEVELOPMENT','run-a') then raise exception 'New execution could not claim'; end if;
  if public.pilot_claim_execution(current_setting('test.exec_a')::uuid,'84000000-0000-4000-8000-000000000002',1,'DEVELOPMENT','run-duplicate') then raise exception 'Duplicate run claimed'; end if;
end $$;
select public.pilot_begin_panel(current_setting('test.exec_a')::uuid,1,repeat('a',64),'84000000-0000-4000-8000-000000000001');
set role authenticated;
-- A healthy paid request is covered by its hold and does not block another maker's admission.
select public.pilot_request_generation(current_setting('test.exec_b')::uuid);
set role service_role;
do $$ begin
  if (select sum(held_micro) from public.pilot_jobs)<>2000000 then raise exception 'Concurrent admission hold wrong'; end if;
end $$;
-- A missing-usage response remains unknown even with a complete saved image.
select public.pilot_record_panel(current_setting('test.exec_a')::uuid,1,'84000000-0000-4000-8000-000000000001','complete',repeat('b',64),current_setting('test.exec_a')||'/1.webp',repeat('c',64),null,'request-a',100,null);
select public.pilot_finish_job(current_setting('test.exec_a')::uuid,'84000000-0000-4000-8000-000000000001');
select public.pilot_claim_execution(current_setting('test.exec_b')::uuid,'84000000-0000-4000-8000-000000000002',1,'DEVELOPMENT','run-b');
do $$ begin
  if not public.pilot_spending_paused(true) then raise exception 'Unknown response did not pause spending'; end if;
  begin perform public.pilot_begin_panel(current_setting('test.exec_b')::uuid,1,repeat('d',64),'84000000-0000-4000-8000-000000000002'); raise exception 'Queued job spent through unknown cost';
  exception when no_data_found then null; end;
end $$;
select public.pilot_defer_job(current_setting('test.exec_b')::uuid,'84000000-0000-4000-8000-000000000002');
select public.pilot_reconcile_execution(current_setting('test.exec_b')::uuid,1,'run-b','COMPLETED',true);
do $$ begin
  if (select dispatch_version from public.pilot_jobs where operation_id=current_setting('test.exec_b')::uuid)<>1 then raise exception 'Blocked work churned recovery versions'; end if;
  begin perform public.pilot_review_expense('85000000-0000-4000-8000-000000000001',current_setting('test.exec_a')::uuid,1,5000,'Verified provider billing','fixture-billing-a'); raise exception 'Review before terminal evidence';
  exception when raise_exception then if sqlerrm<>'Confirm and fence the terminal execution before settling its expense' then raise; end if; end;
end $$;
select public.pilot_reconcile_execution(current_setting('test.exec_a')::uuid,1,'run-a','COMPLETED',false);
select public.pilot_review_expense('85000000-0000-4000-8000-000000000001',current_setting('test.exec_a')::uuid,1,5000,'Verified provider billing','fixture-billing-a');
select public.pilot_review_expense('85000000-0000-4000-8000-000000000001',current_setting('test.exec_a')::uuid,1,5000,'Verified provider billing','fixture-billing-a');
do $$ begin
  if (select held_micro from public.pilot_jobs where operation_id=current_setting('test.exec_a')::uuid)<>0 then raise exception 'Review did not release unknown liability once'; end if;
  if (select expense_micro from public.pilot_panel_attempts where operation_id=current_setting('test.exec_a')::uuid) is not null then raise exception 'Historical receipt was rewritten'; end if;
  if (select accounted_micro from public.pilot_panel_accounting where operation_id=current_setting('test.exec_a')::uuid)<>5000 then raise exception 'Reviewed expense missing'; end if;
end $$;
select public.pilot_reconcile_execution(current_setting('test.exec_b')::uuid,1,'run-b','COMPLETED',true);
select public.pilot_claim_execution(current_setting('test.exec_b')::uuid,'84000000-0000-4000-8000-000000000003',2,'DEVELOPMENT','run-b2');
do $$ begin
  if public.pilot_heartbeat(current_setting('test.exec_b')::uuid,'84000000-0000-4000-8000-000000000002',1,'DEVELOPMENT','run-b') then raise exception 'Stale run renewed'; end if;
  begin perform public.pilot_finish_job(current_setting('test.exec_b')::uuid,'84000000-0000-4000-8000-000000000002'); raise exception 'Stale run finalized';
  exception when raise_exception then if sqlerrm<>'Worker does not own this job' then raise; end if; end;
  if public.pilot_reconcile_execution(current_setting('test.exec_b')::uuid,1,'run-b','FAILED',true)<>'stale' then raise exception 'Late terminal report rewound current job'; end if;
end $$;
-- Verified terminal crashes before any provider intent can recover only twice.
select public.pilot_reconcile_execution(current_setting('test.exec_b')::uuid,2,'run-b2','CRASHED',true);
select public.pilot_claim_execution(current_setting('test.exec_b')::uuid,'84000000-0000-4000-8000-000000000004',3,'DEVELOPMENT','run-b3');
select public.pilot_reconcile_execution(current_setting('test.exec_b')::uuid,3,'run-b3','CRASHED',true);
select public.pilot_claim_execution(current_setting('test.exec_b')::uuid,'84000000-0000-4000-8000-000000000005',4,'DEVELOPMENT','run-b4');
select public.pilot_reconcile_execution(current_setting('test.exec_b')::uuid,4,'run-b4','CRASHED',true);
do $$ begin
  if (select state from public.pilot_jobs where operation_id=current_setting('test.exec_b')::uuid)<>'uncertain' then raise exception 'Recovery limit did not stop'; end if;
  if (select held_micro from public.pilot_jobs where operation_id=current_setting('test.exec_b')::uuid)<>1000000 then raise exception 'Recovery lost reserved allowance'; end if;
  if (select count(*) from public.pilot_panel_attempts where operation_id=current_setting('test.exec_b')::uuid)<>0 then raise exception 'Recovery purchased a panel'; end if;
end $$;
reset role;
rollback;
