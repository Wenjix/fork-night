-- Creation stays disabled until the deployed three-person generation proof passes.
create table public.pilot_room_templates (
  id text not null check (id ~ '^[a-z0-9-]{1,40}$'),
  version integer not null check(version>0),
  title text not null,
  description text not null,
  seed_title text not null,
  seed_byline text not null,
  panels jsonb not null check(jsonb_typeof(panels)='array' and jsonb_array_length(panels) between 1 and 3),
  source_ref text not null,
  enabled boolean not null default true,
  primary key(id,version)
);
insert into public.pilot_room_templates(id,version,title,description,seed_title,seed_byline,panels,source_ref) values
('midnight-signal',1,'The midnight signal','A lighthouse. A missing keeper. A story we make together.','The midnight signal','Room starter',
 '[{"imageUrl":"/art/midnight-story.webp#frame=0","caption":"At midnight, the lighthouse blinked for the first time in years."},{"imageUrl":"/art/midnight-story.webp#frame=1","caption":"Mira found a note beneath the lamp: someone out there was waiting."}]','prepared:midnight-signal:v1'),
('paper-moon',1,'Paper moon','Every window shows a different possible tomorrow.','A moon made of paper','Room starter',
 '[{"imageUrl":"/art/midnight-story.webp#frame=3","caption":"A paper moon caught in the branches above the street."},{"imageUrl":"/art/midnight-story.webp#frame=4","caption":"Every window below it showed a different possible tomorrow."}]','prepared:paper-moon:v1');

create table public.pilot_demo_limits (
  id boolean primary key default true check(id),
  creation_enabled boolean not null default false,
  campaign text not null default 'judges-2026-10',
  room_limit integer not null default 3 check(room_limit between 0 and 3),
  credit_limit integer not null default 36 check(credit_limit between 0 and 36),
  credits_per_room integer not null default 12 check(credits_per_room between 1 and 12),
  rooms_per_creator integer not null default 1 check(rooms_per_creator=1),
  guest_attempt_limit integer not null default 4 check(guest_attempt_limit between 1 and 4)
);
insert into public.pilot_demo_limits(id) values(true);
alter table public.pilot_rooms
  add column is_listed boolean not null default true,
  add column template_id text,
  add column template_version integer,
  add column revision bigint not null default 0,
  add foreign key(template_id,template_version) references public.pilot_room_templates(id,version),
  add check((template_id is null)=(template_version is null));
create table public.pilot_room_creations (
  maker_id uuid not null references public.pilot_profiles(id),
  request_id uuid not null,
  room_id text not null unique references public.pilot_rooms(id),
  campaign text not null,
  template_id text not null,
  template_version integer not null,
  title text not null,
  granted_credits integer not null check(granted_credits>0),
  created_at timestamptz not null default now(),
  primary key(maker_id,request_id),
  unique(maker_id,campaign),
  foreign key(template_id,template_version) references public.pilot_room_templates(id,version)
);
create table public.pilot_room_participants (
  room_id text not null references public.pilot_rooms(id),
  maker_id uuid not null references public.pilot_profiles(id),
  public_id uuid not null unique default gen_random_uuid(),
  display_name text not null,
  joined_at timestamptz not null default now(),
  primary key(room_id,maker_id)
);
alter table public.pilot_room_templates enable row level security;
alter table public.pilot_demo_limits enable row level security;
alter table public.pilot_room_creations enable row level security;
alter table public.pilot_room_participants enable row level security;
revoke all on public.pilot_room_templates,public.pilot_demo_limits,public.pilot_room_creations,public.pilot_room_participants from public,anon,authenticated;
grant select on public.pilot_room_templates to anon,authenticated;
create policy prepared_templates on public.pilot_room_templates for select to anon,authenticated using(enabled);
grant select on public.pilot_room_creations,public.pilot_room_participants to authenticated;
create policy own_room_receipts on public.pilot_room_creations for select to authenticated using(maker_id=(select auth.uid()));
create policy own_participation on public.pilot_room_participants for select to authenticated using(maker_id=(select auth.uid()));
grant all on public.pilot_room_templates,public.pilot_demo_limits,public.pilot_room_participants to service_role;
grant select,insert on public.pilot_room_creations to service_role;

