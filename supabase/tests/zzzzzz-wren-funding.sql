begin;
do $$ begin
  if (select enabled from public.pilot_wren_funding_policy where id) then raise exception 'Funding was enabled by a migration'; end if;
  if (select expires_at from public.pilot_wren_funding_policy where id)<>'2026-10-13T23:24:42Z'::timestamptz then raise exception 'Funding silently renewed the old key'; end if;
end $$;
insert into auth.users(id) values('96000000-0000-4000-8000-000000000001'),('96000000-0000-4000-8000-000000000002');
insert into public.pilot_profiles(id,display_name) values('96000000-0000-4000-8000-000000000001','Funding Alice'),('96000000-0000-4000-8000-000000000002','Funding Bob');
update public.pilot_generation_budget set enabled=true,execution_environment='DEVELOPMENT',cap_micro=10000000,imported_expense_micro=0;
insert into public.pilot_wren_requests(id,maker_id,room_id,parent_id,brief,input_digest,environment,state,claim_token,lease_until) values
  ('96100000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000001','kessler-ward','15000000-0000-4000-8000-000000000001','Private next scene',repeat('a',64),'DEVELOPMENT','funding','96200000-0000-4000-8000-000000000001',clock_timestamp()+interval '5 minutes'),
  ('96100000-0000-4000-8000-000000000002','96000000-0000-4000-8000-000000000002','kessler-ward','15000000-0000-4000-8000-000000000001','Another private next scene',repeat('b',64),'DEVELOPMENT','funding','96200000-0000-4000-8000-000000000002',clock_timestamp()+interval '5 minutes');
set local role service_role;
do $$ begin
  if public.pilot_claim_wren_payment('96100000-0000-4000-8000-000000000001','96200000-0000-4000-8000-000000000001')->>'state'<>'blocked' then raise exception 'Expired disabled key admitted purchase'; end if;
  if exists(select 1 from public.pilot_wren_payments) then raise exception 'Disabled purchase created a payment'; end if;
end $$;
reset role;
-- Test fixture authorization only: no chain, signer, purchase or provider call.
update public.pilot_wren_funding_policy set enabled=true,authorized_at=clock_timestamp()-interval '1 minute',expires_at=clock_timestamp()+interval '23 hours';
-- The request already exists. Ordinary eligibility can change while planning;
-- funding must read it again rather than buy credits that cannot be used.
update public.pilot_room_capacity set guest_attempt_limit=0 where room_id='kessler-ward';
set local role service_role;
do $$ begin
  if (public.pilot_wren_funding_preflight('96100000-0000-4000-8000-000000000001','96200000-0000-4000-8000-000000000001')->>'budgetReady')::boolean then raise exception 'Exhausted maker attempts were ignored'; end if;
  if public.pilot_claim_wren_payment('96100000-0000-4000-8000-000000000001','96200000-0000-4000-8000-000000000001')->>'state'<>'blocked' then raise exception 'Maker without attempts could buy'; end if;
end $$;
reset role;
update public.pilot_room_capacity set guest_attempt_limit=3 where room_id='kessler-ward';
update public.pilot_generation_budget set max_requests=imported_requests where id;
set local role service_role;
do $$ begin
  if (public.pilot_wren_funding_preflight('96100000-0000-4000-8000-000000000001','96200000-0000-4000-8000-000000000001')->>'budgetReady')::boolean then raise exception 'Exhausted image slots were ignored'; end if;
  if public.pilot_claim_wren_payment('96100000-0000-4000-8000-000000000001','96200000-0000-4000-8000-000000000001')->>'state'<>'blocked' then raise exception 'Purchase bypassed slots consumed after request acceptance'; end if;
  if exists(select 1 from public.pilot_wren_payments) then raise exception 'Exhausted ordinary eligibility admitted a payment'; end if;
end $$;
reset role;
update public.pilot_generation_budget set max_requests=100 where id;
set local role service_role;
do $$ begin
  if public.pilot_claim_wren_payment('96100000-0000-4000-8000-000000000001','96200000-0000-4000-8000-000000000001')->>'state'<>'claimed' then raise exception 'Eligible purchase not admitted'; end if;
  if public.pilot_claim_wren_payment('96100000-0000-4000-8000-000000000002','96200000-0000-4000-8000-000000000002')->>'state'<>'pending' then raise exception 'Another request bypassed unresolved purchase'; end if;
  begin
    perform public.pilot_claim_wren_payment('96100000-0000-4000-8000-000000000001','96200000-0000-4000-8000-000000000009');
    raise exception 'A stale request claim admitted funding';
  exception when raise_exception then if sqlerrm='A stale request claim admitted funding' then raise; end if; end;
end $$;
select set_config('test.wren_payment',jsonb_build_object('kind','wren/hosted-mpp-payment/v1','roomId','kessler-ward','actorId','96000000-0000-4000-8000-000000000001',
  'network','eip155:42431','payer','0x951c8D90d0D1e81351ED802178823C60cce3BD98','payTo','0x3B02f4be77C010d872Ace7149051003AB9855Ca1',
  'currency','0x20c0000000000000000000000000000000000000','amount','1000000','credential','Payment offline-fixture',
  'transaction','0x'||repeat('a',64),'intentId',repeat('b',64),'validBefore',1792108825)::text,true);
