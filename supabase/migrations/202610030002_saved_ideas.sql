-- Short attributed ideas on published moments. No generation or credit mutation.
create table public.pilot_ideas (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  room_id text not null references public.pilot_rooms(id),
  moment_id uuid not null,
  maker_id uuid not null references public.pilot_profiles(id),
  maker_label text not null,
  body text not null check (char_length(btrim(body)) between 1 and 500),
  created_at timestamptz not null default now(),
  unique (maker_id, request_id),
  foreign key (moment_id, room_id) references public.pilot_moments(id, room_id)
);
create index pilot_ideas_moment on public.pilot_ideas(moment_id, created_at desc, id desc);
create index pilot_ideas_maker_room on public.pilot_ideas(maker_id, room_id);
alter table public.pilot_ideas enable row level security;
create policy open_ideas on public.pilot_ideas for select to anon, authenticated using (
  exists (select 1 from public.pilot_rooms r where r.id = room_id and r.is_open)
);
revoke all on public.pilot_ideas from anon, authenticated;
grant select on public.pilot_ideas to anon, authenticated;
grant all on public.pilot_ideas to service_role;

create function public.pilot_leave_idea(p_request_id uuid, p_room_id text, p_moment_id uuid, p_body text)
returns public.pilot_ideas language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); label text; result public.pilot_ideas;
begin
  if actor is null then raise exception 'Choose your guest name first'; end if;
  -- The profile lock serializes quota admission and repeated requests by one guest.
  select display_name into label from public.pilot_profiles where id = actor for update;
  if not found then raise exception 'Choose your guest name first'; end if;
  if p_request_id is null or p_body is null or char_length(btrim(p_body)) not between 1 and 500 then
    raise exception 'Write an idea of 1–500 characters';
  end if;
  if not exists (select 1 from public.pilot_rooms where id = p_room_id and is_open) then
    raise exception 'Room is unavailable';
  end if;
  if not exists (select 1 from public.pilot_moments where id = p_moment_id and room_id = p_room_id) then
    raise exception 'Choose a published moment in this room';
  end if;
  select * into result from public.pilot_ideas where maker_id = actor and request_id = p_request_id;
  if found then
    if result.room_id <> p_room_id or result.moment_id <> p_moment_id or result.body <> btrim(p_body) then
      raise exception 'Request ID belongs to a different idea';
    end if;
    return result;
  end if;
  if (select count(*) from public.pilot_ideas where maker_id = actor and room_id = p_room_id) >= 30 then
    raise exception 'You have reached the 30-idea limit for this pilot room';
  end if;
  insert into public.pilot_ideas(request_id, room_id, moment_id, maker_id, maker_label, body)
    values (p_request_id, p_room_id, p_moment_id, actor, label, btrim(p_body)) returning * into result;
  return result;
end;
$$;
revoke all on function public.pilot_leave_idea(uuid, text, uuid, text) from public, anon;
grant execute on function public.pilot_leave_idea(uuid, text, uuid, text) to authenticated;
