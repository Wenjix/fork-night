import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

// A new isolated PostgreSQL cluster; never connects to or changes an existing database.
// The Auth shim tests database policy, not JWT signature verification or Supabase Auth.
const exec = promisify(execFile);
const binaries = process.env.FORK_NIGHT_TEST_PG_BIN ?? (await exec("pg_config", ["--bindir"])).stdout.trim();
const root = await mkdtemp(join(tmpdir(), "fork-night-pg-"));
const data = join(root, "data");
const socket = join(root, "socket");
await mkdir(socket);
const listener = createServer();
await new Promise((resolve, reject) => { listener.once("error", reject); listener.listen(0, "127.0.0.1", resolve); });
const address = listener.address();
assert(address && typeof address === "object");
const port = address.port;
await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
let started = false;
const execute = (program, args) => exec(join(binaries, program), args, { maxBuffer: 2 * 1024 * 1024 });
try {
  await execute("initdb", ["-D", data, "--username=fork_night_test", "--auth=trust", "--no-locale", "--encoding=UTF8"]);
  await execute("pg_ctl", ["-D", data, "-l", join(root, "server.log"), "-w", "-t", "20", "-o", `-h 127.0.0.1 -p ${port} -k ${socket}`, "start"]);
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
  const args = ["-h", "127.0.0.1", "-p", String(port), "-U", "fork_night_test", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "--no-psqlrc"];
  const migrations=(await readdir("supabase/migrations")).filter(name=>name.endsWith(".sql")).sort().map(name=>resolve("supabase/migrations",name));
  const proofs=(await readdir("supabase/tests")).filter(name=>name.endsWith(".sql")).sort().map(name=>resolve("supabase/tests",name));
  for (const file of [bootstrap, ...migrations, resolve("supabase/seed.sql"), ...proofs])
    await execute("psql", [...args, "-f", file]);
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
