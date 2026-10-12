-- Isolated, private rehearsals. No pilot data, credits or provider work changes.
create table public.world_demo_runs (
  id uuid primary key,
  owner_id uuid not null references auth.users(id),
  world_key text not null default 'night-city-after-hours' check(world_key='night-city-after-hours'),
  terms_version text not null default 'concept-2026-10-04' check(terms_version='concept-2026-10-04'),
  revision integer not null default 0,
  created_at timestamptz not null default now()
);
create table public.world_demo_members (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.world_demo_runs(id),
  user_id uuid not null references auth.users(id),
  role text not null check(role in ('curator','maker','continuing')),
  label text not null,
  terms_version text not null,
  joined_at timestamptz not null default now(),
  unique(run_id,user_id), unique(run_id,role), unique(run_id,id)
);
create table public.world_demo_invitations (
  run_id uuid not null references public.world_demo_runs(id),
  role text not null check(role in ('maker','continuing')),
  token text not null unique default(replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','')),
  claimed_by uuid references auth.users(id),
  primary key(run_id,role)
);
create table public.world_demo_works (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.world_demo_runs(id),
  parent_id uuid,
  maker_id uuid,
  maker_label text not null,
  role text not null check(role in ('opening','maker','continuing')),
  title text not null check(length(title) between 1 and 80),
  panels jsonb not null,
  source_kind text not null default 'prepared-art-edited-caption',
  created_at timestamptz not null default now(),
  unique(run_id,id), unique(run_id,role),
  foreign key(run_id,parent_id) references public.world_demo_works(run_id,id),
  foreign key(run_id,maker_id) references public.world_demo_members(run_id,id)
);
create table public.world_demo_drafts (
  run_id uuid not null references public.world_demo_runs(id),
  member_id uuid not null,
  parent_id uuid not null,
  title text not null,
  panels jsonb not null,
  updated_at timestamptz not null default now(),
  primary key(run_id,member_id),
  foreign key(run_id,member_id) references public.world_demo_members(run_id,id),
  foreign key(run_id,parent_id) references public.world_demo_works(run_id,id)
);
create table public.world_demo_selections (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.world_demo_runs(id),
  source_id uuid not null,
  curator_id uuid not null,
  reason text not null check(length(reason) between 1 and 500),
  selected_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  foreign key(run_id,source_id) references public.world_demo_works(run_id,id),
  foreign key(run_id,curator_id) references public.world_demo_members(run_id,id)
);
create unique index world_demo_one_selection on public.world_demo_selections(run_id) where withdrawn_at is null;
create table public.world_demo_releases (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.world_demo_runs(id),
  source_id uuid not null,
  tip_id uuid not null,
  snapshot jsonb not null,
  digest text not null,
  created_at timestamptz not null default now(),
  unique(run_id),
  foreign key(run_id,source_id) references public.world_demo_works(run_id,id),
  foreign key(run_id,tip_id) references public.world_demo_works(run_id,id)
);
create table public.world_demo_commands (
  actor uuid not null references auth.users(id),
  request_id uuid not null,
  run_id uuid not null references public.world_demo_runs(id),
  kind text not null,
  payload jsonb not null,
  result_id uuid,
  primary key(actor,request_id)
);

-- Only the bounded functions below expose data. RLS also denies direct API
-- reads/writes, so drafts, invitation secrets and Auth IDs cannot leak via joins.
do $$ declare t text; begin
  foreach t in array array['runs','members','invitations','works','drafts','selections','releases','commands'] loop
    execute format('alter table public.world_demo_%I enable row level security',t);
    execute format('revoke all on public.world_demo_%I from public, anon, authenticated',t);
    execute format('grant all on public.world_demo_%I to service_role',t);
  end loop;
end $$;

create function public.world_demo_read(p_run_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare member public.world_demo_members; result jsonb;
begin
  select * into member from public.world_demo_members where run_id=p_run_id and user_id=auth.uid();
  if not found then raise exception 'This rehearsal is private. Open your invitation in the browser where you joined.'; end if;
  select jsonb_build_object(
    'id',r.id,'revision',r.revision,'termsVersion',r.terms_version,
    'me',jsonb_build_object('id',member.id,'role',member.role,'label',member.label),
    'members',(select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'role',m.role,'label',m.label) order by m.joined_at),'[]') from public.world_demo_members m where m.run_id=r.id),
    'works',(select coalesce(jsonb_agg(to_jsonb(w)-'run_id' order by w.created_at,w.id),'[]') from public.world_demo_works w where w.run_id=r.id),
    'draft',(select to_jsonb(d)-'run_id' from public.world_demo_drafts d where d.run_id=r.id and d.member_id=member.id),
    'selections',(select coalesce(jsonb_agg(to_jsonb(s)-'run_id' order by s.selected_at,s.id),'[]') from public.world_demo_selections s where s.run_id=r.id),
    'releases',(select coalesce(jsonb_agg(to_jsonb(v)-'run_id' order by v.created_at,v.id),'[]') from public.world_demo_releases v where v.run_id=r.id),
    'invitations',case when member.role='curator' then (select coalesce(jsonb_agg(jsonb_build_object('role',i.role,'token',case when i.claimed_by is null then i.token else null end,'claimed',i.claimed_by is not null) order by i.role),'[]') from public.world_demo_invitations i where i.run_id=r.id) else '[]'::jsonb end
  ) into result from public.world_demo_runs r where r.id=p_run_id;
  return result;
