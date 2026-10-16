-- Real Tempo testnet purchases only. This migration grants no credits, authorizes
-- no access key, enables no payments, and changes no inference dollar ceiling.
create table public.pilot_wren_funding_policy (
  id boolean primary key default true check(id),
  enabled boolean not null default false,
  room_id text not null default 'kessler-ward' check(room_id='kessler-ward'),
  network text not null default 'eip155:42431' check(network='eip155:42431'),
  steward text not null default '0x951c8D90d0D1e81351ED802178823C60cce3BD98'
    check(lower(steward)='0x951c8d90d0d1e81351ed802178823c60cce3bd98'),
  pay_to text not null default '0x3B02f4be77C010d872Ace7149051003AB9855Ca1'
    check(lower(pay_to)='0x3b02f4be77c010d872ace7149051003ab9855ca1'),
  currency text not null default '0x20c0000000000000000000000000000000000000'
    check(lower(currency)='0x20c0000000000000000000000000000000000000'),
  access_key text not null default '0x814d643005ace60552737db7e6bd83d458bcab8d'
    check(access_key ~ '^0x[0-9a-fA-F]{40}$'),
  authorized_at timestamptz not null default '2026-10-12T23:24:42Z',
  expires_at timestamptz not null default '2026-10-13T23:24:42Z',
  authorization_tx text not null default '0x0b0efc93ede26b200161ca4cc4ce9fc78bc350474db141faff97a7642d65d37a'
    check(authorization_tx ~ '^0x[0-9a-fA-F]{64}$'),
  allowance_atomic bigint not null default 2000000 check(allowance_atomic=2000000),
  period_seconds integer not null default 86400 check(period_seconds=86400),
  -- One 1.00 payment leaves the rest of the 2.00 allowance for network fees.
  topups_per_day integer not null default 1 check(topups_per_day=1),
  check(expires_at>authorized_at and expires_at<=authorized_at+interval '24 hours')
);
insert into public.pilot_wren_funding_policy(id) values(true);

create table public.pilot_wren_payments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.pilot_wren_requests(id),
  room_id text not null check(room_id='kessler-ward'),
  actor_id uuid not null references public.pilot_profiles(id),
  state text not null default 'claimed' check(state in ('claimed','signed','pending','credited','blocked')),
  -- This write-once payload contains a public-on-broadcast signed credential,
  -- never the access key. Only service_role can read it.
  payment jsonb,
  receipt_id text,
  message text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check(payment is null or jsonb_typeof(payment)='object'),
  check(state not in ('signed','pending','credited') or payment is not null),
  check(state<>'credited' or receipt_id is not null)
);
alter table public.pilot_wren_funding_policy enable row level security;
alter table public.pilot_wren_payments enable row level security;
revoke all on public.pilot_wren_funding_policy,public.pilot_wren_payments from public,anon,authenticated;
grant all on public.pilot_wren_funding_policy,public.pilot_wren_payments to service_role;

