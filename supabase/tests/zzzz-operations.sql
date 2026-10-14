reset role;
begin;
update public.pilot_rooms set is_open=true where id='paper-moon';
insert into auth.users(id) values('89000000-0000-4000-8000-000000000001');
set role authenticated;
set request.jwt.claim.sub='89000000-0000-4000-8000-000000000001';
select public.pilot_set_display_name('Operator proof maker');
select set_config('test.legacy_cancel',(public.pilot_save_continuation(gen_random_uuid(),'paper-moon','10000000-0000-4000-8000-000000000002','Cancel fixture','Saved original words','["A"]')).id::text,true);
select set_config('test.legacy_adopt',(public.pilot_save_continuation(gen_random_uuid(),'paper-moon','10000000-0000-4000-8000-000000000002','Adopt fixture','Saved original words','["B"]')).id::text,true);
do $$ begin
  begin perform public.pilot_prepare_judge_room('forged-grant','paper-moon'); raise exception 'Maker changed operator allowances';
  exception when insufficient_privilege then null; end;
  begin perform public.pilot_readiness('paper-moon'); raise exception 'Maker read operator readiness';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
update public.pilot_generation_budget set enabled=true,execution_environment='PRODUCTION',cap_micro=10000000,
  imported_expense_micro=500000,imported_requests=3,max_requests=10;
insert into public.pilot_jobs(operation_id,panel_count,held_micro,state,claim_token) values
  (current_setting('test.legacy_cancel')::uuid,1,1000000,'running','8a000000-0000-4000-8000-000000000001'),
  (current_setting('test.legacy_adopt')::uuid,1,1000000,'queued',null);
update public.pilot_operations set status='queued' where id in (current_setting('test.legacy_cancel')::uuid,current_setting('test.legacy_adopt')::uuid);
set role service_role;
select public.pilot_review_legacy_job('8b000000-0000-4000-8000-000000000001',current_setting('test.legacy_cancel')::uuid,'cancel','CANCELED','run-old-canceled','Verified terminal legacy run','fixture:terminal-run');
select public.pilot_review_legacy_job('8b000000-0000-4000-8000-000000000001',current_setting('test.legacy_cancel')::uuid,'cancel','CANCELED','run-old-canceled','Verified terminal legacy run','fixture:terminal-run');
do $$ begin
  if (select count(*) from public.pilot_execution_reviews)<>1 then raise exception 'Legacy review was duplicated'; end if;
  if not exists(select 1 from public.pilot_jobs where operation_id=current_setting('test.legacy_cancel')::uuid and state='failed' and held_micro=0 and claim_token is null) then raise exception 'Cancellation did not fence and release the unused hold'; end if;
  if (select prompt from public.pilot_operations where id=current_setting('test.legacy_cancel')::uuid)<>'Saved original words' then raise exception 'Cancellation lost the original words'; end if;
  begin perform public.pilot_finish_job(current_setting('test.legacy_cancel')::uuid,'8a000000-0000-4000-8000-000000000001'); raise exception 'Canceled legacy token remained valid';
  exception when raise_exception then if sqlerrm<>'Worker does not own this job' then raise; end if; end;
  begin perform public.pilot_review_legacy_job('8b000000-0000-4000-8000-000000000001',current_setting('test.legacy_cancel')::uuid,'adopt','CANCELED','run-old-canceled','Verified terminal legacy run','fixture:terminal-run'); raise exception 'Review ID accepted changed evidence';
  exception when raise_exception then if sqlerrm<>'Review ID belongs to different evidence' then raise; end if; end;
end $$;
-- Even a terminal legacy run cannot be adopted/canceled through this path if it
-- has a paid intent. Its receipt and liability need separate accounting review.
insert into public.pilot_panel_attempts(operation_id,panel_number,input_digest)
  values(current_setting('test.legacy_adopt')::uuid,1,repeat('a',64));
