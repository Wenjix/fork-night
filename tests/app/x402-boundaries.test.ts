import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_TOKEN_HEADER, FundingConfigError, loadFundingConfig, parseFundingConfig } from "../../src/x402/config.ts";
import { agentAuthorized, allowsLocalX402 } from "../../src/x402/gate.ts";
import {
  BASE_SEPOLIA, SOLANA_DEVNET, intentId, recordPaths, refillRequestId, uuidv5,
} from "../../src/x402/ids.ts";
import { PAY_TO, REF, STEWARD } from "./x402-fakes.ts";

test("refill request IDs are RFC 9562 version 5 UUIDs that converge for the same transaction", () => {
  assert.equal(uuidv5("www.example.com", "6ba7b810-9dad-11d1-80b4-00c04fd430c8"), "2ed6657d-e927-568b-95e1-2665a8aea6a2");
  // Golden values, cross-checked with Python's uuid.uuid5 under bb9e5c31-5e3f-4fb1-af58-efb407517d7f: the namespace
  // and the "<network>:<transaction>" name are fixed forever, or a reconciled payment could credit twice.
  assert.equal(refillRequestId(BASE_SEPOLIA, `0x${"ab".repeat(32)}`), "3e1087c8-e078-5ecc-9147-9bf004b4dda6");
  assert.equal(refillRequestId(BASE_SEPOLIA, `0x${"AB".repeat(32)}`), "3e1087c8-e078-5ecc-9147-9bf004b4dda6");
  assert.equal(
    refillRequestId(SOLANA_DEVNET, "66x87vdkTbzaT5FbJda2pKbSJKS5ggYkYHaNsozJEsiZHnp8X3sSo9e6cEg3STzBCYEr1AYYtrmaRK7iUjaH9jUb"),
    "45e4339c-e07d-58db-ac60-2346a3b44dd1",
  );
  const hash = "0xABCDEF0000000000000000000000000000000000000000000000000000000001";
  assert.equal(refillRequestId(BASE_SEPOLIA, hash), refillRequestId(BASE_SEPOLIA, hash.toLowerCase()));
  assert.match(refillRequestId(BASE_SEPOLIA, hash), /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  // Solana signatures are case-sensitive base58 and must not be folded.
  assert.notEqual(refillRequestId(SOLANA_DEVNET, "AbC"), refillRequestId(SOLANA_DEVNET, "abc"));
  assert.notEqual(refillRequestId(SOLANA_DEVNET, "abc"), refillRequestId(BASE_SEPOLIA, "abc"));
});

test("intent IDs identify one authorization regardless of address casing", () => {
  const evm = (payer: string, nonce: string) => intentId({ network: BASE_SEPOLIA, payer, nonce });
  assert.equal(evm("0xAbC", "0xDEF"), evm("0xabc", "0xdef"));
  assert.notEqual(evm("0xabc", "0x01"), evm("0xabc", "0x02"));
  const memo = "a".repeat(32);
  assert.match(intentId({ network: SOLANA_DEVNET, memo }), /^[a-f0-9]{64}$/);
  const paths = recordPaths(intentId({ network: SOLANA_DEVNET, memo }), "paper-moon");
  assert.match(paths.intent, /^x402\/intents\/[a-f0-9]{64}\.json$/);
  assert.match(paths.roomIndex, /^x402\/rooms\/paper-moon\/[a-f0-9]{64}\.json$/);
});

const valid = () => ({
  version: 1,
  payTo: { ...PAY_TO },
  rooms: { [REF]: { roomId: "paper-moon", stewardProfileId: STEWARD.toUpperCase(), maxTopUps: 2 } },
});

test("funding configuration accepts only reviewed testnets and well-formed opt-ins", () => {
  const config = parseFundingConfig(valid());
  assert.equal(config.facilitatorUrl, "https://x402.org/facilitator");
  assert.equal(config.rooms[REF].stewardProfileId, STEWARD);
  assert.equal(parseFundingConfig({ ...valid(), facilitatorUrl: "https://facilitator.payai.network/" }).facilitatorUrl,
    "https://facilitator.payai.network");
  const refused: [string, unknown][] = [
    ["mainnet Base", { ...valid(), payTo: { "eip155:8453": PAY_TO[BASE_SEPOLIA] } }],
    ["mainnet Solana", { ...valid(), payTo: { "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": PAY_TO[SOLANA_DEVNET] } }],
    ["Monad testnet (not reviewed here)", { ...valid(), payTo: { "eip155:10143": PAY_TO[BASE_SEPOLIA] } }],
    ["EVM address on Solana", { ...valid(), payTo: { [SOLANA_DEVNET]: PAY_TO[BASE_SEPOLIA] } }],
    ["no networks", { ...valid(), payTo: {} }],
    ["http facilitator", { ...valid(), facilitatorUrl: "http://x402.org/facilitator" }],
    ["credentials in URL", { ...valid(), facilitatorUrl: "https://user:pass@x402.org/facilitator" }],
    ["short reference", { ...valid(), rooms: { short: valid().rooms[REF] } }],
    ["room id", { ...valid(), rooms: { [REF]: { ...valid().rooms[REF], roomId: "../etc" } } }],
    ["steward", { ...valid(), rooms: { [REF]: { ...valid().rooms[REF], stewardProfileId: "steward" } } }],
    ["ceiling 0", { ...valid(), rooms: { [REF]: { ...valid().rooms[REF], maxTopUps: 0 } } }],
    ["ceiling 21", { ...valid(), rooms: { [REF]: { ...valid().rooms[REF], maxTopUps: 21 } } }],
    ["version", { ...valid(), version: 2 }],
  ];
  for (const [name, raw] of refused) assert.throws(() => parseFundingConfig(raw), FundingConfigError, name);
});

test("a missing configuration means this server has not opted in", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "x402-config-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  assert.equal(await loadFundingConfig(join(directory, "missing.json")), null);
  await writeFile(join(directory, "broken.json"), "{");
  await assert.rejects(loadFundingConfig(join(directory, "broken.json")), FundingConfigError);
  await writeFile(join(directory, "funding.json"), JSON.stringify(valid()));
  assert.equal((await loadFundingConfig(join(directory, "funding.json")))?.rooms[REF].roomId, "paper-moon");
});