create function public.pilot_protect_template() returns trigger language plpgsql set search_path='' as $$
begin
  if (to_jsonb(new)-'enabled') is distinct from (to_jsonb(old)-'enabled') then
    raise exception 'Prepared openings are versioned; insert a new version'; end if;
  return new;
end;
$$;
create trigger pilot_template_immutable before update on public.pilot_room_templates for each row execute function public.pilot_protect_template();

create function public.pilot_join_room(p_room_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); label text; p public.pilot_room_participants;
begin
  select display_name into label from public.pilot_profiles where id=actor;
  if not found then raise exception 'Choose your storyteller name first'; end if;
  if not exists(select 1 from public.pilot_rooms where id=p_room_id and is_open) then raise exception 'Room is unavailable'; end if;
  insert into public.pilot_room_participants(room_id,maker_id,display_name) values(p_room_id,actor,label)
    on conflict(room_id,maker_id) do nothing;
  select * into strict p from public.pilot_room_participants where room_id=p_room_id and maker_id=actor;
  return jsonb_build_object('id',p.public_id,'name',p.display_name,'joinedAt',p.joined_at);
end;
$$;

create function public.pilot_create_room(p_request_id uuid,p_template_id text,p_template_version integer,p_title text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); l public.pilot_demo_limits; b public.pilot_generation_budget;
  t public.pilot_room_templates; old public.pilot_room_creations; room text; root uuid; title text:=btrim(p_title);
  used_rooms integer; used_credits integer; committed bigint;
begin
  if actor is null or not exists(select 1 from public.pilot_profiles where id=actor) then raise exception 'Choose your storyteller name first'; end if;
  if p_request_id is null or title is null or char_length(title) not between 1 and 80 then raise exception 'Enter a room title of 1–80 characters'; end if;
  -- All generation/creation admission takes these locks in this order.
  select * into strict b from public.pilot_generation_budget where id for update;
  select * into strict l from public.pilot_demo_limits where id for update;
  select * into old from public.pilot_room_creations where maker_id=actor and request_id=p_request_id;
  if found then
    if old.template_id is distinct from p_template_id or old.template_version is distinct from p_template_version or old.title<>title then
      raise exception 'Request ID belongs to different room inputs'; end if;
    select id into strict root from public.pilot_moments where room_id=old.room_id and parent_id is null;
    return jsonb_build_object('roomId',old.room_id,'momentId',root);
  end if;
  if not l.creation_enabled then raise exception 'Room creation is paused. You can join an existing story'; end if;
  select * into t from public.pilot_room_templates where id=p_template_id and version=p_template_version and enabled;
  if not found then raise exception 'Choose an available prepared opening'; end if;
  if not b.enabled or b.execution_environment is null or public.pilot_spending_paused(true) then
    raise exception 'Generation is being checked. Join an existing story while new rooms are paused'; end if;
  select b.imported_expense_micro+coalesce((select sum(accounted_micro) from public.pilot_panel_accounting),0)
    +coalesce((select sum(held_micro) from public.pilot_jobs),0) into committed;
  if committed+1000000>b.cap_micro or b.imported_requests+(select coalesce(sum(panel_count),0) from public.pilot_jobs)>=b.max_requests then
    raise exception 'The demo generation allowance is full. Existing stories are still readable'; end if;
  if exists(select 1 from public.pilot_room_creations where maker_id=actor and campaign=l.campaign) then
    raise exception 'You have already created a room for this demo. Return to it or join another story'; end if;
  select count(*),coalesce(sum(granted_credits),0) into used_rooms,used_credits from public.pilot_room_creations where campaign=l.campaign;
  if used_rooms>=l.room_limit or used_credits+l.credits_per_room>l.credit_limit then
    raise exception 'All demo rooms have been created. Join an existing story'; end if;
  room:='room-'||gen_random_uuid()::text;
  insert into public.pilot_rooms(id,title,description,owner_id,is_open,is_listed,template_id,template_version)
    values(room,title,t.description,actor,true,false,t.id,t.version);
  insert into public.pilot_room_capacity(room_id,delivery_limit,guest_attempt_limit)
    values(room,l.credits_per_room,l.guest_attempt_limit);
  insert into public.pilot_moments(room_id,maker_label,title,panels,source_kind)
    values(room,t.seed_byline,t.seed_title,t.panels,'fixture') returning id into root;
  insert into public.pilot_room_creations(maker_id,request_id,room_id,campaign,template_id,template_version,title,granted_credits)
    values(actor,p_request_id,room,l.campaign,t.id,t.version,title,l.credits_per_room);
  perform public.pilot_join_room(room);
  return jsonb_build_object('roomId',room,'momentId',root);
