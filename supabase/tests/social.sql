reset role;
begin;
update public.pilot_rooms set is_open = true where id = 'midnight-signal';
insert into auth.users values ('80000000-0000-4000-8000-000000000001');
set local role authenticated;
set local request.jwt.claim.sub = '80000000-0000-4000-8000-000000000001';
select public.pilot_set_display_name('Idea maker');
select public.pilot_leave_idea('81000000-0000-4000-8000-000000000001','midnight-signal','10000000-0000-4000-8000-000000000001','What if the whale remembers?');
select public.pilot_leave_idea('81000000-0000-4000-8000-000000000001','midnight-signal','10000000-0000-4000-8000-000000000001',E' \tWhat if the whale remembers?\n');
select public.pilot_set_display_name('Renamed maker');
do $$ begin
  if (select count(*) from public.pilot_ideas) <> 1 then raise exception 'Duplicate idea'; end if;
  if (select maker_label from public.pilot_ideas limit 1) <> 'Idea maker' then raise exception 'Idea attribution changed'; end if;
  begin
    perform public.pilot_leave_idea('81000000-0000-4000-8000-000000000001','midnight-signal','10000000-0000-4000-8000-000000000001','Changed');
    raise exception 'Changed idempotency inputs accepted';
  exception when raise_exception then if sqlerrm <> 'Request ID belongs to a different idea' then raise; end if; end;
  begin
    perform public.pilot_leave_idea(gen_random_uuid(),'paper-moon','10000000-0000-4000-8000-000000000001','Wrong room');
    raise exception 'Foreign moment accepted';
  exception when raise_exception then if sqlerrm <> 'Choose a published moment in this room' then raise; end if; end;
  begin
    perform public.pilot_leave_idea(gen_random_uuid(),'midnight-signal','10000000-0000-4000-8000-000000000001',E' \t\r\n ');
    raise exception 'Blank idea accepted';
  exception when raise_exception then if sqlerrm <> 'Write an idea of 1–500 characters' then raise; end if; end;
  begin
    perform public.pilot_leave_idea(gen_random_uuid(),'midnight-signal','10000000-0000-4000-8000-000000000001',repeat('a',501));
    raise exception 'Oversized idea accepted';
  exception when raise_exception then if sqlerrm <> 'Write an idea of 1–500 characters' then raise; end if; end;
  begin update public.pilot_ideas set maker_label='Stolen'; raise exception 'Editable idea'; exception when insufficient_privilege then null; end;
  begin delete from public.pilot_ideas; raise exception 'Deletable idea'; exception when insufficient_privilege then null; end;
  begin insert into public.pilot_ideas(request_id,room_id,moment_id,maker_id,maker_label,body) values (gen_random_uuid(),'midnight-signal','10000000-0000-4000-8000-000000000001',auth.uid(),'Forged','Forged'); raise exception 'Direct insert accepted'; exception when insufficient_privilege then null; end;
end $$;
do $$ begin
  for i in 1..29 loop
    perform public.pilot_leave_idea(gen_random_uuid(),'midnight-signal','10000000-0000-4000-8000-000000000001','Idea ' || i);
  end loop;
  begin
    perform public.pilot_leave_idea(gen_random_uuid(),'midnight-signal','10000000-0000-4000-8000-000000000001','One too many');
    raise exception 'Idea quota bypassed';
  exception when raise_exception then if sqlerrm <> 'You have reached the 30-idea limit for this pilot room' then raise; end if; end;
  perform public.pilot_leave_idea('81000000-0000-4000-8000-000000000001','midnight-signal','10000000-0000-4000-8000-000000000001','What if the whale remembers?');
end $$;
set local role anon;
do $$ begin
  if (select count(*) from public.pilot_ideas) <> 30 then raise exception 'Public ideas not shared'; end if;
  begin perform public.pilot_leave_idea(gen_random_uuid(),'midnight-signal','10000000-0000-4000-8000-000000000001','Unidentified'); raise exception 'Unnamed write allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
update public.pilot_rooms set is_open = false where id='midnight-signal';
set local role authenticated;
do $$ begin
  if (select count(*) from public.pilot_ideas) <> 0 then raise exception 'Closed room ideas leaked'; end if;
  begin perform public.pilot_leave_idea('81000000-0000-4000-8000-000000000001','midnight-signal','10000000-0000-4000-8000-000000000001','What if the whale remembers?'); raise exception 'Closed room retry leaked'; exception when raise_exception then if sqlerrm <> 'Room is unavailable' then raise; end if; end;
end $$;
reset role;
rollback;
