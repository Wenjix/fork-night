-- Keep idea recognition through generation and publication. This does not
-- create payment rights or add an idea author to the maker payout graph.
alter table public.pilot_operations add column source_idea_id uuid references public.pilot_ideas(id) on delete set null;
alter table public.pilot_operations add column source_idea_label text;
alter table public.pilot_operations add column source_idea_body text;
alter table public.pilot_moments add column source_idea_id uuid references public.pilot_ideas(id) on delete set null;
alter table public.pilot_moments add column source_idea_label text;
alter table public.pilot_moments add column source_idea_body text;

drop function public.pilot_save_continuation(uuid,text,uuid,text,text,jsonb);
create function public.pilot_save_continuation(p_request_id uuid,p_room_id text,p_parent_id uuid,p_title text,p_prompt text,p_captions jsonb,p_idea_id uuid default null)
returns public.pilot_operations language plpgsql security definer set search_path='' as $$
declare result public.pilot_operations; idea public.pilot_ideas;
begin
  if p_captions is null or jsonb_typeof(p_captions)<>'array' or jsonb_array_length(p_captions)<>2 then raise exception 'Write two story beats'; end if;
  if exists(select 1 from jsonb_array_elements(p_captions) c where jsonb_typeof(c)<>'string' or char_length(btrim(c#>>'{}')) not between 1 and 500) then raise exception 'Each story beat needs 1–500 characters'; end if;
  if p_idea_id is not null then
    select * into idea from public.pilot_ideas where id=p_idea_id and room_id=p_room_id and moment_id=p_parent_id;
    if not found then raise exception 'Choose an idea on the source moment'; end if;
  end if;
  result:=public.pilot_save_draft(p_request_id,p_room_id,p_parent_id,p_title,p_prompt);
  select * into strict result from public.pilot_operations where id=result.id for update;
  if result.requested_captions is not null then
    if result.requested_captions<>p_captions then raise exception 'Request ID belongs to different story beats'; end if;
    if result.source_idea_id is distinct from p_idea_id then raise exception 'Request ID belongs to a different idea'; end if;
  else
    if result.status<>'draft' then raise exception 'This contribution is already in progress'; end if;
    update public.pilot_operations set requested_captions=p_captions,source_idea_id=idea.id,source_idea_label=idea.maker_label,source_idea_body=idea.body
      where id=result.id returning * into result;
  end if;
  return result;
end;
$$;
revoke all on function public.pilot_save_continuation(uuid,text,uuid,text,text,jsonb,uuid) from public,anon;
grant execute on function public.pilot_save_continuation(uuid,text,uuid,text,text,jsonb,uuid) to authenticated;

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
  insert into public.pilot_moments(room_id,parent_id,maker_id,maker_label,title,panels,source_kind,source_idea_id,source_idea_label,source_idea_body)
    values(operation.room_id,operation.parent_id,actor,credit,operation.title,operation.panels,operation.source_kind,operation.source_idea_id,operation.source_idea_label,operation.source_idea_body)
    returning * into result;
  update public.pilot_operations set status='published',published_moment_id=result.id where id=operation.id;
  return result;
end;
$$;

-- Separate from paid image capacity. A claim is consumed even on a failed or
-- uncertain provider response. Browser STT tokens are never persisted here.
create table public.pilot_assist_limits (
  id boolean primary key default true check(id),
  voice_enabled boolean not null default false,
  shape_enabled boolean not null default false,
  voice_token_limit integer not null default 0 check(voice_token_limit between 0 and 10000),
  shape_request_limit integer not null default 0 check(shape_request_limit between 0 and 10000),
  guest_voice_limit integer not null default 5 check(guest_voice_limit between 0 and 100),
  guest_shape_limit integer not null default 10 check(guest_shape_limit between 0 and 100)
);
insert into public.pilot_assist_limits(id) values(true);
create table public.pilot_assist_requests (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  maker_id uuid not null references public.pilot_profiles(id),
  room_id text not null references public.pilot_rooms(id),
  parent_id uuid not null references public.pilot_moments(id),
  kind text not null check(kind in ('voice','shape')),
  input_digest text not null check(input_digest ~ '^[a-f0-9]{64}$'),
  state text not null default 'pending' check(state in ('pending','complete','failed')),
  result jsonb,
  usage jsonb,
  provider_request_id text,
  created_at timestamptz not null default now(),
  unique(maker_id,request_id)
);
alter table public.pilot_assist_limits enable row level security;
alter table public.pilot_assist_requests enable row level security;
revoke all on public.pilot_assist_limits,public.pilot_assist_requests from anon,authenticated;
grant all on public.pilot_assist_limits,public.pilot_assist_requests to service_role;
create index pilot_assist_maker on public.pilot_assist_requests(maker_id,kind);

create function public.pilot_claim_assist(p_actor uuid,p_request_id uuid,p_room_id text,p_parent_id uuid,p_kind text,p_digest text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare lim public.pilot_assist_limits; existing public.pilot_assist_requests; total_limit integer; guest_limit integer;
begin
  if not exists(select 1 from public.pilot_profiles where id=p_actor) then raise exception 'Choose your guest name first'; end if;
  if not exists(select 1 from public.pilot_rooms where id=p_room_id and is_open) then raise exception 'Room is unavailable'; end if;
  if not exists(select 1 from public.pilot_moments where id=p_parent_id and room_id=p_room_id) then raise exception 'Choose a published source moment'; end if;
  if p_request_id is null or p_kind is null or p_kind not in ('voice','shape') or p_digest is null or p_digest !~ '^[a-f0-9]{64}$' then raise exception 'Invalid assistance request'; end if;
  select * into strict lim from public.pilot_assist_limits where id for update;
  select * into existing from public.pilot_assist_requests where maker_id=p_actor and request_id=p_request_id;
  if found then
    if existing.room_id<>p_room_id or existing.parent_id<>p_parent_id or existing.kind<>p_kind or existing.input_digest<>p_digest then raise exception 'Request ID belongs to different inputs'; end if;
    return jsonb_build_object('claimed',false,'request',to_jsonb(existing));
  end if;
  if (p_kind='voice' and not lim.voice_enabled) or (p_kind='shape' and not lim.shape_enabled) then raise exception 'This helper is being set up. You can still write your two beats.'; end if;
  total_limit:=case when p_kind='voice' then lim.voice_token_limit else lim.shape_request_limit end;
  guest_limit:=case when p_kind='voice' then lim.guest_voice_limit else lim.guest_shape_limit end;
  if (select count(*) from public.pilot_assist_requests where kind=p_kind)>=total_limit then raise exception 'This pilot helper has reached its allowance. Your draft is safe.'; end if;
  if (select count(*) from public.pilot_assist_requests where kind=p_kind and maker_id=p_actor)>=guest_limit then raise exception 'You have used your helper turns. You can keep editing by hand.'; end if;
  insert into public.pilot_assist_requests(request_id,maker_id,room_id,parent_id,kind,input_digest)
    values(p_request_id,p_actor,p_room_id,p_parent_id,p_kind,p_digest) returning * into existing;
  return jsonb_build_object('claimed',true,'request',to_jsonb(existing));
end;
$$;
revoke all on function public.pilot_claim_assist(uuid,uuid,text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.pilot_claim_assist(uuid,uuid,text,uuid,text,text) to service_role;
