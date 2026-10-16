import assert from "node:assert/strict";

/** Only the disposable PostgreSQL harness calls this; no hosted connection. */
export async function proveWrenFundingConcurrency(execute, args) {
  const sql = async (source) => (await execute("psql", [...args, "-qAt", "-c", source])).stdout.trim();
  const requestA = "97100000-0000-4000-8000-000000000001", requestB = "97100000-0000-4000-8000-000000000002";
  const tokenA = "97200000-0000-4000-8000-000000000001", tokenB = "97200000-0000-4000-8000-000000000002";
  await sql(`insert into auth.users(id) values('97000000-0000-4000-8000-000000000001'),('97000000-0000-4000-8000-000000000002');
    insert into public.pilot_profiles(id,display_name) values('97000000-0000-4000-8000-000000000001','Purchase Alice'),('97000000-0000-4000-8000-000000000002','Purchase Bob');
    update public.pilot_generation_budget set enabled=true,execution_environment='DEVELOPMENT',cap_micro=10000000,imported_expense_micro=0;
    update public.pilot_room_capacity set delivery_limit=0 where room_id='kessler-ward';
    update public.pilot_wren_funding_policy set enabled=true,authorized_at=clock_timestamp()-interval '1 minute',expires_at=clock_timestamp()+interval '23 hours';
    insert into public.pilot_wren_requests(id,maker_id,room_id,parent_id,brief,input_digest,environment,state,claim_token,lease_until) values
    ('${requestA}','97000000-0000-4000-8000-000000000001','kessler-ward','15000000-0000-4000-8000-000000000001','Private A',repeat('a',64),'DEVELOPMENT','funding','${tokenA}',clock_timestamp()+interval '5 minutes'),
    ('${requestB}','97000000-0000-4000-8000-000000000002','kessler-ward','15000000-0000-4000-8000-000000000001','Private B',repeat('b',64),'DEVELOPMENT','funding','${tokenB}',clock_timestamp()+interval '5 minutes');`);
  const race = (request, token) => sql(`begin; set local role service_role;
    select public.pilot_claim_wren_payment('${request}','${token}')->>'state'; select pg_sleep(0.3); commit;`);
  const different = await Promise.all([race(requestA, tokenA), race(requestB, tokenB)]);
  assert.deepEqual(different.sort(), ["claimed", "pending"], "different hosted workers cannot claim two purchases");
  assert.equal(await sql("select count(*) from public.pilot_wren_payments"), "1");
  await sql("delete from public.pilot_wren_payments");
  const same = await Promise.all([race(requestA, tokenA), race(requestA, tokenA)]);
  assert.deepEqual(same.sort(), ["claimed", "existing"], "duplicate acknowledgement resumes one payment row");
  assert.equal(await sql("select count(*) from public.pilot_wren_payments"), "1");
  assert.equal(await sql("select delivery_limit from public.pilot_room_capacity where room_id='kessler-ward'"), "0", "claiming never grants fake credits");
  assert.equal(await sql("select cap_micro from public.pilot_generation_budget where id"), "10000000", "claims preserve the image dollar cap");
  console.log("Concurrent Wren funding proof passed: separate sessions claim one payment, replay one acknowledgement, and preserve credits and the inference cap.");
}
