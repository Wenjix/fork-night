import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { moderatoReader, tempoRpc } from "../../src/mpp/chain.ts";
import { createChargePort } from "../../src/mpp/charge.ts";
import { handleMppFunding } from "../../src/mpp/funding.ts";
import { MODERATO_RPC, MODERATO_TEST_TOKENS, MPP_COMMANDS, PATHUSD, mppRefillRequestId } from "../../src/mpp/ids.ts";
import { fundMppRoom, resumeMppAttempt, type MppPaymentAttempt } from "../../src/mpp/payer.ts";
import { MppWalletError, mppSigner } from "../../src/mpp/wallets.ts";
import { AGENT_TOKEN_HEADER } from "../../src/x402/config.ts";
import { BASE_SEPOLIA } from "../../src/x402/ids.ts";
import { check, fundPayer, init, renderCheck, tokenBalance } from "../../scripts/mpp-setup.ts";
import {
  blockNetwork, CHALLENGE_KEY, PAY_TO, REF, STEWARD, doorConfig, doorRooms, fakeAdapter, fakeKeccak, fakeModerato,
} from "./mpp-fakes.ts";
import { PAY_TO as X402_PAY_TO, memoryLedger, memoryStore } from "./x402-fakes.ts";

blockNetwork();

const TOKEN = Buffer.alloc(32, 5).toString("base64url");
const mode = async (path: string) => (await stat(path)).mode & 0o777;
const ROOT = fileURLToPath(new URL("../../", import.meta.url));

async function workspace(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "mpp-operator-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const paths = {
    configPath: join(root, ".local/mpp/config.json"),
    walletDir: join(root, ".local/mpp/wallets"),
    keyPath: join(root, ".local/mpp/challenge-key"),
    fundingPath: join(root, ".local/x402/funding.json"),
    tokenPath: join(root, ".local/x402/agent-token"),
  };
  await mkdir(dirname(paths.fundingPath), { recursive: true });
  await writeFile(paths.fundingPath, JSON.stringify({
    version: 1, payTo: { [BASE_SEPOLIA]: X402_PAY_TO[BASE_SEPOLIA] },
    rooms: { [REF]: { roomId: "paper-moon", stewardProfileId: STEWARD, maxTopUps: 7 } },
  }));
  await writeFile(paths.tokenPath, `${TOKEN}\n`, { mode: 0o600 });
  return { root, paths };
}

/** A scripted read-only Moderato for setup: chain ID, balanceOf and the faucet. */
function setupRpc(balances: Record<string, bigint> = {}, chainId = "0xa5bf") {
  const calls: string[] = [];
  const rpc = async <T>(method: string, params: unknown[]): Promise<T> => {
    calls.push(method);
    if (method === "eth_chainId") return chainId as T;
    if (method === "eth_call") {
      const owner = `0x${String((params[0] as { data: string }).data).slice(-40)}`.toLowerCase();
      return `0x${(balances[owner] ?? 0n).toString(16)}` as T;
    }
    if (method === "tempo_fundAddress") {
      balances[String(params[0]).toLowerCase()] = (balances[String(params[0]).toLowerCase()] ?? 0n) + 1_000_000_000_000n;
      return [`0x${"12".repeat(32)}`, `0x${"34".repeat(32)}`] as T;
    }
    throw new Error(`offline fake: ${method} is not scripted`);
  };
  return { rpc, calls, balances };
}

test("the root package.json stays untouched: MPP commands are the direct node form of existing scripts", async () => {
  const { scripts, dependencies = {}, devDependencies = {} } = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8")) as {
    scripts: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string>;
  };
  assert(!Object.keys(scripts).some((name) => name.startsWith("mpp:")), "no mpp:* npm scripts");
  assert(!("mppx" in dependencies) && !("mppx" in devDependencies), "mppx stays in vendor/mpp-adapter");
  const sources = [
    ...(await readdir(join(ROOT, "src"), { recursive: true })).map((name) => join("src", name)),
    ...(await readdir(join(ROOT, "scripts"), { recursive: true })).map((name) => join("scripts", name)),
  ].filter((name) => /\.(ts|tsx|mjs|js)$/.test(name));
  const named = new Set<string>(Object.values(MPP_COMMANDS));
  for (const file of sources) {
    const text = await readFile(join(ROOT, file), "utf8");
    assert(!/\b(?:npm|pnpm) run mpp:/.test(text), `${file} names an npm run mpp:* script, which does not exist`);
    for (const [command] of text.matchAll(/node --env-file-if-exists=\.env\.local scripts\/mpp-[\w.-]+\.ts/g)) named.add(command);
  }
  for (const command of named) {
    const target = command.split(" ").pop()!;
    assert.ok((await stat(join(ROOT, target)).catch(() => null))?.isFile(), `${command} runs ${target}, which does not exist`);
  }
});

