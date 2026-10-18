begin;
insert into auth.users(id) values('97000000-0000-4000-8000-000000000001');
insert into public.pilot_profiles(id,display_name) values('97000000-0000-4000-8000-000000000001','Overview fixture');
insert into public.pilot_wren_requests(id,maker_id,room_id,parent_id,brief,input_digest,environment,state,claim_token,lease_until) values
  ('97100000-0000-4000-8000-000000000001','97000000-0000-4000-8000-000000000001','kessler-ward','15000000-0000-4000-8000-000000000001','PRIVATE BRIEF',repeat('a',64),'DEVELOPMENT','funding','97200000-0000-4000-8000-000000000001',clock_timestamp()+interval '5 minutes');
insert into public.pilot_wren_payments(request_id,room_id,actor_id,state,payment) values
  ('97100000-0000-4000-8000-000000000001','kessler-ward','97000000-0000-4000-8000-000000000001','pending',jsonb_build_object(
    'roomId','kessler-ward','network','eip155:42431','payer','0x951c8D90d0D1e81351ED802178823C60cce3BD98',
    'payTo','0x3B02f4be77C010d872Ace7149051003AB9855Ca1','currency','0x20c0000000000000000000000000000000000000',
    'amount','1000000','transaction','0x'||repeat('a',64),'credential','PRIVATE CREDENTIAL'));
set local role anon;
do $$ declare result jsonb; begin
  result:=public.pilot_kessler_overview();
  if result->>'roomId'<>'kessler-ward' or (result#>>'{story,prepared}')::integer<>11 or (result#>>'{story,published}')::integer<>0 then raise exception 'Incorrect prepared/public counts'; end if;
  if result#>'{wren,payments}'<>'[]'::jsonb then raise exception 'Unconfirmed payment was public'; end if;
  if result::text ~ 'PRIVATE|credential|claim_token|actor_id|brief|cap_micro' then raise exception 'Private data leaked'; end if;
  begin perform 1 from public.pilot_wren_payments; raise exception 'Anonymous payment table access'; exception when insufficient_privilege then null; end;
end $$;
reset role;
update public.pilot_wren_payments set state='credited',receipt_id='private/receipt.json' where request_id='97100000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ declare result jsonb; begin
  result:=public.pilot_kessler_overview();
  if jsonb_array_length(result#>'{wren,payments}')<>1 or result#>>'{wren,payments,0,transaction}'<>'0x'||repeat('a',64) then raise exception 'Credited payment absent'; end if;
  if result::text ~ 'PRIVATE|credential|claim_token|actor_id|brief|private/receipt' then raise exception 'Private payment data leaked'; end if;
end $$;
reset role;
update public.pilot_wren_payments set payment=jsonb_set(payment,'{roomId}','"paper-moon"') where request_id='97100000-0000-4000-8000-000000000001';
set local role anon;
do $$ begin
  if public.pilot_kessler_overview()#>'{wren,payments}'<>'[]'::jsonb then raise exception 'Other room payment claimed for Kessler'; end if;
end $$;
reset role;
update public.pilot_rooms set is_listed=false where id='kessler-ward';
set local role anon;
do $$ begin
  if public.pilot_kessler_overview() is not null then raise exception 'Unlisted room leaked'; end if;
end $$;
reset role;
update public.pilot_rooms set is_listed=true,is_open=false where id='kessler-ward';
set local role authenticated;
do $$ begin
  if public.pilot_kessler_overview() is not null then raise exception 'Closed room leaked'; end if;
end $$;
reset role;
rollback;
