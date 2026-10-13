import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ADAPTER_PINS, MppAdapterError, checkAdapter, loadMppAdapter, mppAdapterPath } from "../../src/mpp/adapter.ts";
import {
  MppConfigError,
  loadMppConfig,
  mppRoomFor,
  parseMppConfig,
  readChallengeKey,
} from "../../src/mpp/config.ts";
import {
  MODERATO_TEST_TOKENS,
  PATHUSD,
  TEMPO_MODERATO,
  mppIntentId,
  mppRecordPaths,
  mppRefillRequestId,
} from "../../src/mpp/ids.ts";
import { AGENT_TOKEN_HEADER, parseFundingConfig } from "../../src/x402/config.ts";
import { allowsLocalX402 } from "../../src/x402/gate.ts";
import { BASE_SEPOLIA, intentId, refillRequestId, type Testnet } from "../../src/x402/ids.ts";
import { CHALLENGE_KEY, PAY_TO, REF, STEWARD, fakeAdapter } from "./mpp-fakes.ts";
import { PAY_TO as X402_PAY_TO } from "./x402-fakes.ts";

test("MPP refill request IDs are UUIDv5 of eip155:42431:<lowercase hash> in the x402 namespace", () => {
  // Golden values, cross-checked with Python's uuid.uuid5 under bb9e5c31-5e3f-4fb1-af58-efb407517d7f.
  assert.equal(mppRefillRequestId(`0x${"ab".repeat(32)}`), "141f4548-2b5b-549f-901a-61dc9327d9ec");
  assert.equal(mppRefillRequestId(`0x${"AB".repeat(32)}`), "141f4548-2b5b-549f-901a-61dc9327d9ec");
  assert.equal(mppRefillRequestId(`0x${"cd".repeat(32)}`), "29a1bef9-d6fe-5f2d-9d89-e9f995d6a1fb");
  // The x402 helper is typed to its two testnets and folds only Base: casting the Tempo network in would
  // give a second ID for the same uppercase hash, so a route and a reconciler could credit one payment twice.
  assert.equal(refillRequestId(TEMPO_MODERATO as Testnet, `0x${"AB".repeat(32)}`), "36a1a31b-6668-5a46-85af-5972e2be37d5");
  assert.notEqual(mppRefillRequestId(`0x${"ab".repeat(32)}`), refillRequestId(BASE_SEPOLIA, `0x${"ab".repeat(32)}`));
  assert.match(mppRefillRequestId(`0x${"ab".repeat(32)}`), /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
});

test("MPP intents are keyed by challenge and recorded only under mpp/", () => {
  const id = mppIntentId("YARwdN-A7dlVzZQj5RtiOiwCTRl5SixahCKORJxqNPs");
  assert.match(id, /^[a-f0-9]{64}$/);
  assert.notEqual(id, mppIntentId("another-challenge"));
  assert.notEqual(id, intentId({ network: BASE_SEPOLIA, payer: "0xabc", nonce: "0x01" }));
  const paths = mppRecordPaths(id, "paper-moon");
  assert.deepEqual(Object.values(paths).map((path) => path.split("/")[0]), ["mpp", "mpp", "mpp", "mpp", "mpp", "mpp"]);
  assert.equal(paths.roomIndex, `mpp/rooms/paper-moon/${id}.json`);
});

const valid = () => ({
  version: 1,
  network: TEMPO_MODERATO,
  recipient: PAY_TO,
  currency: PATHUSD,
  rooms: { "paper-moon": { maxTopUps: 3 } },
});

test("the MPP door config accepts only Tempo Moderato, its faucet test dollars and well-formed per-rail limits", () => {
  const config = parseMppConfig(valid());
  assert.deepEqual(config, { network: TEMPO_MODERATO, recipient: PAY_TO, currency: PATHUSD, rooms: { "paper-moon": { maxTopUps: 3 } } });
  const { currency: _currency, ...withoutCurrency } = valid();
  assert.equal(parseMppConfig(withoutCurrency).currency, PATHUSD);
  assert.equal(parseMppConfig({ ...valid(), currency: MODERATO_TEST_TOKENS.alphaUSD.toUpperCase().replace(/^0X/, "0x") }).currency,
    MODERATO_TEST_TOKENS.alphaUSD);
  const refused: [string, unknown][] = [
    ["Tempo mainnet", { ...valid(), network: "eip155:4217" }],
    ["no network", { ...valid(), network: undefined }],
    ["Base Sepolia", { ...valid(), network: BASE_SEPOLIA }],
    ["Solana address", { ...valid(), recipient: X402_PAY_TO["solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"] }],
    ["zero recipient", { ...valid(), recipient: `0x${"0".repeat(40)}` }],
    ["USDC.e", { ...valid(), currency: "0x20c0000000000000000000009e8d7eb59b783726" }],
    ["OUSD (also a mainnet token)", { ...valid(), currency: "0x20c0000000000000000000006a37DA5C996874BE" }],
    ["room id", { ...valid(), rooms: { "../etc": { maxTopUps: 1 } } }],
    ["limit 0", { ...valid(), rooms: { "paper-moon": { maxTopUps: 0 } } }],
    ["limit 21", { ...valid(), rooms: { "paper-moon": { maxTopUps: 21 } } }],
    ["version", { ...valid(), version: 2 }],
  ];
  for (const [name, raw] of refused) assert.throws(() => parseMppConfig(raw), MppConfigError, name);
});

test("a room is open to MPP only with an x402 opt-in and its own MPP limit; the x402 limit is never used", () => {
  const funding = parseFundingConfig({
    version: 1,
    payTo: { [BASE_SEPOLIA]: X402_PAY_TO[BASE_SEPOLIA] },
    rooms: { [REF]: { roomId: "paper-moon", stewardProfileId: STEWARD, maxTopUps: 7 } },
  });
  assert.deepEqual(mppRoomFor(funding, parseMppConfig(valid()), REF), { roomId: "paper-moon", stewardProfileId: STEWARD, maxTopUps: 3 });
  assert.equal(mppRoomFor(funding, parseMppConfig({ ...valid(), rooms: {} }), REF), null);
  assert.equal(mppRoomFor(funding, parseMppConfig(valid()), "ref_unknown_ccccccccccccccc"), null);
  assert.equal(mppRoomFor(funding, parseMppConfig(valid()), "toString"), null);
});

async function scratch(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "mpp-door-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("a missing MPP config or challenge key means this machine has not opted in", async (t) => {
  const directory = await scratch(t);
  assert.equal(await loadMppConfig(join(directory, "missing.json")), null);
  await writeFile(join(directory, "broken.json"), "{");
  await assert.rejects(loadMppConfig(join(directory, "broken.json")), MppConfigError);
  await writeFile(join(directory, "config.json"), JSON.stringify(valid()));
  assert.equal((await loadMppConfig(join(directory, "config.json")))?.rooms["paper-moon"].maxTopUps, 3);
  assert.equal(await readChallengeKey(join(directory, "missing-key")), null);
  await writeFile(join(directory, "short-key"), "too-short\n");
  assert.equal(await readChallengeKey(join(directory, "short-key")), null);
  await writeFile(join(directory, "challenge-key"), `${CHALLENGE_KEY}\n`);
  assert.equal(await readChallengeKey(join(directory, "challenge-key")), CHALLENGE_KEY);
});

