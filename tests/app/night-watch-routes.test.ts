import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NightWatchError } from "../../src/night-watch/http.ts";
import { authenticateMaker, FALLBACK_DISPLAY_NAME, type MakerLookup } from "../../src/night-watch/maker.ts";

const SESSION = `nws_${"a".repeat(32)}`;
// Shaped like a Supabase access token; it is never sent anywhere.
const TOKEN = "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJtYWtlciJ9.c2lnbmF0dXJlLW5vdC1yZWFs";
const MAKER_ID = "95000000-0000-4000-8000-0000000000aa";

/** Sets environment variables for one test (undefined deletes one) and restores them afterwards. */
function withEnv(t: TestContext, values: Record<string, string | undefined>) {
  const set = (entries: [string, string | undefined][]) => {
    for (const [key, value] of entries) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  };
  const saved = Object.keys(values).map((key) => [key, process.env[key]] as [string, string | undefined]);
  t.after(() => set(saved));
  set(Object.entries(values));
}

/** Resolves the app's "@/" alias as Next does, recording each aliased module a route asks for. */
function aliases(t: TestContext) {
  const loaded: string[] = [];
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (!specifier.startsWith("@/")) return next(specifier, context);
      loaded.push(specifier);
      return next(new URL(`../../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    },
  });
  t.after(() => hooks.deregister());
  return loaded;
}

type Call = (request: Request) => Promise<Response>;

async function routes(): Promise<[string, string, Call][]> {
  const me = await import("../../src/app/api/night-watch/me/route.ts");
  const sessions = await import("../../src/app/api/night-watch/sessions/route.ts");
  const confirm = await import("../../src/app/api/night-watch/sessions/[id]/confirm/route.ts");
  const revoke = await import("../../src/app/api/night-watch/sessions/[id]/revoke/route.ts");
  const params = () => ({ params: Promise.resolve({ id: SESSION }) });
  for (const module of [me, sessions, confirm, revoke]) assert.equal(module.runtime, "nodejs");
  return [
    ["GET", "/api/night-watch/me", (request) => me.GET(request)],
    ["POST", "/api/night-watch/sessions", (request) => sessions.POST(request)],
    ["POST", `/api/night-watch/sessions/${SESSION}/confirm`, (request) => confirm.POST(request, params())],
    ["POST", `/api/night-watch/sessions/${SESSION}/revoke`, (request) => revoke.POST(request, params())],
  ];
}

function request(method: string, path: string, headers: Record<string, string> = {}, origin = "http://127.0.0.1:3005") {
  const url = new URL(path, origin);
  return new Request(url, {
    method,
    headers: { host: url.host, ...headers },
    body: method === "POST" ? JSON.stringify({ hours: 2, maxPayments: 1, attemptAllowance: 1 }) : undefined,
  });
}

async function expectAnswer(response: Response, status: number, body: Record<string, unknown>, label: string) {
  assert.equal(response.status, status, label);
  assert.equal(response.headers.get("cache-control"), "no-store", label);
  assert.deepEqual(await response.json(), body, label);
}

async function scratch(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "night-watch-routes-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function offline(t: TestContext) {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("An offline test tried to reach the network.");
  });
}

test("the session routes are absent unless local controls are on and the request is loopback-only", async (t) => {
  const loaded = aliases(t);
  offline(t);
  withEnv(t, { PILOT_LOCAL_CONTROLS: undefined, VERCEL: undefined, NIGHT_WATCH_DIR: await scratch(t) });
  const all = await routes();
  const bearer = { authorization: `Bearer ${TOKEN}` };
  for (const [method, path, call] of all) {
    await expectAnswer(await call(request(method, path, bearer)), 404, { error: "Not found." }, `${method} ${path} without PILOT_LOCAL_CONTROLS`);
  }

  process.env.PILOT_LOCAL_CONTROLS = "1";
  const foreign: [string, (method: string, path: string) => Request][] = [
    ["a public host", (method, path) => request(method, path, bearer, "https://night-watch.example")],
    ["a LAN address", (method, path) => request(method, path, bearer, "http://192.168.1.20:3005")],
    ["a forwarded public host", (method, path) => request(method, path, { ...bearer, "x-forwarded-host": "night-watch.example" })],
    ["a forwarded client", (method, path) => request(method, path, { ...bearer, "x-forwarded-for": "203.0.113.9" })],
    ["a cross-site page", (method, path) => request(method, path, { ...bearer, origin: "https://evil.example", "sec-fetch-site": "cross-site" })],
  ];
  for (const [name, build] of foreign) {
    for (const [method, path, call] of all) {
      await expectAnswer(await call(build(method, path)), 404, { error: "Not found." }, `${method} ${path} from ${name}`);
    }
  }

  process.env.VERCEL = "1";
  for (const [method, path, call] of all) {
    await expectAnswer(await call(request(method, path, bearer)), 404, { error: "Not found." }, `${method} ${path} on Vercel`);
  }
  assert.ok(loaded.length > 0 && loaded.every((specifier) => specifier === "@/night-watch/http"), `only the gate loaded: ${loaded.join(", ")}`);
});

test("a local request without a maker's bearer token is refused with 401 before any Night Watch module loads", async (t) => {
  const loaded = aliases(t);
  offline(t);
  withEnv(t, { PILOT_LOCAL_CONTROLS: "1", VERCEL: undefined, NIGHT_WATCH_DIR: await scratch(t) });
  for (const [method, path, call] of await routes()) {
    for (const [name, headers] of [
      ["no Authorization header", {}],
      ["Basic credentials", { authorization: "Basic YWRtaW46YWRtaW4=" }],
      ["an empty bearer", { authorization: "Bearer " }],
      ["the browser's same-origin request without a token", { origin: "http://127.0.0.1:3005", "sec-fetch-site": "same-origin" }],
    ] as const) {
      await expectAnswer(
        await call(request(method, path, headers)),
        401,
        { error: "Sign in on this machine first.", code: "sign_in" },
        `${method} ${path} with ${name}`,
      );
    }
  }
  assert.ok(loaded.every((specifier) => specifier === "@/night-watch/http"), `only the gate loaded: ${loaded.join(", ")}`);
});

test("past the gate and the bearer check, a route verifies the maker with Supabase and says so when it cannot", async (t) => {
  const loaded = aliases(t);
  offline(t);
  withEnv(t, {
    PILOT_LOCAL_CONTROLS: "1",
    VERCEL: undefined,
    NIGHT_WATCH_DIR: await scratch(t),
    NEXT_PUBLIC_SUPABASE_URL: undefined,
    SUPABASE_SECRET_KEY: undefined,
  });
  for (const [method, path, call] of await routes()) {
    // A token that is not a JWT never reaches Supabase.
    await expectAnswer(
      await call(request(method, path, { authorization: `Bearer ${"x".repeat(40)}` })),
      401,
      { error: "Sign in with Google on this machine to authorize a Night Watch.", code: "sign_in" },
      `${method} ${path} with a malformed token`,
    );
    await expectAnswer(
      await call(request(method, path, { authorization: `Bearer ${TOKEN}` })),
      503,
      { error: "Supabase is not configured on this machine.", code: "not_configured" },
      `${method} ${path} without Supabase settings`,
    );
  }
  assert.ok(loaded.includes("@/night-watch/maker") && loaded.includes("@/night-watch/delegation"), loaded.join(", "));
});

function lookup(user: { id: string; saved: boolean } | null, name: string | null | Error = "Wenjie") {
  const seen: string[] = [];
  const directory: MakerLookup = {
    async user(token) {
      seen.push(`user ${token.length}`);
      return user;
    },
    async displayName(profileId) {
      seen.push(`profile ${profileId}`);
      if (name instanceof Error) throw name;
      return name;
    },
  };
  return { directory, seen };
}

async function refusedWith(promise: Promise<unknown>, status: number, code: string) {
  await assert.rejects(promise, (error: unknown) => error instanceof NightWatchError && error.status === status && error.code === code);
}

test("a maker is a saved Supabase account, named from their pilot profile", async (t) => {
  assert.deepEqual(await authenticateMaker(TOKEN, lookup({ id: MAKER_ID, saved: true }).directory), { id: MAKER_ID, displayName: "Wenjie" });
  assert.equal((await authenticateMaker(TOKEN, lookup({ id: MAKER_ID, saved: true }, "  Wen\n  jie ").directory)).displayName, "Wen jie");
  assert.equal((await authenticateMaker(TOKEN, lookup({ id: MAKER_ID, saved: true }, null).directory)).displayName, FALLBACK_DISPLAY_NAME);
  assert.equal((await authenticateMaker(TOKEN, lookup({ id: MAKER_ID, saved: true }, "   ").directory)).displayName, FALLBACK_DISPLAY_NAME);
  const quiet = t.mock.method(console, "error", () => undefined);
  assert.equal((await authenticateMaker(TOKEN, lookup({ id: MAKER_ID, saved: true }, new Error("profiles unavailable")).directory)).displayName, FALLBACK_DISPLAY_NAME);
  assert.equal(quiet.mock.callCount(), 1);

  const malformed = lookup({ id: MAKER_ID, saved: true });
  await refusedWith(authenticateMaker("not-a-jwt-but-long-enough", malformed.directory), 401, "sign_in");
  assert.deepEqual(malformed.seen, [], "a malformed token is refused without a lookup");
  await refusedWith(authenticateMaker(TOKEN, lookup(null).directory), 401, "sign_in");
  const guest = lookup({ id: MAKER_ID, saved: false });
  await refusedWith(authenticateMaker(TOKEN, guest.directory), 403, "google_required");
  assert.deepEqual(guest.seen, [`user ${TOKEN.length}`], "a guest's profile is not read");
  const outage: MakerLookup = {
    user: async () => { throw new NightWatchError(503, "auth_unavailable", "Your sign-in could not be checked right now."); },
    displayName: async () => null,
  };
  await refusedWith(authenticateMaker(TOKEN, outage), 503, "auth_unavailable");
});

const HTTP_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;
/** Plausible values for dynamic segments, keyed by "parent/[segment]" or "[segment]"; the gate runs before any is read. */
const SEGMENT_VALUES: Record<string, string> = {
  "sessions/[id]": SESSION,
  "jobs/[id]": `nwj_${"a".repeat(32)}`,
  "moments/[id]": "20000000-0000-4000-8000-000000000001",
  "[n]": "1",
  "[frame]": "0",
};

type DiscoveredRoute = { file: string; path: string; params: Record<string, string>; module: Record<string, unknown> };

/** Every route file under src/app/api/night-watch, found on disk so a new route is covered without editing this test. */
async function discoveredRoutes(): Promise<DiscoveredRoute[]> {
  const base = new URL("../../src/app/api/night-watch/", import.meta.url);
  const files = (await readdir(base, { recursive: true }))
    .map((name) => String(name).replaceAll("\\", "/"))
    .filter((name) => name === "route.ts" || name.endsWith("/route.ts"))
    .sort();
  const routes: DiscoveredRoute[] = [];
  for (const file of files) {
    const segments = file.split("/").slice(0, -1);
    const params: Record<string, string> = {};
    const concrete = segments.map((segment, index) => {
      const dynamic = /^\[(\w+)\]$/.exec(segment);
      if (!dynamic) return segment;
      const value = SEGMENT_VALUES[`${segments[index - 1]}/${segment}`] ?? SEGMENT_VALUES[segment] ?? "1";
      params[dynamic[1]] = value;
      return value;
    });
    const module = (await import(new URL(file, base).href)) as Record<string, unknown>;
    routes.push({ file: `src/app/api/night-watch/${file}`, path: `/api/night-watch/${concrete.join("/")}`, params, module });
  }
  return routes;
}

test("every Night Watch route on disk, for every method it exports, is absent off this machine and checks the gate first", async (t) => {
  const loaded = aliases(t);
  offline(t);
  withEnv(t, { PILOT_LOCAL_CONTROLS: undefined, VERCEL: undefined, NIGHT_WATCH_DIR: await scratch(t) });
  const routes = await discoveredRoutes();
  assert.ok(routes.length >= 14, `found ${routes.length} route files: ${routes.map((route) => route.file).join(", ")}`);

  const calls: [string, string, Call][] = [];
  for (const route of routes) {
    assert.equal(route.module.runtime, "nodejs", `${route.file} runs on Node`);
    const methods = HTTP_METHODS.filter((method) => typeof route.module[method] === "function");
    assert.ok(methods.length > 0, `${route.file} exports a handler`);
    // The gate is each handler's first statement: no work, no dynamic import before it.
    const source = await readFile(fileURLToPath(new URL(`../../${route.file}`, import.meta.url)), "utf8");
    for (const method of methods) {
      assert.match(
        source,
        new RegExp(`export async function ${method}\\(request: Request[^)]*\\) \\{\\s*const blocked = localOnly\\(request\\);\\s*if \\(blocked\\) return blocked;`),
        `${route.file} ${method} calls localOnly before anything else`,
      );
      const handler = route.module[method] as (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;
      calls.push([method, route.path, (request) => handler(request, { params: Promise.resolve(route.params) })]);
    }
  }

  const bearer = { authorization: `Bearer ${TOKEN}` };
  for (const [method, path, call] of calls) {
    await expectAnswer(await call(request(method, path, bearer)), 404, { error: "Not found." }, `${method} ${path} without PILOT_LOCAL_CONTROLS`);
  }

  process.env.PILOT_LOCAL_CONTROLS = "1";
  const foreign: [string, (method: string, path: string) => Request][] = [
    ["a public host", (method, path) => request(method, path, bearer, "https://night-watch.example")],
    ["a LAN address", (method, path) => request(method, path, bearer, "http://192.168.1.20:3005")],
    ["a public IPv6 address", (method, path) => request(method, path, bearer, "http://[2001:db8::7]:3005")],
    ["a public Host header", (method, path) => request(method, path, { ...bearer, host: "night-watch.example" })],
    ["a forwarded public host", (method, path) => request(method, path, { ...bearer, "x-forwarded-host": "night-watch.example" })],
    ["a forwarded client", (method, path) => request(method, path, { ...bearer, "x-forwarded-for": "203.0.113.9" })],
    ["a cross-site page", (method, path) => request(method, path, { ...bearer, origin: "https://evil.example", "sec-fetch-site": "cross-site" })],
  ];
  for (const [name, build] of foreign) {
    for (const [method, path, call] of calls) {
      await expectAnswer(await call(build(method, path)), 404, { error: "Not found." }, `${method} ${path} from ${name}`);
    }
  }

  process.env.VERCEL = "1";
  for (const [method, path, call] of calls) {
    await expectAnswer(await call(request(method, path, bearer)), 404, { error: "Not found." }, `${method} ${path} on Vercel, even with local controls on`);
  }
  assert.ok(loaded.every((specifier) => specifier === "@/night-watch/http"), `only the gate loaded: ${[...new Set(loaded)].join(", ")}`);
});
