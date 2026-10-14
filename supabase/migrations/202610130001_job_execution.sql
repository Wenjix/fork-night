-- Durable dispatch and fenced execution. Configure the environment after the
-- matching web/worker release is ready; legacy queued jobs require review.
alter table public.pilot_generation_budget add column execution_environment text
  check (execution_environment in ('PRODUCTION','DEVELOPMENT','STAGING','PREVIEW'));
alter table public.pilot_generation_budget add column last_reconcile_at timestamptz;
alter table public.pilot_jobs
  add column execution_environment text,
  add column run_id text,
  add column lease_until timestamptz,
  add column heartbeat_at timestamptz,
  add column legacy_terminal_observed_at timestamptz,
  add column recovery_count integer not null default 0 check (recovery_count between 0 and 2);
alter table public.pilot_panel_attempts
  add column request_deadline timestamptz,
  add column expense_basis text not null default 'unknown'
    check (expense_basis in ('unknown','estimated','usage','legacy'));
update public.pilot_panel_attempts set expense_basis=case
  when expense_micro is null then 'unknown'
  when expense_micro=250000 then 'estimated'
  else 'legacy' end;
-- Restore liability coverage for any fallback estimates written before cutover.
-- This reserves capacity; it neither rewrites expense nor grants a refund.
update public.pilot_jobs j set held_micro=greatest(j.held_micro,
  1000000*((select count(*) from public.pilot_panel_attempts p where p.operation_id=j.operation_id
    and p.expense_basis in ('unknown','estimated'))
    +case when j.state in ('queued','running','uncertain') then j.panel_count-
      (select count(*) from public.pilot_panel_attempts p where p.operation_id=j.operation_id) else 0 end))
where exists(select 1 from public.pilot_panel_attempts p where p.operation_id=j.operation_id and p.expense_basis='estimated');

create table public.pilot_job_dispatches (
  operation_id uuid not null references public.pilot_jobs(operation_id),
  dispatch_version integer not null,
  environment text not null check (environment in ('PRODUCTION','DEVELOPMENT','STAGING','PREVIEW')),
  state text not null default 'pending' check (state in ('pending','dispatching','queued','running','waiting','review','terminal')),
  run_id text,
  lease_token uuid,
  lease_until timestamptz,
  enqueue_attempts integer not null default 0,
  next_check_at timestamptz not null default now(),
  observed_status text,
  terminal_observed_at timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  primary key(operation_id,dispatch_version)
);
create index pilot_dispatch_due on public.pilot_job_dispatches(environment,next_check_at)
  where state not in ('terminal','review');
create table public.pilot_expense_reviews (
  id uuid primary key,
  sequence bigint generated always as identity unique,
  operation_id uuid not null,
  panel_number integer not null,
  actual_micro bigint not null check (actual_micro>=0),
  reason text not null check (char_length(btrim(reason)) between 10 and 1000),
  evidence_ref text not null check (char_length(btrim(evidence_ref)) between 3 and 500),
  created_at timestamptz not null default now(),
  foreign key(operation_id,panel_number) references public.pilot_panel_attempts(operation_id,panel_number)
);
alter table public.pilot_job_dispatches enable row level security;
alter table public.pilot_expense_reviews enable row level security;
revoke all on public.pilot_job_dispatches,public.pilot_expense_reviews from public,anon,authenticated;
grant all on public.pilot_job_dispatches to service_role;
grant select on public.pilot_expense_reviews to service_role;
revoke select on public.pilot_jobs from authenticated;
grant select(operation_id,state,panel_count,updated_at,dispatch_version) on public.pilot_jobs to authenticated;

-- Effective cost is a projection; original receipts and booked expense stay intact.
create view public.pilot_panel_accounting with (security_invoker=true) as
select p.*,coalesce(r.actual_micro,p.expense_micro,0) as accounted_micro,
  (r.id is not null or (p.expense_micro is not null and p.expense_basis in ('usage','legacy'))) as expense_known,
  r.id is not null as reviewed
