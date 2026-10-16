begin;
do $$
begin
  if (select count(*) from public.pilot_moments where room_id='kessler-ward')<>11 then raise exception 'Missing prepared Kessler moments'; end if;
  if exists(select 1 from public.pilot_moments where room_id='kessler-ward' and (maker_id is not null or maker_label<>'Prepared story' or source_kind<>'fixture')) then raise exception 'Invented creator provenance'; end if;
  if exists(select 1 from public.pilot_operations where room_id='kessler-ward') then raise exception 'Prepared story invented operations'; end if;
  if (select delivery_limit from public.pilot_room_capacity where room_id='kessler-ward')<>0 then raise exception 'Prepared story invented purchased credits'; end if;
end;
$$;
create temporary table saved_kessler as select * from public.pilot_moments where room_id='kessler-ward';
create temporary table saved_kessler_room as select * from public.pilot_rooms where id='kessler-ward';
insert into public.pilot_rooms(id,title,description,is_open) values('night-shift','The Night Shift','Old description',true) on conflict(id) do nothing;
\ir ../migrations/202610150003_kessler_room.sql
do $$
begin
  if exists((select * from saved_kessler except select * from public.pilot_moments where room_id='kessler-ward') union all (select * from public.pilot_moments where room_id='kessler-ward' except select * from saved_kessler)) then raise exception 'Retry changed prepared work'; end if;
  if exists(select * from saved_kessler_room except select * from public.pilot_rooms where id='kessler-ward') then raise exception 'Retry changed room or revision'; end if;
  if (select title from public.pilot_rooms where id='night-shift')<>'The Uncharted Star' then raise exception 'Harbor room display rename missing'; end if;
end;
$$;
set local role anon;
do $$
begin
  if (select count(*) from public.pilot_moments where room_id='kessler-ward')<>11 then raise exception 'Published Kessler sample is not publicly readable'; end if;
end;
$$;
reset role;
rollback;
