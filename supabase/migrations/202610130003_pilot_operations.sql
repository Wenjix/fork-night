-- Operator-only observations, expense review and fenced legacy disposition.
create table public.pilot_execution_reviews (
  id uuid primary key,
  operation_id uuid not null references public.pilot_jobs(operation_id),
  action text not null check(action in ('adopt','cancel','observe')),
  observed_status text not null check(observed_status in ('NO_ACCEPTED_RUN','COMPLETED','CANCELED','FAILED','CRASHED','SYSTEM_FAILURE','EXPIRED','TIMED_OUT')),
  run_id text,
  reason text not null check(char_length(btrim(reason)) between 10 and 1000),
  evidence_ref text not null check(char_length(btrim(evidence_ref)) between 3 and 500),
  created_at timestamptz not null default now(),
  check((observed_status='NO_ACCEPTED_RUN')=(run_id is null))
);
alter table public.pilot_execution_reviews enable row level security;
revoke all on public.pilot_execution_reviews from public,anon,authenticated,service_role;
grant select on public.pilot_execution_reviews to service_role;
create function public.pilot_review_legacy_job(p_review_id uuid,p_operation_id uuid,p_action text,p_status text,p_run_id text,p_reason text,p_evidence_ref text)
returns void language plpgsql security definer set search_path='' as $$
declare j public.pilot_jobs; old public.pilot_execution_reviews; environment text;
begin
  select execution_environment into environment from public.pilot_generation_budget where id for update;
  if p_action is null or p_action not in ('adopt','cancel','observe') then raise exception 'Choose a supported legacy review action'; end if;
  select * into old from public.pilot_execution_reviews where id=p_review_id;
  if found then
    if old.operation_id is distinct from p_operation_id or old.action is distinct from p_action or old.observed_status is distinct from p_status or old.run_id is distinct from p_run_id or old.reason is distinct from p_reason or old.evidence_ref is distinct from p_evidence_ref then
      raise exception 'Review ID belongs to different evidence'; end if;
    return;
  end if;
  select * into strict j from public.pilot_jobs where operation_id=p_operation_id for update;
  if j.execution_environment is not null or (p_action<>'observe' and j.state not in ('queued','running','uncertain')) then raise exception 'Only unfinished legacy work can use this review'; end if;
  if p_action='observe' and (p_status is null or p_status='NO_ACCEPTED_RUN') then
    raise exception 'Record a verified terminal legacy run before reviewing provider expense'; end if;
  if p_action<>'observe' and exists(select 1 from public.pilot_panel_attempts where operation_id=p_operation_id)
    and (p_action<>'adopt' or j.legacy_terminal_observed_at is null
      or not exists(select 1 from public.pilot_execution_reviews where operation_id=p_operation_id and action='observe'
        and run_id is not distinct from p_run_id and observed_status=p_status)
      or exists(select 1 from public.pilot_panel_accounting where operation_id=p_operation_id and not expense_known)) then
    raise exception 'A provider intent exists. Preserve its hold and review its receipt separately'; end if;
  if p_action='adopt' and environment is null then raise exception 'Configure the new execution environment before adoption'; end if;
  insert into public.pilot_execution_reviews(id,operation_id,action,observed_status,run_id,reason,evidence_ref)
    values(p_review_id,p_operation_id,p_action,p_status,p_run_id,p_reason,p_evidence_ref);
  -- Revoking the old token under the admission lock fences every old write/POST intent.
  if p_action='observe' then
    -- An observation fences the old execution but releases no liability or
    -- changes a delivered/published result. Expense review is a separate act.
    update public.pilot_jobs set legacy_terminal_observed_at=clock_timestamp(),claim_token=null,lease_until=null,
      state=case when state in ('queued','running') then 'uncertain' else state end,updated_at=clock_timestamp()
      where operation_id=p_operation_id;
    update public.pilot_operations set status='uncertain',generation_error='This earlier result needs receipt and expense review.'
      where id=p_operation_id and status in ('queued','dispatching');
  elsif p_action='cancel' then
    update public.pilot_jobs set state='failed',claim_token=null,held_micro=0,updated_at=clock_timestamp() where operation_id=p_operation_id;
    update public.pilot_operations set status='failed',generation_error='This earlier request was closed after review. Your words are saved; you can start another idea.' where id=p_operation_id;
  else
    update public.pilot_jobs set state='queued',claim_token=null,dispatch_version=dispatch_version+1,
      execution_environment=environment,run_id=null,lease_until=null,updated_at=clock_timestamp() where operation_id=p_operation_id;
    insert into public.pilot_job_dispatches(operation_id,dispatch_version,environment) values(p_operation_id,j.dispatch_version+1,environment);
    update public.pilot_operations set status='queued',generation_error=null where id=p_operation_id;
  end if;