from public.pilot_panel_attempts p
left join lateral (select id,actual_micro from public.pilot_expense_reviews
  where operation_id=p.operation_id and panel_number=p.panel_number
  order by sequence desc limit 1) r on true;
revoke all on public.pilot_panel_accounting from public,anon,authenticated;
grant select on public.pilot_panel_accounting to service_role;

create function public.pilot_spending_paused(p_allow_healthy boolean default false) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(
    select 1 from public.pilot_panel_accounting p
    join public.pilot_jobs j on j.operation_id=p.operation_id
    cross join public.pilot_generation_budget b
    where (p.accounted_micro>1000000 and not p.reviewed) or
      (not p.expense_known and not coalesce(p_allow_healthy and p.state='dispatching'
        and p.response_digest is null and j.state='running' and j.claim_token is not null
        and j.run_id is not null and j.execution_environment=b.execution_environment
        and j.lease_until>clock_timestamp() and p.request_deadline>clock_timestamp()
        and j.held_micro>=1000000, false)))
$$;
create function public.pilot_job_status(p_job public.pilot_jobs) returns jsonb
language sql immutable set search_path='' as $$
  select jsonb_build_object('operation_id',p_job.operation_id,'state',p_job.state,
    'panel_count',p_job.panel_count,'updated_at',p_job.updated_at,'dispatch_version',p_job.dispatch_version)
$$;

