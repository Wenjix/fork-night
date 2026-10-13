import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { address, getBase58Decoder } from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { pilotAdmin } from "../../src/generation/client.ts";
import { AGENT_TOKEN_PATTERN, FUNDING_REF_PATTERN, parseFundingConfig } from "../../src/x402/config.ts";
import {
  BASE_SEPOLIA, SOLANA_DEVNET, TESTNET_USDC, explorerUrl, intentId, recordPaths, type IntentKey,
} from "../../src/x402/ids.ts";
import { TESTNET_LABEL, activeTopUps, creditSettledPayment, recordEvent, type FundingIntent } from "../../src/x402/records.ts";
import { recordBytes, supabaseReceiptStore } from "../../src/x402/store.ts";
import {
  WalletError, createMissingWallets, evmSigner, inspectWallets, loadWallets, solanaSigner, walletDirectory,
} from "../../src/x402/wallets.ts";
import {
  SetupError, baseUsdcBalance, check, defaultPaths, init, parseSupported, renderCheck, solanaUsdcAccount, supportedLines,
  type CheckLine,
} from "../../scripts/x402-setup.ts";
import {
  collectRecords, readBudgetRows, readStatus, renderStatus, summarizeBudget, supabaseRoomReader, type RoomReader,
} from "../../scripts/x402-status.ts";
import { PAY_TO, STEWARD, fundingConfig, memoryLedger, memoryStore } from "./x402-fakes.ts";

// Trimmed from GET https://x402.org/facilitator/supported on 2026-10-12.
const FEE_PAYER = "CKPKJWNdJEqa81x7CkZ14BVPiY6y16Sxs7owznqtWYp5";
const SUPPORTED = {
  kinds: [
    { x402Version: 2, scheme: "exact", network: BASE_SEPOLIA },
    { x402Version: 2, scheme: "upto", network: BASE_SEPOLIA, extra: { facilitatorAddress: "0xd407e409E34E0b9afb99EcCeb609bDbcD5e7f1bf" } },
    { x402Version: 2, scheme: "exact", network: SOLANA_DEVNET, extra: { feePayer: FEE_PAYER, features: { smartWalletSupported: true } } },
    { x402Version: 2, scheme: "exact", network: "stellar:testnet", extra: { areFeesSponsored: true } },
    { x402Version: 1, scheme: "exact", network: "base-sepolia" },
    { x402Version: 1, scheme: "exact", network: "solana-devnet", extra: { feePayer: FEE_PAYER } },
  ],
  extensions: ["builder-code", "eip2612GasSponsoring", "erc20ApprovalGasSponsoring"],
  signers: { "eip155:*": ["0xd407e409E34E0b9afb99EcCeb609bDbcD5e7f1bf"], "solana:*": [FEE_PAYER] },
};

async function workspace(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "x402-operator-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return {
    configPath: join(root, "x402", "funding.json"),
    walletDir: join(root, "x402", "wallets"),
    tokenPath: join(root, "x402", "agent-token"),
  };
}
const quiet = () => {};
const mode = async (path: string) => (await stat(path)).mode & 0o777;

// Throwaway keys, generated in memory for each test.
function solanaKey() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const seed = Buffer.from(privateKey.export({ format: "jwk" }).d!, "base64url");
  const pub = Buffer.from(publicKey.export({ format: "jwk" }).x!, "base64url");
  return { address: getBase58Decoder().decode(pub), seed: [...seed], pub: [...pub] };
}
function evmWallet(role: string, overrides: Record<string, unknown> = {}) {
  const privateKey = generatePrivateKey();
  return { version: 1, kind: "evm", role, network: BASE_SEPOLIA, address: privateKeyToAccount(privateKey).address, privateKey, ...overrides };
}
function svmWallet(role: string, overrides: Record<string, unknown> = {}) {
  const key = solanaKey();
  return { version: 1, kind: "svm", role, network: SOLANA_DEVNET, address: key.address, secretKey: [...key.seed, ...key.pub], ...overrides };
}
const writeJson = (path: string, value: unknown) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
/** Every secret in a wallet directory, as it could appear in text. */
async function secretsIn(walletDir: string) {
  const secrets: string[] = [];
  for (const name of await readdir(walletDir)) {
    const wallet = JSON.parse(await readFile(join(walletDir, name), "utf8"));
    if (wallet.privateKey) secrets.push(wallet.privateKey, wallet.privateKey.slice(2));
    if (wallet.secretKey) secrets.push(JSON.stringify(wallet.secretKey), wallet.secretKey.join(","), Buffer.from(wallet.secretKey.slice(0, 32)).toString("hex"));
  }
  return secrets;
}
const ataOf = async (owner: string) => String((await findAssociatedTokenPda({
  owner: address(owner), mint: address(TESTNET_USDC[SOLANA_DEVNET]), tokenProgram: TOKEN_PROGRAM_ADDRESS,
}))[0]);

