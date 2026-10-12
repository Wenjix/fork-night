reset role;
begin;
insert into auth.users values ('90000000-0000-4000-8000-000000000001'),('90000000-0000-4000-8000-000000000002');
set local role authenticated;
set local request.jwt.claim.sub='90000000-0000-4000-8000-000000000001';
select public.pilot_set_display_name('Maya');
select set_config('test.idea',(public.pilot_leave_idea(gen_random_uuid(),'midnight-signal','10000000-0000-4000-8000-000000000001','What if the lighthouse is alive?')).id::text,true);
select public.pilot_set_display_name('A new name');
set local request.jwt.claim.sub='90000000-0000-4000-8000-000000000002';
select public.pilot_set_display_name('Riff maker');
select set_config('test.draft',(public.pilot_save_continuation('91000000-0000-4000-8000-000000000001','midnight-signal','10000000-0000-4000-8000-000000000001','The lighthouse','Our next beat','["First","Then"]',current_setting('test.idea')::uuid)).id::text,true);
do $$ begin
  if (select source_idea_label from public.pilot_operations where id=current_setting('test.draft')::uuid)<>'Maya' then raise exception 'Source attribution was not snapshotted'; end if;
  perform public.pilot_save_continuation('91000000-0000-4000-8000-000000000001','midnight-signal','10000000-0000-4000-8000-000000000001','The lighthouse','Our next beat','["First","Then"]',current_setting('test.idea')::uuid);
  begin
    perform public.pilot_save_continuation('91000000-0000-4000-8000-000000000001','midnight-signal','10000000-0000-4000-8000-000000000001','The lighthouse','Our next beat','["First","Then"]');
    raise exception 'Source stripped on replay';
  exception when raise_exception then if sqlerrm<>'Request ID belongs to a different idea' then raise; end if; end;
  begin
    perform public.pilot_save_continuation(gen_random_uuid(),'paper-moon','20000000-0000-4000-8000-000000000001','Foreign','Foreign','["First","Then"]',current_setting('test.idea')::uuid);
    raise exception 'Foreign source accepted';
  exception when raise_exception then if sqlerrm<>'Choose an idea on the source moment' then raise; end if; end;
  begin perform public.pilot_claim_assist(auth.uid(),gen_random_uuid(),'midnight-signal','10000000-0000-4000-8000-000000000001','voice',repeat('a',64)); raise exception 'Guest can issue own provider allowance'; exception when insufficient_privilege then null; end;
  begin select * from public.pilot_assist_requests; raise exception 'Private helper work exposed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
update public.pilot_operations set status='delivered',source_kind='fixture',panels=(select panels from public.pilot_moments where id='10000000-0000-4000-8000-000000000001') where id=current_setting('test.draft')::uuid;
set local role authenticated;
select set_config('test.published',(public.pilot_publish(current_setting('test.draft')::uuid)).id::text,true);
select public.pilot_publish(current_setting('test.draft')::uuid);
set local role anon;
do $$ begin
  if not exists(select 1 from public.pilot_moments where id=current_setting('test.published')::uuid and maker_id='90000000-0000-4000-8000-000000000002' and maker_label='Riff maker' and source_idea_id is null and source_idea_label is null and source_idea_body is null) then raise exception 'A note must not acquire generation credit'; end if;
  if not exists(select 1 from public.pilot_ideas where id=current_setting('test.idea')::uuid and maker_label='Maya') then raise exception 'The original note lost its author'; end if;
end $$;
reset role;
set local role service_role;
do $$ begin
  begin perform public.pilot_claim_assist('90000000-0000-4000-8000-000000000002',gen_random_uuid(),'midnight-signal','10000000-0000-4000-8000-000000000001','voice',repeat('a',64)); raise exception 'Default-off allowance bypassed'; exception when raise_exception then if sqlerrm<>'This helper is being set up. You can keep developing your idea.' then raise; end if; end;
end $$;
update public.pilot_assist_limits set voice_enabled=true,shape_enabled=true,voice_token_limit=2,shape_request_limit=2,guest_voice_limit=1;
select public.pilot_claim_assist('90000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000001','midnight-signal','10000000-0000-4000-8000-000000000001','voice',repeat('a',64));
do $$ declare r jsonb; begin
  r:=public.pilot_claim_assist('90000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000001','midnight-signal','10000000-0000-4000-8000-000000000001','voice',repeat('a',64));
  if (r->>'claimed')::boolean then raise exception 'Duplicate provider claim'; end if;
  begin perform public.pilot_claim_assist('90000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000001','midnight-signal','10000000-0000-4000-8000-000000000001','voice',repeat('b',64)); raise exception 'Conflicting replay'; exception when raise_exception then if sqlerrm<>'Request ID belongs to different inputs' then raise; end if; end;
  begin perform public.pilot_claim_assist('90000000-0000-4000-8000-000000000002',gen_random_uuid(),'midnight-signal','10000000-0000-4000-8000-000000000001','voice',repeat('a',64)); raise exception 'Guest limit bypassed'; exception when raise_exception then if sqlerrm<>'You have used your helper turns. You can keep editing by hand.' then raise; end if; end;
end $$;
update public.pilot_assist_requests set state='failed';
select public.pilot_claim_assist('90000000-0000-4000-8000-000000000001',gen_random_uuid(),'midnight-signal','10000000-0000-4000-8000-000000000001','voice',repeat('a',64));
do $$ begin
  begin perform public.pilot_claim_assist('90000000-0000-4000-8000-000000000001',gen_random_uuid(),'midnight-signal','10000000-0000-4000-8000-000000000001','voice',repeat('a',64)); raise exception 'Failed attempts released global allowance'; exception when raise_exception then if sqlerrm<>'This pilot helper has reached its allowance. Your draft is safe.' then raise; end if; end;
end $$;
update public.pilot_rooms set is_open=false where id='midnight-signal';
do $$ begin
  begin perform public.pilot_claim_assist('90000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000001','midnight-signal','10000000-0000-4000-8000-000000000001','voice',repeat('a',64)); raise exception 'Closed-room replay allowed'; exception when raise_exception then if sqlerrm<>'Room is unavailable' then raise; end if; end;
end $$;
reset role;
rollback;
