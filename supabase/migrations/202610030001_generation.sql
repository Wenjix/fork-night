-- Durable generation intent, expense admission, and protected media.
-- All amounts are integer micro-USD. Provider limits remain distinct from credits.
alter table public.pilot_operations drop constraint pilot_operations_status_check;
alter table public.pilot_operations add constraint pilot_operations_status_check check
  (status in ('draft','queued','dispatching','uncertain','delivered','failed','published','discarded'));
alter table public.pilot_operations add column requested_captions jsonb;
alter table public.pilot_operations add column generation_error text;
alter table public.pilot_operations add column charged_units integer not null default 0 check (charged_units in (0,1));

create table public.pilot_generation_budget (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  cap_micro bigint not null default 0 check (cap_micro >= 0),
  imported_expense_micro bigint not null default 0 check (imported_expense_micro >= 0),
  imported_requests integer not null default 0 check (imported_requests >= 0),
  max_requests integer not null default 10 check (max_requests between 0 and 10000)
);
insert into public.pilot_generation_budget(id) values(true);

create table public.pilot_room_capacity (
  room_id text primary key references public.pilot_rooms(id),
  delivery_limit integer not null default 4 check (delivery_limit between 0 and 1000),
  guest_attempt_limit integer not null default 2 check (guest_attempt_limit between 0 and 100)
);
insert into public.pilot_room_capacity(room_id) select id from public.pilot_rooms;

create table public.pilot_jobs (
  operation_id uuid primary key references public.pilot_operations(id),
  state text not null default 'queued' check (state in ('queued','running','uncertain','failed','delivered')),
  held_micro bigint not null default 2000000 check (held_micro >= 0),
  dispatch_version integer not null default 1,
  claim_token uuid,
  updated_at timestamptz not null default now()
);

create table public.pilot_panel_attempts (
  operation_id uuid not null references public.pilot_jobs(operation_id),
  panel_number integer not null check (panel_number in (1,2)),
  input_digest text not null check (input_digest ~ '^[a-f0-9]{64}$'),
  state text not null default 'dispatching' check (state in ('dispatching','complete','failed','uncertain')),
  response_digest text,
  image_path text,
  image_digest text,
  expense_micro bigint check (expense_micro >= 0),
  request_id text,
  elapsed_ms integer,
  error_code text,
  created_at timestamptz not null default now(),
  primary key(operation_id,panel_number),
  check (state <> 'complete' or (image_path is not null and image_digest ~ '^[a-f0-9]{64}$'))
);

alter table public.pilot_generation_budget enable row level security;
alter table public.pilot_room_capacity enable row level security;
alter table public.pilot_jobs enable row level security;
alter table public.pilot_panel_attempts enable row level security;
revoke all on public.pilot_generation_budget, public.pilot_room_capacity, public.pilot_jobs, public.pilot_panel_attempts from anon, authenticated;
grant all on public.pilot_generation_budget, public.pilot_room_capacity, public.pilot_jobs, public.pilot_panel_attempts to service_role;
grant select on public.pilot_jobs to authenticated;
create policy own_jobs on public.pilot_jobs for select to authenticated using
  (exists (select 1 from public.pilot_operations o where o.id=operation_id and o.maker_id=(select auth.uid())));