test("wallet files are validated for shape, network and key ownership without echoing key material", async (t) => {
  const { walletDir } = await workspace(t);
  const created = await createMissingWallets(walletDir);
  assert.equal(created.length, 4);
  assert.equal(await mode(walletDir), 0o700);
  const wallets = await loadWallets(walletDir);
  for (const role of ["payer", "payTo"] as const) {
    assert.match(wallets[role][BASE_SEPOLIA].address, /^0x[0-9a-fA-F]{40}$/);
    assert.match(wallets[role][SOLANA_DEVNET].address, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    assert.equal(wallets[role][BASE_SEPOLIA].mode, 0o600);
    assert.equal(await mode(wallets[role][SOLANA_DEVNET].path), 0o600);
  }
  assert.equal((await evmSigner("payer", walletDir)).address, wallets.payer[BASE_SEPOLIA].address);
  assert.equal((await solanaSigner("payTo", walletDir)).address, wallets.payTo[SOLANA_DEVNET].address);
  const secrets = await secretsIn(walletDir);
  const exposed = JSON.stringify({ wallets, checks: await inspectWallets(walletDir), signer: await evmSigner("payer", walletDir) });
  for (const secret of secrets) assert(!exposed.includes(secret), "public wallet data must not carry key material");

  // Mismatched keys, a wrong network, a wrong role and malformed files.
  const other = solanaKey(), stranger = svmWallet("payTo");
  await writeJson(join(walletDir, "payer-base-sepolia.json"), evmWallet("payer", { address: privateKeyToAccount(generatePrivateKey()).address }));
  await writeJson(join(walletDir, "payer-solana-devnet.json"), svmWallet("payer", { address: other.address }));
  await writeJson(join(walletDir, "payto-base-sepolia.json"), evmWallet("payTo", { network: "eip155:8453" }));
  await writeJson(join(walletDir, "payto-solana-devnet.json"), { ...stranger, secretKey: [...(stranger.secretKey as number[]).slice(0, 32), ...other.pub] });
  const problems = (await inspectWallets(walletDir)).map((item) => (item.ok ? "ok" : item.problem));
  assert.deepEqual(problems, [
    "payer-base-sepolia.json: privateKey does not match address",
    "payer-solana-devnet.json: secretKey does not match address",
    "payto-base-sepolia.json: network must be eip155:84532",
    "payto-solana-devnet.json: secretKey is not a valid ed25519 key pair",
  ]);
  await assert.rejects(loadWallets(walletDir), (error: Error) =>
    error instanceof WalletError && problems.every((problem) => error.message.includes(problem)));

  const leaky = `{"privateKey": "0x${"7".repeat(64)}" oops}`;
  const outOfRange = "f".repeat(64);
  await writeFile(join(walletDir, "payer-base-sepolia.json"), leaky);
  await writeJson(join(walletDir, "payto-base-sepolia.json"), evmWallet("payTo", { privateKey: `0x${outOfRange}` }));
  await writeJson(join(walletDir, "payer-solana-devnet.json"), svmWallet("payTo"));
  await writeJson(join(walletDir, "payto-solana-devnet.json"), svmWallet("payTo", { secretKey: [1, 2, 3] }));
  const malformed = await inspectWallets(walletDir);
  assert.deepEqual(malformed.map((item) => (item.ok ? "ok" : item.problem)), [
    "payer-base-sepolia.json: is not valid JSON",
    'payer-solana-devnet.json: role must be "payer"',
    "payto-base-sepolia.json: privateKey is not a valid secp256k1 key",
    "payto-solana-devnet.json: secretKey must be an array of 64 bytes",
  ]);
  const text = JSON.stringify(malformed);
  // The secp256k1 library's own error would print this key as a decimal number.
  for (const secret of ["7".repeat(64), outOfRange, BigInt(`0x${outOfRange}`).toString()]) assert(!text.includes(secret));

  await rm(join(walletDir, "payer-base-sepolia.json"));
  const [missing] = await inspectWallets(walletDir);
  assert.equal(missing.ok, false);
  assert.equal(!missing.ok && missing.missing, true);
  await assert.rejects(evmSigner("payer", walletDir), { code: "ENOENT" });
});

test("init writes a 0600 config with a fresh reference and payTo from the payto wallets, creating only missing wallets", async (t) => {
  const paths = await workspace(t);
  await mkdir(paths.walletDir, { recursive: true });
  const kept = `${JSON.stringify(evmWallet("payer"), null, 2)}\n`;
  await writeFile(join(paths.walletDir, "payer-base-sepolia.json"), kept, { mode: 0o600 });
  const log: string[] = [];
  const first = await init(["--room", "lighthouse", "--steward", STEWARD.toUpperCase()], paths, (line) => log.push(line));

  assert.match(first.ref, /^[A-Za-z0-9_-]{32}$/);
  assert.match(first.ref, FUNDING_REF_PATTERN);
  assert.equal(await mode(paths.configPath), 0o600);
  assert.deepEqual(first.created, ["payer-solana-devnet.json", "payto-base-sepolia.json", "payto-solana-devnet.json"]);
  assert.equal(await readFile(join(paths.walletDir, "payer-base-sepolia.json"), "utf8"), kept, "an existing wallet is never rewritten");
  const wallets = await loadWallets(paths.walletDir);
  const saved = JSON.parse(await readFile(paths.configPath, "utf8"));
  assert.deepEqual(parseFundingConfig(saved), {
    facilitatorUrl: "https://x402.org/facilitator",
    payTo: { [SOLANA_DEVNET]: wallets.payTo[SOLANA_DEVNET].address, [BASE_SEPOLIA]: wallets.payTo[BASE_SEPOLIA].address },
    rooms: { [first.ref]: { roomId: "lighthouse", stewardProfileId: STEWARD, maxTopUps: 2 } },
  });
  assert.equal(saved.version, 1);
  assert(log.includes(`Funding URL: http://127.0.0.1:3005/api/x402/fund/${first.ref}`));
  assert(log.some((line) => line.includes("--port")));
  const secrets = await secretsIn(paths.walletDir);
  for (const secret of secrets) assert(!log.join("\n").includes(secret), "init never prints key material");

  // The local agent token: 32 random bytes as base64url, mode 600 in a 700 directory, never printed.
  const token = await readFile(paths.tokenPath, "utf8");
  assert.match(token, /^[A-Za-z0-9_-]{43}\n$/);
  assert.match(token.trim(), AGENT_TOKEN_PATTERN);
  assert.equal(Buffer.from(token.trim(), "base64url").length, 32);
  assert.equal(await mode(paths.tokenPath), 0o600);
  assert.equal(await mode(dirname(paths.tokenPath)), 0o700);
  assert(log.includes(`Agent token created at ${paths.tokenPath} (mode 600); only the local payer sends it.`));
  assert(!log.join("\n").includes(token.trim()), "init never prints the agent token");

  // A second room keeps the first one and anything else in the file.
  await writeFile(paths.configPath, JSON.stringify({ ...saved, operatorNote: "keep me" }));
  const secondLog: string[] = [];
  const second = await init(["--room", "paper-moon", "--steward", STEWARD, "--max-top-ups", "3", "--port", "4010"], paths, (line) => secondLog.push(line));
  assert.notEqual(second.ref, first.ref);
  assert.equal(await readFile(paths.tokenPath, "utf8"), token, "an existing agent token is never replaced");
  assert(secondLog.includes(`Agent token kept at ${paths.tokenPath} (mode 600); only the local payer sends it.`));
  assert(!secondLog.join("\n").includes(token.trim()));
  assert.equal(second.url, `http://127.0.0.1:4010/api/x402/fund/${second.ref}`);
  assert.deepEqual(second.created, []);
  const both = JSON.parse(await readFile(paths.configPath, "utf8"));
  assert.equal(both.operatorNote, "keep me");
  assert.deepEqual(Object.keys(both.rooms).sort(), [first.ref, second.ref].sort());
  assert.deepEqual(both.rooms[second.ref], { roomId: "paper-moon", stewardProfileId: STEWARD, maxTopUps: 3 });
  assert.equal(await mode(paths.configPath), 0o600);

  // The same room again is refused unless the operator replaces its link.
  const before = await readFile(paths.configPath, "utf8");
  await assert.rejects(init(["--room", "lighthouse", "--steward", STEWARD], paths, quiet), (error: Error) =>
    error instanceof SetupError && /already has a funding reference.*--replace/.test(error.message));
  await assert.rejects(init(["--room", "lighthouse", "--steward", STEWARD, "--replace", "--facilitator", "https://other.example/facilitator"], paths, quiet),
    /already uses https:\/\/x402\.org\/facilitator/);
  await assert.rejects(init(["--room", "lighthouse", "--steward", "not-a-uuid"], paths, quiet), SetupError);
  await assert.rejects(init(["--room", "Light House", "--steward", STEWARD], paths, quiet), SetupError);
  await assert.rejects(init(["--room", "lighthouse", "--steward", STEWARD, "--max-top-ups", "21"], paths, quiet), SetupError);
  await assert.rejects(init(["--steward", STEWARD], paths, quiet), SetupError);
  await assert.rejects(init(["--room", "lighthouse", "--steward", STEWARD, "--rooms", "x"], paths, quiet), { code: "ERR_PARSE_ARGS_UNKNOWN_OPTION" });
  assert.equal(await readFile(paths.configPath, "utf8"), before, "a refused init leaves the config untouched");

  const replaced = await init(["--room", "lighthouse", "--steward", STEWARD, "--replace"], paths, quiet);
  const after = JSON.parse(await readFile(paths.configPath, "utf8"));
  assert.deepEqual(Object.keys(after.rooms).sort(), [second.ref, replaced.ref].sort());
  assert.equal(after.rooms[first.ref], undefined, "the replaced link stops working");
  assert.equal(after.operatorNote, "keep me");
  assert.deepEqual(after.payTo, saved.payTo);

  // A kept token is tightened back to mode 600 in a 700 directory, never rewritten.
  await chmod(paths.tokenPath, 0o644);
  await chmod(dirname(paths.tokenPath), 0o755);
  await init(["--room", "harbor", "--steward", STEWARD], paths, quiet);
  assert.equal(await readFile(paths.tokenPath, "utf8"), token);
  assert.equal(await mode(paths.tokenPath), 0o600);
  assert.equal(await mode(dirname(paths.tokenPath)), 0o700);
});

test("init refuses to build on an invalid config or wallet, and changes neither", async (t) => {
  const paths = await workspace(t);
  await mkdir(join(paths.configPath, ".."), { recursive: true });
  await writeFile(paths.configPath, "{ not json");
  await assert.rejects(init(["--room", "lighthouse", "--steward", STEWARD], paths, quiet), /is not valid JSON/);
  await assert.rejects(readdir(paths.walletDir), { code: "ENOENT" }, "nothing is created before the config is understood");
  await assert.rejects(stat(paths.tokenPath), { code: "ENOENT" });
  await writeFile(paths.configPath, JSON.stringify({ version: 1, payTo: { [BASE_SEPOLIA]: PAY_TO[BASE_SEPOLIA] }, rooms: {}, facilitatorUrl: "http://plain.example" }));
  await assert.rejects(init(["--room", "lighthouse", "--steward", STEWARD], paths, quiet), /plain https URL/);

  await rm(paths.configPath);
  await createMissingWallets(paths.walletDir);
  const broken = JSON.stringify(svmWallet("payTo", { network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" }));
  await writeFile(join(paths.walletDir, "payto-solana-devnet.json"), broken);
  await rm(join(paths.walletDir, "payer-base-sepolia.json"));
  await assert.rejects(init(["--room", "lighthouse", "--steward", STEWARD], paths, quiet), (error: Error) =>
    error instanceof WalletError && /payto-solana-devnet\.json: network must be solana:EtWT/.test(error.message));
  assert.equal(await readFile(join(paths.walletDir, "payto-solana-devnet.json"), "utf8"), broken);
  await assert.rejects(stat(join(paths.walletDir, "payer-base-sepolia.json")), { code: "ENOENT" }, "a refused init creates no wallet");
  await assert.rejects(stat(paths.configPath), { code: "ENOENT" });
  await assert.rejects(stat(paths.tokenPath), { code: "ENOENT" }, "a refused init creates no agent token");

  // An agent token that cannot be used is refused before anything is created, and left in place.
  await rm(join(paths.walletDir, "payto-solana-devnet.json"));
  await writeFile(paths.tokenPath, "not-a-token\n", { mode: 0o600 });
  await assert.rejects(init(["--room", "lighthouse", "--steward", STEWARD], paths, quiet), (error: Error) =>
    error instanceof SetupError && error.message === `${paths.tokenPath} is not a valid agent token; move it aside and run init to create a new one.`);
  assert.equal(await readFile(paths.tokenPath, "utf8"), "not-a-token\n");
  await assert.rejects(stat(join(paths.walletDir, "payer-base-sepolia.json")), { code: "ENOENT" });
  await assert.rejects(stat(paths.configPath), { code: "ENOENT" });
});

test("default operator paths honor X402_FUNDING_CONFIG, X402_WALLET_DIR and X402_AGENT_TOKEN_FILE", (t) => {
  const names = ["X402_FUNDING_CONFIG", "X402_WALLET_DIR", "X402_AGENT_TOKEN_FILE"];
  const saved = names.map((name) => process.env[name]);
  t.after(() => names.forEach((name, index) => {
    if (saved[index] === undefined) delete process.env[name]; else process.env[name] = saved[index];
  }));
  for (const name of names) delete process.env[name];
  assert.deepEqual(defaultPaths(), {
    configPath: join(process.cwd(), ".local/x402/funding.json"),
    walletDir: join(process.cwd(), ".local/x402/wallets"),
    tokenPath: join(process.cwd(), ".local/x402/agent-token"),
  });
  assert.equal(walletDirectory(), join(process.cwd(), ".local/x402/wallets"));
  process.env.X402_FUNDING_CONFIG = "/tmp/elsewhere/funding.json";
  process.env.X402_WALLET_DIR = "/tmp/elsewhere/wallets";
  process.env.X402_AGENT_TOKEN_FILE = "/tmp/elsewhere/agent-token";
  assert.deepEqual(defaultPaths(),
    { configPath: "/tmp/elsewhere/funding.json", walletDir: "/tmp/elsewhere/wallets", tokenPath: "/tmp/elsewhere/agent-token" });
});

type Canned = {
  supported?: unknown;
  supportedStatus?: number;
  base?: Record<string, bigint>;
  solana?: Record<string, { pubkey: string; amount: string }[]>;
};
const tokenAccount = (pubkey: string, owner: string, amount: string) => ({
  pubkey,
  account: {
    data: {
      parsed: {
        info: {
          isNative: false, mint: TESTNET_USDC[SOLANA_DEVNET], owner, state: "initialized",
          tokenAmount: { amount, decimals: 6, uiAmount: Number(amount) / 1e6, uiAmountString: String(Number(amount) / 1e6) },
        },
        type: "account",
      },
      program: "spl-token",
      space: 165,
    },
    executable: false, lamports: 1488440, owner: String(TOKEN_PROGRAM_ADDRESS), space: 165,
  },
});

/** The facilitator and both RPCs, answered from canned JSON; any other request fails the test. */
function offline(t: TestContext, canned: Canned) {
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = init?.method ?? "GET";
    if (method === "GET" && url === "https://x402.org/facilitator/supported") {
      calls.push(`GET ${url}`);
      return Response.json(canned.supported ?? SUPPORTED, { status: canned.supportedStatus ?? 200 });
    }
    const body = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
    calls.push(`${method} ${url} ${body.method}`);
    if (method === "POST" && url === "https://sepolia.base.org" && body.method === "eth_call") {
      const owner = `0x${String((body.params[0] as { data: string }).data).slice(-40)}`;
      return Response.json({ jsonrpc: "2.0", id: 1, result: `0x${(canned.base?.[owner] ?? 0n).toString(16).padStart(64, "0")}` });
    }
    if (method === "POST" && url === "https://api.devnet.solana.com" && body.method === "getTokenAccountsByOwner") {
      const owner = String(body.params[0]);
      const value = (canned.solana?.[owner] ?? []).map((item) => tokenAccount(item.pubkey, owner, item.amount));
      return Response.json({ jsonrpc: "2.0", id: 1, result: { context: { apiVersion: "4.4.0-beta.0", slot: 510256287 }, value } });
    }
    throw new Error(`An offline test refused ${method} ${url}`);
  });
  return calls;
}

function roomsFrom(ledger: ReturnType<typeof memoryLedger>, storage: ReturnType<typeof memoryStore>): RoomReader {
  return async (room) => {
    const state = await ledger.ledger.state(room.roomId, room.stewardProfileId);
    const limit = state.deliveryLimit ?? 0;
    return {
      state,
      activeTopUps: await activeTopUps(storage.store, room.roomId),
      credits: state.open ? { limit, used: 0, reserved: 0, available: limit, enabled: true } : null,
    };
  };
}
const find = (lines: CheckLine[], level: CheckLine["level"], pattern: RegExp) =>
  lines.find((item) => item.level === level && pattern.test(item.detail));

test("check confirms facilitator kinds, the route's offer, balances, the payTo account and the room, read-only", async (t) => {
  const paths = await workspace(t);
  await init(["--room", "lighthouse", "--steward", STEWARD], paths, quiet);
  const wallets = await loadWallets(paths.walletDir);
  const payerSol = wallets.payer[SOLANA_DEVNET].address, payToSol = wallets.payTo[SOLANA_DEVNET].address;
  const calls = offline(t, {
    base: { [wallets.payer[BASE_SEPOLIA].address.toLowerCase()]: 20_000_000n },
    solana: {
      [payerSol]: [{ pubkey: await ataOf(payerSol), amount: "20000000" }],
      [payToSol]: [{ pubkey: await ataOf(payToSol), amount: "500000" }],
    },
  });
  const ledger = memoryLedger(), storage = memoryStore();
  const lines = await check({ ...paths, rooms: roomsFrom(ledger, storage) });

  assert.deepEqual(lines.filter((item) => item.level !== "PASS"), []);
  assert(find(lines, "PASS", /^1 room\(s\) opted in; facilitator https:\/\/x402\.org\/facilitator$/));
  assert.deepEqual(lines.find((item) => item.topic === "agent"), { level: "PASS", topic: "agent", detail: `token ${paths.tokenPath} exists with mode 600` });
  assert.equal(lines.filter((item) => item.topic === "wallet").length, 4);
  assert(find(lines, "PASS", /^supports x402 v2 exact on Base Sepolia$/));
  assert(find(lines, "PASS", new RegExp(`^supports x402 v2 exact on Solana devnet with fee payer ${FEE_PAYER}$`)));
  assert(find(lines, "PASS", /route builds its \$1\.00 test USDC offer on Solana devnet and Base Sepolia/));
  assert(find(lines, "PASS", /^payer on Base Sepolia holds 20\.000000 test USDC; enough for 20 top-up\(s\)$/));
  assert(find(lines, "PASS", /^payTo on Base Sepolia holds 0\.000000 test USDC$/));
  assert(find(lines, "PASS", new RegExp(`^payer on Solana devnet holds 20\\.000000 test USDC in ${await ataOf(payerSol)}`)));
  assert(find(lines, "PASS", new RegExp(`^payTo's Solana devnet USDC account ${await ataOf(payToSol)} exists and holds 0\\.500000`)));
  assert(find(lines, "PASS", new RegExp(`^${STEWARD} exists for room lighthouse$`)));
  assert(find(lines, "PASS", /^lighthouse \(ref .{6}…\): open; credits 0 available of 0 \(used 0, reserved 0\); x402 top-ups 0 of 2; the route can offer a top-up$/));
  assert.match(renderCheck(lines), /\n0 FAIL, 0 WARN$/);

  // Only GET /supported and read-only JSON-RPC; the facilitator is never asked to verify or settle.
  assert.deepEqual(calls.sort(), [
    "GET https://x402.org/facilitator/supported",
    "POST https://api.devnet.solana.com getTokenAccountsByOwner",
    "POST https://api.devnet.solana.com getTokenAccountsByOwner",
    "POST https://sepolia.base.org eth_call",
    "POST https://sepolia.base.org eth_call",
  ]);
  assert(!ledger.calls.some((call) => call.startsWith("refill")));
  assert.equal(storage.objects.size, 0);
  const printed = renderCheck(lines);
  for (const secret of [...await secretsIn(paths.walletDir), (await readFile(paths.tokenPath, "utf8")).trim()]) assert(!printed.includes(secret));
});

test("check fails on whatever would stop a payment, and warns about what would not", async (t) => {
  const paths = await workspace(t);
  await init(["--room", "lighthouse", "--steward", STEWARD], paths, quiet);
  const wallets = await loadWallets(paths.walletDir);
  const payerSol = wallets.payer[SOLANA_DEVNET].address, payToSol = wallets.payTo[SOLANA_DEVNET].address;
  const stray = solanaKey().address;
  offline(t, {
    supported: { ...SUPPORTED, kinds: SUPPORTED.kinds.map((kind) => (kind.network === SOLANA_DEVNET && kind.x402Version === 2 ? { ...kind, extra: {} } : kind)) },
    base: { [wallets.payer[BASE_SEPOLIA].address.toLowerCase()]: 500_000n },
    solana: { [payerSol]: [{ pubkey: stray, amount: "3000000" }], [payToSol]: [] },
  });
  const ledger = memoryLedger(), storage = memoryStore();
  ledger.rooms.lighthouse = { open: false, deliveryLimit: 4, stewardExists: false };
  const lines = await check({ ...paths, rooms: roomsFrom(ledger, storage) });

  assert(find(lines, "FAIL", /Solana devnet but names no fee payer/));
  assert(!lines.some((item) => item.topic === "offer"), "no offer is built against an unusable facilitator");
  assert(find(lines, "FAIL", /^payer on Base Sepolia holds 0\.500000 test USDC; one top-up needs 1\.000000; request test USDC at https:\/\/faucet\.circle\.com$/));
  assert(find(lines, "FAIL", new RegExp(`^payer on Solana devnet has no USDC account \\(${await ataOf(payerSol)}\\)`)));
  assert(find(lines, "WARN", new RegExp(`holds 3\\.000000 more test USDC outside ${await ataOf(payerSol)}`)));
  assert(find(lines, "FAIL", new RegExp(`^payTo's Solana devnet USDC account ${await ataOf(payToSol)} does not exist, so Solana payments would fail`)));
  assert(find(lines, "FAIL", /was not found for room lighthouse/));
  assert(find(lines, "FAIL", /^lighthouse \(ref .{6}…\): closed; delivery limit 4; x402 top-ups 0 of 2; the route would refuse: This room is not open\.$/));
  assert.match(renderCheck(lines), /\n6 FAIL, 1 WARN$/);
});

test("check reports a missing config, a bad wallet, an unreachable facilitator and missing Supabase settings without throwing", async (t) => {
  const paths = await workspace(t);
  await createMissingWallets(paths.walletDir);
  await writeJson(join(paths.walletDir, "payer-base-sepolia.json"), evmWallet("payer", { address: privateKeyToAccount(generatePrivateKey()).address }));
  const calls = offline(t, { supportedStatus: 503 });
  const missing = await check({ ...paths, rooms: null });
  assert(find(missing, "FAIL", /funding\.json does not exist; run init first$/));
  assert.deepEqual(missing.filter((item) => item.topic === "agent"),
    [{ level: "FAIL", topic: "agent", detail: `${paths.tokenPath} is missing; run init to create it` }]);
  assert(find(missing, "FAIL", /^payer-base-sepolia\.json: privateKey does not match address$/));
  assert(find(missing, "FAIL", /^https:\/\/x402\.org\/facilitator\/supported could not be read: HTTP 503$/));
  assert(!missing.some((item) => /payer on Base Sepolia/.test(item.detail)), "an invalid payer wallet is not queried");
  assert(find(missing, "PASS", /^payTo on Base Sepolia holds 0\.000000 test USDC$/));
  // The route cannot run without Supabase, so missing settings fail even before any room is configured.
  assert.deepEqual(missing.filter((item) => item.topic === "supabase"), [{
    level: "FAIL", topic: "supabase",
    detail: "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are not set, and the route needs them: put them in .env.local, which npm run x402:setup -- check reads. Room and steward checks were skipped",
  }]);
  assert.equal(calls.filter((call) => call.includes("eth_call")).length, 1);

  await createMissingWallets(paths.walletDir);
  await rm(join(paths.walletDir, "payer-base-sepolia.json"));
  await init(["--room", "lighthouse", "--steward", STEWARD], paths, quiet);
  const config = JSON.parse(await readFile(paths.configPath, "utf8"));
  await writeFile(paths.configPath, JSON.stringify({ ...config, payTo: { [BASE_SEPOLIA]: PAY_TO[BASE_SEPOLIA] } }));
  await chmod(join(paths.walletDir, "payer-solana-devnet.json"), 0o644);
  const degraded = await check({ ...paths, rooms: null });
  assert(find(degraded, "WARN", /^payer-solana-devnet\.json is readable by other users; chmod 600 it$/));
  assert(find(degraded, "WARN", /^payTo names no Solana devnet address, so the route does not offer it$/));
  assert(find(degraded, "WARN", new RegExp(`^payTo on Base Sepolia is ${PAY_TO[BASE_SEPOLIA]}, not the payto wallet`)));
  assert(find(degraded, "FAIL", /^NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are not set, and the route needs them: put them in \.env\.local, which npm run x402:setup -- check reads\. Room and steward checks were skipped$/));
  assert(!degraded.some((item) => item.topic === "room" || item.topic === "steward"));
  assert(!degraded.some((item) => item.level === "WARN" && /Supabase/.test(item.detail)), "missing Supabase settings never pass as a warning");
  assert(!degraded.some((item) => item.topic === "balance" && /Solana/.test(item.detail)), "an unoffered network is not queried");
});

test("check names the wallet or room behind an RPC or Supabase failure, using only the fetch it is given", async (t) => {
  const paths = await workspace(t);
  await init(["--room", "lighthouse", "--steward", STEWARD], paths, quiet);
  t.mock.method(globalThis, "fetch", async () => { throw new Error("the global fetch must not be used"); });
  const lines = await check({
    ...paths,
    fetch: async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith("/supported")) return Response.json(SUPPORTED);
      const { method } = JSON.parse(String(init?.body)) as { method: string };
      if (method === "eth_call") return new Response("slow down", { status: 429 });
      return Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32005, message: "Too many requests for a specific RPC call" } });
    },
    rooms: async () => { throw new Error("Could not read the room's funding state."); },
  });
  assert.deepEqual(lines.filter((item) => item.level === "FAIL").map((item) => item.detail), [
    "payer on Solana devnet: getTokenAccountsByOwner failed: Too many requests for a specific RPC call",
    "payTo on Solana devnet: getTokenAccountsByOwner failed: Too many requests for a specific RPC call",
    "payer on Base Sepolia: eth_call returned HTTP 429",
    "payTo on Base Sepolia: eth_call returned HTTP 429",
    "room lighthouse: Could not read the room's funding state.",
  ]);
  assert(find(lines, "PASS", /route builds its \$1\.00 test USDC offer/));
});