test("setup opts an x402 room in to MPP with its own limit, creating 0600 wallets and key, and prints no secret", async (t) => {
  const { paths } = await workspace(t);
  const { adapter } = fakeAdapter();
  const lines: string[] = [];
  const result = await init(["--room", "paper-moon", "--skip-faucet"], paths, (line) => lines.push(line), null, adapter);
  assert.equal(result.ref, REF);
  assert.equal(result.url, `http://127.0.0.1:3005/api/mpp/fund/${REF}`);
  const config = JSON.parse(await readFile(paths.configPath, "utf8"));
  const payTo = JSON.parse(await readFile(join(paths.walletDir, "payto-tempo-moderato.json"), "utf8"));
  const payer = JSON.parse(await readFile(join(paths.walletDir, "payer-tempo-moderato.json"), "utf8"));
  assert.deepEqual(config, { version: 1, network: "eip155:42431", recipient: payTo.address, currency: PATHUSD, rooms: { "paper-moon": { maxTopUps: 2 } } });
  assert.deepEqual([payer.version, payer.kind, payer.role, payer.network], [1, "evm", "payer", "eip155:42431"]);
  assert.equal(payer.address, adapter.addressOf(payer.privateKey), "the key and address come from the adapter");
  for (const path of [paths.configPath, paths.keyPath, join(paths.walletDir, "payer-tempo-moderato.json"), join(paths.walletDir, "payto-tempo-moderato.json")])
    assert.equal(await mode(path), 0o600, path);
  assert.equal(await mode(paths.walletDir), 0o700);
  const key = (await readFile(paths.keyPath, "utf8")).trim();
  const output = lines.join("\n");
  for (const secret of [key, payer.privateKey, payTo.privateKey, TOKEN]) assert(!output.includes(secret), "init prints no key or token");
  assert.match(output, /x402 top-ups keep their own limit/);
  assert.match(output, /Next: node --env-file-if-exists=\.env\.local scripts\/mpp-setup\.ts check/);

  // Re-running keeps wallets and key and changes only this rail's limit.
  const again: string[] = [];
  await init(["--room", "paper-moon", "--max-top-ups", "9", "--skip-faucet"], paths, (line) => again.push(line), null, adapter);
  assert.equal(JSON.parse(await readFile(paths.configPath, "utf8")).rooms["paper-moon"].maxTopUps, 9);
  assert.equal((await readFile(paths.keyPath, "utf8")).trim(), key);
  assert.equal(JSON.parse(await readFile(join(paths.walletDir, "payer-tempo-moderato.json"), "utf8")).privateKey, payer.privateKey);
  assert.match(again.join("\n"), /at most 9 on this rail \(was 2\)/);
  // The x402 opt-in owns the room and its steward: no MPP door without it.
  await assert.rejects(init(["--room", "lighthouse", "--skip-faucet"], paths, () => {}, null, adapter), /not opted in.*npm run x402:setup -- init/);
  await rm(paths.tokenPath);
  await assert.rejects(init(["--room", "paper-moon", "--skip-faucet"], paths, () => {}, null, adapter), /No valid agent token/);
});