test("the funding route exists only on an opted-in loopback server", (t) => {
  const original = { ...process.env };
  t.after(() => { process.env = original; });
  process.env.PILOT_LOCAL_CONTROLS = "1";
  delete process.env.VERCEL;
  const request = (headers: Record<string, string> = {}, url = "http://127.0.0.1:3005/api/x402/fund/ref") =>
    new Request(url, { method: "POST", headers: { host: "127.0.0.1:3005", ...headers } });

  // An agent sends neither Origin nor Sec-Fetch-Site; Next may report the URL as localhost. A LAN peer can forge
  // every one of these headers, so they are browser hygiene: the agent token is what admits a request.
  assert.equal(allowsLocalX402(request()), true);
  assert.equal(allowsLocalX402(request({}, "http://localhost:3005/api/x402/fund/ref")), true);
  assert.equal(allowsLocalX402(request({ origin: "http://127.0.0.1:3005", "sec-fetch-site": "same-origin" })), true);
  assert.equal(allowsLocalX402(request({ "x-forwarded-for": "127.0.0.1, ::1" })), true);

  for (const [name, refused] of [
    ["public URL", request({}, "https://public.example/api/x402/fund/ref")],
    ["public Host", request({ host: "evil.example" })],
    ["other port", request({ host: "127.0.0.1:9999" })],
    ["forwarded client", request({ "x-forwarded-for": "203.0.113.1" })],
    ["forwarded host", request({ "x-forwarded-host": "evil.example" })],
    ["cross-site origin", request({ origin: "https://evil.example" })],
    ["opaque origin", request({ origin: "null" })],
    ["cross-site fetch", request({ "sec-fetch-site": "cross-site" })],
    ["same-site fetch", request({ "sec-fetch-site": "same-site" })],
  ] as const) assert.equal(allowsLocalX402(refused), false, name);

  process.env.PILOT_LOCAL_CONTROLS = "0";
  assert.equal(allowsLocalX402(request()), false);
  process.env.PILOT_LOCAL_CONTROLS = "1";
  process.env.VERCEL = "1";
  assert.equal(allowsLocalX402(request()), false);
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
async function scratch(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "x402-agent-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
const TOKEN = Buffer.alloc(32, 7).toString("base64url");

test("only this machine's agent token admits a request, compared by digest", async (t) => {
  const tokenFile = join(await scratch(t), "agent-token");
  withEnv(t, { X402_AGENT_TOKEN_FILE: tokenFile });
  await writeFile(tokenFile, `${TOKEN}\n`, { mode: 0o600 });
  const request = (token?: string) => new Request(`http://127.0.0.1:3005/api/x402/fund/${REF}`, {
    method: "POST", headers: token === undefined ? {} : { [AGENT_TOKEN_HEADER]: token },
  });
  assert.equal(await agentAuthorized(request(TOKEN)), true);
  for (const [name, sent] of [
    ["no header", undefined],
    ["an empty header", ""],
    ["another token of the same length", Buffer.alloc(32, 8).toString("base64url")],
    ["a shorter value", TOKEN.slice(0, 12)],
    ["a longer value", `${TOKEN}${TOKEN}`],
  ] as const) assert.equal(await agentAuthorized(request(sent)), false, name);

  // Without a valid token file nothing is admitted, whatever is sent.
  await writeFile(tokenFile, "too-short\n");
  assert.equal(await agentAuthorized(request("too-short")), false, "malformed token file");
  await rm(tokenFile);
  assert.equal(await agentAuthorized(request(TOKEN)), false, "missing token file");
  await mkdir(tokenFile);
  assert.equal(await agentAuthorized(request(TOKEN)), false, "unreadable token file");
});

test("the route refuses a forged loopback request without the agent token, before any x402 code loads", async (t) => {
  const directory = await scratch(t);
  const configFile = join(directory, "funding.json"), tokenFile = join(directory, "agent-token");
  await writeFile(configFile, JSON.stringify(valid()));
  await writeFile(tokenFile, TOKEN);
  // Past the gate the route answers 503, because this test gives it no Supabase settings.
  withEnv(t, {
    PILOT_LOCAL_CONTROLS: "1", VERCEL: undefined, X402_FUNDING_CONFIG: configFile, X402_AGENT_TOKEN_FILE: tokenFile,
    NEXT_PUBLIC_SUPABASE_URL: undefined, SUPABASE_SECRET_KEY: undefined,
  });
  t.mock.method(globalThis, "fetch", async () => { throw new Error("An offline test tried to reach the network."); });
  // Resolves the app's "@/" alias as Next does, recording each module the route asks for.
  const loaded: string[] = [];
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (!specifier.startsWith("@/")) return next(specifier, context);
      loaded.push(specifier);
      return next(new URL(`../../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    },
  });
  t.after(() => hooks.deregister());
  const { POST } = await import("../../src/app/api/x402/fund/[fundingRef]/route.ts");
  const post = (headers: Record<string, string>) => POST(
    new Request(`http://localhost:3005/api/x402/fund/${REF}`, { method: "POST", headers }),
    { params: Promise.resolve({ fundingRef: REF }) },
  );

  // A LAN peer forging a loopback Host and X-Forwarded-For passes every header check (Next reports localhost).
  const forged = { host: "127.0.0.1:3005", "x-forwarded-for": "127.0.0.1" };
  assert.equal(allowsLocalX402(new Request(`http://localhost:3005/api/x402/fund/${REF}`, { method: "POST", headers: forged })), true);
  for (const headers of [forged, { ...forged, [AGENT_TOKEN_HEADER]: Buffer.alloc(32, 8).toString("base64url") }]) {
    const refused = await post(headers);
    assert.equal(refused.status, 404);
    assert.deepEqual(await refused.json(), { error: "Not found." });
  }
  assert.deepEqual(loaded, ["@/x402/gate"]);

  // The token, not the headers, admits the local agent.
  assert.equal((await post({ ...forged, [AGENT_TOKEN_HEADER]: TOKEN })).status, 503);
  assert.deepEqual(loaded, ["@/x402/gate", "@/x402/local"]);
});
