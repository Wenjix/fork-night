-- A public, read-only view of the demonstration. Private requests, drafts,
-- payment credentials, claim tokens and operator budgets never leave this function.
create function public.pilot_kessler_overview() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare credits jsonb; limits public.pilot_wren_limits; funding public.pilot_wren_funding_policy;
begin
  if not exists(select 1 from public.pilot_rooms where id='kessler-ward' and is_open and is_listed) then
    return null;
  end if;
  credits:=public.pilot_room_credits('kessler-ward');
  select * into limits from public.pilot_wren_limits where id;
  select * into funding from public.pilot_wren_funding_policy where id;
  return jsonb_build_object(
    'roomId','kessler-ward',
    'checkedAt',statement_timestamp(),
    'credits',jsonb_build_object('enabled',credits->'enabled','available',credits->'available'),
    'story',(
      select jsonb_build_object('moments',count(*),'prepared',count(*) filter(where maker_id is null),
        'contributors',count(distinct maker_id),'published',count(*) filter(where maker_id is not null))
      from public.pilot_moments where room_id='kessler-ward'
    ),
    'wren',jsonb_build_object(
      'enabled',coalesce(limits.enabled,false),
      'published', (select count(*) from public.pilot_wren_assistance('kessler-ward')),
      'fundingEnabled',coalesce(funding.enabled,false),
      'payer',funding.steward,'accessKey',funding.access_key,
      'authorizationTx',funding.authorization_tx,'expiresAt',funding.expires_at,
      'allowanceAtomic',funding.allowance_atomic::text,
      'payments',coalesce((
        select jsonb_agg(jsonb_build_object(
          'transaction',p.payment->>'transaction','amount',p.payment->>'amount',
          'credits',5,'recordedAt',p.updated_at
        ) order by p.updated_at desc)
        from public.pilot_wren_payments p
        where p.room_id='kessler-ward' and p.state='credited' and p.receipt_id is not null
          and p.payment->>'roomId'='kessler-ward'
          and p.payment->>'network'='eip155:42431'
          and lower(p.payment->>'payer')=lower(funding.steward)
          and lower(p.payment->>'payTo')=lower(funding.pay_to)
          and lower(p.payment->>'currency')=lower(funding.currency)
          and p.payment->>'amount'='1000000'
          and p.payment->>'transaction' ~ '^0x[0-9a-f]{64}$'
      ),'[]'::jsonb)
    )
  );
end;
$$;
revoke all on function public.pilot_kessler_overview() from public;
grant execute on function public.pilot_kessler_overview() to anon,authenticated,service_role;