do $$ begin
  begin perform public.pilot_review_legacy_job('8b000000-0000-4000-8000-000000000002',current_setting('test.legacy_adopt')::uuid,'adopt','NO_ACCEPTED_RUN',null,'Verified no accepted legacy run','fixture:run-search'); raise exception 'Legacy provider intent was ignored';
  exception when raise_exception then if sqlerrm<>'A provider intent exists. Preserve its hold and review its receipt separately' then raise; end if; end;
end $$;
delete from public.pilot_panel_attempts where operation_id=current_setting('test.legacy_adopt')::uuid;
select public.pilot_review_legacy_job('8b000000-0000-4000-8000-000000000002',current_setting('test.legacy_adopt')::uuid,'adopt','NO_ACCEPTED_RUN',null,'Verified no accepted legacy run','fixture:run-search');
select public.pilot_review_legacy_job('8b000000-0000-4000-8000-000000000002',current_setting('test.legacy_adopt')::uuid,'adopt','NO_ACCEPTED_RUN',null,'Verified no accepted legacy run','fixture:run-search');
do $$ begin
  if not exists(select 1 from public.pilot_jobs where operation_id=current_setting('test.legacy_adopt')::uuid and state='queued' and held_micro=1000000 and dispatch_version=2 and execution_environment='PRODUCTION') then raise exception 'Adoption changed the purchase or hold'; end if;
  if (select count(*) from public.pilot_job_dispatches where operation_id=current_setting('test.legacy_adopt')::uuid)<>1 then raise exception 'Adoption created duplicate dispatches'; end if;
  if public.pilot_claim_job(current_setting('test.legacy_adopt')::uuid,'8a000000-0000-4000-8000-000000000002') then raise exception 'Old worker could claim adopted work'; end if;
end $$;
reset role;
update public.pilot_assist_limits set shape_enabled=false,shape_request_limit=1,guest_shape_limit=10,voice_enabled=true;
insert into public.pilot_assist_requests(request_id,maker_id,room_id,parent_id,kind,input_digest,state) values
  (gen_random_uuid(),'89000000-0000-4000-8000-000000000001','paper-moon','10000000-0000-4000-8000-000000000002','shape',repeat('b',64),'failed');
update public.pilot_room_capacity set delivery_limit=2,guest_attempt_limit=1 where room_id='paper-moon';
update public.pilot_generation_budget set cap_micro=5000000;
set role service_role;
do $$ begin
  begin perform public.pilot_prepare_judge_room('fixture-rehearsal','paper-moon'); raise exception 'Preparation raised an insufficient dollar cap';
  exception when raise_exception then if sqlerrm<>'This rehearsal needs six dollars of existing admission headroom; the cap has not changed' then raise; end if; end;
  if exists(select 1 from public.pilot_rehearsal_allowances) then raise exception 'Rejected preparation recorded a grant'; end if;
