-- Public pilot persistence foundation. This does not dispatch generation or settle money.
-- Actor identity comes from verified Supabase Auth claims, never a request's maker ID.
create table public.pilot_profiles (
  id uuid primary key references auth.users(id),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 60),
  created_at timestamptz not null default now()
);

create table public.pilot_rooms (
  id text primary key check (id ~ '^[a-z0-9-]{1,60}$'),
  title text not null,
  description text not null,
  owner_id uuid references public.pilot_profiles(id),
  is_open boolean not null default false,
  funding_policy text not null default 'sponsored-generation' check (funding_policy = 'sponsored-generation')
);

create table public.pilot_moments (
  id uuid primary key default gen_random_uuid(),
  room_id text not null references public.pilot_rooms(id),
  parent_id uuid references public.pilot_moments(id),
  maker_id uuid references public.pilot_profiles(id),
  maker_label text not null,
  title text not null check (char_length(title) between 1 and 160),
  panels jsonb not null check (jsonb_typeof(panels) = 'array' and jsonb_array_length(panels) = 2),
  source_kind text not null check (source_kind in ('fixture', 'openai')),
  created_at timestamptz not null default now(),
  unique (id, room_id),
  foreign key (parent_id, room_id) references public.pilot_moments(id, room_id)
);

create table public.pilot_operations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  maker_id uuid not null references public.pilot_profiles(id),
  room_id text not null references public.pilot_rooms(id),
  parent_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  prompt text not null check (char_length(btrim(prompt)) between 1 and 2000),
  status text not null default 'draft' check (status in ('draft', 'dispatching', 'uncertain', 'delivered', 'failed', 'published', 'discarded')),
  panels jsonb,
  source_kind text check (source_kind in ('fixture', 'openai')),
  published_moment_id uuid unique references public.pilot_moments(id),
  created_at timestamptz not null default now(),
  unique (maker_id, request_id),
  foreign key (parent_id, room_id) references public.pilot_moments(id, room_id),
  check (status not in ('delivered', 'published', 'discarded') or
    (panels is not null and jsonb_typeof(panels) = 'array' and jsonb_array_length(panels) = 2 and source_kind is not null)),
  check ((status = 'published') = (published_moment_id is not null))
);

create index pilot_moments_room on public.pilot_moments(room_id, created_at);
create index pilot_operations_maker on public.pilot_operations(maker_id, created_at);

alter table public.pilot_profiles enable row level security;
alter table public.pilot_rooms enable row level security;
alter table public.pilot_moments enable row level security;
alter table public.pilot_operations enable row level security;

-- Public authorship uses the immutable maker_label on published moments.
-- Other guests' profile records and unpublished drafts are not public projections.
create policy profile_self on public.pilot_profiles for select to authenticated using (id = (select auth.uid()));
create policy open_rooms on public.pilot_rooms for select to anon, authenticated using (is_open);
create policy open_moments on public.pilot_moments for select to anon, authenticated using (
  exists (select 1 from public.pilot_rooms r where r.id = room_id and r.is_open)
);
create policy own_operations on public.pilot_operations for select to authenticated using (
  maker_id = (select auth.uid()) and exists (select 1 from public.pilot_rooms r where r.id = room_id and r.is_open)
);

revoke all on public.pilot_profiles, public.pilot_rooms, public.pilot_moments, public.pilot_operations from anon, authenticated;
grant select on public.pilot_rooms, public.pilot_moments to anon, authenticated;
grant select on public.pilot_profiles, public.pilot_operations to authenticated;
grant all on public.pilot_profiles, public.pilot_rooms, public.pilot_moments, public.pilot_operations to service_role;

create function public.pilot_set_display_name(p_name text) returns public.pilot_profiles
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); result public.pilot_profiles;
begin
  if actor is null then raise exception 'Sign in as a guest first'; end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 60 then raise exception 'Enter a name of 1–60 characters'; end if;
  insert into public.pilot_profiles(id, display_name) values (actor, btrim(p_name))
    on conflict (id) do update set display_name = excluded.display_name returning * into result;
  return result;
end;
$$;

create function public.pilot_save_draft(p_request_id uuid, p_room_id text, p_parent_id uuid, p_title text, p_prompt text)
returns public.pilot_operations language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); result public.pilot_operations;
begin
  if actor is null or not exists (select 1 from public.pilot_profiles where id = actor) then raise exception 'Choose your guest name first'; end if;
  if p_request_id is null or p_title is null or p_prompt is null or char_length(btrim(p_title)) not between 1 and 160 or char_length(btrim(p_prompt)) not between 1 and 2000 then
    raise exception 'Invalid draft';
  end if;
  if not exists (select 1 from public.pilot_rooms where id = p_room_id and is_open) then raise exception 'Room is unavailable'; end if;
  if not exists (select 1 from public.pilot_moments where id = p_parent_id and room_id = p_room_id) then raise exception 'Choose a published moment in this room'; end if;
  insert into public.pilot_operations(request_id, maker_id, room_id, parent_id, title, prompt)
    values (p_request_id, actor, p_room_id, p_parent_id, btrim(p_title), btrim(p_prompt))
    on conflict (maker_id, request_id) do nothing;
  select * into strict result from public.pilot_operations where maker_id = actor and request_id = p_request_id;
  if result.room_id <> p_room_id or result.parent_id <> p_parent_id or result.title <> btrim(p_title) or result.prompt <> btrim(p_prompt) then
    raise exception 'Request ID belongs to different inputs';
  end if;
  return result;
end;
$$;

create function public.pilot_publish(p_operation_id uuid) returns public.pilot_moments
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); operation public.pilot_operations; result public.pilot_moments; credit text;
begin
  if actor is null then raise exception 'Sign in as a guest first'; end if;
  select * into operation from public.pilot_operations where id = p_operation_id and maker_id = actor for update;
  if not found then raise exception 'Contribution is unavailable'; end if;
  if not exists (select 1 from public.pilot_rooms where id = operation.room_id and is_open) then raise exception 'Room is unavailable'; end if;
  if operation.status = 'published' then
    select * into strict result from public.pilot_moments where id = operation.published_moment_id;
    return result;
  end if;
  if operation.status <> 'delivered' then raise exception 'A complete delivered result is required'; end if;
  select display_name into strict credit from public.pilot_profiles where id = actor;
  insert into public.pilot_moments(room_id, parent_id, maker_id, maker_label, title, panels, source_kind)
    values (operation.room_id, operation.parent_id, actor, credit, operation.title, operation.panels, operation.source_kind)
    returning * into result;
  update public.pilot_operations set status = 'published', published_moment_id = result.id where id = operation.id;
  return result;
end;
$$;

-- Service-role delivery is intentionally not exposed as a guest RPC. It will need
-- artifact validation, real admission/expense accounting and durable worker proof.
revoke all on function public.pilot_set_display_name(text) from public, anon;
revoke all on function public.pilot_save_draft(uuid, text, uuid, text, text) from public, anon;
revoke all on function public.pilot_publish(uuid) from public, anon;
grant execute on function public.pilot_set_display_name(text) to authenticated;
grant execute on function public.pilot_save_draft(uuid, text, uuid, text, text) to authenticated;
grant execute on function public.pilot_publish(uuid) to authenticated;