drop function public.pilot_request_generation(uuid);
create function public.pilot_request_generation(p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.pilot_generation_budget; o public.pilot_operations; j public.pilot_jobs; c public.pilot_room_capacity;
  committed bigint; admitted integer; room_committed integer; guest_attempts integer;
  ancestor uuid; depth integer:=0; requested integer; units integer; active_work public.pilot_operations;
begin
  select * into strict b from public.pilot_generation_budget where id for update;
  select * into o from public.pilot_operations where id=p_operation_id and maker_id=auth.uid() for update;
  if not found then raise exception 'Contribution is unavailable'; end if;
  if not exists(select 1 from public.pilot_rooms where id=o.room_id and is_open) then raise exception 'Room is unavailable'; end if;
  select * into j from public.pilot_jobs where operation_id=o.id for update;
  if found then
    -- Checking never revokes a live worker or authorizes another purchase.
    update public.pilot_job_dispatches set next_check_at=least(next_check_at,clock_timestamp())
      where operation_id=j.operation_id and dispatch_version=j.dispatch_version and state<>'review';
    return public.pilot_job_status(j);
  end if;
  if not b.enabled or b.execution_environment is null then raise exception 'Generation is being set up. Your draft is saved'; end if;
  if o.status<>'draft' or o.requested_captions is null then raise exception 'Save your panel preview first'; end if;
  select y.* into active_work from public.pilot_jobs x join public.pilot_operations y on y.id=x.operation_id
    where y.maker_id=o.maker_id and x.state in ('queued','running','uncertain') order by y.created_at limit 1;
  if found then raise exception using message='Finish or check your existing generation before starting another',
    detail=jsonb_build_object('roomId',active_work.room_id,'parentId',active_work.parent_id,'operationId',active_work.id)::text; end if;
  if exists(select 1 from public.pilot_operations where maker_id=o.maker_id and room_id=o.room_id and status='delivered') then
    raise exception 'Publish or discard your private preview first'; end if;
  if public.pilot_spending_paused(true) then raise exception 'Generation is paused while a previous result is checked'; end if;
  requested:=jsonb_array_length(o.requested_captions); units:=(requested+1)/2;
  select b.imported_expense_micro+coalesce((select sum(accounted_micro) from public.pilot_panel_accounting),0)
    +coalesce((select sum(held_micro) from public.pilot_jobs),0) into committed;
  select b.imported_requests+coalesce(sum(panel_count),0) into admitted from public.pilot_jobs;
  if committed+requested*1000000>b.cap_micro or admitted+requested>b.max_requests then raise exception 'The generation allowance has been used for this rehearsal'; end if;
  select * into c from public.pilot_room_capacity where room_id=o.room_id;
  if not found then raise exception 'This room has no generation allowance'; end if;
  select coalesce(sum(case when y.charged_units>0 then y.charged_units else (x.panel_count+1)/2 end),0)
    into room_committed from public.pilot_jobs x join public.pilot_operations y on y.id=x.operation_id
    where y.room_id=o.room_id and (y.charged_units>0 or x.state in ('queued','running','uncertain'));
  select count(*) into guest_attempts from public.pilot_jobs x join public.pilot_operations y on y.id=x.operation_id
    where y.room_id=o.room_id and y.maker_id=o.maker_id;
  if room_committed+units>c.delivery_limit then raise exception 'This room needs more generation credits'; end if;
  if guest_attempts>=c.guest_attempt_limit then raise exception 'You have used your attempts for this rehearsal'; end if;
  ancestor:=o.parent_id;
  while ancestor is not null loop
    depth:=depth+1;
    if depth>12 then raise exception 'This story path has reached the rehearsal depth limit'; end if;
    select parent_id into ancestor from public.pilot_moments where id=ancestor and room_id=o.room_id;
    if not found then raise exception 'The selected story path is incomplete'; end if;
  end loop;
  insert into public.pilot_jobs(operation_id,panel_count,held_micro,execution_environment)
    values(o.id,requested,requested*1000000,b.execution_environment) returning * into j;
  insert into public.pilot_job_dispatches(operation_id,dispatch_version,environment)
    values(o.id,j.dispatch_version,b.execution_environment);
  update public.pilot_operations set status='queued',generation_error=null where id=o.id;
  return public.pilot_job_status(j);
end;
$$;

-- Old workers may finish their already-claimed legacy work; they cannot claim
-- new or orphaned work after cutover. Adopt legacy jobs only through review.
create or replace function public.pilot_claim_job(p_operation_id uuid,p_claim_token uuid) returns boolean
language sql security definer set search_path='' as $$ select false $$;

create function public.pilot_lease_dispatch(p_operation_id uuid,p_version integer,p_environment text,p_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.pilot_job_dispatches;
begin
  perform 1 from public.pilot_generation_budget where id and execution_environment=p_environment for update;
  if not found then return null; end if;
  if not exists(select 1 from public.pilot_jobs where operation_id=p_operation_id and dispatch_version=p_version
    and execution_environment=p_environment and state='queued') then return null; end if;
  update public.pilot_job_dispatches set state='dispatching',lease_token=p_token,
    lease_until=clock_timestamp()+interval '45 seconds',enqueue_attempts=enqueue_attempts+1,
    next_check_at=clock_timestamp()+interval '1 minute'
    where operation_id=p_operation_id and dispatch_version=p_version and environment=p_environment
      and state in ('pending','dispatching') and run_id is null
      and (lease_until is null or lease_until<clock_timestamp()) returning * into d;
  if not found then return null; end if;
  return to_jsonb(d);
end;
$$;
create function public.pilot_ack_dispatch(p_operation_id uuid,p_version integer,p_token uuid,p_run_id text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  update public.pilot_job_dispatches set run_id=p_run_id,
    state=case when state='dispatching' then 'queued' else state end,lease_until=null,lease_token=null,error_code=null
    where operation_id=p_operation_id and dispatch_version=p_version and lease_token=p_token
      and (run_id is null or run_id=p_run_id);
  return found;
end;
$$;
create function public.pilot_claim_execution(p_operation_id uuid,p_claim_token uuid,p_version integer,p_environment text,p_run_id text)
returns boolean language plpgsql security definer set search_path='' as $$
declare d public.pilot_job_dispatches;
begin
  perform 1 from public.pilot_generation_budget where id and execution_environment=p_environment for update;
  if not found or p_run_id is null or char_length(p_run_id) not between 1 and 255 or p_claim_token is null then return false; end if;
  select * into d from public.pilot_job_dispatches where operation_id=p_operation_id and dispatch_version=p_version for update;
  if not found or d.environment<>p_environment or d.state not in ('pending','dispatching','queued')
    or (d.run_id is not null and d.run_id<>p_run_id) then return false; end if;
  update public.pilot_jobs set state='running',claim_token=p_claim_token,run_id=p_run_id,
    heartbeat_at=clock_timestamp(),lease_until=clock_timestamp()+interval '90 seconds',updated_at=clock_timestamp()
    where operation_id=p_operation_id and state='queued' and dispatch_version=p_version and execution_environment=p_environment;
  if not found then return false; end if;
  update public.pilot_job_dispatches set run_id=p_run_id,state='running'
    where operation_id=p_operation_id and dispatch_version=p_version;
  update public.pilot_operations set status='dispatching',generation_error=null where id=p_operation_id and status='queued';
  return true;
end;
$$;
create function public.pilot_heartbeat(p_operation_id uuid,p_claim_token uuid,p_version integer,p_environment text,p_run_id text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  update public.pilot_jobs set heartbeat_at=clock_timestamp(),lease_until=clock_timestamp()+interval '90 seconds',updated_at=clock_timestamp()
    where operation_id=p_operation_id and state='running' and claim_token=p_claim_token
      and dispatch_version=p_version and execution_environment=p_environment and run_id=p_run_id
      and lease_until>clock_timestamp()
      and execution_environment=(select execution_environment from public.pilot_generation_budget where id);
  return found;
end;
$$;
create function public.pilot_assert_claim(p_operation_id uuid,p_claim_token uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.pilot_jobs where operation_id=p_operation_id and state='running'
    and claim_token=p_claim_token and p_claim_token is not null
    and (execution_environment is null or (lease_until>clock_timestamp()
      and execution_environment=(select execution_environment from public.pilot_generation_budget where id)))) then
    raise exception 'Worker does not own this job'; end if;
end;
$$;

create or replace function public.pilot_begin_panel(p_operation_id uuid,p_panel_number integer,p_input_digest text,p_claim_token uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare b public.pilot_generation_budget; previous public.pilot_panel_attempts; j public.pilot_jobs;
begin
  select * into strict b from public.pilot_generation_budget where id for update;
  perform public.pilot_assert_claim(p_operation_id,p_claim_token);
  select * into strict j from public.pilot_jobs where operation_id=p_operation_id;
  if p_panel_number is null or p_panel_number not between 1 and j.panel_count then raise exception 'Panel is outside the saved sequence'; end if;
  select * into previous from public.pilot_panel_attempts where operation_id=p_operation_id and panel_number=p_panel_number;
  if found then
    if previous.input_digest<>p_input_digest then raise exception 'Panel inputs changed'; end if;
    return false;
  end if;
  if not b.enabled or public.pilot_spending_paused(false) then
    raise exception using errcode='P0002',message='Generation is waiting while an earlier result is checked'; end if;
  if not exists(select 1 from public.pilot_operations o join public.pilot_rooms r on r.id=o.room_id where o.id=p_operation_id and r.is_open) then raise exception 'Room is unavailable'; end if;
  if (select count(*) from public.pilot_panel_accounting where operation_id=p_operation_id and panel_number<p_panel_number and state='complete' and expense_known)<>p_panel_number-1 then raise exception 'Save and account for the preceding panels first'; end if;
  if j.held_micro<1000000 then raise exception 'Panel has no expense reservation'; end if;
  if b.imported_expense_micro+coalesce((select sum(accounted_micro) from public.pilot_panel_accounting),0)
    +coalesce((select sum(held_micro) from public.pilot_jobs),0)>b.cap_micro then
    raise exception using errcode='P0002',message='Generation is waiting for an expense review'; end if;
  insert into public.pilot_panel_attempts(operation_id,panel_number,input_digest,request_deadline)
    values(p_operation_id,p_panel_number,p_input_digest,clock_timestamp()+interval '240 seconds');
  return true;
end;
$$;

create or replace function public.pilot_record_panel(p_operation_id uuid,p_panel_number integer,p_claim_token uuid,p_state text,p_response_digest text,p_image_path text,p_image_digest text,p_expense_micro bigint,p_request_id text,p_elapsed_ms integer,p_error_code text)
returns void language plpgsql security definer set search_path='' as $$
declare previous public.pilot_panel_attempts; basis text;
begin
  perform 1 from public.pilot_generation_budget where id for update;
  perform public.pilot_assert_claim(p_operation_id,p_claim_token);
  select * into strict previous from public.pilot_panel_attempts where operation_id=p_operation_id and panel_number=p_panel_number for update;
  if previous.expense_micro is not null and p_expense_micro is distinct from previous.expense_micro then raise exception 'Recorded expense cannot change'; end if;
  if previous.response_digest is not null and p_response_digest is distinct from previous.response_digest then raise exception 'Provider receipt cannot change'; end if;
  if previous.state='complete' and (p_state<>'complete' or p_image_digest is distinct from previous.image_digest or p_image_path is distinct from previous.image_path) then raise exception 'Delivered panel cannot change'; end if;
  if p_image_path is not null and p_image_path<>p_operation_id::text||'/'||p_panel_number::text||'.webp' then raise exception 'Invalid media path'; end if;
  basis:=case when previous.expense_micro is not null then previous.expense_basis
    when p_expense_micro is null then 'unknown'
    when p_expense_micro=250000 and (select execution_environment is null from public.pilot_jobs where operation_id=p_operation_id) then 'estimated'
    else 'usage' end;
  update public.pilot_panel_attempts set state=p_state,response_digest=p_response_digest,image_path=p_image_path,image_digest=p_image_digest,
    expense_micro=p_expense_micro,expense_basis=basis,request_id=p_request_id,elapsed_ms=p_elapsed_ms,error_code=p_error_code
    where operation_id=p_operation_id and panel_number=p_panel_number;
  if previous.expense_micro is null and p_expense_micro is not null and basis='usage'
    and not exists(select 1 from public.pilot_expense_reviews where operation_id=p_operation_id and panel_number=p_panel_number) then
    update public.pilot_jobs set held_micro=greatest(0,held_micro-1000000),updated_at=clock_timestamp() where operation_id=p_operation_id;
  end if;
end;
$$;
create or replace function public.pilot_finish_job(p_operation_id uuid,p_claim_token uuid,p_error text default null)
returns void language plpgsql security definer set search_path='' as $$
declare j public.pilot_jobs; o public.pilot_operations; output jsonb; complete_count integer; unresolved integer; needs_recovery integer;
begin
  perform 1 from public.pilot_generation_budget where id for update;
  select * into strict j from public.pilot_jobs where operation_id=p_operation_id for update;
  if j.state in ('delivered','failed') and j.claim_token=p_claim_token then return; end if;
  perform public.pilot_assert_claim(p_operation_id,p_claim_token);
  select * into strict o from public.pilot_operations where id=p_operation_id for update;
  select count(*) filter(where state='complete'),count(*) filter(where not expense_known),
    count(*) filter(where not expense_known or state in ('dispatching','uncertain'))
    into complete_count,unresolved,needs_recovery from public.pilot_panel_accounting where operation_id=p_operation_id;
  if complete_count=j.panel_count then
    select jsonb_agg(jsonb_build_object('imagePath',image_path,'sha256',image_digest,'caption',o.requested_captions->>(panel_number-1)) order by panel_number)
      into output from public.pilot_panel_attempts where operation_id=p_operation_id;
    update public.pilot_operations set status='delivered',panels=output,source_kind='openai',charged_units=(j.panel_count+1)/2,generation_error=null where id=p_operation_id;
    update public.pilot_jobs set state='delivered',held_micro=unresolved*1000000,lease_until=null,updated_at=clock_timestamp() where operation_id=p_operation_id;
  else
    update public.pilot_jobs set state=case when needs_recovery>0 then 'uncertain' else 'failed' end,
      held_micro=case when needs_recovery>0 then held_micro else 0 end,lease_until=null,updated_at=clock_timestamp() where operation_id=p_operation_id;
    update public.pilot_operations set status=case when needs_recovery>0 then 'uncertain' else 'failed' end,
      generation_error=left(coalesce(p_error,'The complete result is not available yet.'),240) where id=p_operation_id;
  end if;
  update public.pilot_job_dispatches set next_check_at=clock_timestamp()
    where operation_id=p_operation_id and dispatch_version=j.dispatch_version;
end;
$$;

create function public.pilot_defer_job(p_operation_id uuid,p_claim_token uuid) returns void
language plpgsql security definer set search_path='' as $$
declare j public.pilot_jobs;
begin
  perform 1 from public.pilot_generation_budget where id for update;
  perform public.pilot_assert_claim(p_operation_id,p_claim_token);
  select * into strict j from public.pilot_jobs where operation_id=p_operation_id;
  update public.pilot_jobs set state='queued',claim_token=null,lease_until=null,updated_at=clock_timestamp() where operation_id=p_operation_id;
  update public.pilot_operations set status='queued',generation_error='We are checking an earlier result. Your idea is saved.' where id=p_operation_id;
  update public.pilot_job_dispatches set state='waiting',next_check_at=clock_timestamp()+interval '1 minute'
    where operation_id=p_operation_id and dispatch_version=j.dispatch_version;
end;
$$;

-- Terminal observations come from the service reconciler, never a browser timer.
create function public.pilot_reconcile_execution(p_operation_id uuid,p_version integer,p_run_id text,p_status text,p_recover boolean)
returns text language plpgsql security definer set search_path='' as $$
declare j public.pilot_jobs; d public.pilot_job_dispatches; terminal boolean; recoveries integer;
begin
  perform 1 from public.pilot_generation_budget where id for update;
  select * into strict j from public.pilot_jobs where operation_id=p_operation_id for update;
  select * into d from public.pilot_job_dispatches where operation_id=p_operation_id and dispatch_version=p_version for update;
  if not found or j.dispatch_version<>p_version or d.run_id is distinct from p_run_id or p_run_id is null then return 'stale'; end if;
  terminal:=p_status in ('COMPLETED','CANCELED','FAILED','CRASHED','SYSTEM_FAILURE','EXPIRED','TIMED_OUT');
  update public.pilot_job_dispatches set observed_status=p_status,next_check_at=clock_timestamp()+interval '1 minute',
    terminal_observed_at=case when terminal then clock_timestamp() else terminal_observed_at end
    where operation_id=p_operation_id and dispatch_version=p_version;
  if not terminal then return 'active'; end if;
  if j.state in ('delivered','failed') then
    update public.pilot_job_dispatches set state=case when j.held_micro>0 then 'review' else 'terminal' end
      where operation_id=p_operation_id and dispatch_version=p_version;
    return case when j.held_micro>0 then 'review' else 'finished' end;
  end if;
  if d.state='waiting' and (public.pilot_spending_paused(false) or
    exists(select 1 from public.pilot_generation_budget b where not b.enabled or
      b.imported_expense_micro+coalesce((select sum(accounted_micro) from public.pilot_panel_accounting),0)
      +coalesce((select sum(held_micro) from public.pilot_jobs),0)>b.cap_micro)) then return 'waiting'; end if;
  recoveries:=j.recovery_count+case when d.state='waiting' then 0 else 1 end;
  if not p_recover or recoveries>2 or j.execution_environment is distinct from
    (select execution_environment from public.pilot_generation_budget where id) then
    update public.pilot_jobs set state='uncertain',claim_token=null,lease_until=null,updated_at=clock_timestamp() where operation_id=p_operation_id;
    update public.pilot_operations set status='uncertain',generation_error='Your saved result needs review before generation can continue.' where id=p_operation_id;
    update public.pilot_job_dispatches set state='review',error_code=case when recoveries>2 then 'recovery_limit' else 'expense_or_receipt_review' end
      where operation_id=p_operation_id and dispatch_version=p_version;
    return 'review';
  end if;
  update public.pilot_job_dispatches set state='terminal' where operation_id=p_operation_id and dispatch_version=p_version;
  update public.pilot_jobs set state='queued',dispatch_version=dispatch_version+1,claim_token=null,lease_until=null,
    run_id=null,recovery_count=recoveries,updated_at=clock_timestamp() where operation_id=p_operation_id;
  insert into public.pilot_job_dispatches(operation_id,dispatch_version,environment) values(p_operation_id,p_version+1,j.execution_environment);
  update public.pilot_operations set status='queued',generation_error=null where id=p_operation_id;
  return 'pending';
end;
$$;

create function public.pilot_review_expense(p_review_id uuid,p_operation_id uuid,p_panel_number integer,p_actual_micro bigint,p_reason text,p_evidence_ref text)
returns void language plpgsql security definer set search_path='' as $$
declare old public.pilot_expense_reviews; known boolean;
begin
  perform 1 from public.pilot_generation_budget where id for update;
  select * into old from public.pilot_expense_reviews where id=p_review_id;
  if found then
    if old.operation_id is distinct from p_operation_id or old.panel_number is distinct from p_panel_number or old.actual_micro is distinct from p_actual_micro
      or old.reason is distinct from p_reason or old.evidence_ref is distinct from p_evidence_ref then raise exception 'Review ID belongs to different evidence'; end if;
    return;
  end if;
  if exists(select 1 from public.pilot_jobs where operation_id=p_operation_id and state='running')
    or (not exists(select 1 from public.pilot_job_dispatches d join public.pilot_jobs j on j.operation_id=d.operation_id and j.dispatch_version=d.dispatch_version
      where d.operation_id=p_operation_id and d.terminal_observed_at is not null)
      and not exists(select 1 from public.pilot_jobs where operation_id=p_operation_id and execution_environment is null
        and legacy_terminal_observed_at is not null and claim_token is null)) then
    raise exception 'Confirm and fence the terminal execution before settling its expense'; end if;
  select expense_known into strict known from public.pilot_panel_accounting where operation_id=p_operation_id and panel_number=p_panel_number;
  insert into public.pilot_expense_reviews(id,operation_id,panel_number,actual_micro,reason,evidence_ref)
    values(p_review_id,p_operation_id,p_panel_number,p_actual_micro,p_reason,p_evidence_ref);
  if not known then update public.pilot_jobs set held_micro=greatest(0,held_micro-1000000) where operation_id=p_operation_id; end if;
  update public.pilot_job_dispatches set state=case when state='review' then 'running' else state end,next_check_at=clock_timestamp()
    where operation_id=p_operation_id and dispatch_version=(select dispatch_version from public.pilot_jobs where operation_id=p_operation_id);
end;
$$;

revoke all on function public.pilot_spending_paused(boolean),public.pilot_job_status(public.pilot_jobs),
  public.pilot_request_generation(uuid),public.pilot_lease_dispatch(uuid,integer,text,uuid),
  public.pilot_ack_dispatch(uuid,integer,uuid,text),public.pilot_claim_execution(uuid,uuid,integer,text,text),
  public.pilot_heartbeat(uuid,uuid,integer,text,text),public.pilot_assert_claim(uuid,uuid),
  public.pilot_defer_job(uuid,uuid),public.pilot_reconcile_execution(uuid,integer,text,text,boolean),
  public.pilot_review_expense(uuid,uuid,integer,bigint,text,text) from public,anon,authenticated;
grant execute on function public.pilot_request_generation(uuid) to authenticated;
grant execute on function public.pilot_spending_paused(boolean),public.pilot_lease_dispatch(uuid,integer,text,uuid),
  public.pilot_ack_dispatch(uuid,integer,uuid,text),public.pilot_claim_execution(uuid,uuid,integer,text,text),
  public.pilot_heartbeat(uuid,uuid,integer,text,text),public.pilot_defer_job(uuid,uuid),
  public.pilot_reconcile_execution(uuid,integer,text,text,boolean),public.pilot_review_expense(uuid,uuid,integer,bigint,text,text) to service_role;