end $$;
reset role;
update public.pilot_generation_budget set cap_micro=10000000;
set role service_role;
select public.pilot_prepare_judge_room('fixture-rehearsal','paper-moon');
do $$ declare r jsonb; begin
  r:=public.pilot_readiness('paper-moon');
  if (r#>>'{room,credits,available}')::int<>12 or (r#>>'{room,guestAttemptLimit}')::int<>4 then raise exception 'Room preparation was not bounded to the target'; end if;
  if (r#>>'{generation,requestSlots}')::int<>24 or (r#>>'{generation,capMicro}')::bigint<>10000000 or (r#>>'{generation,knownExpenseMicro}')::bigint<>500000 or (r#>>'{generation,heldMicro}')::bigint<>1000000 then raise exception 'Preparation changed expense, holds, dollar cap or the request target'; end if;
  if (r#>>'{helpers,shapeUsed}')::int<>1 or (r#>>'{helpers,shapeLimit}')::int<>37 or (r#>>'{helpers,perMakerShapeLimit}')::int<>9 or (r#>>'{helpers,voiceEnabled}')::boolean then raise exception 'Helper usage was reset or finite limits were wrong'; end if;
end $$;
-- Consume another helper claim, then replay the same preparation. The once-only
-- grant cannot replenish the spent turn or raise its original limits again.
insert into public.pilot_assist_requests(request_id,maker_id,room_id,parent_id,kind,input_digest,state) values
  (gen_random_uuid(),'89000000-0000-4000-8000-000000000001','paper-moon','10000000-0000-4000-8000-000000000002','shape',repeat('c',64),'failed');
select public.pilot_prepare_judge_room('fixture-rehearsal','paper-moon');
do $$ begin
  if (select shape_request_limit from public.pilot_assist_limits)<>37 or (select count(*) from public.pilot_rehearsal_allowances)<>1 then raise exception 'Repeated preparation added allowance'; end if;
  begin perform public.pilot_prepare_judge_room('fixture-rehearsal','midnight-signal'); raise exception 'Grant ID was reused for a different room';
  exception when raise_exception then if sqlerrm<>'This grant belongs to another room' then raise; end if; end;
end $$;
reset role;
rollback;

-- Pre-outbox fallback estimates must be reviewable without inventing a new
-- execution or editing the old receipt, for both delivered and unfinished work.
begin;
update public.pilot_rooms set is_open=true where id='paper-moon';
update public.pilot_generation_budget set execution_environment='PRODUCTION';
insert into auth.users(id) values('8c000000-0000-4000-8000-000000000001');
set role authenticated;
set request.jwt.claim.sub='8c000000-0000-4000-8000-000000000001';
select public.pilot_set_display_name('Legacy receipt maker');
select set_config('test.legacy_delivered',(public.pilot_save_continuation(gen_random_uuid(),'paper-moon','10000000-0000-4000-8000-000000000002','Delivered legacy','Original words','["A"]')).id::text,true);
select set_config('test.legacy_receipt',(public.pilot_save_continuation(gen_random_uuid(),'paper-moon','10000000-0000-4000-8000-000000000002','Unfinished legacy','Original words','["B"]')).id::text,true);
do $$ begin
  begin perform legacy_terminal_observed_at from public.pilot_jobs; raise exception 'Legacy execution evidence leaked';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
insert into public.pilot_jobs(operation_id,panel_count,held_micro,state,claim_token) values
  (current_setting('test.legacy_delivered')::uuid,1,1000000,'delivered',null),
  (current_setting('test.legacy_receipt')::uuid,1,1000000,'running','8d000000-0000-4000-8000-000000000001');
update public.pilot_operations set status='delivered',source_kind='openai',charged_units=1,
  panels=jsonb_build_array(jsonb_build_object('imagePath',id::text||'/1.webp','sha256',repeat('d',64),'caption','A'))
  where id=current_setting('test.legacy_delivered')::uuid;
update public.pilot_operations set status='dispatching' where id=current_setting('test.legacy_receipt')::uuid;
insert into public.pilot_panel_attempts(operation_id,panel_number,input_digest,expense_micro,expense_basis,state,response_digest,image_path,image_digest) values
  (current_setting('test.legacy_delivered')::uuid,1,repeat('a',64),250000,'estimated','complete',repeat('c',64),current_setting('test.legacy_delivered')||'/1.webp',repeat('d',64)),
  (current_setting('test.legacy_receipt')::uuid,1,repeat('b',64),250000,'estimated','uncertain',null,null,null);
set role service_role;
do $$ begin
  begin perform public.pilot_review_expense('8e000000-0000-4000-8000-000000000001',current_setting('test.legacy_delivered')::uuid,1,30000,'Verified legacy billing','fixture:legacy-bill'); raise exception 'Legacy expense settled before terminal evidence';
  exception when raise_exception then if sqlerrm<>'Confirm and fence the terminal execution before settling its expense' then raise; end if; end;
  begin perform public.pilot_review_legacy_job('8f000000-0000-4000-8000-000000000001',current_setting('test.legacy_delivered')::uuid,'observe','NO_ACCEPTED_RUN',null,'Verified legacy receipt','fixture:legacy-run'); raise exception 'No accepted run substituted for terminal proof';
  exception when raise_exception then if sqlerrm<>'Record a verified terminal legacy run before reviewing provider expense' then raise; end if; end;
end $$;
select public.pilot_review_legacy_job('8f000000-0000-4000-8000-000000000001',current_setting('test.legacy_delivered')::uuid,'observe','COMPLETED','run-legacy-delivered','Verified legacy receipt','fixture:legacy-run');
do $$ begin
  if not exists(select 1 from public.pilot_jobs where operation_id=current_setting('test.legacy_delivered')::uuid and state='delivered' and held_micro=1000000 and legacy_terminal_observed_at is not null) then raise exception 'Observation changed delivery or released the estimate hold'; end if;
end $$;
select public.pilot_review_expense('8e000000-0000-4000-8000-000000000001',current_setting('test.legacy_delivered')::uuid,1,30000,'Verified legacy billing','fixture:legacy-bill');
select public.pilot_review_expense('8e000000-0000-4000-8000-000000000001',current_setting('test.legacy_delivered')::uuid,1,30000,'Verified legacy billing','fixture:legacy-bill');
do $$ begin
  if not exists(select 1 from public.pilot_panel_accounting where operation_id=current_setting('test.legacy_delivered')::uuid and expense_micro=250000 and expense_basis='estimated' and accounted_micro=30000 and expense_known) then raise exception 'Legacy estimate was overwritten or not accounted'; end if;
  if (select held_micro from public.pilot_jobs where operation_id=current_setting('test.legacy_delivered')::uuid)<>0 then raise exception 'Reviewed legacy liability did not settle once'; end if;
  if exists(select 1 from public.pilot_job_dispatches where operation_id=current_setting('test.legacy_delivered')::uuid) then raise exception 'Cost review invented a new dispatch'; end if;
end $$;
select public.pilot_review_legacy_job('8f000000-0000-4000-8000-000000000002',current_setting('test.legacy_receipt')::uuid,'observe','CRASHED','run-legacy-crashed','Verified legacy terminal run','fixture:legacy-crash');
do $$ begin
  begin perform public.pilot_finish_job(current_setting('test.legacy_receipt')::uuid,'8d000000-0000-4000-8000-000000000001'); raise exception 'Observed legacy run retained its token';
  exception when raise_exception then if sqlerrm<>'Worker does not own this job' then raise; end if; end;
  begin perform public.pilot_review_legacy_job('8f000000-0000-4000-8000-000000000003',current_setting('test.legacy_receipt')::uuid,'adopt','CRASHED','run-legacy-crashed','Adopt verified legacy receipt','fixture:legacy-adoption'); raise exception 'Unsettled legacy expense adopted';
  exception when raise_exception then if sqlerrm<>'A provider intent exists. Preserve its hold and review its receipt separately' then raise; end if; end;
end $$;
select public.pilot_review_expense('8e000000-0000-4000-8000-000000000002',current_setting('test.legacy_receipt')::uuid,1,40000,'Verified legacy billing','fixture:legacy-bill-2');
select public.pilot_review_legacy_job('8f000000-0000-4000-8000-000000000003',current_setting('test.legacy_receipt')::uuid,'adopt','CRASHED','run-legacy-crashed','Adopt verified legacy receipt','fixture:legacy-adoption');
select public.pilot_claim_execution(current_setting('test.legacy_receipt')::uuid,'8d000000-0000-4000-8000-000000000002',2,'PRODUCTION','run-adopted-receipt');
do $$ begin
  if public.pilot_begin_panel(current_setting('test.legacy_receipt')::uuid,1,repeat('b',64),'8d000000-0000-4000-8000-000000000002') then raise exception 'Adoption repurchased the recorded legacy panel'; end if;
  if (select held_micro from public.pilot_jobs where operation_id=current_setting('test.legacy_receipt')::uuid)<>0 then raise exception 'Adoption added another purchase reservation'; end if;
end $$;
reset role;
rollback;
