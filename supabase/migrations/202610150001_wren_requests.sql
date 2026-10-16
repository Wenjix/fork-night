-- A private, bounded Wren request belongs to its human requester. Generation and
-- publication continue through the existing pilot ledger and privacy policies.
create table public.pilot_wren_limits (
  id boolean primary key default true check(id),
  room_id text not null default 'kessler-ward' check(room_id='kessler-ward'),
  enabled boolean not null default false,
  request_limit integer not null default 12 check(request_limit between 0 and 36),
  maker_limit integer not null default 3 check(maker_limit between 0 and 4)
);
insert into public.pilot_wren_limits(id) values(true);
create table public.pilot_wren_requests (
  id uuid primary key,
  maker_id uuid not null references public.pilot_profiles(id),
  room_id text not null references public.pilot_rooms(id) check(room_id='kessler-ward'),
  parent_id uuid not null references public.pilot_moments(id),
  brief text not null check(char_length(btrim(brief)) between 1 and 500),
  input_digest text not null check(input_digest ~ '^[a-f0-9]{64}$'),
  environment text not null check(environment in ('PRODUCTION','DEVELOPMENT','STAGING','PREVIEW')),
  state text not null default 'pending' check(state in ('pending','planning','funding','generating','ready','published','discarded','blocked','failed')),
  plan jsonb,
  operation_id uuid unique references public.pilot_operations(id),
  claim_token uuid,
  lease_until timestamptz,
  run_id text,
  dispatch_version integer not null default 1 check(dispatch_version between 1 and 8),
  dispatch_token uuid,
  dispatch_until timestamptz,
  next_check_at timestamptz not null default now(),
  message text not null default 'Wren is waiting to prepare your private next scene.',
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index pilot_wren_one_active_maker on public.pilot_wren_requests(maker_id)
  where state in ('pending','planning','funding','generating');
create index pilot_wren_due on public.pilot_wren_requests(environment,next_check_at)
  where state in ('pending','planning','funding','generating','ready');
alter table public.pilot_wren_limits enable row level security;
alter table public.pilot_wren_requests enable row level security;
revoke all on public.pilot_wren_limits,public.pilot_wren_requests from public,anon,authenticated;
grant all on public.pilot_wren_limits,public.pilot_wren_requests to service_role;
grant select(id,maker_id,room_id,parent_id,brief,state,operation_id,message,created_at,updated_at) on public.pilot_wren_requests to authenticated;
create policy own_wren_requests on public.pilot_wren_requests for select to authenticated using(maker_id=(select auth.uid()));

create function public.pilot_request_wren(p_request_id uuid,p_room_id text,p_parent_id uuid,p_brief text)
returns public.pilot_wren_requests language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); r public.pilot_wren_requests; b public.pilot_generation_budget;
  l public.pilot_wren_limits; thought text:=btrim(p_brief); ancestor uuid; depth integer:=0;
begin
  if actor is null or not exists(select 1 from public.pilot_profiles where id=actor) then raise exception 'Choose your storyteller name first'; end if;
  if p_request_id is null or p_room_id is distinct from 'kessler-ward' or p_parent_id is null or thought is null or char_length(thought) not between 1 and 500 then raise exception 'Choose a Kessler Ward moment and write a brief of 1–500 characters'; end if;
  select * into strict b from public.pilot_generation_budget where id for update;
  select * into r from public.pilot_wren_requests where id=p_request_id;
  if found then
    if r.maker_id<>actor then raise exception 'That private request is unavailable'; end if;
    if r.room_id<>p_room_id or r.parent_id<>p_parent_id or r.brief<>thought then raise exception 'Request ID belongs to different inputs'; end if;
    return r;
  end if;
  select * into strict l from public.pilot_wren_limits where id for update;
  if not l.enabled or not b.enabled or b.execution_environment is null then raise exception 'Wren is being set up. You can keep writing your own continuation'; end if;
  if not exists(select 1 from public.pilot_rooms where id=p_room_id and is_open) then raise exception 'Room is unavailable'; end if;
  if exists(select 1 from public.pilot_wren_requests where maker_id=actor and state in ('pending','planning','funding','generating')) then raise exception 'Finish or check your current Wren request first'; end if;
  if exists(select 1 from public.pilot_operations where maker_id=actor and status in ('queued','dispatching','uncertain','delivered')) then raise exception 'Finish or check your current private continuation first'; end if;
  if (select count(*) from public.pilot_wren_requests)>=l.request_limit then raise exception 'Wren has reached this demonstration’s request allowance'; end if;
  if (select count(*) from public.pilot_wren_requests where maker_id=actor)>=l.maker_limit then raise exception 'You have used your Wren requests for this demonstration'; end if;
  if public.pilot_spending_paused(true) then raise exception 'Generation is paused while a previous result is checked'; end if;
  if b.imported_expense_micro+coalesce((select sum(accounted_micro) from public.pilot_panel_accounting),0)+
    coalesce((select sum(held_micro) from public.pilot_jobs),0)+1000000>b.cap_micro or
    b.imported_requests+coalesce((select sum(panel_count) from public.pilot_jobs),0)>=b.max_requests then
    raise exception 'The generation allowance has been used for this rehearsal'; end if;
  ancestor:=p_parent_id;
  while ancestor is not null loop
    depth:=depth+1;
    if depth>12 then raise exception 'Choose an earlier moment in this story'; end if;
    select parent_id into ancestor from public.pilot_moments where id=ancestor and room_id=p_room_id;
    if not found then raise exception 'Choose a published moment in Kessler Ward'; end if;
  end loop;
  insert into public.pilot_wren_requests(id,maker_id,room_id,parent_id,brief,input_digest,environment)
    values(p_request_id,actor,p_room_id,p_parent_id,thought,
      encode(sha256(convert_to(jsonb_build_array(p_room_id,p_parent_id,thought)::text,'UTF8')),'hex'),b.execution_environment) returning * into r;
  return r;