test("setup funds the payer from the Moderato faucet only on Moderato, and check reads without writing", async (t) => {
  const { paths } = await workspace(t);
  const { adapter } = fakeAdapter();
  const { rpc, calls, balances } = setupRpc();
  const lines: string[] = [];
  await init(["--room", "paper-moon"], paths, (line) => lines.push(line), rpc, adapter);
  const payer = JSON.parse(await readFile(join(paths.walletDir, "payer-tempo-moderato.json"), "utf8")).address.toLowerCase();
  assert.equal(balances[payer], 1_000_000_000_000n);
  assert.deepEqual(calls.filter((call) => call === "tempo_fundAddress"), ["tempo_fundAddress"]);
  assert.match(lines.join("\n"), /Faucet: the payer went from 0\.000000 to 1000000\.000000 test pathUSD/);
  assert.match(lines.join("\n"), /explore\.testnet\.tempo\.xyz\/tx\/0x1212/);
  // Funded payers are not topped up again.
  await init(["--room", "paper-moon"], paths, (line) => lines.push(line), rpc, adapter);
  assert.equal(calls.filter((call) => call === "tempo_fundAddress").length, 1);
  await assert.rejects(fundPayer(setupRpc({}, "0x1").rpc, payer, { adapter, sleep: async () => {} }), /not Tempo Moderato; nothing was requested/);
  assert.equal(await tokenBalance(rpc, PATHUSD, payer), 1_000_000_000_000n);

  const before = await readFile(paths.configPath, "utf8");
  const report = await check({ ...paths, rpc, rooms: null, adapter });
  const rendered = renderCheck(report);
  assert.equal(await readFile(paths.configPath, "utf8"), before);
  for (const topic of ["adapter", "chain", "offer", "key", "agent", "config"])
    assert.equal(report.find((item) => item.topic === topic)?.level, "PASS", `${topic}: ${rendered}`);
  assert.equal(report.find((item) => item.topic === "supabase")?.level, "FAIL");
  const key = (await readFile(paths.keyPath, "utf8")).trim();
  assert(!rendered.includes(key) && !rendered.includes(TOKEN), "check never prints a secret");
  // Without the adapter, check says how to install it instead of failing obscurely.
  const missing = renderCheck(await check({ ...paths, rpc, rooms: null, adapter: null }));
  assert.match(missing, /FAIL\s+adapter\s+the isolated MPP adapter is not loaded\. Install it once with: cd vendor\/mpp-adapter && pnpm install --frozen-lockfile/);
  // A room whose limit outlived its x402 opt-in is reported.
  await writeFile(paths.fundingPath, JSON.stringify({ version: 1, payTo: { [BASE_SEPOLIA]: X402_PAY_TO[BASE_SEPOLIA] }, rooms: {} }));
  assert.match(renderCheck(await check({ ...paths, rpc, rooms: null, adapter })), /paper-moon has an MPP limit but no x402 opt-in/);
});

// Child processes get the same guard as the tests: any request off this machine fails the run.
const GUARD = `data:text/javascript,${encodeURIComponent(`const real = globalThis.fetch;
  globalThis.fetch = (input, init) => new URL(input instanceof Request ? input.url : String(input)).hostname === "127.0.0.1"
    ? real(input, init) : Promise.reject(new Error("offline test: blocked"));`)}`;

