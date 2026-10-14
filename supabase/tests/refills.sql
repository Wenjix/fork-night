reset role;
begin;
update public.pilot_rooms set is_open=true where id in ('midnight-signal','paper-moon');
insert into auth.users values('93000000-0000-4000-8000-000000000001'),('93000000-0000-4000-8000-000000000002');
insert into public.pilot_profiles(id,display_name) values('93000000-0000-4000-8000-000000000001','Local tester');
update public.pilot_room_capacity set delivery_limit=0,guest_attempt_limit=0 where room_id='midnight-signal';
update public.pilot_generation_budget set execution_environment='DEVELOPMENT',enabled=true,cap_micro=10000000,imported_expense_micro=200000,imported_requests=10,max_requests=10 where id;
set local role authenticated;
set local request.jwt.claim.sub='93000000-0000-4000-8000-000000000001';
do $$ begin
  begin perform public.pilot_refill_room('94000000-0000-4000-8000-000000000001','midnight-signal',auth.uid()); raise exception 'Guest refilled directly'; exception when insufficient_privilege then null; end;
  begin select * from public.pilot_local_refills; raise exception 'Guest read local refill ledger'; exception when insufficient_privilege then null; end;
end $$;
set local role service_role;
do $$ declare result jsonb; before_budget jsonb; begin
  result:=public.pilot_refill_room('94000000-0000-4000-8000-000000000001','midnight-signal','93000000-0000-4000-8000-000000000001');
  if (result->>'replayed')::boolean or (result#>>'{credits,available}')::int<>5 then raise exception 'Refill not available'; end if;
  if not exists(select 1 from public.pilot_room_capacity where room_id='midnight-signal' and delivery_limit=5 and guest_attempt_limit=5) then raise exception 'Refill did not extend local attempt capacity'; end if;
  if not exists(select 1 from public.pilot_generation_budget where id and cap_micro=10000000 and imported_expense_micro=200000 and imported_requests=10 and max_requests>=20 and enabled) then raise exception 'Refill reset or raised the spend budget'; end if;
  select to_jsonb(b) into before_budget from public.pilot_generation_budget b where id;
  result:=public.pilot_refill_room('94000000-0000-4000-8000-000000000001','midnight-signal','93000000-0000-4000-8000-000000000001');
  if not (result->>'replayed')::boolean or (result#>>'{credits,available}')::int<>5 then raise exception 'Retry added credits twice'; end if;
  if (select to_jsonb(b) from public.pilot_generation_budget b where id)<>before_budget then raise exception 'Retry increased request allowance'; end if;
  begin perform public.pilot_refill_room('94000000-0000-4000-8000-000000000001','paper-moon','93000000-0000-4000-8000-000000000001'); raise exception 'Cross-room retry accepted'; exception when raise_exception then if sqlerrm<>'This refill belongs to another room or guest' then raise; end if; end;
end $$;
-- A refill unblocks admission but cannot overcome the dollar ceiling.
set local role authenticated;
select set_config('test.refill_op',(public.pilot_save_continuation(gen_random_uuid(),'midnight-signal','10000000-0000-4000-8000-000000000001','One scene','One scene','["One scene"]')).id::text,true);
select public.pilot_request_generation(current_setting('test.refill_op')::uuid);
set local role service_role;
do $$ declare result jsonb; begin
  result:=public.pilot_refill_room('94000000-0000-4000-8000-000000000002','midnight-signal','93000000-0000-4000-8000-000000000001');
  if (result#>>'{credits,reserved}')::int<>1 or (result#>>'{credits,available}')::int<>9 then raise exception 'Refill lost reserved credits'; end if;
end $$;
update public.pilot_generation_budget set cap_micro=1200000 where id;
set local role authenticated;
set local request.jwt.claim.sub='93000000-0000-4000-8000-000000000002';
select public.pilot_set_display_name('Other tester');
select set_config('test.over_cap',(public.pilot_save_continuation(gen_random_uuid(),'midnight-signal','10000000-0000-4000-8000-000000000001','Another','Another','["Another"]')).id::text,true);
do $$ begin
  begin perform public.pilot_request_generation(current_setting('test.over_cap')::uuid); raise exception 'Refill bypassed dollar limit'; exception when raise_exception then if sqlerrm<>'The generation allowance has been used for this rehearsal' then raise; end if; end;
end $$;
reset role;
rollback;
