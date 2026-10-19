-- An operator can admit one exact draft after a maker's ordinary attempt cap.
-- Empty by default. Grants neither credits nor changes to global spending/request limits.
create table public.pilot_generation_grants (
  request_id uuid primary key,
  mission_id uuid not null,
  maker_id uuid not null references public.pilot_profiles(id),
  room_id text not null references public.pilot_rooms(id),
  parent_id uuid references public.pilot_moments(id),
  parent_request_id uuid references public.pilot_generation_grants(request_id),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  check(expires_at>created_at and expires_at<=created_at+interval '1 hour'),
  check((parent_id is null)<>(parent_request_id is null))
);
alter table public.pilot_generation_grants enable row level security;
revoke all on public.pilot_generation_grants from public,anon,authenticated;
grant select,insert,delete on public.pilot_generation_grants to service_role;

create or replace function public.pilot_request_generation(p_operation_id uuid) returns jsonb
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
  if guest_attempts>=c.guest_attempt_limit and not exists(
    select 1 from public.pilot_generation_grants g where g.request_id=o.request_id and g.maker_id=o.maker_id
      and g.room_id=o.room_id and requested=1 and g.expires_at>clock_timestamp()
      and (g.parent_id=o.parent_id or exists(select 1 from public.pilot_operations parent
        where parent.request_id=g.parent_request_id and parent.maker_id=o.maker_id and parent.room_id=o.room_id
          and parent.status='published' and parent.published_moment_id=o.parent_id))
  ) then raise exception 'You have used your attempts for this rehearsal'; end if;
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