test("the scripts print usage, drop the separator pnpm forwards, explain a missing adapter, and stop before any network call", async (t) => {
  const { root, paths } = await workspace(t);
  const env: NodeJS.ProcessEnv = {
    ...process.env, MPP_DOOR_CONFIG: paths.configPath, MPP_WALLET_DIR: paths.walletDir, MPP_CHALLENGE_KEY_FILE: paths.keyPath,
    X402_FUNDING_CONFIG: paths.fundingPath, X402_AGENT_TOKEN_FILE: paths.tokenPath, MPP_ADAPTER: join(root, "vendor/mpp-adapter/index.mjs"),
    // MPP_ADAPTER is honored only under test.
    NODE_ENV: "test",
  };
  for (const name of ["NODE_TEST_CONTEXT", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY"]) delete env[name];
  const run = (script: string, ...args: string[]) => promisify(execFile)(process.execPath,
    ["--import", GUARD, join(ROOT, "scripts", script), ...args], { cwd: root, env });
  const fails = (code: number, stderr: RegExp) => (error: { code?: number; stderr?: string }) => error.code === code && stderr.test(error.stderr ?? "");

  for (const args of [[], ["--"], ["--", "bogus"], ["check", "extra"]])
    await assert.rejects(run("mpp-setup.ts", ...args),
      fails(2, /^Usage:\n {2}node --env-file-if-exists=\.env\.local scripts\/mpp-setup\.ts init --room <roomId>/), JSON.stringify(args));
  await assert.rejects(run("mpp-setup.ts", "--", "init", "--room", "paper-moon", "--skip-faucet"),
    fails(1, /^mpp setup: The MPP adapter is not installed at .*vendor\/mpp-adapter\/index\.mjs\. Install it once with: cd vendor\/mpp-adapter && pnpm install --frozen-lockfile/));
  await assert.rejects(run("mpp-reconcile.ts", "--", "--bogus"), fails(1, /^Usage: node --env-file-if-exists=\.env\.local scripts\/mpp-reconcile\.ts \[--apply\]/));
  await assert.rejects(run("mpp-reconcile.ts"), fails(1, /mpp reconcile failed: .*\nNothing was written\./));
  await assert.rejects(run("mpp-status.ts", "--", "--json"), fails(1, /^mpp status: Status reads the shared pilot/));
  assert.match((await run("mpp-fund-room.ts", "--", "--help")).stdout, /^Usage: node --env-file-if-exists=\.env\.local scripts\/mpp-fund-room\.ts/);
  await assert.rejects(run("mpp-fund-room.ts", "--room", "lighthouse"), fails(1, /No room is opted in to MPP top-ups/));
});

/** The door behind a loopback HTTP server, over the adapter stand-in and an offline Moderato. */
async function room(t: TestContext, maxTopUps = 5) {
  const fake = fakeAdapter();
  const chain = fakeModerato(fake.adapter);
  const storage = memoryStore(), ledger = memoryLedger();
  const deps = {
    rooms: doorRooms(maxTopUps), charges: createChargePort(doorConfig(), { challengeKey: CHALLENGE_KEY, adapter: fake.adapter, rpc: chain.request }),
    chain: moderatoReader({ rpc: chain.rpc, keccak: fakeKeccak, sleep: async () => {}, spacingMs: 0 }), store: storage.store, ledger: ledger.ledger,
  };
  const seen = { agents: [] as (string | null)[], credentials: [] as string[], recordsWhenPaid: [] as number[] };
  const recordDir = await mkdtemp(join(tmpdir(), "mpp-payments-"));
  t.after(() => rm(recordDir, { recursive: true, force: true }));
  const server = createServer(async (incoming, outgoing) => {
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) if (typeof value === "string") headers.set(name, value);
    seen.agents.push(headers.get(AGENT_TOKEN_HEADER));
    if (headers.get(AGENT_TOKEN_HEADER) !== TOKEN) {
      outgoing.writeHead(404, { "content-type": "application/json" });
      outgoing.end(JSON.stringify({ error: "Not found." }));
      return;
    }
    const credential = headers.get("authorization");
    if (credential) {
      seen.credentials.push(credential);
      seen.recordsWhenPaid.push((await readdir(recordDir).catch(() => [])).length);
    }
    const request = new Request(`http://${incoming.headers.host}${incoming.url}`, { method: incoming.method, headers });
    const response = await handleMppFunding(request, decodeURIComponent(incoming.url!.split("/").pop()!), deps);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const { port } = server.address() as AddressInfo;
  const account = fake.adapter.accountFromKey(`0x${"44".repeat(32)}`);
  return { url: `http://127.0.0.1:${port}/api/mpp/fund/${REF}`, fake, chain, storage, ledger, seen, recordDir, account };
}

test("the patron agent pays over loopback: one signature, saved 0600 before it is sent, credited once", async (t) => {
  const { url, fake, chain, ledger, seen, recordDir, account } = await room(t);
  const summary = await fundMppRoom({ url, recordDir, agentToken: TOKEN, adapter: fake.adapter, account, expected: { payTo: PAY_TO, currency: PATHUSD }, rpc: chain.request });
  assert.equal(summary.outcome, "credited", summary.message);
  assert.equal(summary.status, 200);
  assert.equal(summary.credits?.added, 5);
  assert.equal(seen.credentials.length, 1);
  assert.deepEqual(seen.recordsWhenPaid, [1], "the signed payment was on disk before it was sent");
  assert.deepEqual(seen.agents, [TOKEN, TOKEN]);
  const [name] = await readdir(recordDir);
  assert.match(name, /-tempo-moderato\.json$/);
  assert.equal(await mode(join(recordDir, name)), 0o600);
  const record = JSON.parse(await readFile(join(recordDir, name), "utf8")) as MppPaymentAttempt;
  assert.equal(record.state, "credited");
  assert.equal(record.credential, seen.credentials[0]);
  assert.equal(summary.transaction, record.transaction);
  assert.equal(summary.explorerUrl, `https://explore.testnet.tempo.xyz/tx/${record.transaction}`);
  assert.equal(fake.adapter.readReceiptHeader(record.paymentReceipt ?? null)?.reference, record.transaction);
  assert(!JSON.stringify(record).includes(TOKEN), "the agent token is never recorded");
  assert.deepEqual([...ledger.refills.keys()], [mppRefillRequestId(record.transaction)]);
  await assert.rejects(resumeMppAttempt(join(recordDir, name), { agentToken: TOKEN }), /already credited/);
  assert.equal(chain.sentRaw.length, 1);
});

test("a pending payment is resumed with the same credential and credited once; a wrong offer is never signed", async (t) => {
  const { url, fake, chain, ledger, seen, recordDir, account } = await room(t);
  chain.setBroadcast("land-then-timeout");
  const pending = await fundMppRoom({ url, recordDir, agentToken: TOKEN, adapter: fake.adapter, account, expected: { payTo: PAY_TO }, rpc: chain.request });
  assert.equal(pending.outcome, "pending", pending.message);
  assert.match(pending.message, /--resume .*scripts\/mpp-reconcile\.ts; do not sign again/);
  chain.setBroadcast("land");
  const resumed = await resumeMppAttempt(pending.recordFile!, { agentToken: TOKEN });
  assert.equal(resumed.outcome, "credited", resumed.message);
  assert.equal(seen.credentials.length, 2);
  assert.equal(seen.credentials[0], seen.credentials[1], "the resume re-sent the identical credential");
  assert.equal(chain.sentRaw.length, 1, "nothing was signed or broadcast again");
  assert.equal(ledger.refills.size, 1);

  for (const expected of [{ payTo: `0x${"99".repeat(20)}` }, { payTo: PAY_TO, currency: MODERATO_TEST_TOKENS.alphaUSD }]) {
    const declined = await fundMppRoom({ url, recordDir, agentToken: TOKEN, adapter: fake.adapter, account, expected, rpc: chain.request });
    assert.equal(declined.outcome, "declined");
    assert.match(declined.message, /Nothing was signed/);
  }
  assert.equal((await readdir(recordDir)).length, 1);
  await assert.rejects(fundMppRoom({ url: "https://example.com/api/mpp/fund/x", recordDir, agentToken: TOKEN, adapter: fake.adapter, account }), /only pays rooms on this machine/);
  await assert.rejects(fundMppRoom({ url, recordDir, agentToken: "short", adapter: fake.adapter, account }), /No valid local agent token/);
});

test("a room at its MPP limit is refused before anything is signed", async (t) => {
  const { url, fake, chain, ledger, recordDir, account } = await room(t, 1);
  assert.equal((await fundMppRoom({ url, recordDir, agentToken: TOKEN, adapter: fake.adapter, account, rpc: chain.request })).outcome, "credited");
  const refused = await fundMppRoom({ url, recordDir, agentToken: TOKEN, adapter: fake.adapter, account, rpc: chain.request });
  assert.equal(refused.outcome, "refused");
  assert.match(refused.message, /top-up limit.*Nothing was signed/);
  assert.equal(chain.sentRaw.length, 1);
  assert.equal(ledger.refills.size, 1);
});

// Review fixes (12 October).

test("the payer never follows a redirect, and never resumes a record that points off this machine", async (t) => {
  const { url, fake, chain, ledger, recordDir, account } = await room(t);
  const listen = async (server: ReturnType<typeof createServer>) => {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
    return (server.address() as AddressInfo).port;
  };
  // A second loopback server that must never see the agent token or a credential.
  const elsewhere: string[] = [];
  const sink = await listen(createServer((incoming, outgoing) => { elsewhere.push(`${incoming.method} ${incoming.url}`); outgoing.end("{}"); }));
  // A front that relays the unpaid offer from the real room but redirects the paid request (or every request).
  let redirectAll = false;
  const front = await listen(createServer(async (incoming, outgoing) => {
    if (redirectAll || incoming.headers.authorization) {
      outgoing.writeHead(307, { location: `http://127.0.0.1:${sink}/steal` });
      outgoing.end();
      return;
    }
    const relayed = await fetch(url, { method: "POST", headers: { [AGENT_TOKEN_HEADER]: String(incoming.headers[AGENT_TOKEN_HEADER]) } });
    outgoing.writeHead(relayed.status, Object.fromEntries(relayed.headers));
    outgoing.end(Buffer.from(await relayed.arrayBuffer()));
  }));
  const frontUrl = `http://127.0.0.1:${front}/api/mpp/fund/${REF}`;
  const summary = await fundMppRoom({ url: frontUrl, recordDir, agentToken: TOKEN, adapter: fake.adapter, account, rpc: chain.request });
  assert.equal(summary.outcome, "unknown", summary.message);
  assert.match(summary.message, /do not sign a new one/);
  redirectAll = true;
  await assert.rejects(fundMppRoom({ url: frontUrl, recordDir, agentToken: TOKEN, adapter: fake.adapter, account, rpc: chain.request }), /Could not reach .*Nothing was signed/);
  assert.deepEqual(elsewhere, [], "the redirect target never saw a request");
  assert.deepEqual(chain.sentRaw, []);
  assert.equal(ledger.refills.size, 0);

  // A record whose url points off this machine is refused before any request is made.
  const [name] = await readdir(recordDir);
  const record = JSON.parse(await readFile(join(recordDir, name), "utf8")) as MppPaymentAttempt;
  const tampered = join(recordDir, "tampered.json");
  await writeFile(tampered, JSON.stringify({ ...record, url: "https://example.com/api/mpp/fund/x" }), { mode: 0o600 });
  let requests = 0;
  await assert.rejects(resumeMppAttempt(tampered, { agentToken: TOKEN, fetchImpl: async () => { requests += 1; return new Response(null, { status: 500 }); } }),
    /only pays rooms on this machine/);
  assert.equal(requests, 0);
});

test("the payer refuses to sign with a wallet file other users can read, and check fails it", async (t) => {
  const { paths } = await workspace(t);
  const { adapter } = fakeAdapter();
  await init(["--room", "paper-moon", "--skip-faucet"], paths, () => {}, null, adapter);
  const payerFile = join(paths.walletDir, "payer-tempo-moderato.json");
  const key = JSON.parse(await readFile(payerFile, "utf8")).privateKey as string;
  assert.equal((await mppSigner(adapter, "payer", paths.walletDir)).address.length, 42);
  await chmod(payerFile, 0o644);
  await assert.rejects(mppSigner(adapter, "payer", paths.walletDir),
    (error: Error) => error instanceof MppWalletError && /readable by other users; chmod 600 it/.test(error.message) && !error.message.includes(key.slice(2)));
  const report = await check({ ...paths, rpc: setupRpc().rpc, rooms: null, adapter });
  assert(report.some((item) => item.level === "FAIL" && item.topic === "wallet" && /payer-tempo-moderato\.json:? is readable by other users/.test(item.detail)), renderCheck(report));
  await chmod(payerFile, 0o600);
  assert.equal((await mppSigner(adapter, "payer", paths.walletDir)).address.length, 42);
});

test("the chain reader calls only the fixed Moderato RPC and never follows a redirect", async (t) => {
  const seen: [string, RequestRedirect | undefined][] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    seen.push([new URL(String(input instanceof Request ? input.url : input)).href, init?.redirect]);
    return Response.json({ jsonrpc: "2.0", id: 1, result: "0xa5bf" });
  });
  assert.equal(await tempoRpc()("eth_chainId", []), "0xa5bf");
  assert.deepEqual(seen, [["https://rpc.moderato.tempo.xyz/", "error"]]);
  assert.equal(MODERATO_RPC, "https://rpc.moderato.tempo.xyz");
});