end;
$$;

create function public.pilot_claim_wren_request(p_request_id uuid,p_claim_token uuid,p_environment text,p_run_id text,p_version integer)
returns public.pilot_wren_requests language plpgsql security definer set search_path='' as $$
declare r public.pilot_wren_requests;
begin
  select * into r from public.pilot_wren_requests where id=p_request_id for update;
  if not found or r.environment<>p_environment or r.dispatch_version<>p_version or r.state not in ('pending','planning','funding') or
    (r.lease_until is not null and r.lease_until>clock_timestamp()) or (r.run_id is not null and r.run_id<>p_run_id) then return null; end if;
  if p_claim_token is null or coalesce(p_run_id,'')='' or p_environment is distinct from (select execution_environment from public.pilot_generation_budget where id) then raise exception 'The Wren execution is unavailable'; end if;
  if not (select enabled from public.pilot_wren_limits where id) then raise exception 'Wren is paused'; end if;
  update public.pilot_wren_requests set claim_token=p_claim_token,lease_until=clock_timestamp()+interval '5 minutes',run_id=p_run_id,
    state=case when plan is null then 'planning' else 'funding' end,
    message=case when plan is null then 'Wren is shaping your private next scene.' else 'Wren is checking room credits.' end,
    next_check_at=clock_timestamp()+interval '1 minute',updated_at=clock_timestamp() where id=r.id returning * into r;
  return r;
end;
$$;

create function public.pilot_save_wren_plan(p_request_id uuid,p_claim_token uuid,p_plan jsonb)
returns public.pilot_wren_requests language plpgsql security definer set search_path='' as $$
declare r public.pilot_wren_requests;
begin
  select * into r from public.pilot_wren_requests where id=p_request_id for update;
  if not found or r.claim_token is distinct from p_claim_token or r.lease_until is null or r.lease_until<=clock_timestamp() or r.state not in ('planning','funding') then raise exception 'The Wren request claim expired'; end if;
  if jsonb_typeof(p_plan) is distinct from 'object' or jsonb_typeof(p_plan->'title') is distinct from 'string' or jsonb_typeof(p_plan->'caption') is distinct from 'string' or
    char_length(btrim(p_plan->>'title')) not between 1 and 160 or char_length(btrim(p_plan->>'caption')) not between 1 and 500 then raise exception 'Wren could not save a complete next scene'; end if;
  if r.plan is not null and r.plan<>p_plan then raise exception 'This Wren request already has a different plan'; end if;
  update public.pilot_wren_requests set plan=p_plan,state='funding',message='Wren is checking room credits.',updated_at=clock_timestamp() where id=r.id returning * into r;
  return r;
end;
$$;

