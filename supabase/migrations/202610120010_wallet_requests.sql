-- Published makers submit through the authenticated server. Curator approval
-- remains onchain; a signed denial only closes the corresponding request.
create table public.pilot_wallet_requests (
  id uuid primary key,
  room_id text not null references public.pilot_rooms(id),
  project_id text not null check (project_id ~ '^0x[0-9a-f]{64}$'),
  moment_id uuid not null references public.pilot_moments(id),
  maker_id uuid not null references public.pilot_profiles(id),
  maker_label text not null,
  moment_title text not null,
  wallet_address text not null check (wallet_address ~ '^0x[0-9a-fA-F]{40}$' and lower(wallet_address) <> '0x0000000000000000000000000000000000000000'),
  issued_at bigint not null,
  signature text not null,
  state text not null default 'pending' check (state in ('pending', 'approved', 'denied')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decision_signature text,
  foreign key (moment_id, room_id) references public.pilot_moments(id, room_id)
);
create unique index pilot_wallet_request_pending on public.pilot_wallet_requests(project_id, maker_id) where state = 'pending';
create index pilot_wallet_requests_room on public.pilot_wallet_requests(room_id, created_at desc);
alter table public.pilot_wallet_requests enable row level security;
revoke all on public.pilot_wallet_requests from anon, authenticated;
grant all on public.pilot_wallet_requests to service_role;

-- The server verifies Auth identity and the wallet signature before calling.
-- A repeated request ID returns the exact existing request, never another wallet.
create function public.pilot_submit_wallet_request(
  p_id uuid, p_room_id text, p_project_id text, p_moment_id uuid, p_actor uuid,
  p_wallet text, p_issued_at bigint, p_signature text
) returns public.pilot_wallet_requests
language plpgsql security definer set search_path = '' as $$
declare source public.pilot_moments; result public.pilot_wallet_requests;
begin
  select * into source from public.pilot_moments
    where id = p_moment_id and room_id = p_room_id and maker_id = p_actor;
  if not found or not exists (select 1 from public.pilot_rooms where id = p_room_id and is_open) then
    raise exception 'Choose your own published scene in an open room';
  end if;
  -- Serialize submissions for this project and maker, including concurrent IDs.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_project_id || p_actor::text, 0));
  select * into result from public.pilot_wallet_requests where id = p_id;
  if found then
    if result.project_id <> p_project_id or result.room_id <> p_room_id or result.moment_id <> p_moment_id or
      result.maker_id <> p_actor or lower(result.wallet_address) <> lower(p_wallet) or result.issued_at <> p_issued_at or result.signature <> p_signature then
      raise exception 'This request ID already belongs to different inputs';
    end if;
    return result;
  end if;
  if exists (select 1 from public.pilot_wallet_requests where project_id = p_project_id and maker_id = p_actor and state = 'pending') then
    raise exception 'Your wallet request is already waiting for the curator';
  end if;
  insert into public.pilot_wallet_requests(id, room_id, project_id, moment_id, maker_id, maker_label, moment_title, wallet_address, issued_at, signature)
    values (p_id, p_room_id, p_project_id, p_moment_id, p_actor, source.maker_label, source.title, p_wallet, p_issued_at, p_signature)
    returning * into result;
  return result;
end;
$$;
revoke all on function public.pilot_submit_wallet_request(uuid, text, text, uuid, uuid, text, bigint, text) from public, anon, authenticated;
grant execute on function public.pilot_submit_wallet_request(uuid, text, text, uuid, uuid, text, bigint, text) to service_role;
