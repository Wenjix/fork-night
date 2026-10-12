-- A moment may contain one to three panels. Existing rows retain their semantics.
-- Quotes reserve the exact image count; room credits retain the prior pair scale.
alter table public.pilot_moments drop constraint pilot_moments_panels_check;
alter table public.pilot_moments add constraint pilot_moments_panels_check
  check (jsonb_typeof(panels)='array' and jsonb_array_length(panels) between 1 and 3);
alter table public.pilot_operations drop constraint pilot_operations_check;
alter table public.pilot_operations add constraint pilot_operations_check check
  (status not in ('delivered','published','discarded') or
  (panels is not null and jsonb_typeof(panels)='array' and jsonb_array_length(panels) between 1 and 3 and source_kind is not null));
alter table public.pilot_operations drop constraint pilot_operations_charged_units_check;
alter table public.pilot_operations add constraint pilot_operations_charged_units_check check (charged_units between 0 and 2);
alter table public.pilot_operations add constraint pilot_requested_captions_count check
  (requested_captions is null or (jsonb_typeof(requested_captions)='array' and jsonb_array_length(requested_captions) between 1 and 3));
alter table public.pilot_panel_attempts drop constraint pilot_panel_attempts_panel_number_check;
alter table public.pilot_panel_attempts add constraint pilot_panel_attempts_panel_number_check check (panel_number between 1 and 3);
alter table public.pilot_jobs add column panel_count integer not null default 2 check (panel_count between 1 and 3);