end $$;

-- Versioned runtime artwork is content-addressed; release pixels never follow a mutable filename.
create table public.world_demo_assets (
  id text primary key, path text not null, sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$')
);
alter table public.world_demo_assets enable row level security;
revoke all on public.world_demo_assets from public, anon, authenticated;
grant all on public.world_demo_assets to service_role;
insert into public.world_demo_assets(id,path,sha256) values
('hero','/world-demo/hero-4db281ac3107715bcf6837b49e7bfe5d10605f96ea7c5fc4c845c446dba1577e.webp','4db281ac3107715bcf6837b49e7bfe5d10605f96ea7c5fc4c845c446dba1577e'),
('source-writing','/world-demo/source-writing-ff200a90ef07ad57eb703217fbbb41d27e3700745488b9a53ac80b271b1a2292.webp','ff200a90ef07ad57eb703217fbbb41d27e3700745488b9a53ac80b271b1a2292'),
('source-ledger','/world-demo/source-ledger-9ddfab2e7a76cfb0c7cf9f8659a5ccba6d68042db7502b0fece1d35becabfbe5.webp','9ddfab2e7a76cfb0c7cf9f8659a5ccba6d68042db7502b0fece1d35becabfbe5'),
('outcome','/world-demo/outcome-793decfde65591fd484505487052ac235ab1fd3819f30802ec48890ef0a9e6f0.webp','793decfde65591fd484505487052ac235ab1fd3819f30802ec48890ef0a9e6f0');
create function public.world_demo_artifact_panels(p_panels jsonb) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_agg(jsonb_build_object('asset',e.value->>'asset','caption',e.value->>'caption',
    'artifact',jsonb_build_object('path',a.path,'sha256',a.sha256)) order by e.ordinality)
  from jsonb_array_elements(p_panels) with ordinality e
  join public.world_demo_assets a on a.id=e.value->>'asset';
$$;
revoke all on function public.world_demo_artifact_panels(jsonb) from public,anon,authenticated;

create function public.world_demo_create(p_run_id uuid,p_terms_version text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); existing public.world_demo_runs;
begin
  if v_actor is null then raise exception 'Start a guest session first.'; end if;
  if p_run_id is null or p_terms_version is distinct from 'concept-2026-10-04' then raise exception 'Read and accept the current rehearsal terms.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text,42));
  select * into existing from public.world_demo_runs where id=p_run_id;
  if found then
    if existing.owner_id<>v_actor then raise exception 'This rehearsal belongs to another account.'; end if;
    return public.world_demo_read(p_run_id);
  end if;
  if (select count(*) from public.world_demo_runs where owner_id=v_actor)>=5 then raise exception 'You have five rehearsals. Reopen an existing rehearsal.'; end if;
  insert into public.world_demo_runs(id,owner_id) values(p_run_id,v_actor);
  insert into public.world_demo_members(run_id,user_id,role,label,terms_version) values(p_run_id,v_actor,'curator','Demo curator',p_terms_version);
  insert into public.world_demo_invitations(run_id,role) values(p_run_id,'maker'),(p_run_id,'continuing');
  insert into public.world_demo_works(run_id,maker_label,role,title,panels,source_kind)
    values(p_run_id,'Prepared story opening','opening','The city after midnight',
      public.world_demo_artifact_panels('[{"asset":"hero","caption":"When the city goes quiet, Nika keeps the repair stall open. Every broken object has someone waiting for it."}]'),'prepared-opening');
  return public.world_demo_read(p_run_id);
end $$;

