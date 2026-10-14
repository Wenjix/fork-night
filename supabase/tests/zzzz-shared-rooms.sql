reset role;
begin;
insert into auth.users(id) values('81000000-0000-4000-8000-000000000001'),('81000000-0000-4000-8000-000000000002'),('81000000-0000-4000-8000-000000000003'),('81000000-0000-4000-8000-000000000004');
update public.pilot_generation_budget set enabled=true,execution_environment='DEVELOPMENT',cap_micro=10000000,max_requests=100;
set role authenticated;
set request.jwt.claim.sub='81000000-0000-4000-8000-000000000001';
select public.pilot_set_display_name('Room maker');
do $$ begin
  begin perform public.pilot_create_room('82000000-0000-4000-8000-000000000001','paper-moon',1,'Our moon'); raise exception 'Creation enabled by default';
  exception when raise_exception then if sqlerrm<>'Room creation is paused. You can join an existing story' then raise; end if; end;
  begin insert into public.pilot_room_participants(room_id,maker_id,display_name) values('paper-moon',auth.uid(),'Forged'); raise exception 'Direct join write';
  exception when insufficient_privilege then null; end;
  begin update public.pilot_demo_limits set creation_enabled=true; raise exception 'Guest changed campaign';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
update public.pilot_demo_limits set creation_enabled=true;
set role authenticated;
select set_config('test.created',public.pilot_create_room('82000000-0000-4000-8000-000000000001','paper-moon',1,'Our moon')::text,true);
select set_config('test.created_room',current_setting('test.created')::jsonb->>'roomId',true);
select set_config('test.created_root',current_setting('test.created')::jsonb->>'momentId',true);
do $$ declare again jsonb; state jsonb; begin
  again:=public.pilot_create_room('82000000-0000-4000-8000-000000000001','paper-moon',1,'Our moon');
  if again<>current_setting('test.created')::jsonb then raise exception 'Retry made another room'; end if;
  state:=public.pilot_room_snapshot(current_setting('test.created_room'));
  if jsonb_array_length(state->'participants')<>1 or state#>>'{participants,0,name}'<>'Room maker' then raise exception 'Creator did not join'; end if;
  if (state#>>'{credits,available}')::int<>12 then raise exception 'Wrong room grant'; end if;
  if state->'participants' @> jsonb_build_array(jsonb_build_object('maker_id',auth.uid())) then raise exception 'Auth ID leaked in roster'; end if;
  begin perform public.pilot_create_room('82000000-0000-4000-8000-000000000001','midnight-signal',1,'Our moon'); raise exception 'Changed retry accepted';
  exception when raise_exception then if sqlerrm<>'Request ID belongs to different room inputs' then raise; end if; end;
  begin perform public.pilot_create_room(gen_random_uuid(),'paper-moon',1,'Second room'); raise exception 'Creator cap ignored';
  exception when raise_exception then if sqlerrm<>'You have already created a room for this demo. Return to it or join another story' then raise; end if; end;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.pilot_moments where room_id=current_setting('test.created_room'))<>1 then raise exception 'Copied live descendants'; end if;
  if not exists(select 1 from public.pilot_moments where id=current_setting('test.created_root')::uuid and parent_id is null and maker_id is null and maker_label='Room starter' and source_kind='fixture') then raise exception 'Starter attribution or ancestry changed'; end if;
  if exists(select 1 from public.pilot_rooms where id=current_setting('test.created_room') and is_listed) then raise exception 'New room appeared in directory'; end if;
  if (select count(*) from public.pilot_room_creations)<>1 then raise exception 'Duplicate grant'; end if;
  if (select imported_requests+imported_expense_micro from public.pilot_generation_budget where id)<>0 then raise exception 'Creation bought inference'; end if;
end $$;
set role anon;
do $$ declare state jsonb; begin
  state:=public.pilot_room_snapshot(current_setting('test.created_room'));
  if state is null or jsonb_array_length(state->'participants')<>1 then raise exception 'Share-link story was not public'; end if;
  if (select count(*) from public.pilot_moments where room_id=current_setting('test.created_room'))<>1 then raise exception 'Opening was not readable'; end if;
  if public.pilot_room_snapshot('missing-room') is not null then raise exception 'Missing room substituted'; end if;
  begin perform public.pilot_create_room(gen_random_uuid(),'paper-moon',1,'Anonymous'); raise exception 'Anonymous creation accepted'; exception when insufficient_privilege then null; end;
  begin perform * from public.pilot_room_participants; raise exception 'Raw participant identities public'; exception when insufficient_privilege then null; end;
end $$;
set role authenticated;
set request.jwt.claim.sub='81000000-0000-4000-8000-000000000002';
select public.pilot_set_display_name('Second storyteller');
select public.pilot_join_room(current_setting('test.created_room'));
select public.pilot_join_room(current_setting('test.created_room'));
select public.pilot_set_display_name('Changed label');
do $$ declare state jsonb; begin
  state:=public.pilot_room_snapshot(current_setting('test.created_room'));
  if jsonb_array_length(state->'participants')<>2 then raise exception 'Join retry duplicated participant'; end if;
  if not exists(select 1 from jsonb_array_elements(state->'participants') p where p->>'name'='Second storyteller') then raise exception 'Join byline was rewritten'; end if;
  if (select count(*) from public.pilot_room_participants)<>1 then raise exception 'Other raw participation leaked'; end if;
  if exists(select 1 from public.pilot_room_creations) then raise exception 'Other creator receipt leaked'; end if;
end $$;
select set_config('test.private',(public.pilot_save_continuation(gen_random_uuid(),current_setting('test.created_room'),current_setting('test.created_root')::uuid,'Private continuation','Private continuation','["A private thought."]')).id::text,true);
set request.jwt.claim.sub='81000000-0000-4000-8000-000000000001';
do $$ begin
  if exists(select 1 from public.pilot_operations where id=current_setting('test.private')::uuid) then raise exception 'Room owner saw another private draft'; end if;
end $$;
-- A disabled template rolls back all room/grant/participant writes.
reset role;
update public.pilot_room_templates set enabled=false where id='paper-moon';
set role authenticated;
set request.jwt.claim.sub='81000000-0000-4000-8000-000000000003';
select public.pilot_set_display_name('Third storyteller');
do $$ begin
  begin perform public.pilot_create_room(gen_random_uuid(),'paper-moon',1,'Unavailable opening'); raise exception 'Disabled opening accepted';
  exception when raise_exception then if sqlerrm<>'Choose an available prepared opening' then raise; end if; end;
end $$;
select public.pilot_create_room(gen_random_uuid(),'midnight-signal',1,'Third storyteller room');
set request.jwt.claim.sub='81000000-0000-4000-8000-000000000004';
select public.pilot_set_display_name('Fourth storyteller');
select public.pilot_create_room(gen_random_uuid(),'midnight-signal',1,'Fourth storyteller room');
set request.jwt.claim.sub='81000000-0000-4000-8000-000000000002';
do $$ begin
  begin perform public.pilot_create_room(gen_random_uuid(),'midnight-signal',1,'One too many'); raise exception 'Campaign exceeded three rooms';
  exception when raise_exception then if sqlerrm<>'All demo rooms have been created. Join an existing story' then raise; end if; end;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.pilot_room_creations)<>3 or (select sum(granted_credits) from public.pilot_room_creations)<>36 then raise exception 'Campaign grant total wrong'; end if;
end $$;
rollback;