end;
$$;

create function public.pilot_creation_status() returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('enabled',l.creation_enabled and b.enabled and b.execution_environment is not null,
    'creditsPerRoom',l.credits_per_room,'remainingRooms',greatest(0,least(l.room_limit-count(c.*),
      (l.credit_limit-coalesce(sum(c.granted_credits),0))/l.credits_per_room)),
    'ownRoomId',(select room_id from public.pilot_room_creations where maker_id=auth.uid() and campaign=l.campaign))
  from public.pilot_demo_limits l cross join public.pilot_generation_budget b
  left join public.pilot_room_creations c on c.campaign=l.campaign
  group by l.creation_enabled,b.enabled,b.execution_environment,l.credits_per_room,l.room_limit,l.credit_limit,l.campaign
$$;

create function public.pilot_bump_room_revision() returns trigger language plpgsql security definer set search_path='' as $$
begin
  update public.pilot_rooms set revision=revision+1 where id=new.room_id;
  return new;
end;
$$;
create trigger pilot_moment_revision after insert on public.pilot_moments for each row execute function public.pilot_bump_room_revision();
create trigger pilot_participant_revision after insert on public.pilot_room_participants for each row execute function public.pilot_bump_room_revision();

-- Saving an idea/contribution is a deliberate join. Browsing never joins a room.
create function public.pilot_join_on_contribution() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.maker_id is not null then
    insert into public.pilot_room_participants(room_id,maker_id,display_name)
      select new.room_id,id,display_name from public.pilot_profiles where id=new.maker_id
      on conflict(room_id,maker_id) do nothing;
  end if;
  return new;
end;
$$;
create trigger pilot_operation_join after insert on public.pilot_operations for each row execute function public.pilot_join_on_contribution();
create trigger pilot_idea_join after insert on public.pilot_ideas for each row execute function public.pilot_join_on_contribution();
create trigger pilot_publication_join after insert on public.pilot_moments for each row execute function public.pilot_join_on_contribution();

create function public.pilot_room_snapshot(p_room_id text) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('roomId',r.id,'title',r.title,'revision',r.revision,'credits',public.pilot_room_credits(r.id),
    'participants',coalesce((select jsonb_agg(jsonb_build_object('id',p.public_id,'name',p.display_name,'joinedAt',p.joined_at) order by p.joined_at,p.public_id)
      from public.pilot_room_participants p where p.room_id=r.id),'[]'::jsonb))
  from public.pilot_rooms r where r.id=p_room_id and r.is_open
$$;

revoke all on function public.pilot_protect_template(),public.pilot_join_room(text),public.pilot_create_room(uuid,text,integer,text),
  public.pilot_creation_status(),public.pilot_bump_room_revision(),public.pilot_join_on_contribution(),public.pilot_room_snapshot(text) from public,anon,authenticated;
grant execute on function public.pilot_join_room(text),public.pilot_create_room(uuid,text,integer,text) to authenticated;
grant execute on function public.pilot_creation_status(),public.pilot_room_snapshot(text) to anon,authenticated;