test("check fails on a missing, malformed, unreadable or loosely permissioned agent token, and never prints it", async (t) => {
  const paths = await workspace(t);
  await init(["--room", "lighthouse", "--steward", STEWARD], paths, quiet);
  offline(t, {});
  const token = (await readFile(paths.tokenPath, "utf8")).trim();
  const agent = async () => {
    const lines = await check({ ...paths, rooms: null });
    assert(!renderCheck(lines).includes(token), "check never prints the agent token");
    return lines.filter((item) => item.topic === "agent").map((item) => `${item.level} ${item.detail}`);
  };
  assert.deepEqual(await agent(), [`PASS token ${paths.tokenPath} exists with mode 600`]);
  await chmod(paths.tokenPath, 0o644);
  assert.deepEqual(await agent(), [`FAIL ${paths.tokenPath} has mode 644; chmod 600 it`]);
  await chmod(paths.tokenPath, 0o400);
  assert.deepEqual(await agent(), [`FAIL ${paths.tokenPath} has mode 400; chmod 600 it`]);
  await chmod(paths.tokenPath, 0o600);
  await writeFile(paths.tokenPath, `${token.slice(1)}\n`);
  assert.deepEqual(await agent(), [`FAIL ${paths.tokenPath} is not a valid agent token; move it aside and run init to create a new one`]);
  await rm(paths.tokenPath);
  await mkdir(paths.tokenPath);
  assert.deepEqual(await agent(), [`FAIL ${paths.tokenPath} could not be read (EISDIR)`]);
  await rm(paths.tokenPath, { recursive: true });
  assert.deepEqual(await agent(), [`FAIL ${paths.tokenPath} is missing; run init to create it`]);
});

