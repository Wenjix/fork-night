-- Isolated database fixtures only. Signature and Auth checks live in the HTTP tests.
begin;
insert into auth.users(id) values ('20000000-0000-4000-8000-000000000071'), ('20000000-0000-4000-8000-000000000072');
insert into public.pilot_profiles(id, display_name) values
  ('20000000-0000-4000-8000-000000000071', 'Request maker'),
  ('20000000-0000-4000-8000-000000000072', 'Another maker');
update public.pilot_rooms set is_open = true where id = 'midnight-signal';
insert into public.pilot_moments(id, room_id, parent_id, maker_id, maker_label, title, panels, source_kind) values
  ('10000000-0000-4000-8000-000000000071', 'midnight-signal', '10000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000071', 'Published byline', 'A signed-wallet scene',
   '[{"caption":"A test scene.","imageUrl":"/art/midnight-story.webp#frame=0"}]', 'fixture');

set role anon;
do $$ begin
  begin
    perform 1 from public.pilot_wallet_requests;
    raise exception 'Raw wallet requests were readable by anon';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set role authenticated;
do $$ begin
  begin
    perform public.pilot_submit_wallet_request('30000000-0000-4000-8000-000000000071', 'midnight-signal',
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '10000000-0000-4000-8000-000000000071',
      '20000000-0000-4000-8000-000000000071', '0x0000000000000000000000000000000000000002', 1791820000, 'fixture-signature');
    raise exception 'Authenticated caller bypassed the signature-verifying server';
  exception when insufficient_privilege then null; end;
  begin
    update public.pilot_wallet_requests set state = 'approved';
    raise exception 'Authenticated caller forged request approval';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set role service_role;
do $$
declare request_record public.pilot_wallet_requests; repeated public.pilot_wallet_requests;
begin
  request_record := public.pilot_submit_wallet_request('30000000-0000-4000-8000-000000000071', 'midnight-signal',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '10000000-0000-4000-8000-000000000071',
    '20000000-0000-4000-8000-000000000071', '0x0000000000000000000000000000000000000002', 1791820000, 'fixture-signature');
  repeated := public.pilot_submit_wallet_request(request_record.id, request_record.room_id, request_record.project_id, request_record.moment_id,
    request_record.maker_id, request_record.wallet_address, request_record.issued_at, request_record.signature);
  if request_record.id <> repeated.id or (select count(*) from public.pilot_wallet_requests where maker_id = request_record.maker_id) <> 1 then
    raise exception 'Identical retry duplicated the pending request';
  end if;
  if request_record.maker_label <> 'Published byline' or request_record.moment_title <> 'A signed-wallet scene' then
    raise exception 'The request did not preserve actual published attribution';
  end if;
  begin
    perform public.pilot_submit_wallet_request(request_record.id, request_record.room_id, request_record.project_id, request_record.moment_id,
      request_record.maker_id, '0x0000000000000000000000000000000000000003', request_record.issued_at, request_record.signature);
    raise exception 'Same request ID was rebound to another wallet';
  exception when raise_exception then if sqlerrm <> 'This request ID already belongs to different inputs' then raise; end if; end;
  begin
    perform public.pilot_submit_wallet_request('30000000-0000-4000-8000-000000000072', request_record.room_id, request_record.project_id, request_record.moment_id,
      request_record.maker_id, request_record.wallet_address, request_record.issued_at, request_record.signature);
    raise exception 'A second pending request was created';
  exception when raise_exception then if sqlerrm <> 'Your wallet request is already waiting for the curator' then raise; end if; end;
  begin
    perform public.pilot_submit_wallet_request('30000000-0000-4000-8000-000000000072', request_record.room_id, request_record.project_id, request_record.moment_id,
      '20000000-0000-4000-8000-000000000072', request_record.wallet_address, request_record.issued_at, request_record.signature);
    raise exception 'Another maker claimed the published scene';
  exception when raise_exception then if sqlerrm <> 'Choose your own published scene in an open room' then raise; end if; end;
  update public.pilot_wallet_requests set state = 'denied', decided_at = now() where id = request_record.id;
  repeated := public.pilot_submit_wallet_request('30000000-0000-4000-8000-000000000072', request_record.room_id, request_record.project_id, request_record.moment_id,
    request_record.maker_id, '0x0000000000000000000000000000000000000003', request_record.issued_at + 1, 'new-fixture-signature');
  if repeated.state <> 'pending' or repeated.wallet_address <> '0x0000000000000000000000000000000000000003' then
    raise exception 'Denial did not allow a new, separate request';
  end if;
  update public.pilot_rooms set is_open = false where id = request_record.room_id;
  begin
    perform public.pilot_submit_wallet_request('30000000-0000-4000-8000-000000000073', request_record.room_id, request_record.project_id, request_record.moment_id,
      request_record.maker_id, request_record.wallet_address, request_record.issued_at, request_record.signature);
    raise exception 'Closed room accepted a wallet request';
  exception when raise_exception then if sqlerrm <> 'Choose your own published scene in an open room' then raise; end if; end;
end $$;
reset role;
rollback;