create function public.pilot_save_continuation(p_request_id uuid, p_room_id text, p_parent_id uuid, p_title text, p_prompt text, p_captions jsonb)
returns public.pilot_operations language plpgsql security definer set search_path='' as $$
declare result public.pilot_operations;
begin
  if p_captions is null or jsonb_typeof(p_captions)<>'array' or jsonb_array_length(p_captions)<>2 then raise exception 'Write two story beats'; end if;
  if exists (select 1 from jsonb_array_elements(p_captions) c where jsonb_typeof(c)<>'string' or char_length(btrim(c#>>'{}')) not between 1 and 500) then raise exception 'Each story beat needs 1–500 characters'; end if;
  result:=public.pilot_save_draft(p_request_id,p_room_id,p_parent_id,p_title,p_prompt);
  select * into strict result from public.pilot_operations where id=result.id for update;
  if result.requested_captions is not null and result.requested_captions<>p_captions then raise exception 'Request ID belongs to different story beats'; end if;
  if result.requested_captions is null then
    if result.status<>'draft' then raise exception 'This contribution is already in progress'; end if;
    update public.pilot_operations set requested_captions=p_captions where id=result.id returning * into result;
  end if;
  return result;
end;
$$;

create function public.pilot_room_credits(p_room_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare capacity public.pilot_room_capacity; used integer; held integer;
begin
  if not exists(select 1 from public.pilot_rooms where id=p_room_id and is_open) then raise exception 'Room is unavailable'; end if;
  select * into capacity from public.pilot_room_capacity where room_id=p_room_id;
  select coalesce(sum(charged_units),0) into used from public.pilot_operations where room_id=p_room_id;
  select count(*) into held from public.pilot_jobs j join public.pilot_operations o on o.id=j.operation_id
    where o.room_id=p_room_id and o.charged_units=0 and j.state in ('queued','running','uncertain');
  return jsonb_build_object('limit',coalesce(capacity.delivery_limit,0),'used',used,'reserved',held,
    'available',greatest(0,coalesce(capacity.delivery_limit,0)-used-held),'enabled',(select enabled from public.pilot_generation_budget where id));
end;
$$;

create function public.pilot_request_generation(p_operation_id uuid) returns public.pilot_jobs
language plpgsql security definer set search_path='' as $$
declare b public.pilot_generation_budget; o public.pilot_operations; j public.pilot_jobs; c public.pilot_room_capacity;
  committed bigint; admitted integer; room_committed integer; guest_attempts integer; ancestor uuid; depth integer:=0;
begin
  -- Every spending transaction takes this same lock first, across rooms and guests.
  select * into strict b from public.pilot_generation_budget where id for update;
  select * into o from public.pilot_operations where id=p_operation_id and maker_id=auth.uid() for update;
  if not found then raise exception 'Contribution is unavailable'; end if;
  if not exists(select 1 from public.pilot_rooms where id=o.room_id and is_open) then raise exception 'Room is unavailable'; end if;
  select * into j from public.pilot_jobs where operation_id=o.id for update;
  if found then
    if j.state='uncertain' or (j.state='running' and j.updated_at<now()-interval '10 minutes') then
      update public.pilot_jobs set state='queued',dispatch_version=dispatch_version+1,claim_token=null,updated_at=now() where operation_id=o.id returning * into j;
      update public.pilot_operations set status='queued' where id=o.id and status not in ('published','discarded','delivered');
    end if;
    return j;
  end if;
  if not b.enabled then raise exception 'Generation is being set up. Your draft is saved'; end if;
  if o.status<>'draft' or o.requested_captions is null then raise exception 'Save two story beats first'; end if;
  if exists(select 1 from public.pilot_panel_attempts where expense_micro is null) then raise exception 'Generation is paused while a previous result is checked'; end if;
  if exists(select 1 from public.pilot_panel_attempts where expense_micro>1000000) then raise exception 'Generation is paused for an expense review'; end if;
  select b.imported_expense_micro+coalesce((select sum(expense_micro) from public.pilot_panel_attempts),0)+coalesce((select sum(held_micro) from public.pilot_jobs),0) into committed;
  select b.imported_requests+2*count(*) into admitted from public.pilot_jobs;
  if committed+2000000>b.cap_micro or admitted+2>b.max_requests then raise exception 'The generation allowance has been used for this rehearsal'; end if;
  select * into c from public.pilot_room_capacity where room_id=o.room_id;
  if not found then raise exception 'This room has no generation allowance'; end if;
  select count(*) into room_committed from public.pilot_jobs x join public.pilot_operations y on y.id=x.operation_id
    where y.room_id=o.room_id and (y.charged_units=1 or x.state in ('queued','running','uncertain'));
  select count(*) into guest_attempts from public.pilot_jobs x join public.pilot_operations y on y.id=x.operation_id
    where y.room_id=o.room_id and y.maker_id=o.maker_id;
  if room_committed>=c.delivery_limit then raise exception 'This room needs more generation credits'; end if;
  if guest_attempts>=c.guest_attempt_limit then raise exception 'You have used your attempts for this rehearsal'; end if;
  ancestor:=o.parent_id;
  while ancestor is not null loop
    depth:=depth+1;
    if depth>12 then raise exception 'This story path has reached the rehearsal depth limit'; end if;
    select parent_id into ancestor from public.pilot_moments where id=ancestor and room_id=o.room_id;
    if not found then raise exception 'The selected story path is incomplete'; end if;
  end loop;
  insert into public.pilot_jobs(operation_id) values(o.id) returning * into j;
  update public.pilot_operations set status='queued',generation_error=null where id=o.id;
  return j;
end;
$$;

create function public.pilot_claim_job(p_operation_id uuid,p_claim_token uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  update public.pilot_jobs set state='running',claim_token=p_claim_token,updated_at=now() where operation_id=p_operation_id and state='queued';
  if not found then return false; end if;
  update public.pilot_operations set status='dispatching' where id=p_operation_id and status='queued';
  return true;
end;
$$;

create function public.pilot_begin_panel(p_operation_id uuid,p_panel_number integer,p_input_digest text,p_claim_token uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare b public.pilot_generation_budget; previous public.pilot_panel_attempts;
begin
  select * into strict b from public.pilot_generation_budget where id for update;
  if not exists(select 1 from public.pilot_jobs where operation_id=p_operation_id and state='running' and claim_token=p_claim_token) then raise exception 'Worker does not own this job'; end if;
  select * into previous from public.pilot_panel_attempts where operation_id=p_operation_id and panel_number=p_panel_number;
  if found then
    if previous.input_digest<>p_input_digest then raise exception 'Panel inputs changed'; end if;
    return false;
  end if;
  if not b.enabled then raise exception 'Generation is paused'; end if;
  if not exists(select 1 from public.pilot_operations o join public.pilot_rooms r on r.id=o.room_id where o.id=p_operation_id and r.is_open) then raise exception 'Room is unavailable'; end if;
  if exists(select 1 from public.pilot_panel_attempts where expense_micro is null or expense_micro>1000000) then raise exception 'Previous provider expense needs review'; end if;
  if p_panel_number=2 and not exists(select 1 from public.pilot_panel_attempts where operation_id=p_operation_id and panel_number=1 and state='complete' and expense_micro is not null) then raise exception 'Save and account for panel one first'; end if;
  insert into public.pilot_panel_attempts(operation_id,panel_number,input_digest) values(p_operation_id,p_panel_number,p_input_digest);
  return true;
end;
$$;

create function public.pilot_record_panel(p_operation_id uuid,p_panel_number integer,p_claim_token uuid,p_state text,p_response_digest text,p_image_path text,p_image_digest text,p_expense_micro bigint,p_request_id text,p_elapsed_ms integer,p_error_code text) returns void
language plpgsql security definer set search_path='' as $$
declare previous public.pilot_panel_attempts;
begin
  perform 1 from public.pilot_generation_budget where id for update;
  if not exists(select 1 from public.pilot_jobs where operation_id=p_operation_id and state='running' and claim_token=p_claim_token) then raise exception 'Worker does not own this job'; end if;
  select * into strict previous from public.pilot_panel_attempts where operation_id=p_operation_id and panel_number=p_panel_number for update;
  if previous.expense_micro is not null and p_expense_micro is distinct from previous.expense_micro then raise exception 'Recorded expense cannot change'; end if;
  if previous.response_digest is not null and p_response_digest is distinct from previous.response_digest then raise exception 'Provider receipt cannot change'; end if;
  if previous.state='complete' and (p_state<>'complete' or p_image_digest is distinct from previous.image_digest or p_image_path is distinct from previous.image_path) then raise exception 'Delivered panel cannot change'; end if;
  if p_image_path is not null and p_image_path<>p_operation_id::text||'/'||p_panel_number::text||'.webp' then raise exception 'Invalid media path'; end if;
  update public.pilot_panel_attempts set state=p_state,response_digest=p_response_digest,image_path=p_image_path,image_digest=p_image_digest,
    expense_micro=p_expense_micro,request_id=p_request_id,elapsed_ms=p_elapsed_ms,error_code=p_error_code
    where operation_id=p_operation_id and panel_number=p_panel_number;
  if previous.expense_micro is null and p_expense_micro is not null then
    update public.pilot_jobs set held_micro=greatest(0,held_micro-1000000),updated_at=now() where operation_id=p_operation_id;
  end if;
end;
$$;

create function public.pilot_finish_job(p_operation_id uuid,p_claim_token uuid,p_error text default null) returns void
language plpgsql security definer set search_path='' as $$
declare j public.pilot_jobs; o public.pilot_operations; output jsonb; complete_count integer; unresolved integer; needs_recovery integer;
begin
  perform 1 from public.pilot_generation_budget where id for update;
  select * into strict j from public.pilot_jobs where operation_id=p_operation_id for update;
  if j.state='delivered' then return; end if;
  if j.state<>'running' or j.claim_token<>p_claim_token then raise exception 'Worker does not own this job'; end if;
  select * into strict o from public.pilot_operations where id=p_operation_id for update;
  select count(*) filter(where state='complete'),count(*) filter(where expense_micro is null),count(*) filter(where expense_micro is null or state in ('dispatching','uncertain')) into complete_count,unresolved,needs_recovery
    from public.pilot_panel_attempts where operation_id=p_operation_id;
  if complete_count=2 then
    select jsonb_agg(jsonb_build_object('imagePath',image_path,'sha256',image_digest,'caption',o.requested_captions->>(panel_number-1)) order by panel_number)
      into output from public.pilot_panel_attempts where operation_id=p_operation_id;
    update public.pilot_operations set status='delivered',panels=output,source_kind='openai',charged_units=1,generation_error=null where id=p_operation_id;
    update public.pilot_jobs set state='delivered',held_micro=unresolved*1000000,updated_at=now() where operation_id=p_operation_id;
  else
    update public.pilot_jobs set state=case when needs_recovery>0 then 'uncertain' else 'failed' end,held_micro=case when needs_recovery>0 then held_micro else 0 end,updated_at=now() where operation_id=p_operation_id;
    update public.pilot_operations set status=case when needs_recovery>0 then 'uncertain' else 'failed' end,
      generation_error=left(coalesce(p_error,'The complete result is not available yet.'),240) where id=p_operation_id;
  end if;
end;
$$;

create function public.pilot_discard(p_operation_id uuid) returns public.pilot_operations
language plpgsql security definer set search_path='' as $$
declare o public.pilot_operations;
begin
  select * into o from public.pilot_operations where id=p_operation_id and maker_id=auth.uid() for update;
  if not found then raise exception 'Contribution is unavailable'; end if;
  if o.status='discarded' then return o; end if;
  if o.status<>'delivered' then raise exception 'Only a delivered result can be discarded'; end if;
  update public.pilot_operations set status='discarded' where id=o.id returning * into o;
  return o;
end;
$$;

-- Draft images are read with the guest's bearer token. No public bucket or signed-link bypass.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
  ('pilot-media','pilot-media',false,4194304,array['image/webp']),
  ('pilot-receipts','pilot-receipts',false,16777216,array['application/json'])
on conflict(id) do nothing;
create function public.pilot_can_read_media(p_name text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.pilot_operations o join public.pilot_rooms r on r.id=o.room_id
    where r.is_open and p_name in (o.id::text||'/1.webp',o.id::text||'/2.webp')
    and (o.maker_id=auth.uid() or o.status='published'));
$$;
create policy pilot_media_read on storage.objects for select to anon, authenticated
  using(bucket_id='pilot-media' and public.pilot_can_read_media(name));

-- Deny default PUBLIC execution; worker functions are service-only.
revoke all on function public.pilot_save_continuation(uuid,text,uuid,text,text,jsonb),public.pilot_request_generation(uuid),public.pilot_discard(uuid),public.pilot_room_credits(text),public.pilot_can_read_media(text),public.pilot_claim_job(uuid,uuid),public.pilot_begin_panel(uuid,integer,text,uuid),public.pilot_record_panel(uuid,integer,uuid,text,text,text,text,bigint,text,integer,text),public.pilot_finish_job(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.pilot_save_continuation(uuid,text,uuid,text,text,jsonb),public.pilot_request_generation(uuid),public.pilot_discard(uuid) to authenticated;
grant execute on function public.pilot_room_credits(text),public.pilot_can_read_media(text) to anon, authenticated;
grant execute on function public.pilot_claim_job(uuid,uuid),public.pilot_begin_panel(uuid,integer,text,uuid),public.pilot_record_panel(uuid,integer,uuid,text,text,text,text,bigint,text,integer,text),public.pilot_finish_job(uuid,uuid,text) to service_role;