// Child processes get the same guard as the tests: any request off this machine fails the run.
const GUARD = `data:text/javascript,${encodeURIComponent(`const real = globalThis.fetch;
  globalThis.fetch = (input, init) => new URL(input instanceof Request ? input.url : String(input)).hostname === "127.0.0.1"
    ? real(input, init) : Promise.reject(new Error("offline test: blocked"));`)}`;
const exits = (code: number, stderr: string | RegExp) => (error: { code?: number; stderr?: string }) =>
  error.code === code && (typeof stderr === "string" ? error.stderr === stderr : stderr.test(error.stderr ?? ""));

test("setup and status print npm script usage and drop the separator pnpm forwards", async (t) => {
  const paths = await workspace(t);
  const env: NodeJS.ProcessEnv = { ...process.env, X402_FUNDING_CONFIG: paths.configPath, X402_WALLET_DIR: paths.walletDir, X402_AGENT_TOKEN_FILE: paths.tokenPath };
  for (const name of ["NODE_TEST_CONTEXT", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY"]) delete env[name];
  const run = (script: string, ...args: string[]) => promisify(execFile)(process.execPath,
    ["--import", GUARD, fileURLToPath(new URL(`../../scripts/${script}`, import.meta.url)), ...args], { cwd: dirname(dirname(paths.configPath)), env });

  const usage = `Usage:
  npm run x402:setup -- init --room <roomId> --steward <profileUuid> [--max-top-ups 2] [--facilitator https://x402.org/facilitator] [--replace] [--port 3005]
  npm run x402:setup -- check
`;
  for (const args of [[], ["--"], ["--", "--", "check"], ["--", "bogus"], ["check", "extra"]])
    await assert.rejects(run("x402-setup.ts", ...args), exits(2, usage), JSON.stringify(args));

  const { stdout, stderr } = await run("x402-setup.ts", "--", "init", "--room", "lighthouse", "--steward", STEWARD);
  assert.match(stdout, /^Room lighthouse accepts x402 top-ups of 5 test credits/m);
  assert.match(stdout, /^Next: npm run x402:setup -- check \(read-only\)\.$/m);
  const token = (await readFile(paths.tokenPath, "utf8")).trim();
  assert.match(token, AGENT_TOKEN_PATTERN);
  assert.equal(await mode(paths.tokenPath), 0o600);
  for (const secret of [token, ...await secretsIn(paths.walletDir)])
    assert(!`${stdout}${stderr}`.includes(secret), "init prints no key or token");

  // Without the settings npm run x402:status loads from .env.local, status stops before any request.
  await assert.rejects(run("x402-status.ts", "--", "--json"), exits(1,
    "x402 status: Status reads the shared pilot: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (for example in .env.local, which npm run x402:status reads). Nothing was changed.\n"));
  await assert.rejects(run("x402-status.ts", "--", "--bogus"), exits(1, /^x402 status: Unknown option '--bogus'/));
});

test("every npm run x402:* command named in src, scripts and the submission docs runs an existing script with .env.local", async () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const { scripts } = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { scripts: Record<string, string> };
  const sources = [
    ...(await readdir(join(root, "src"), { recursive: true })).map((name) => join("src", name)),
    ...(await readdir(join(root, "scripts"), { recursive: true })).map((name) => join("scripts", name)),
    ...(await readdir(join(root, "docs/submission"))).map((name) => join("docs/submission", name)).filter((name) => name.endsWith(".md")),
  ].filter((name) => /\.(ts|tsx|mjs|js|md)$/.test(name));
  const named = new Map<string, Set<string>>();
  for (const file of sources)
    for (const [, name] of (await readFile(join(root, file), "utf8")).matchAll(/\b(?:npm|pnpm) run (x402:[\w:-]+)/g))
      named.set(name, (named.get(name) ?? new Set<string>()).add(file));
  for (const name of ["x402:setup", "x402:fund", "x402:status", "x402:reconcile"]) assert(named.has(name), `nothing names ${name}`);
  for (const [name, files] of named) {
    const command = scripts[name];
    assert.ok(command, `${name}, named in ${[...files].join(", ")}, is not a package.json script`);
    assert.match(command, /^node --env-file-if-exists=\.env\.local scripts\/[\w.-]+\.(ts|mjs)$/, `${name} must run one script with .env.local`);
    const target = command.split(" ").pop()!;
    assert.ok((await stat(join(root, target)).catch(() => null))?.isFile(), `${name} runs ${target}, which does not exist`);
  }
});

test("supported kinds and balances parse from the facilitator's and RPCs' JSON shapes", async () => {
  const supported = parseSupported(SUPPORTED);
  assert.equal(supported.kinds.length, 6);
  assert.deepEqual(supportedLines(supported, [SOLANA_DEVNET, BASE_SEPOLIA]).map((item) => item.level), ["PASS", "PASS"]);
  const rotated = parseSupported({ ...SUPPORTED, signers: { "solana:*": ["2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4"] } });
  assert.equal(supportedLines(rotated, [SOLANA_DEVNET])[0].level, "WARN");
  const v1Only = parseSupported({ kinds: SUPPORTED.kinds.filter((kind) => kind.x402Version === 1) });
  assert.deepEqual(supportedLines(v1Only, [SOLANA_DEVNET, BASE_SEPOLIA]).map((item) => item.level), ["FAIL", "FAIL"]);
  assert.throws(() => parseSupported({ error: "nope" }), /lists no kinds/);

  const reply = (result: unknown) => async () => result;
  assert.equal(await baseUsdcBalance(reply(`0x${"0".repeat(57)}1312d00`), "0x309a90aA8453E78f1B5878B46E5B65342dF7Fe83"), 20_000_000n);
  await assert.rejects(baseUsdcBalance(reply("0x"), "0x309a90aA8453E78f1B5878B46E5B65342dF7Fe83"), /unexpected value/);
  const owner = solanaKey().address, ata = await ataOf(owner), stray = solanaKey().address;
  assert.deepEqual(await solanaUsdcAccount(reply({ value: [tokenAccount(stray, owner, "7"), tokenAccount(ata, owner, "20000000")] }), owner),
    { ata, exists: true, atomic: 20_000_000n, elsewhere: 7n });
  assert.deepEqual(await solanaUsdcAccount(reply({ context: { slot: 1 }, value: [] }), owner), { ata, exists: false, atomic: 0n, elsewhere: 0n });
  await assert.rejects(solanaUsdcAccount(reply({ value: [{ pubkey: ata }] }), owner), /unexpected account/);
});

test("status budget arithmetic matches generation admission for one two-panel job", () => {
  const rows = {
    budget: { enabled: true, cap_micro: 10_000_000, imported_expense_micro: 1_234_567, imported_requests: 6, max_requests: 20 },
    attempts: [{ expense_micro: 39_000 }, { expense_micro: 41_000 }, { expense_micro: null }],
    jobs: [{ held_micro: 0, panel_count: 2 }, { held_micro: 2_000_000, panel_count: 2 }],
  };
  const summary = summarizeBudget(rows);
  assert.deepEqual(summary, {
    enabled: true,
    capMicro: 10_000_000,
    importedExpenseMicro: 1_234_567,
    measuredExpenseMicro: 80_000,
    heldMicro: 2_000_000,
    committedMicro: 3_314_567,
    headroomMicro: 6_685_433,
    maxRequests: 20,
    admittedRequests: 10,
    requestHeadroom: 10,
    unresolvedExpenses: 1,
    expensesOverOneDollar: 0,
    twoPanelJobFits: false,
    blockedBy: ["an expense is unresolved"],
  });
  const resolved = { ...rows, attempts: [{ expense_micro: 39_000 }, { expense_micro: 41_000 }, { expense_micro: 40_000 }] };
  assert.equal(summarizeBudget(resolved).twoPanelJobFits, true);
  // Exactly $2 of headroom and two requests left still admit a two-panel job; less does not.
  const edge = { ...resolved, budget: { ...resolved.budget, cap_micro: 3_354_567 + 2_000_000, max_requests: 12 } };
  assert.equal(summarizeBudget(edge).twoPanelJobFits, true);
  assert.deepEqual(summarizeBudget({ ...edge, budget: { ...edge.budget, cap_micro: edge.budget.cap_micro - 1, max_requests: 11 } }).blockedBy,
    ["the dollar headroom is below $2.000000", "the request headroom is below 2"]);
  assert.deepEqual(summarizeBudget({ ...resolved, budget: { ...resolved.budget, enabled: false }, attempts: [{ expense_micro: 1_000_001 }] }).blockedBy,
    ["generation is disabled", "an expense over $1 awaits review"]);
  const over = summarizeBudget({ ...resolved, budget: { ...resolved.budget, cap_micro: 3_000_000 } });
  assert.equal(over.headroomMicro, -354_567);
});

const SOL_TX = "5".repeat(88);
function intentFor(key: IntentKey, roomId: string, createdAt: string): FundingIntent {
  return {
    kind: "fork-night/x402-intent/v1", intentId: intentId(key), key, roomId, stewardProfileId: STEWARD, credits: 5,
    payer: key.network === SOLANA_DEVNET ? "4uxMGnZdLT6Jz2b4FtdBsB77DiobT5WvJsZp68XpGJsA" : "0x309a90aA8453E78f1B5878B46E5B65342dF7Fe83",
    payTo: PAY_TO[key.network], asset: TESTNET_USDC[key.network], amount: "1000000",
    payloadDigest: "d".repeat(64), payload: { signature: "SIGNED-PAYLOAD-SENTINEL" }, requirement: { network: key.network, memo: "REQUIREMENT-SENTINEL" },
    validUntil: key.network === BASE_SEPOLIA ? new Date(Date.parse(createdAt) + 120_000).toISOString() : null, createdAt,
  };
}
/** A credited Solana top-up, a settled Base one whose credit is pending, and an expired Base authorization. */
async function seedRecords() {
  const storage = memoryStore(), ledger = memoryLedger();
  const credited = intentFor({ network: SOLANA_DEVNET, memo: "a".repeat(32) }, "lighthouse", "2026-10-12T12:00:00.000Z");
  const pending = intentFor({ network: BASE_SEPOLIA, payer: "0x309a90aa8453e78f1b5878b46e5b65342df7fe83", nonce: `0x${"2".repeat(64)}` }, "paper-moon", "2026-10-12T12:05:00.000Z");
  const expired = intentFor({ network: BASE_SEPOLIA, payer: "0x309a90aa8453e78f1b5878b46e5b65342df7fe83", nonce: `0x${"3".repeat(64)}` }, "lighthouse", "2026-10-12T11:00:00.000Z");
  for (const intent of [credited, pending, expired]) {
    const paths = recordPaths(intent.intentId, intent.roomId);
    await storage.store.create(paths.intent, recordBytes(intent));
    await storage.store.create(paths.roomIndex, recordBytes({ intentId: intent.intentId, roomId: intent.roomId }));
  }
  await recordEvent(storage.store, credited.intentId, "settle-pending", new Date("2026-10-12T12:00:01.000Z"), { reason: "settlement_pending", transaction: SOL_TX });
  await creditSettledPayment({ store: storage.store, ledger: ledger.ledger, now: () => new Date("2026-10-12T12:00:09.000Z") }, credited, {
    transaction: SOL_TX, settlement: { success: true, network: SOLANA_DEVNET }, paymentResponse: null, source: "reconciler",
  });
  await recordEvent(storage.store, pending.intentId, "credit-pending", new Date("2026-10-12T12:05:03.000Z"), { reason: "database unavailable", transaction: `0x${"AB".repeat(32)}` });
  await storage.store.create(recordPaths(expired.intentId, "lighthouse").expired, recordBytes({
    kind: "fork-night/x402-expired/v1", intentId: expired.intentId, roomId: "lighthouse", network: BASE_SEPOLIA,
    reason: "The authorization expired unused.", evidence: { authorizationState: false }, recordedAt: "2026-10-12T11:10:00.000Z",
  }));
  return { storage, credited, pending, expired };
}

test("status groups every x402 record by intent, newest first, with explorer links and no signed payloads", async () => {
  const { storage, credited, pending, expired } = await seedRecords();
  const groups = await collectRecords(storage.store);
  assert.deepEqual(groups.map((group) => [group.intentId, group.state]), [
    [pending.intentId, "credit-pending"], [credited.intentId, "credited"], [expired.intentId, "expired"],
  ]);
  const [settled, credit, lapsed] = groups;
  assert.deepEqual(settled.links, [`https://sepolia.basescan.org/tx/0x${"ab".repeat(32)}`]);
  assert.equal(credit.receipt?.explorerUrl, explorerUrl(SOLANA_DEVNET, SOL_TX));
  assert.deepEqual(credit.links, [explorerUrl(SOLANA_DEVNET, SOL_TX)]);
  assert.deepEqual(credit.events.map((event) => event.kind), ["settle-pending"]);
  assert.equal(credit.receipt?.label, TESTNET_LABEL);
  assert.equal(lapsed.expired?.reason, "The authorization expired unused.");
  assert.equal(lapsed.intent?.validUntil, "2026-10-12T11:02:00.000Z");
  assert(!JSON.stringify(groups).includes("SENTINEL"), "status never repeats the signed payload or requirement");

  const report = await readStatus({
    config: fundingConfig(),
    store: storage.store,
    budget: async () => ({
      budget: { enabled: true, cap_micro: 10_000_000, imported_expense_micro: 2_500_000, imported_requests: 8, max_requests: 30 },
      attempts: [{ expense_micro: 40_000 }],
      jobs: [{ held_micro: 0, panel_count: 2 }],
    }),
    rooms: async (room) => {
      if (room.roomId === "paper-moon") throw new Error("Could not read the credits of room paper-moon.");
      return {
        state: { open: true, deliveryLimit: 9, stewardExists: true },
        activeTopUps: await activeTopUps(storage.store, room.roomId),
        credits: { limit: 9, used: 4, reserved: 0, available: 5, enabled: true },
      };
    },
    now: () => new Date("2026-10-12T12:30:00.000Z"),
  });
  assert.equal(report.label, TESTNET_LABEL);
  assert.equal(report.budget.committedMicro, 2_540_000);
  assert.deepEqual(report.rooms.map((room) => [room.roomId, room.ref, room.evidence?.activeTopUps ?? room.error]), [
    ["lighthouse", "ref_li…", 1], ["paper-moon", "ref_pa…", "Could not read the credits of room paper-moon."],
  ]);
  const text = renderStatus(report);
  assert(text.startsWith("Fork Night x402 status (read-only, testnets only) at 2026-10-12T12:30:00.000Z\n" + TESTNET_LABEL));
  for (const expected of [
    "committed $2.540000 = imported $2.500000 + measured $0.040000 + held $0.000000",
    "headroom $7.460000; requests 10 of 30 admitted (headroom 20); unresolved expenses 0",
    "a two-panel job fits",
    "lighthouse (ref ref_li…): open; credits 5 available of 9 (used 4, reserved 0); x402 top-ups 1 of 2",
    "paper-moon (ref ref_pa…): Could not read the credits of room paper-moon.",
    "x402 records: 3 intent(s), newest first",
    "credit-pending  Base Sepolia  room paper-moon",
    "receipt (reconciler) 2026-10-12T12:00:09.000Z: +5 test credits; transaction 5555",
    "expired 2026-10-12T11:10:00.000Z: The authorization expired unused.",
    "event 2026-10-12T12:00:01.000Z settle-pending reason=settlement_pending",
    "memo aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    explorerUrl(SOLANA_DEVNET, SOL_TX),
  ]) assert(text.includes(expected), `missing: ${expected}`);
  assert(text.indexOf(pending.intentId.slice(0, 12)) < text.indexOf(credited.intentId.slice(0, 12)));
  assert(!JSON.stringify(report).includes("SENTINEL"));
});

test("status and room checks reach Supabase only through selects, the credits read and storage reads", async (t) => {
  const saved = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY };
  t.after(() => {
    if (saved.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = saved.url;
    if (saved.key === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = saved.key;
  });
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://pilot.test.invalid";
  process.env.SUPABASE_SECRET_KEY = "test-secret";
  const { storage, credited } = await seedRecords();
  const tables: Record<string, Record<string, unknown>[]> = {
    pilot_generation_budget: [{ id: true, enabled: true, cap_micro: 10_000_000, imported_expense_micro: 1_000_000, imported_requests: 4, max_requests: 20 }],
    pilot_panel_attempts: [{ operation_id: "a", panel_number: 1, expense_micro: 40_000 }, { operation_id: "a", panel_number: 2, expense_micro: null }],
    pilot_jobs: [{ operation_id: "a", held_micro: 0, panel_count: 2 }],
    pilot_rooms: [{ id: "lighthouse", is_open: true }, { id: "paper-moon", is_open: false }],
    pilot_room_capacity: [{ room_id: "lighthouse", delivery_limit: 9 }, { room_id: "paper-moon", delivery_limit: 4 }],
    pilot_profiles: [{ id: STEWARD }],
  };
  const requests: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const method = (init?.method ?? "GET").toUpperCase();
    requests.push(`${method} ${url.pathname}`);
    const table = url.pathname.match(/^\/rest\/v1\/(\w+)$/)?.[1];
    if (method === "GET" && table) {
      let rows = tables[table] ?? [];
      for (const [key, value] of url.searchParams)
        if (value.startsWith("eq.")) rows = rows.filter((row) => String(row[key]) === value.slice(3));
      const offset = Number(url.searchParams.get("offset") ?? 0);
      rows = rows.slice(offset, offset + Number(url.searchParams.get("limit") ?? rows.length));
      return new Headers(init?.headers).get("accept")?.includes("vnd.pgrst.object") ? Response.json(rows[0]) : Response.json(rows);
    }
    if (method === "POST" && url.pathname === "/rest/v1/rpc/pilot_room_credits")
      return Response.json({ limit: 9, used: 4, reserved: 0, available: 5, enabled: true });
    if (method === "POST" && url.pathname === "/storage/v1/object/list/pilot-receipts") {
      const base = String(JSON.parse(String(init?.body)).prefix).replace(/\/?$/, "/");
      const names = [...storage.objects.keys()].filter((key) => key.startsWith(base) && !key.slice(base.length).includes("/"));
      return Response.json(names.map((key) => ({ name: key.slice(base.length), id: key })));
    }
    const object = url.pathname.match(/^\/storage\/v1\/object\/pilot-receipts\/(.+)$/)?.[1];
    if (method === "GET" && object) {
      const bytes = storage.objects.get(decodeURIComponent(object));
      return bytes ? new Response(new Uint8Array(bytes)) : Response.json({ statusCode: "404", error: "not_found", message: "Object not found" }, { status: 404 });
    }
    throw new Error(`An offline test refused ${method} ${url.pathname}`);
  });

  const client = pilotAdmin();
  const report = await readStatus({
    config: fundingConfig(),
    store: supabaseReceiptStore(client),
    budget: () => readBudgetRows(client),
    rooms: supabaseRoomReader(client),
  });
  assert.equal(report.budget.committedMicro, 1_040_000);
  assert.equal(report.budget.admittedRequests, 6);
  assert.equal(report.budget.unresolvedExpenses, 1);
  assert.deepEqual(report.rooms.map((room) => [room.roomId, room.evidence?.state.open, room.evidence?.credits?.available ?? null, room.evidence?.activeTopUps]), [
    ["lighthouse", true, 5, 1], ["paper-moon", false, null, 1],
  ]);
  assert.equal(report.records.length, 3);
  assert.equal(report.records.find((group) => group.intentId === credited.intentId)?.state, "credited");
  const writes = requests.filter((request) => !request.startsWith("GET ") &&
    request !== "POST /rest/v1/rpc/pilot_room_credits" && request !== "POST /storage/v1/object/list/pilot-receipts");
  assert.deepEqual(writes, []);
  assert.equal(requests.filter((request) => request === "POST /rest/v1/rpc/pilot_room_credits").length, 1, "a closed room's credits are not read");
});