/** Sets environment variables for one test (undefined deletes one) and restores them afterwards. */
function withEnv(t: TestContext, values: Record<string, string | undefined>) {
  const set = (entries: [string, string | undefined][]) => {
    for (const [key, value] of entries) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  };
  const saved = Object.keys(values).map((key) => [key, process.env[key]] as [string, string | undefined]);
  t.after(() => set(saved));
  set(Object.entries(values));
}
const TOKEN = Buffer.alloc(32, 7).toString("base64url");

test("the MPP route refuses a forged loopback request without the agent token, before any MPP code or mppx loads", async (t) => {
  const directory = await scratch(t);
  const fundingFile = join(directory, "funding.json"), configFile = join(directory, "config.json");
  const tokenFile = join(directory, "agent-token"), keyFile = join(directory, "challenge-key");
  await writeFile(fundingFile, JSON.stringify({
    version: 1, payTo: { [BASE_SEPOLIA]: X402_PAY_TO[BASE_SEPOLIA] },
    rooms: { [REF]: { roomId: "paper-moon", stewardProfileId: STEWARD, maxTopUps: 7 } },
  }));
  await writeFile(tokenFile, TOKEN);
  await writeFile(keyFile, CHALLENGE_KEY);
  // Past the gate the route answers 404 until MPP is configured, then 503: this test gives it no Supabase settings.
  withEnv(t, {
    PILOT_LOCAL_CONTROLS: "1", VERCEL: undefined, X402_FUNDING_CONFIG: fundingFile, X402_AGENT_TOKEN_FILE: tokenFile,
    MPP_DOOR_CONFIG: configFile, MPP_CHALLENGE_KEY_FILE: keyFile, NEXT_PUBLIC_SUPABASE_URL: undefined, SUPABASE_SECRET_KEY: undefined,
  });
  t.mock.method(globalThis, "fetch", async () => { throw new Error("An offline test tried to reach the network."); });
  // Resolves the app's "@/" alias as Next does, recording each alias, every mppx entry and the isolated adapter.
  const loaded: string[] = [];
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (specifier.startsWith("mppx") || specifier.includes("mpp-adapter")) loaded.push(specifier);
      if (!specifier.startsWith("@/")) return next(specifier, context);
      loaded.push(specifier);
      return next(new URL(`../../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    },
  });
  t.after(() => hooks.deregister());
  const { POST } = await import("../../src/app/api/mpp/fund/[fundingRef]/route.ts");
  const post = (headers: Record<string, string>) => POST(
    new Request(`http://localhost:3005/api/mpp/fund/${REF}`, { method: "POST", headers }),
    { params: Promise.resolve({ fundingRef: REF }) },
  );

  const forged = { host: "127.0.0.1:3005", "x-forwarded-for": "127.0.0.1" };
  assert.equal(allowsLocalX402(new Request(`http://localhost:3005/api/mpp/fund/${REF}`, { method: "POST", headers: forged })), true);
  for (const headers of [forged, { ...forged, [AGENT_TOKEN_HEADER]: Buffer.alloc(32, 8).toString("base64url") }, { ...forged, authorization: "Payment eyJ9" }]) {
    const refused = await post(headers);
    assert.equal(refused.status, 404);
    assert.equal(refused.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await refused.json(), { error: "Not found." });
  }
  assert.deepEqual(loaded, ["@/x402/gate"]);

  // The token admits the local agent; a room without an MPP limit is still unknown to this door.
  const unconfigured = await post({ ...forged, [AGENT_TOKEN_HEADER]: TOKEN });
  assert.equal(unconfigured.status, 404);
  assert.deepEqual(loaded, ["@/x402/gate", "@/mpp/local"]);
  await writeFile(configFile, JSON.stringify(valid()));
  assert.equal((await post({ ...forged, [AGENT_TOKEN_HEADER]: TOKEN })).status, 503);
  // Without Supabase the route stops before the adapter (and so mppx) is ever loaded.
  assert(!loaded.some((specifier) => specifier.startsWith("mppx") || specifier.includes("mpp-adapter")), loaded.join(", "));
});

test("src/mpp reaches mppx, viem, ox and Tempo only through the isolated adapter, loaded at run time", async () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const files = [
    ...(await readdir(join(root, "src/mpp"))).map((name) => join("src/mpp", name)),
    "src/app/api/mpp/fund/[fundingRef]/route.ts",
    ...(await readdir(join(root, "scripts"))).filter((name) => name.startsWith("mpp-")).map((name) => join("scripts", name)),
  ];
  for (const file of files) {
    const text = await readFile(join(root, file), "utf8");
    assert(!/(?:from\s+|import\s*\(\s*(?:\/\*[^*]*\*\/\s*)?)["'](?:mppx|viem|ox)(?:\/[^"']*)?["']/.test(text), `${file} imports mppx, viem or ox directly`);
  }
  const loader = await readFile(join(root, "src/mpp/adapter.ts"), "utf8");
  assert.match(loader, /import\(\/\* turbopackIgnore: true \*\/ pathToFileURL\(path\)\.href\)/);
  assert.match(loader, /resolve\(\/\*turbopackIgnore: true\*\/ \(process\.env\.NODE_ENV === "test" && process\.env\.MPP_ADAPTER\) \|\| "vendor\/mpp-adapter\/index\.mjs"\)/);
});

test("the adapter loader accepts only the reviewed adapter and explains how to install it", async (t) => {
  const directory = await scratch(t);
  await assert.rejects(loadMppAdapter(join(directory, "missing/index.mjs")),
    (error: Error) => error instanceof MppAdapterError && /is not installed at .*Install it once with: cd vendor\/mpp-adapter && pnpm install --frozen-lockfile/.test(error.message));
  // A module that is there but cannot load its own dependencies gets the same hint.
  await mkdir(join(directory, "broken"));
  await writeFile(join(directory, "broken/index.mjs"), 'import "mppx-not-installed-here";\n');
  await assert.rejects(loadMppAdapter(join(directory, "broken/index.mjs")), /not installed at|could not be loaded|not the reviewed adapter/);
  const { adapter } = fakeAdapter();
  assert.equal(checkAdapter(adapter), adapter);
  for (const [name, module] of [
    ["another adapter version", { ...adapter, adapterVersion: 2 }],
    ["another mppx", { ...adapter, versions: { ...adapter.versions, mppx: "0.14.0" } }],
    ["another viem", { ...adapter, versions: { ...adapter.versions, viem: "2.56.5" } }],
    ["another chain", { ...adapter, chainId: 4217 }],
    ["a missing function", { ...adapter, createPayment: undefined }],
    ["no faucet", { ...adapter, faucet: undefined }],
    ["nothing", null],
  ] as const) assert.throws(() => checkAdapter(module), MppAdapterError, name);
  const { adapterVersion, mppx, viem } = ADAPTER_PINS;
  assert.deepEqual({ adapterVersion, mppx, viem }, { adapterVersion: 1, mppx: "0.13.4", viem: "2.57.3" });
});

// Review fixes (12 October).

/** The route module under a new URL: a fresh instance whose imports resolve (and are recorded) again. */
const freshRoute = (name: string) => new URL(`../../src/app/api/mpp/fund/[fundingRef]/route.ts?case=${name}`, import.meta.url).href;

test("a valid token never opens the MPP route on a hosted, non-opted-in, non-loopback or cross-site request", async (t) => {
  const directory = await scratch(t);
  await writeFile(join(directory, "agent-token"), TOKEN);
  withEnv(t, {
    X402_AGENT_TOKEN_FILE: join(directory, "agent-token"), X402_FUNDING_CONFIG: join(directory, "missing-funding.json"),
    MPP_DOOR_CONFIG: join(directory, "missing-config.json"), PILOT_LOCAL_CONTROLS: undefined, VERCEL: undefined,
  });
  t.mock.method(globalThis, "fetch", async () => { throw new Error("An offline test tried to reach the network."); });
  const loaded: string[] = [];
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (!specifier.startsWith("@/")) return next(specifier, context);
      loaded.push(specifier);
      return next(new URL(`../../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    },
  });
  t.after(() => hooks.deregister());
  // A fresh module instance, so its imports resolve (and are recorded) again.
  const { POST } = await import(freshRoute("gate")) as typeof import("../../src/app/api/mpp/fund/[fundingRef]/route.ts");
  const post = (url: string, headers: Record<string, string>) =>
    POST(new Request(url, { method: "POST", headers: { [AGENT_TOKEN_HEADER]: TOKEN, ...headers } }), { params: Promise.resolve({ fundingRef: REF }) });
  const local = `http://127.0.0.1:3005/api/mpp/fund/${REF}`;
  const cases: [string, Record<string, string | undefined>, string, Record<string, string>][] = [
    ["VERCEL=1", { PILOT_LOCAL_CONTROLS: "1", VERCEL: "1" }, local, {}],
    ["PILOT_LOCAL_CONTROLS unset", { PILOT_LOCAL_CONTROLS: undefined, VERCEL: undefined }, local, {}],
    ["PILOT_LOCAL_CONTROLS=0 (what hosting:prepare sets)", { PILOT_LOCAL_CONTROLS: "0", VERCEL: undefined }, local, {}],
    ["a public Host", { PILOT_LOCAL_CONTROLS: "1", VERCEL: undefined }, `https://forknight.example/api/mpp/fund/${REF}`, {}],
    ["a cross-site Origin", { PILOT_LOCAL_CONTROLS: "1", VERCEL: undefined }, local, { origin: "https://evil.example" }],
    ["Sec-Fetch-Site cross-site", { PILOT_LOCAL_CONTROLS: "1", VERCEL: undefined }, local, { "sec-fetch-site": "cross-site" }],
  ];
  for (const [name, env, url, headers] of cases) {
    for (const [key, value] of Object.entries(env)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    const response = await post(url, headers);
    assert.equal(response.status, 404, name);
    assert.equal(response.headers.get("Cache-Control"), "no-store", name);
    assert.deepEqual(await response.json(), { error: "Not found." }, name);
    assert.deepEqual(loaded, ["@/x402/gate"], `${name}: no MPP code loaded`);
  }
  // Control: the same token on an opted-in local server passes the gate (404 only because no room is configured).
  process.env.PILOT_LOCAL_CONTROLS = "1";
  delete process.env.VERCEL;
  assert.equal((await post(local, {})).status, 404);
  assert.deepEqual(loaded, ["@/x402/gate", "@/mpp/local"], "the control request did pass the gate");
});

test("every method other than POST gets the same 404 as a refused POST, with or without the token, before any MPP code loads", async (t) => {
  const directory = await scratch(t);
  await writeFile(join(directory, "agent-token"), TOKEN);
  withEnv(t, { X402_AGENT_TOKEN_FILE: join(directory, "agent-token"), PILOT_LOCAL_CONTROLS: "1", VERCEL: undefined });
  const loaded: string[] = [];
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (!specifier.startsWith("@/")) return next(specifier, context);
      loaded.push(specifier);
      return next(new URL(`../../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    },
  });
  t.after(() => hooks.deregister());
  const route = await import(freshRoute("methods")) as Record<string, unknown>;
  const methods = ["GET", "HEAD", "PUT", "PATCH", "DELETE", "OPTIONS"];
  for (const method of methods) {
    const handler = route[method] as ((request: Request, context: unknown) => Response | Promise<Response>) | undefined;
    assert.equal(typeof handler, "function", `${method} is answered by the door, not by Next's 405/204 defaults`);
    for (const headers of [{}, { [AGENT_TOKEN_HEADER]: TOKEN }] as Record<string, string>[]) {
      for (const hosted of [undefined, "1"]) {
        if (hosted) process.env.VERCEL = hosted; else delete process.env.VERCEL;
        const response = await handler!(new Request(`http://127.0.0.1:3005/api/mpp/fund/${REF}`, { method, headers }), { params: Promise.resolve({ fundingRef: REF }) });
        assert.equal(response.status, 404, method);
        assert.equal(response.headers.get("Cache-Control"), "no-store", method);
        assert.equal(response.headers.get("Allow"), null, method);
        assert.deepEqual(await response.json(), { error: "Not found." }, method);
      }
    }
  }
  assert.deepEqual(Object.keys(route).filter((name) => /^[A-Z]+$/.test(name)).sort(), ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]);
  assert.deepEqual(loaded, ["@/x402/gate"]);
});

test("src/mpp reads only the documented environment variables, so the RPC and the adapter cannot be redirected by the environment", async () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const allowed = new Set(["MPP_DOOR_CONFIG", "MPP_CHALLENGE_KEY_FILE", "MPP_WALLET_DIR", "MPP_ADAPTER", "NODE_ENV", "SUPABASE_SECRET_KEY", "NEXT_PUBLIC_SUPABASE_URL"]);
  const files = [...(await readdir(join(root, "src/mpp"))).map((name) => join("src/mpp", name)), "src/app/api/mpp/fund/[fundingRef]/route.ts"];
  const read = new Set<string>();
  for (const file of files) {
    const text = await readFile(join(root, file), "utf8");
    assert(!/process\.env\s*\[/.test(text), `${file} reads the environment by a computed name`);
    for (const [, name] of text.matchAll(/process\.env\.([A-Za-z0-9_]+)/g)) read.add(name);
  }
  assert.deepEqual([...read].filter((name) => !allowed.has(name)), []);
  // MPP_ADAPTER is honored only under test; a dev or production server always loads the vendored adapter.
  const env = process.env as Record<string, string | undefined>;
  const saved = { NODE_ENV: env.NODE_ENV, MPP_ADAPTER: env.MPP_ADAPTER };
  try {
    env.MPP_ADAPTER = "/tmp/elsewhere/index.mjs";
    for (const value of ["development", "production", undefined]) {
      if (value) env.NODE_ENV = value; else delete env.NODE_ENV;
      assert(mppAdapterPath().endsWith(join("vendor", "mpp-adapter", "index.mjs")), `NODE_ENV=${value}`);
    }
    env.NODE_ENV = "test";
    assert.equal(mppAdapterPath(), "/tmp/elsewhere/index.mjs");
  } finally {
    for (const [key, value] of Object.entries(saved)) if (value === undefined) delete env[key]; else env[key] = value;
  }
});

// The public source export leaves vendor/ out (config/submission-files.json); there this check has nothing to compare.
const vendored = existsSync(fileURLToPath(new URL("../../vendor/mpp-adapter/index.mjs", import.meta.url)));
test("the loader imports only the reviewed adapter files: index.mjs and its lockfile must match the pinned SHA-256",
  vendored ? {} : { skip: "vendor/mpp-adapter is not in this source tree" }, async (t) => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const sha = async (path: string) => createHash("sha256").update(await readFile(path)).digest("hex");
  assert.equal(await sha(join(root, "vendor/mpp-adapter/index.mjs")), ADAPTER_PINS.indexSha256, "update ADAPTER_PINS.indexSha256 with index.mjs");
  assert.equal(await sha(join(root, "vendor/mpp-adapter/pnpm-lock.yaml")), ADAPTER_PINS.lockfileSha256, "update ADAPTER_PINS.lockfileSha256 with the lockfile");
  // A copy that differs by one byte is refused before it is imported.
  const directory = await scratch(t);
  await copyFile(join(root, "vendor/mpp-adapter/pnpm-lock.yaml"), join(directory, "pnpm-lock.yaml"));
  await writeFile(join(directory, "index.mjs"), `${await readFile(join(root, "vendor/mpp-adapter/index.mjs"), "utf8")}\n`);
  await assert.rejects(loadMppAdapter(join(directory, "index.mjs")), (error: Error) => error instanceof MppAdapterError && /not the reviewed adapter/.test(error.message));
  await writeFile(join(directory, "index.mjs"), await readFile(join(root, "vendor/mpp-adapter/index.mjs")));
  await writeFile(join(directory, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  await assert.rejects(loadMppAdapter(join(directory, "index.mjs")), (error: Error) => error instanceof MppAdapterError && /not the reviewed adapter/.test(error.message));
});