end;
$$;

create function public.pilot_readiness(p_room_id text) returns jsonb
language sql stable security definer set search_path='' as $$
select jsonb_build_object(
  'observedAt',now(),
  'generation',jsonb_build_object('enabled',b.enabled,'environment',b.execution_environment,'capMicro',b.cap_micro,
    'knownExpenseMicro',b.imported_expense_micro+coalesce((select sum(accounted_micro) from public.pilot_panel_accounting where expense_known),0),
    'unresolvedBookedMicro',coalesce((select sum(accounted_micro) from public.pilot_panel_accounting where not expense_known),0),
    'heldMicro',coalesce((select sum(held_micro) from public.pilot_jobs),0),
    'headroomMicro',b.cap_micro-b.imported_expense_micro-coalesce((select sum(accounted_micro) from public.pilot_panel_accounting),0)-coalesce((select sum(held_micro) from public.pilot_jobs),0),
    'requestSlots',b.max_requests-b.imported_requests-coalesce((select sum(panel_count) from public.pilot_jobs),0),
    'pausedForReview',public.pilot_spending_paused(true),'lastReconcileAt',b.last_reconcile_at),
  'work',jsonb_build_object('active', (select count(*) from public.pilot_jobs where state in ('queued','running','uncertain')),
    'legacyUnfinished',(select count(*) from public.pilot_jobs where execution_environment is null and state in ('queued','running','uncertain')),
    'unresolvedPanels',(select count(*) from public.pilot_panel_accounting where not expense_known),
    'oldestActiveSeconds',(select extract(epoch from now()-min(o.created_at)) from public.pilot_jobs j join public.pilot_operations o on o.id=j.operation_id where j.state in ('queued','running','uncertain')),
    'multipleActiveMakers',(select count(*) from (select o.maker_id from public.pilot_jobs j join public.pilot_operations o on o.id=j.operation_id where j.state in ('queued','running','uncertain') group by o.maker_id having count(*)>1) x),
    'dueDispatches',(select count(*) from public.pilot_job_dispatches where next_check_at<=now() and state not in ('terminal','review')),
    'unavailableChecks',(select count(*) from public.pilot_job_dispatches where error_code='check_unavailable' and state not in ('terminal','review')),
    'unacknowledgedDispatches',(select count(*) from public.pilot_job_dispatches where run_id is null and state='dispatching'),
    'reviewDispatches',(select count(*) from public.pilot_job_dispatches where state='review')),
  'room',jsonb_build_object('id',p_room_id,'credits',public.pilot_room_credits(p_room_id),
    'guestAttemptLimit',(select guest_attempt_limit from public.pilot_room_capacity where room_id=p_room_id)),
  'helpers',jsonb_build_object('shapeEnabled',a.shape_enabled,'shapeLimit',a.shape_request_limit,
    'shapeUsed',(select count(*) from public.pilot_assist_requests where kind='shape'),
    'perMakerShapeLimit',a.guest_shape_limit,'voiceEnabled',a.voice_enabled,
    'pendingOlderThanTwoMinutes',(select count(*) from public.pilot_assist_requests where state='pending' and created_at<now()-interval '2 minutes')),
  'creation',jsonb_build_object('enabled',l.creation_enabled,'campaign',l.campaign,'roomLimit',l.room_limit,
    'creditLimit',l.credit_limit,'creditsPerRoom',l.credits_per_room,
    'roomsCreated',(select count(*) from public.pilot_room_creations where campaign=l.campaign),
    'enabledTemplates',(select count(*) from public.pilot_room_templates where enabled)))