create function public.pilot_wren_funding_preflight(p_request_id uuid,p_claim_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.pilot_wren_requests; p public.pilot_wren_funding_policy;
  b public.pilot_generation_budget; c public.pilot_room_capacity; credits jsonb;
  attempts integer; admitted integer; committed bigint;
begin
  select * into r from public.pilot_wren_requests where id=p_request_id for update;
  if not found or p_claim_token is null or r.claim_token is distinct from p_claim_token
    or r.lease_until is null or r.lease_until<=clock_timestamp() or r.state<>'funding' or r.room_id<>'kessler-ward'
    then raise exception 'The Wren funding claim is unavailable'; end if;
  select * into strict p from public.pilot_wren_funding_policy where id;
  select * into strict b from public.pilot_generation_budget where id;
  select * into c from public.pilot_room_capacity where room_id=r.room_id;
  if not found then raise exception 'This room has no generation allowance'; end if;
  credits:=public.pilot_room_credits(r.room_id);
  select count(*) into attempts from public.pilot_jobs j join public.pilot_operations o on o.id=j.operation_id
    where o.room_id=r.room_id and o.maker_id=r.maker_id;
  select b.imported_expense_micro+coalesce((select sum(accounted_micro) from public.pilot_panel_accounting),0)
    +coalesce((select sum(held_micro) from public.pilot_jobs),0) into committed;
  select b.imported_requests+coalesce(sum(panel_count),0) into admitted from public.pilot_jobs;
  return jsonb_build_object('roomId',r.room_id,'actorId',r.maker_id,'policy',to_jsonb(p),
    'creditsReady',coalesce((credits->>'available')::integer,0)>=1,
    'budgetReady',coalesce(b.enabled and b.execution_environment=r.environment and committed+1000000<=b.cap_micro
      and attempts<c.guest_attempt_limit and admitted+1<=b.max_requests and not public.pilot_spending_paused(true),false),
    'credits',credits);
end;
$$;

create function public.pilot_claim_wren_payment(p_request_id uuid,p_claim_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare f jsonb; p public.pilot_wren_funding_policy; result public.pilot_wren_payments;
begin
  -- A database lock covers every instance and every Wren request. A process-local
  -- MPP lock alone cannot enforce this boundary in hosted workers.
  perform pg_advisory_xact_lock(hashtextextended('fork-night-wren-funding',0));
  f:=public.pilot_wren_funding_preflight(p_request_id,p_claim_token);
  select * into result from public.pilot_wren_payments where request_id=p_request_id for update;
  if found then return jsonb_build_object('state','existing','payment',to_jsonb(result)); end if;
  if not (f->>'budgetReady')::boolean then
    return jsonb_build_object('state','blocked','message','The existing inference allowance cannot cover this preview.'); end if;
  if (f->>'creditsReady')::boolean then return jsonb_build_object('state','ready'); end if;
  select * into strict p from public.pilot_wren_funding_policy where id;
  if not p.enabled or p.expires_at<=clock_timestamp() or p.authorized_at>clock_timestamp() then
    return jsonb_build_object('state','blocked','message','Wren needs a current, explicitly authorized testnet allowance before buying credits.'); end if;
  if exists(select 1 from public.pilot_wren_payments where state in ('claimed','signed','pending')) then
    return jsonb_build_object('state','pending','message','A previous test-credit payment is being checked. No new payment was made.'); end if;
  if (select count(*) from public.pilot_wren_payments where created_at>clock_timestamp()-interval '24 hours')>=p.topups_per_day then
    return jsonb_build_object('state','blocked','message','Wren has used the existing testnet purchase allowance for this day.'); end if;
  insert into public.pilot_wren_payments(request_id,room_id,actor_id)
    values(p_request_id,f->>'roomId',(f->>'actorId')::uuid) returning * into result;
  return jsonb_build_object('state','claimed','payment',to_jsonb(result));
end;
$$;

create function public.pilot_save_wren_payment(p_request_id uuid,p_claim_token uuid,p_state text,p_payment jsonb default null,p_receipt_id text default null,p_message text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare f jsonb; prior public.pilot_wren_payments;
begin
  f:=public.pilot_wren_funding_preflight(p_request_id,p_claim_token);
  select * into strict prior from public.pilot_wren_payments where request_id=p_request_id for update;
  if p_state not in ('signed','pending','credited','blocked') then raise exception 'Invalid payment state'; end if;
  if prior.state='credited' then return to_jsonb(prior); end if;
  if prior.state='blocked' and p_state<>'blocked' then raise exception 'This payment needs operator review'; end if;
  if p_state='blocked' and (prior.payment is not null or p_payment is not null) then
    raise exception 'A signed payment must remain pending until its exact receipt is confirmed'; end if;
  if prior.payment is not null and p_payment is not null and prior.payment<>p_payment then
    raise exception 'A different payment is already recorded; never sign or broadcast another'; end if;
  if p_payment is not null and (
      p_payment->>'roomId' is distinct from prior.room_id or p_payment->>'actorId' is distinct from prior.actor_id::text
      or p_payment->>'network' is distinct from 'eip155:42431'
      or lower(p_payment->>'payTo') is distinct from '0x3b02f4be77c010d872ace7149051003ab9855ca1'
      or lower(p_payment->>'payer') is distinct from '0x951c8d90d0d1e81351ed802178823c60cce3bd98'
      or lower(p_payment->>'currency') is distinct from '0x20c0000000000000000000000000000000000000'
      or p_payment->>'amount' is distinct from '1000000'
      or coalesce(p_payment->>'credential','') not like 'Payment %'
      or coalesce(p_payment->>'transaction','') !~ '^0x[0-9a-f]{64}$'
      or coalesce(p_payment->>'intentId','') !~ '^[0-9a-f]{64}$'
    ) then raise exception 'The recorded payment does not match the fixed testnet purchase'; end if;
  if p_state='credited' and p_receipt_id is distinct from ('mpp/receipts/'||(coalesce(prior.payment,p_payment)->>'intentId')||'.json') then
    raise exception 'The receipt does not match this exact payment'; end if;
  update public.pilot_wren_payments set state=p_state,payment=coalesce(payment,p_payment),
    receipt_id=coalesce(receipt_id,p_receipt_id),message=left(p_message,240),updated_at=clock_timestamp()
    where id=prior.id returning * into prior;
  return to_jsonb(prior);
end;
$$;
revoke all on function public.pilot_wren_funding_preflight(uuid,uuid),public.pilot_claim_wren_payment(uuid,uuid),public.pilot_save_wren_payment(uuid,uuid,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.pilot_wren_funding_preflight(uuid,uuid),public.pilot_claim_wren_payment(uuid,uuid),public.pilot_save_wren_payment(uuid,uuid,text,jsonb,text,text) to service_role;

-- The hosted paid refill preserves every ordinary generation ceiling. The
-- historical local refill increases attempts and request slots; keep that
-- function unchanged for its existing receipts and operator workflows.
create function public.pilot_refill_wren_room(p_request_id uuid,p_room_id text,p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.pilot_generation_budget; c public.pilot_room_capacity; prior public.pilot_local_refills;
begin
  if p_request_id is null or p_actor is null or p_room_id is distinct from 'kessler-ward' then raise exception 'Choose the paid Kessler room first'; end if;
  if not exists(select 1 from public.pilot_profiles where id=p_actor) then raise exception 'The funding maker is unavailable'; end if;
  if not exists(select 1 from public.pilot_rooms where id=p_room_id and is_open) then raise exception 'Room is unavailable'; end if;
  -- Match generation admission and the historical refill lock order.
  select * into strict b from public.pilot_generation_budget where id for update;
  select * into prior from public.pilot_local_refills where request_id=p_request_id;
  if found then
    if prior.room_id<>p_room_id or prior.actor<>p_actor then raise exception 'This refill belongs to another room or maker'; end if;
    return jsonb_build_object('added',5,'replayed',true,'credits',public.pilot_room_credits(p_room_id));
  end if;
  select * into c from public.pilot_room_capacity where room_id=p_room_id for update;
  if not found then raise exception 'This room has no generation allowance'; end if;
  if c.delivery_limit>995 then raise exception 'This room has reached its test-credit limit'; end if;
  update public.pilot_room_capacity set delivery_limit=delivery_limit+5 where room_id=p_room_id;
  insert into public.pilot_local_refills(request_id,room_id,actor) values(p_request_id,p_room_id,p_actor);
  return jsonb_build_object('added',5,'replayed',false,'credits',public.pilot_room_credits(p_room_id));
end;
$$;
revoke all on function public.pilot_refill_wren_room(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.pilot_refill_wren_room(uuid,text,uuid) to service_role;
