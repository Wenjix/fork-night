import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { provePilotConcurrency } from "./pilot-db-concurrency.mjs";
import { proveWrenFundingConcurrency } from "./wren-funding-db-concurrency.mjs";

// A new isolated PostgreSQL cluster; never connects to or changes an existing database.
// The Auth shim tests database policy, not JWT signature verification or Supabase Auth.
const exec = promisify(execFile);
const binaries = process.env.FORK_NIGHT_TEST_PG_BIN ?? (await exec("pg_config", ["--bindir"])).stdout.trim();
const root = await mkdtemp(join(tmpdir(), "fork-night-pg-"));
const data = join(root, "data");
const socket = join(root, "socket");
await mkdir(socket);
// The unique socket directory isolates this cluster without opening a TCP port.
const port = 5432;
let started = false;
const execute = (program, args) => exec(join(binaries, program), args, { maxBuffer: 2 * 1024 * 1024 });
try {
  await execute("initdb", ["-D", data, "--username=fork_night_test", "--auth=trust", "--no-locale", "--encoding=UTF8"]);
  await execute("pg_ctl", ["-D", data, "-l", join(root, "server.log"), "-w", "-t", "20", "-o", `-c listen_addresses='' -p ${port} -k ${socket}`, "start"]);
  started = true;
  const bootstrap = join(root, "bootstrap.sql");
  await writeFile(bootstrap, `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth, public to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
alter table storage.objects enable row level security;
grant usage on schema storage to anon,authenticated,service_role;
grant select on storage.objects to anon,authenticated;
grant all on storage.objects,storage.buckets to service_role;
`);
  const args = ["-h", socket, "-p", String(port), "-U", "fork_night_test", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "--no-psqlrc"];
  const migrations=(await readdir("supabase/migrations")).filter(name=>name.endsWith(".sql")).sort().map(name=>resolve("supabase/migrations",name));
  const proofs=(await readdir("supabase/tests")).filter(name=>name.endsWith(".sql")).sort().map(name=>resolve("supabase/tests",name));
  for (const file of [bootstrap, ...migrations, resolve("supabase/seed.sql"), ...proofs])
    await execute("psql", [...args, "-f", file]);
  await provePilotConcurrency(execute, args);
  await proveWrenFundingConcurrency(execute, args);
  console.log("Pilot database proof passed: guest isolation, immutable authorship, idempotent drafts/publication, valid same-room parents and public reads. Auth is a test shim; no Supabase service or provider call was used.");
} catch (error) {
  console.error(error.stderr ?? error.message);
  process.exitCode = 1;
} finally {
  if (started) {
    try { await execute("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"]); started = false; }
    catch (error) { console.error("Could not stop isolated test database:", error.message); process.exitCode = 1; }
  }
  if (!started) await rm(root, { recursive: true, force: true });
  else console.error(`Preserved running test database files at ${root}`);
}