create function public.world_demo_join(p_run_id uuid,p_token text,p_terms_version text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); invitation public.world_demo_invitations;
begin
  if v_actor is null then raise exception 'Start a guest session first.'; end if;
  if p_terms_version is distinct from 'concept-2026-10-04' then raise exception 'Read and accept the current rehearsal terms.'; end if;
  perform 1 from public.world_demo_runs where id=p_run_id for update;
  select * into invitation from public.world_demo_invitations where run_id=p_run_id and token=p_token;
  if not found then raise exception 'This invitation is unavailable. Ask the rehearsal host for the original link.'; end if;
  if invitation.claimed_by=v_actor then return public.world_demo_read(p_run_id); end if;
  if invitation.claimed_by is not null then raise exception 'This seat has already been claimed. Reopen it in the original browser.'; end if;
  if exists(select 1 from public.world_demo_members where run_id=p_run_id and user_id=v_actor) then raise exception 'This account already has a role in this rehearsal. Open the invitation in a separate session.'; end if;
  insert into public.world_demo_members(run_id,user_id,role,label,terms_version)
    values(p_run_id,v_actor,invitation.role,case invitation.role when 'maker' then 'Mira' else 'Kai' end,p_terms_version);
  update public.world_demo_invitations set claimed_by=v_actor where run_id=p_run_id and role=invitation.role;
  update public.world_demo_runs set revision=revision+1 where id=p_run_id;
  return public.world_demo_read(p_run_id);
end $$;

