import assert from "node:assert/strict";

// Invoked only by the disposable-cluster harness. Each contender uses a distinct
// psql process/connection and holds its transaction open to force overlapping work.
export async function provePilotConcurrency(execute, args) {
  const sql = async source => (await execute("psql", [...args, "-qAt", "-c", source])).stdout;
  const actorA = "86000000-0000-4000-8000-000000000001";
  const actorB = "86000000-0000-4000-8000-000000000002";
  await sql(`insert into auth.users values('${actorA}'),('${actorB}');
    insert into public.pilot_profiles(id,display_name) values('${actorA}','Concurrent Alice'),('${actorB}','Concurrent Bob');
    update public.pilot_generation_budget set enabled=true,execution_environment='DEVELOPMENT',cap_micro=10000000,imported_expense_micro=0,imported_requests=0;
    update public.pilot_rooms set is_open=true where id in ('midnight-signal','paper-moon');
    update public.pilot_room_capacity set delivery_limit=12,guest_attempt_limit=20;`);
  const save = (actor, request, room = "midnight-signal") => sql(`set role authenticated; set request.jwt.claim.sub='${actor}';
    select (public.pilot_save_continuation('${request}','${room}','10000000-0000-4000-8000-00000000000${room === "paper-moon" ? "2" : "1"}','Concurrent scene','Concurrent scene','["A small scene."]')).id;`).then(output => output.trim());
  const race = (actor, operation) => sql(`begin; set local role authenticated; set local request.jwt.claim.sub='${actor}';
    select public.pilot_request_generation('${operation}'::uuid)->>'state'; select pg_sleep(0.3); commit;`);
  const clean = () => sql(`delete from public.pilot_job_dispatches;
    delete from public.pilot_jobs; delete from public.pilot_operations;`);
  for (const [label, sameActor, sameOperation, sameRoom, requests, roomCredits] of [
    ["global request ceiling", false, false, false, 1, 12],
    ["room credit ceiling", false, false, true, 100, 1],
    ["one active generation per maker", true, false, false, 100, 12],
    ["same request acknowledged twice", true, true, true, 100, 12],
  ]) {
    await sql(`update public.pilot_generation_budget set max_requests=${requests}; update public.pilot_room_capacity set delivery_limit=${roomCredits};`);
    const one = await save(actorA, "87000000-0000-4000-8000-000000000001");
    const secondActor = sameActor ? actorA : actorB;
    const two = sameOperation ? one : await save(secondActor, "87000000-0000-4000-8000-000000000002", sameRoom ? "midnight-signal" : "paper-moon");
    const results = await Promise.allSettled([race(actorA, one), race(secondActor, two)]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, sameOperation ? 2 : 1, label);
    const totals = JSON.parse((await sql(`select json_build_object('jobs',count(*),'holds',sum(held_micro),'panels',sum(panel_count),'dispatches',(select count(*) from public.pilot_job_dispatches)) from public.pilot_jobs;`)).trim());
    assert.deepEqual(totals, { jobs: 1, holds: 1000000, panels: 1, dispatches: 1 }, label);
    for (const result of results) if (result.status === "rejected") assert.match(result.reason.stderr, /allowance has been used|needs more generation credits|existing generation/, label);
    await clean();
  }
  await sql(`update public.pilot_generation_budget set max_requests=100;
    update public.pilot_demo_limits set creation_enabled=true,room_limit=1,credit_limit=12;`);
  const create = (actor, request, title) => sql(`begin; set local role authenticated; set local request.jwt.claim.sub='${actor}';
    select public.pilot_create_room('${request}','paper-moon',1,'${title}')->>'roomId'; select pg_sleep(0.3); commit;`);
  let results = await Promise.allSettled([
    create(actorA, "88000000-0000-4000-8000-000000000001", "Shared moon A"),
    create(actorB, "88000000-0000-4000-8000-000000000002", "Shared moon B"),
  ]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1, "competing creators cannot exceed campaign capacity");
  for (const result of results) if (result.status === "rejected") assert.match(result.reason.stderr, /All demo rooms have been created/);
  await sql(`update public.pilot_demo_limits set campaign='retry-proof',room_limit=3,credit_limit=36;`);
  results = await Promise.allSettled([
    create(actorA, "88000000-0000-4000-8000-000000000003", "Retry moon"),
    create(actorA, "88000000-0000-4000-8000-000000000003", "Retry moon"),
  ]);
  assert(results.every(result => result.status === "fulfilled"), "same creation returns successfully twice");
  const rooms = results.map(result => result.value.trim());
  assert.equal(rooms[0], rooms[1], "same request opens the same room");
  const grants = JSON.parse((await sql(`select json_build_object('grants',count(*),'credits',sum(granted_credits),
    'roots',(select count(*) from public.pilot_moments m join public.pilot_room_creations c on c.room_id=m.room_id where c.campaign='retry-proof' and m.parent_id is null)) from public.pilot_room_creations where campaign='retry-proof';`)).trim());
  assert.deepEqual(grants, { grants: 1, credits: 12, roots: 1 });
  console.log("Concurrent PostgreSQL proof passed: separate sessions serialize request, credit, maker and campaign limits, including duplicate acknowledgements.");
}