create function public.pilot_admit_wren(p_request_id uuid,p_claim_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.pilot_wren_requests; o public.pilot_operations; j jsonb; previous_claim text:=current_setting('request.jwt.claim.sub',true);
begin
  -- Preserve the established global-lock order and every ordinary generation cap.
  perform 1 from public.pilot_generation_budget where id for update;
  select * into r from public.pilot_wren_requests where id=p_request_id for update;
  if not found or r.claim_token is distinct from p_claim_token or r.lease_until is null or r.lease_until<=clock_timestamp() or r.state not in ('funding','generating') or r.plan is null then raise exception 'The Wren request claim expired'; end if;
  if r.environment is distinct from (select execution_environment from public.pilot_generation_budget where id) then raise exception 'The Wren execution environment changed'; end if;
  if not (select enabled from public.pilot_wren_limits where id) then raise exception 'Wren is paused'; end if;
  perform set_config('request.jwt.claim.sub',r.maker_id::text,true);
  begin
    o:=public.pilot_save_continuation(r.id,r.room_id,r.parent_id,r.plan->>'title',
      'Wren-assisted next scene. Keep the chosen story, characters and visual style. Requester brief: '||r.brief,
      jsonb_build_array(r.plan->>'caption'));
    update public.pilot_wren_requests set operation_id=o.id where id=r.id;
    j:=public.pilot_request_generation(o.id);
  exception when others then
    perform set_config('request.jwt.claim.sub',coalesce(previous_claim,''),true);
    raise;
  end;
  perform set_config('request.jwt.claim.sub',coalesce(previous_claim,''),true);
  update public.pilot_wren_requests set operation_id=o.id,state='generating',message='Your private next scene is being illustrated.',
    next_check_at=clock_timestamp()+interval '1 minute',updated_at=clock_timestamp() where id=r.id;
  return jsonb_build_object('operation_id',o.id,'dispatch_version',(j->>'dispatch_version')::int);
end;
$$;

create function public.pilot_finish_wren_request(p_request_id uuid,p_claim_token uuid,p_state text,p_message text)
returns public.pilot_wren_requests language plpgsql security definer set search_path='' as $$
declare r public.pilot_wren_requests;
begin
  select * into r from public.pilot_wren_requests where id=p_request_id for update;
  if not found or r.claim_token is distinct from p_claim_token or r.lease_until is null or r.lease_until<=clock_timestamp() or r.state not in ('planning','funding') then raise exception 'The Wren request claim expired'; end if;
  if p_state not in ('blocked','failed','funding') or p_message is null then raise exception 'Invalid Wren outcome'; end if;
  update public.pilot_wren_requests set state=p_state,message=left(p_message,240),lease_until=clock_timestamp(),
    next_check_at=clock_timestamp()+interval '1 minute',updated_at=clock_timestamp() where id=r.id returning * into r;
  return r;
end;
$$;

create function public.pilot_observe_wren_request(p_request_id uuid)
returns public.pilot_wren_requests language plpgsql security definer set search_path='' as $$
declare r public.pilot_wren_requests; o public.pilot_operations; outcome text;
begin
  select * into r from public.pilot_wren_requests where id=p_request_id for update;
  if not found then raise exception 'That private request is unavailable'; end if;
  if r.operation_id is not null then
    select * into strict o from public.pilot_operations where id=r.operation_id and maker_id=r.maker_id and room_id=r.room_id and parent_id=r.parent_id;
    outcome:=case o.status when 'delivered' then 'ready' when 'published' then 'published' when 'discarded' then 'discarded' when 'failed' then 'failed' else 'generating' end;
    update public.pilot_wren_requests set state=outcome,message=case outcome
      when 'ready' then 'Your private preview is ready. You choose whether to publish it.'
      when 'published' then 'You published this Wren-assisted continuation.' when 'discarded' then 'You discarded this private preview.'
      when 'failed' then 'The image could not be prepared. Check your saved continuation.' else 'Your private next scene is being illustrated or checked.' end,
      next_check_at=clock_timestamp()+interval '1 minute',updated_at=case when state<>outcome then clock_timestamp() else updated_at end where id=r.id returning * into r;
  end if;
  return r;
end;
$$;
create function public.pilot_refresh_wren_request(p_request_id uuid)
returns public.pilot_wren_requests language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not exists(select 1 from public.pilot_wren_requests where id=p_request_id and maker_id=auth.uid()) then raise exception 'That private request is unavailable'; end if;
  return public.pilot_observe_wren_request(p_request_id);
end;
$$;

create function public.pilot_lease_wren_dispatch(p_request_id uuid,p_version integer,p_environment text,p_token uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if p_token is null then return false; end if;
  update public.pilot_wren_requests set dispatch_token=p_token,dispatch_until=clock_timestamp()+interval '1 minute'
    where id=p_request_id and dispatch_version=p_version and environment=p_environment and run_id is null
      and state in ('pending','planning','funding') and (dispatch_until is null or dispatch_until<clock_timestamp());
  return found;
end;
$$;
create function public.pilot_ack_wren_dispatch(p_request_id uuid,p_version integer,p_token uuid,p_run_id text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  update public.pilot_wren_requests set run_id=p_run_id,next_check_at=clock_timestamp()+interval '1 minute'
    where id=p_request_id and dispatch_version=p_version and dispatch_token=p_token and (run_id is null or run_id=p_run_id);
  return found;
end;
$$;
create function public.pilot_retry_wren_request(p_request_id uuid,p_version integer,p_run_id text,p_status text)
returns public.pilot_wren_requests language plpgsql security definer set search_path='' as $$
declare r public.pilot_wren_requests;
begin
  select * into strict r from public.pilot_wren_requests where id=p_request_id for update;
  if r.dispatch_version<>p_version or r.run_id is distinct from p_run_id or r.state not in ('pending','planning','funding') or
    r.lease_until>clock_timestamp() or p_status not in ('COMPLETED','CANCELED','FAILED','CRASHED','SYSTEM_FAILURE','EXPIRED','TIMED_OUT') then return r; end if;
  if r.dispatch_version>=8 then
    update public.pilot_wren_requests set state='blocked',message='This saved request needs an operator check. No new payment or image request was made.',updated_at=clock_timestamp() where id=r.id returning * into r;
  else
    update public.pilot_wren_requests set dispatch_version=dispatch_version+1,run_id=null,claim_token=null,lease_until=null,
      dispatch_token=null,dispatch_until=null,next_check_at=clock_timestamp(),updated_at=clock_timestamp() where id=r.id returning * into r;
  end if;
  return r;
end;
$$;

revoke all on function public.pilot_request_wren(uuid,text,uuid,text),public.pilot_refresh_wren_request(uuid) from public,anon;
grant execute on function public.pilot_request_wren(uuid,text,uuid,text),public.pilot_refresh_wren_request(uuid) to authenticated;
revoke all on function public.pilot_claim_wren_request(uuid,uuid,text,text,integer),public.pilot_save_wren_plan(uuid,uuid,jsonb),public.pilot_admit_wren(uuid,uuid),
  public.pilot_finish_wren_request(uuid,uuid,text,text),public.pilot_observe_wren_request(uuid),public.pilot_lease_wren_dispatch(uuid,integer,text,uuid),
  public.pilot_ack_wren_dispatch(uuid,integer,uuid,text),public.pilot_retry_wren_request(uuid,integer,text,text) from public,anon,authenticated;
grant execute on function public.pilot_claim_wren_request(uuid,uuid,text,text,integer),public.pilot_save_wren_plan(uuid,uuid,jsonb),public.pilot_admit_wren(uuid,uuid),
  public.pilot_finish_wren_request(uuid,uuid,text,text),public.pilot_observe_wren_request(uuid),public.pilot_lease_wren_dispatch(uuid,integer,text,uuid),
  public.pilot_ack_wren_dispatch(uuid,integer,uuid,text),public.pilot_retry_wren_request(uuid,integer,text,text) to service_role;

create function public.pilot_guard_wren_generation() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.pilot_wren_requests r join public.pilot_operations o on o.id=new.operation_id
    where r.maker_id=o.maker_id and r.state in ('pending','planning','funding','generating') and r.operation_id is distinct from new.operation_id) then
    raise exception 'Finish or check your active Wren request before generating another continuation';
  end if;
  return new;
end;
$$;
revoke all on function public.pilot_guard_wren_generation() from public,anon,authenticated;
create trigger pilot_wren_generation_guard before insert on public.pilot_jobs for each row execute function public.pilot_guard_wren_generation();

-- Only an ordinary published moment makes assistance provenance public.
create function public.pilot_wren_assistance(p_room_id text) returns table(moment_id uuid,agent_label text)
language sql stable security definer set search_path='' as $$
  select m.id,'Wren'::text from public.pilot_wren_requests r
    join public.pilot_operations o on o.id=r.operation_id and o.maker_id=r.maker_id and o.room_id=r.room_id and o.status='published'
    join public.pilot_moments m on m.id=o.published_moment_id and m.room_id=r.room_id
    join public.pilot_rooms room on room.id=m.room_id and room.is_open
    where m.room_id=p_room_id
$$;
revoke all on function public.pilot_wren_assistance(text) from public;
grant execute on function public.pilot_wren_assistance(text) to anon,authenticated,service_role;