create function public.world_demo_command(p_run_id uuid,p_request_id uuid,p_revision integer,p_kind text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid(); member public.world_demo_members; run public.world_demo_runs;
  receipt public.world_demo_commands; draft public.world_demo_drafts; source public.world_demo_works;
  tip public.world_demo_works; selection public.world_demo_selections;
  parent uuid; result_id uuid; title text; panels jsonb; panel jsonb; reason text;
  snapshot jsonb; path jsonb:='[]'; depth integer:=0; includes_source boolean:=false;
begin
  if v_actor is null then raise exception 'Start a guest session first.'; end if;
  if p_request_id is null or p_kind is null or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'This action is incomplete. Reload and try again.'; end if;
  -- Serialize a request even when a malicious replay targets another run.
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text||p_request_id::text,43));
  select * into member from public.world_demo_members where run_id=p_run_id and user_id=v_actor;
  if not found then raise exception 'This rehearsal is private. Open your invitation in the browser where you joined.'; end if;
  select * into strict run from public.world_demo_runs where id=p_run_id for update;
  select * into receipt from public.world_demo_commands c where c.actor=v_actor and c.request_id=p_request_id;
  if found then
    if receipt.run_id<>p_run_id or receipt.kind<>p_kind or receipt.payload<>p_payload then raise exception 'This request was already used for a different action. Reload before trying again.'; end if;
    return jsonb_build_object('state',public.world_demo_read(p_run_id),'replayed',true,'resultId',receipt.result_id);
  end if;
  if p_revision is distinct from run.revision then raise exception 'The rehearsal changed. Refresh to review the latest work before trying again.'; end if;
  if p_kind in ('save_draft','publish_work') then
    if member.role not in ('maker','continuing') then raise exception 'Only the invited maker can publish this contribution.'; end if;
    if exists(select 1 from public.world_demo_works where run_id=p_run_id and maker_id=member.id) then raise exception 'Your contribution is already published. Its authorship and panels are preserved.'; end if;
    select id into parent from public.world_demo_works where run_id=p_run_id and role=case member.role when 'maker' then 'opening' else 'maker' end;
    if parent is null then raise exception 'Mira needs to publish the source scene before Kai can continue it.'; end if;
    if p_kind='save_draft' then
      if p_payload - array['title','panels'] <> '{}'::jsonb then raise exception 'A draft accepts only a title and panels.'; end if;
      title:=btrim(p_payload->>'title'); panels:=p_payload->'panels';
      if title is null or length(title) not between 1 and 80 or jsonb_typeof(panels) is distinct from 'array' then raise exception 'Add a title of 1–80 characters and one to three panels.'; end if;
      if jsonb_array_length(panels) not between 1 and 3 then raise exception 'Choose one to three panels.'; end if;
      for panel in select value from jsonb_array_elements(panels) loop
        if jsonb_typeof(panel) is distinct from 'object' or panel - array['asset','caption'] <> '{}'::jsonb
          or jsonb_typeof(panel->'caption') is distinct from 'string' or length(btrim(panel->>'caption')) not between 1 and 500
          or coalesce(panel->>'asset','') not in ('source-writing','source-ledger','outcome') then raise exception 'Each panel needs prepared art and a caption of 1–500 characters.'; end if;
        if (member.role='maker' and panel->>'asset'='outcome') or (member.role='continuing' and panel->>'asset'<>'outcome') then raise exception 'Choose artwork prepared for your contribution.'; end if;
      end loop;
      insert into public.world_demo_drafts(run_id,member_id,parent_id,title,panels) values(p_run_id,member.id,parent,title,panels)
        on conflict(run_id,member_id) do update set title=excluded.title,panels=excluded.panels,updated_at=now();
      result_id:=member.id;
    else
      if p_payload<>'{}'::jsonb then raise exception 'Publish the saved draft without changing its credit.'; end if;
      select * into draft from public.world_demo_drafts where run_id=p_run_id and member_id=member.id;
      if not found then raise exception 'Save your draft before publishing it.'; end if;
      insert into public.world_demo_works(run_id,parent_id,maker_id,maker_label,role,title,panels)
        values(p_run_id,draft.parent_id,member.id,member.label,member.role,draft.title,public.world_demo_artifact_panels(draft.panels)) returning id into result_id;
      delete from public.world_demo_drafts where run_id=p_run_id and member_id=member.id;
    end if;
  elsif p_kind in ('select','withdraw','publish_release') then
    if member.role<>'curator' then raise exception 'Only the rehearsal curator can select or publish a release.'; end if;
    if exists(select 1 from public.world_demo_releases where run_id=p_run_id) then raise exception 'Chapter 2 is published. Its source, panels and credits are preserved.'; end if;
    if p_kind='select' then
      if p_payload - array['sourceId','reason'] <> '{}'::jsonb then raise exception 'Select an exact source and explain the selection.'; end if;
      select * into source from public.world_demo_works where run_id=p_run_id and id=(p_payload->>'sourceId')::uuid and role='maker';
      if not found then raise exception 'Choose a published source from this rehearsal.'; end if;
      reason:=btrim(p_payload->>'reason');
      if reason is null or length(reason) not between 1 and 500 then raise exception 'Explain the selection in 1–500 characters.'; end if;
      if exists(select 1 from public.world_demo_selections where run_id=p_run_id and withdrawn_at is null) then raise exception 'A source is already selected. Withdraw it before selecting again.'; end if;
      insert into public.world_demo_selections(run_id,source_id,curator_id,reason) values(p_run_id,source.id,member.id,reason) returning id into result_id;
    elsif p_kind='withdraw' then
      if p_payload<>'{}'::jsonb then raise exception 'Withdraw the current selection without extra fields.'; end if;
      update public.world_demo_selections set withdrawn_at=now() where run_id=p_run_id and withdrawn_at is null returning id into result_id;
      if result_id is null then raise exception 'There is no active selection to withdraw.'; end if;
    else
      if p_payload - array['tipId'] <> '{}'::jsonb then raise exception 'Choose the published continuation to release.'; end if;
      select * into selection from public.world_demo_selections where run_id=p_run_id and withdrawn_at is null;
      if not found then raise exception 'Select the source before publishing Chapter 2.'; end if;
      select * into tip from public.world_demo_works where run_id=p_run_id and id=(p_payload->>'tipId')::uuid and role='continuing';
      if not found then raise exception 'Kai needs to publish a continuation before Chapter 2 can be released.'; end if;
      source:=tip;
      loop
        depth:=depth+1;
        if depth>13 then raise exception 'The contribution path is too long.'; end if;
        path:=jsonb_build_array(to_jsonb(source)-'run_id')||path;
        if source.id=selection.source_id then includes_source:=true; end if;
        exit when source.parent_id is null;
        select * into source from public.world_demo_works where run_id=p_run_id and id=source.parent_id;
        if not found then raise exception 'The contribution path is incomplete.'; end if;
      end loop;
      if not includes_source then raise exception 'The released path must include the exact selected source.'; end if;
      snapshot:=jsonb_build_object('title','After Hours, Chapter 2','termsVersion',run.terms_version,
        'works',path,'sourceId',selection.source_id,'tipId',tip.id,
        'curator',jsonb_build_object('id',member.id,'label',member.label,'imaginedRole','Imagine Mike Pondsmith making the final selections'),
        'selectionReason',selection.reason,'publishedAt',now());
      insert into public.world_demo_releases(run_id,source_id,tip_id,snapshot,digest)
        values(p_run_id,selection.source_id,tip.id,snapshot,encode(sha256(convert_to(snapshot::text,'UTF8')),'hex')) returning id into result_id;
    end if;
  else raise exception 'This action is unavailable. Reload the rehearsal.';
  end if;
  update public.world_demo_runs set revision=revision+1 where id=p_run_id;
  insert into public.world_demo_commands(actor,request_id,run_id,kind,payload,result_id) values(v_actor,p_request_id,p_run_id,p_kind,p_payload,result_id);
  return jsonb_build_object('state',public.world_demo_read(p_run_id),'replayed',false,'resultId',result_id);
end $$;

revoke all on function public.world_demo_read(uuid), public.world_demo_create(uuid,text), public.world_demo_join(uuid,text,text), public.world_demo_command(uuid,uuid,integer,text,jsonb) from public,anon;
grant execute on function public.world_demo_read(uuid), public.world_demo_create(uuid,text), public.world_demo_join(uuid,text,text), public.world_demo_command(uuid,uuid,integer,text,jsonb) to authenticated;