select public.pilot_save_wren_payment('96100000-0000-4000-8000-000000000001','96200000-0000-4000-8000-000000000001','signed',current_setting('test.wren_payment')::jsonb);
do $$ begin
  begin
    perform public.pilot_save_wren_payment('96100000-0000-4000-8000-000000000001','96200000-0000-4000-8000-000000000001','signed',jsonb_set(current_setting('test.wren_payment')::jsonb,'{transaction}',to_jsonb('0x'||repeat('c',64))));
    raise exception 'A replacement transaction was saved';
  exception when raise_exception then if sqlerrm='A replacement transaction was saved' then raise; end if; end;
  begin
    perform public.pilot_save_wren_payment('96100000-0000-4000-8000-000000000001','96200000-0000-4000-8000-000000000001','blocked');
    raise exception 'A signed payment was cleared without reconciliation';
  exception when raise_exception then if sqlerrm='A signed payment was cleared without reconciliation' then raise; end if; end;
end $$;
reset role;
update public.pilot_wren_requests set claim_token='96200000-0000-4000-8000-000000000003' where id='96100000-0000-4000-8000-000000000001';
set local role service_role;
select public.pilot_save_wren_payment('96100000-0000-4000-8000-000000000001','96200000-0000-4000-8000-000000000003','pending',current_setting('test.wren_payment')::jsonb);
select public.pilot_save_wren_payment('96100000-0000-4000-8000-000000000001','96200000-0000-4000-8000-000000000003','credited',current_setting('test.wren_payment')::jsonb,'mpp/receipts/'||repeat('b',64)||'.json');
select public.pilot_save_wren_payment('96100000-0000-4000-8000-000000000001','96200000-0000-4000-8000-000000000003','credited',current_setting('test.wren_payment')::jsonb,'mpp/receipts/'||repeat('b',64)||'.json');
do $$ begin
  if (select count(*) from public.pilot_wren_payments)<>1 then raise exception 'Duplicate payment record'; end if;
  if public.pilot_claim_wren_payment('96100000-0000-4000-8000-000000000002','96200000-0000-4000-8000-000000000002')->>'state'<>'blocked' then raise exception 'Daily cap was bypassed'; end if;
  if (select delivery_limit from public.pilot_room_capacity where room_id='kessler-ward')<>0 then raise exception 'Saving a payment invented credits'; end if;
  if (select cap_micro from public.pilot_generation_budget where id)<>10000000 then raise exception 'Funding expanded inference dollar ceiling'; end if;
end $$;
-- These calls stand in for the seller after it verified the exact on-chain
-- transfer. Receipt IDs share the historical refill table and cannot credit twice.
select public.pilot_refill_wren_room('96300000-0000-4000-8000-000000000001','kessler-ward','96000000-0000-4000-8000-000000000001');
select public.pilot_refill_wren_room('96300000-0000-4000-8000-000000000001','kessler-ward','96000000-0000-4000-8000-000000000001');
do $$ begin
  if (select delivery_limit from public.pilot_room_capacity where room_id='kessler-ward')<>5 then raise exception 'Paid refill was duplicated'; end if;
  if (select guest_attempt_limit from public.pilot_room_capacity where room_id='kessler-ward')<>3 then raise exception 'Paid refill raised maker attempts'; end if;
  if (select max_requests from public.pilot_generation_budget where id)<>100 then raise exception 'Paid refill raised image request ceiling'; end if;
  if (select cap_micro from public.pilot_generation_budget where id)<>10000000 then raise exception 'Paid refill raised dollar ceiling'; end if;
  if (select count(*) from public.pilot_local_refills where request_id='96300000-0000-4000-8000-000000000001')<>1 then raise exception 'Paid refill lost durable idempotency'; end if;
  begin
    perform public.pilot_refill_wren_room('96300000-0000-4000-8000-000000000001','kessler-ward','96000000-0000-4000-8000-000000000002');
    raise exception 'Receipt was replayed under another actor';
  exception when raise_exception then if sqlerrm='Receipt was replayed under another actor' then raise; end if; end;
end $$;
reset role;
set local role authenticated;
do $$ begin
  begin perform 1 from public.pilot_wren_payments; raise exception 'Maker read signed credentials'; exception when insufficient_privilege then null; end;
  begin perform public.pilot_claim_wren_payment('96100000-0000-4000-8000-000000000002','96200000-0000-4000-8000-000000000002'); raise exception 'Maker invoked private funding'; exception when insufficient_privilege then null; end;
  begin perform public.pilot_refill_wren_room('96300000-0000-4000-8000-000000000002','kessler-ward','96000000-0000-4000-8000-000000000001'); raise exception 'Maker invoked paid refill'; exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