create or replace function public.pilot_save_continuation(p_request_id uuid,p_room_id text,p_parent_id uuid,p_title text,p_prompt text,p_captions jsonb,p_idea_id uuid default null)
returns public.pilot_operations language plpgsql security definer set search_path='' as $$
declare result public.pilot_operations; idea public.pilot_ideas;
begin
  if p_captions is null or jsonb_typeof(p_captions)<>'array' or jsonb_array_length(p_captions) not between 1 and 3 then raise exception 'Choose one to three panels'; end if;
  if exists(select 1 from jsonb_array_elements(p_captions) c where jsonb_typeof(c)<>'string' or char_length(btrim(c#>>'{}')) not between 1 and 500) then raise exception 'Each panel needs 1–500 characters'; end if;
  if p_idea_id is not null then
    select * into idea from public.pilot_ideas where id=p_idea_id and room_id=p_room_id and moment_id=p_parent_id;
    if not found then raise exception 'Choose an idea on the source moment'; end if;
  end if;
  result:=public.pilot_save_draft(p_request_id,p_room_id,p_parent_id,p_title,p_prompt);
  select * into strict result from public.pilot_operations where id=result.id for update;
  if result.requested_captions is not null then
    if result.requested_captions<>p_captions then raise exception 'Request ID belongs to a different sequence'; end if;
    if result.source_idea_id is distinct from p_idea_id then raise exception 'Request ID belongs to a different idea'; end if;
  else
    if result.status<>'draft' then raise exception 'This contribution is already in progress'; end if;
    update public.pilot_operations set requested_captions=p_captions,source_idea_id=idea.id,source_idea_label=idea.maker_label,source_idea_body=idea.body
      where id=result.id returning * into result;
  end if;
  return result;
end;
$$;

create or replace function public.pilot_room_credits(p_room_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare capacity public.pilot_room_capacity; used integer; held integer;
begin
  if not exists(select 1 from public.pilot_rooms where id=p_room_id and is_open) then raise exception 'Room is unavailable'; end if;
  select * into capacity from public.pilot_room_capacity where room_id=p_room_id;
  select coalesce(sum(charged_units),0) into used from public.pilot_operations where room_id=p_room_id;
  select coalesce(sum((j.panel_count+1)/2),0) into held from public.pilot_jobs j join public.pilot_operations o on o.id=j.operation_id
    where o.room_id=p_room_id and o.charged_units=0 and j.state in ('queued','running','uncertain');
  return jsonb_build_object('limit',coalesce(capacity.delivery_limit,0),'used',used,'reserved',held,
    'available',greatest(0,coalesce(capacity.delivery_limit,0)-used-held),'enabled',(select enabled from public.pilot_generation_budget where id));
end;
$$;

create or replace function public.pilot_request_generation(p_operation_id uuid) returns public.pilot_jobs
language plpgsql security definer set search_path='' as $$
declare b public.pilot_generation_budget; o public.pilot_operations; j public.pilot_jobs; c public.pilot_room_capacity;
  committed bigint; admitted integer; room_committed integer; guest_attempts integer; ancestor uuid; depth integer:=0; requested integer; units integer;
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
  if o.status<>'draft' or o.requested_captions is null then raise exception 'Save your panel preview first'; end if;
  requested:=jsonb_array_length(o.requested_captions);
  units:=(requested+1)/2;
  if exists(select 1 from public.pilot_panel_attempts where expense_micro is null) then raise exception 'Generation is paused while a previous result is checked'; end if;
  if exists(select 1 from public.pilot_panel_attempts where expense_micro>1000000) then raise exception 'Generation is paused for an expense review'; end if;
  select b.imported_expense_micro+coalesce((select sum(expense_micro) from public.pilot_panel_attempts),0)+coalesce((select sum(held_micro) from public.pilot_jobs),0) into committed;
  select b.imported_requests+coalesce(sum(panel_count),0) into admitted from public.pilot_jobs;
  if committed+requested*1000000>b.cap_micro or admitted+requested>b.max_requests then raise exception 'The generation allowance has been used for this rehearsal'; end if;
  select * into c from public.pilot_room_capacity where room_id=o.room_id;
  if not found then raise exception 'This room has no generation allowance'; end if;
  select coalesce(sum(case when y.charged_units>0 then y.charged_units else (x.panel_count+1)/2 end),0) into room_committed from public.pilot_jobs x join public.pilot_operations y on y.id=x.operation_id
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
  insert into public.pilot_jobs(operation_id,panel_count,held_micro) values(o.id,requested,requested*1000000) returning * into j;
  update public.pilot_operations set status='queued',generation_error=null where id=o.id;
  return j;
end;
$$;

create or replace function public.pilot_begin_panel(p_operation_id uuid,p_panel_number integer,p_input_digest text,p_claim_token uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare b public.pilot_generation_budget; previous public.pilot_panel_attempts; requested integer;
begin
  select * into strict b from public.pilot_generation_budget where id for update;
  if not exists(select 1 from public.pilot_jobs where operation_id=p_operation_id and state='running' and claim_token=p_claim_token) then raise exception 'Worker does not own this job'; end if;
  select panel_count into strict requested from public.pilot_jobs where operation_id=p_operation_id;
  if p_panel_number is null or p_panel_number not between 1 and requested then raise exception 'Panel is outside the saved sequence'; end if;
  select * into previous from public.pilot_panel_attempts where operation_id=p_operation_id and panel_number=p_panel_number;
  if found then
    if previous.input_digest<>p_input_digest then raise exception 'Panel inputs changed'; end if;
    return false;
  end if;
  if not b.enabled then raise exception 'Generation is paused'; end if;
  if not exists(select 1 from public.pilot_operations o join public.pilot_rooms r on r.id=o.room_id where o.id=p_operation_id and r.is_open) then raise exception 'Room is unavailable'; end if;
  if exists(select 1 from public.pilot_panel_attempts where expense_micro is null or expense_micro>1000000) then raise exception 'Previous provider expense needs review'; end if;
  if (select count(*) from public.pilot_panel_attempts where operation_id=p_operation_id and panel_number<p_panel_number and state='complete' and expense_micro is not null)<>p_panel_number-1 then raise exception 'Save and account for the preceding panels first'; end if;
  insert into public.pilot_panel_attempts(operation_id,panel_number,input_digest) values(p_operation_id,p_panel_number,p_input_digest);
  return true;
end;
$$;

create or replace function public.pilot_finish_job(p_operation_id uuid,p_claim_token uuid,p_error text default null) returns void
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
  if complete_count=j.panel_count then
    select jsonb_agg(jsonb_build_object('imagePath',image_path,'sha256',image_digest,'caption',o.requested_captions->>(panel_number-1)) order by panel_number)
      into output from public.pilot_panel_attempts where operation_id=p_operation_id;
    update public.pilot_operations set status='delivered',panels=output,source_kind='openai',charged_units=(j.panel_count+1)/2,generation_error=null where id=p_operation_id;
    update public.pilot_jobs set state='delivered',held_micro=unresolved*1000000,updated_at=now() where operation_id=p_operation_id;
  else
    update public.pilot_jobs set state=case when needs_recovery>0 then 'uncertain' else 'failed' end,held_micro=case when needs_recovery>0 then held_micro else 0 end,updated_at=now() where operation_id=p_operation_id;
    update public.pilot_operations set status=case when needs_recovery>0 then 'uncertain' else 'failed' end,
      generation_error=left(coalesce(p_error,'The complete result is not available yet.'),240) where id=p_operation_id;
  end if;
end;
$$;

create or replace function public.pilot_can_read_media(p_name text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.pilot_operations o join public.pilot_rooms r on r.id=o.room_id
    where r.is_open and p_name in (select o.id::text||'/'||n::text||'.webp' from generate_series(1,coalesce(jsonb_array_length(o.requested_captions),jsonb_array_length(o.panels),0)) n)
    and (o.maker_id=auth.uid() or o.status='published'));
$$;

create or replace function public.pilot_claim_assist(p_actor uuid,p_request_id uuid,p_room_id text,p_parent_id uuid,p_kind text,p_digest text)
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
  if (p_kind='voice' and not lim.voice_enabled) or (p_kind='shape' and not lim.shape_enabled) then raise exception 'This helper is being set up. You can keep developing your idea.'; end if;
  total_limit:=case when p_kind='voice' then lim.voice_token_limit else lim.shape_request_limit end;
  guest_limit:=case when p_kind='voice' then lim.guest_voice_limit else lim.guest_shape_limit end;
  if (select count(*) from public.pilot_assist_requests where kind=p_kind)>=total_limit then raise exception 'This pilot helper has reached its allowance. Your draft is safe.'; end if;
  if (select count(*) from public.pilot_assist_requests where kind=p_kind and maker_id=p_actor)>=guest_limit then raise exception 'You have used your helper turns. You can keep editing by hand.'; end if;
  insert into public.pilot_assist_requests(request_id,maker_id,room_id,parent_id,kind,input_digest)
    values(p_request_id,p_actor,p_room_id,p_parent_id,p_kind,p_digest) returning * into existing;
  return jsonb_build_object('claimed',true,'request',to_jsonb(existing));
end;
$$;

-- CREATE OR REPLACE preserves the existing restricted function grants.
