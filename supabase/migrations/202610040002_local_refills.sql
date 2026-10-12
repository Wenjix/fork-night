-- Notes stay attributed where posted. A generated moment has its own maker;
-- source-note snapshots remain private operation context, not publication credit.
create or replace function public.pilot_publish(p_operation_id uuid) returns public.pilot_moments
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); operation public.pilot_operations; result public.pilot_moments; credit text;
begin
  if actor is null then raise exception 'Sign in as a guest first'; end if;
  select * into operation from public.pilot_operations where id=p_operation_id and maker_id=actor for update;
  if not found then raise exception 'Contribution is unavailable'; end if;
  if not exists(select 1 from public.pilot_rooms where id=operation.room_id and is_open) then raise exception 'Room is unavailable'; end if;
  if operation.status='published' then select * into strict result from public.pilot_moments where id=operation.published_moment_id; return result; end if;
  if operation.status<>'delivered' then raise exception 'A complete delivered result is required'; end if;
  select display_name into strict credit from public.pilot_profiles where id=actor;
  insert into public.pilot_moments(room_id,parent_id,maker_id,maker_label,title,panels,source_kind)
    values(operation.room_id,operation.parent_id,actor,credit,operation.title,operation.panels,operation.source_kind)
    returning * into result;
  update public.pilot_operations set status='published',published_moment_id=result.id where id=operation.id;
  return result;
end;
$$;

-- Server-only local operator action. No money, sponsor attribution or payout.
create table public.pilot_local_refills (
  request_id uuid primary key,
  room_id text not null references public.pilot_rooms(id),
  actor uuid not null references public.pilot_profiles(id),
  credits integer not null default 5 check(credits=5),
  created_at timestamptz not null default now()
);
alter table public.pilot_local_refills enable row level security;
revoke all on public.pilot_local_refills from anon, authenticated;
grant all on public.pilot_local_refills to service_role;

create function public.pilot_refill_room(p_request_id uuid,p_room_id text,p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.pilot_generation_budget; c public.pilot_room_capacity; prior public.pilot_local_refills; admitted integer;
begin
  if p_request_id is null or p_actor is null then raise exception 'Choose a guest and room first'; end if;
  if not exists(select 1 from public.pilot_profiles where id=p_actor) then raise exception 'Choose your guest name first'; end if;
  if not exists(select 1 from public.pilot_rooms where id=p_room_id and is_open) then raise exception 'Room is unavailable'; end if;
  -- Same first lock as generation admission, so refills cannot lose updates or
  -- race an admission. All increments and the retry receipt commit together.
  select * into strict b from public.pilot_generation_budget where id for update;
  select * into prior from public.pilot_local_refills where request_id=p_request_id;
  if found then
    if prior.room_id<>p_room_id or prior.actor<>p_actor then raise exception 'This refill belongs to another room or guest'; end if;
    return jsonb_build_object('added',5,'replayed',true,'credits',public.pilot_room_credits(p_room_id));
  end if;
  select * into c from public.pilot_room_capacity where room_id=p_room_id for update;
  if not found then raise exception 'This room has no generation allowance'; end if;
  if c.delivery_limit>995 then raise exception 'This room has reached its local test-credit limit'; end if;
  select b.imported_requests+coalesce(sum(panel_count),0) into admitted from public.pilot_jobs;
  update public.pilot_room_capacity set delivery_limit=delivery_limit+5,guest_attempt_limit=least(100,guest_attempt_limit+5) where room_id=p_room_id;
  -- Five room credits cover at most ten new images. Preserve every old request,
  -- expense, reservation, failure and the existing dollar ceiling/enabled state.
  update public.pilot_generation_budget set max_requests=least(10000,greatest(max_requests,admitted)+10) where id;
  insert into public.pilot_local_refills(request_id,room_id,actor) values(p_request_id,p_room_id,p_actor);
  return jsonb_build_object('added',5,'replayed',false,'credits',public.pilot_room_credits(p_room_id));
end;
$$;
revoke all on function public.pilot_refill_room(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.pilot_refill_room(uuid,text,uuid) to service_role;