from public.pilot_generation_budget b cross join public.pilot_assist_limits a cross join public.pilot_demo_limits l
$$;
revoke all on function public.pilot_review_legacy_job(uuid,uuid,text,text,text,text,text),public.pilot_readiness(text) from public,anon,authenticated;
grant execute on function public.pilot_review_legacy_job(uuid,uuid,text,text,text,text,text),public.pilot_readiness(text) to service_role;

create table public.pilot_rehearsal_allowances (
  id text primary key,
  room_id text not null references public.pilot_rooms(id),
  settings jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.pilot_rehearsal_allowances enable row level security;
revoke all on public.pilot_rehearsal_allowances from public,anon,authenticated,service_role;
grant select on public.pilot_rehearsal_allowances to service_role;
create function public.pilot_prepare_judge_room(p_grant_id text,p_room_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.pilot_generation_budget; previous public.pilot_rehearsal_allowances; credits jsonb; result jsonb;
  shape_used integer; images_admitted integer; headroom bigint;
begin
  select * into strict b from public.pilot_generation_budget where id for update;
  perform 1 from public.pilot_assist_limits where id for update;
  if p_grant_id is null or char_length(p_grant_id) not between 3 and 100 then raise exception 'Name this bounded rehearsal grant'; end if;
  select * into previous from public.pilot_rehearsal_allowances where id=p_grant_id;
  if found then
    if previous.room_id<>p_room_id then raise exception 'This grant belongs to another room'; end if;
    return previous.settings;
  end if;
  if not b.enabled or b.execution_environment<>'PRODUCTION' or b.execution_environment is null or public.pilot_spending_paused(true) then
    raise exception 'Verify Production generation and clear unresolved expenses first'; end if;
  headroom:=b.cap_micro-b.imported_expense_micro-coalesce((select sum(accounted_micro) from public.pilot_panel_accounting),0)-coalesce((select sum(held_micro) from public.pilot_jobs),0);
  if headroom<6000000 then raise exception 'This rehearsal needs six dollars of existing admission headroom; the cap has not changed'; end if;
  credits:=public.pilot_room_credits(p_room_id);
  select b.imported_requests+coalesce(sum(panel_count),0) into images_admitted from public.pilot_jobs;
  select count(*) into shape_used from public.pilot_assist_requests where kind='shape';
  update public.pilot_room_capacity set delivery_limit=greatest(delivery_limit,(credits->>'used')::int+(credits->>'reserved')::int+12),
    guest_attempt_limit=greatest(guest_attempt_limit,4) where room_id=p_room_id;
  if not found then raise exception 'The selected room has no capacity row'; end if;
  update public.pilot_generation_budget set max_requests=greatest(max_requests,images_admitted+24) where id;
  update public.pilot_assist_limits set shape_enabled=true,shape_request_limit=greatest(shape_request_limit,shape_used+36),
    guest_shape_limit=9,voice_enabled=false where id;
  result:=jsonb_build_object('roomId',p_room_id,'credits',public.pilot_room_credits(p_room_id),'imageCapMicro',b.cap_micro,
    'requestLimit',(select max_requests from public.pilot_generation_budget where id),
    'shapeLimit',(select shape_request_limit from public.pilot_assist_limits where id),'freshMakerShapeLimit',9,'voiceEnabled',false);
  insert into public.pilot_rehearsal_allowances(id,room_id,settings) values(p_grant_id,p_room_id,result);
  return result;
end;
$$;
revoke all on function public.pilot_prepare_judge_room(text,text) from public,anon,authenticated;
grant execute on function public.pilot_prepare_judge_room(text,text) to service_role;
