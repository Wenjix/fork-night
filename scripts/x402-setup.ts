import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { address } from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import type { FacilitatorClient } from "@x402/core/server";
import type { SupportedKind, SupportedResponse } from "@x402/core/types";
import { formatUsd } from "../src/experiments/money.ts";
import { writeAtomic } from "../src/experiments/storage.ts";
import { pilotAdmin } from "../src/generation/client.ts";
import { isUuid } from "../src/lib/pilot.ts";
import {
  DEFAULT_FACILITATOR_URL,
  ROOM_PATTERN,
  agentTokenPath,
  fundingConfigPath,
  loadFundingConfig,
  parseFundingConfig,
  readAgentToken,
  type FundingConfig,
} from "../src/x402/config.ts";
import { BASE_SEPOLIA, SOLANA_DEVNET, TESTNETS, TESTNET_USDC, TOP_UP, type Testnet } from "../src/x402/ids.ts";
import { fundingRefusal } from "../src/x402/ledger.ts";
import { createPaymentPort } from "../src/x402/payment.ts";
import {
  WalletError,
  createMissingWallets,
  inspectWallets,
  loadWallets,
  walletDirectory,
  type WalletRole,
} from "../src/x402/wallets.ts";
import { NETWORK_NAME, describeRoom, supabaseConfigured, supabaseRoomReader, type RoomReader } from "./x402-status.ts";

// Operator setup for the local, testnet-only x402 top-up. Network access is read-only.
// npm run x402:setup -- init --room <roomId> --steward <profileUuid> [--max-top-ups 2] [--facilitator <https url>] [--replace] [--port 3005]
// npm run x402:setup -- check

export class SetupError extends Error {}
export type SetupPaths = { configPath: string; walletDir: string; tokenPath: string };
export const defaultPaths = (): SetupPaths =>
  ({ configPath: fundingConfigPath(), walletDir: walletDirectory(), tokenPath: agentTokenPath() });

export const RPC_URLS: Record<Testnet, string> = {
  [BASE_SEPOLIA]: "https://sepolia.base.org",
  [SOLANA_DEVNET]: "https://api.devnet.solana.com",
};
const FAUCET = "https://faucet.circle.com";
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const TOP_UP_ATOMIC = BigInt(TOP_UP.atomic);
const sameAddress = (network: Testnet, a: string, b: string) =>
  network === BASE_SEPOLIA ? a.toLowerCase() === b.toLowerCase() : a === b;

/** What is wrong with the local agent token, never quoting the file: it is a secret. */
async function agentTokenProblem(path: string): Promise<{ kind: "missing" | "unusable" | "mode"; problem: string } | null> {
  let token: string | null, mode: number;
  try {
    [token, mode] = await Promise.all([readAgentToken(path), stat(path).then((info) => info.mode & 0o777)]);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOENT"
      ? { kind: "missing", problem: `${path} is missing; run init to create it` }
      : { kind: "unusable", problem: `${path} could not be read (${code ?? "unknown error"})` };
  }
  if (!token) return { kind: "unusable", problem: `${path} is not a valid agent token; move it aside and run init to create a new one` };
  if (mode !== 0o600) return { kind: "mode", problem: `${path} has mode ${mode.toString(8)}; chmod 600 it` };
  return null;
}

/** 32 random bytes, written once with mode 600 in a 700 directory; an existing token is kept (mode 600), never printed. */
async function createAgentToken(path: string) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await chmod(dirname(path), 0o700);
  let created = true;
  try {
    await writeFile(path, `${randomBytes(32).toString("base64url")}\n`, { mode: 0o600, flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    created = false;
  }
  await chmod(path, 0o600);
  return created;
}

function integer(value: string, flag: string, min: number, max: number) {
  if (!/^\d{1,6}$/.test(value) || Number(value) < min || Number(value) > max)
    throw new SetupError(`${flag} must be a whole number from ${min} to ${max}.`);
  return Number(value);
}

/**
 * Opts one room in under a fresh, random funding reference. Creates only the missing
 * throwaway wallets, keeps every other room and setting, and writes the config atomically.
 */
export async function init(args: string[], paths = defaultPaths(), log: (line: string) => void = console.log) {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      room: { type: "string" },
      steward: { type: "string" },
      "max-top-ups": { type: "string", default: "2" },
      facilitator: { type: "string" },
      replace: { type: "boolean", default: false },
      port: { type: "string", default: "3005" },
    },
  });
  const roomId = values.room ?? "", steward = (values.steward ?? "").toLowerCase();
  if (!ROOM_PATTERN.test(roomId)) throw new SetupError("Pass --room <roomId> (lowercase letters, digits and hyphens).");
  if (!isUuid(steward)) throw new SetupError("Pass --steward <profileUuid>, the steward's guest profile UUID.");
  const maxTopUps = integer(values["max-top-ups"], "--max-top-ups", 1, 20);
  const port = integer(values.port, "--port", 1, 65535);

  // Refuse before creating anything: a broken config is never built on.
  let existing: Record<string, unknown> | null = null;
  let text: string | null = null;
  try { text = await readFile(paths.configPath, "utf8"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (text !== null) {
    try { existing = JSON.parse(text) as Record<string, unknown>; } catch {
      throw new SetupError(`${paths.configPath} is not valid JSON; fix or move it before running init.`);
    }
  }
  const current = existing ? parseFundingConfig(existing) : null;
  const facilitatorUrl = (values.facilitator ?? current?.facilitatorUrl ?? DEFAULT_FACILITATOR_URL).replace(/\/+$/, "");
  if (current && values.facilitator !== undefined && facilitatorUrl !== current.facilitatorUrl)
    throw new SetupError(`${paths.configPath} already uses ${current.facilitatorUrl}; edit the file to change facilitators.`);
  const previous = Object.entries(current?.rooms ?? {}).filter(([, room]) => room.roomId === roomId).map(([ref]) => ref);
  if (previous.length && !values.replace)
    throw new SetupError(`Room ${roomId} already has a funding reference (${previous[0].slice(0, 6)}…). Pass --replace to issue a new one; the old link then stops working.`);

  const broken = (await inspectWallets(paths.walletDir)).flatMap((item) => (item.ok || item.missing ? [] : [item.problem]));
  if (broken.length) throw new WalletError(`Fix or move these wallet files first: ${broken.join("; ")}`);
  const token = await agentTokenProblem(paths.tokenPath);
  if (token?.kind === "unusable") throw new SetupError(`${token.problem}.`);
  const created = await createMissingWallets(paths.walletDir);
  const wallets = await loadWallets(paths.walletDir);
  const tokenCreated = await createAgentToken(paths.tokenPath);

  const rooms: Record<string, unknown> = { ...(existing?.rooms as Record<string, unknown> | undefined) };
  for (const ref of previous) delete rooms[ref];
  let ref = randomBytes(24).toString("base64url");
  while (Object.hasOwn(rooms, ref)) ref = randomBytes(24).toString("base64url");
  rooms[ref] = { roomId, stewardProfileId: steward, maxTopUps };
  const next = existing ? { ...existing, rooms } : {
    version: 1,
    facilitatorUrl,
    payTo: { [SOLANA_DEVNET]: wallets.payTo[SOLANA_DEVNET].address, [BASE_SEPOLIA]: wallets.payTo[BASE_SEPOLIA].address },
    rooms,
  };
  const saved = parseFundingConfig(next);
  await mkdir(dirname(paths.configPath), { recursive: true, mode: 0o700 });
  await writeAtomic(paths.configPath, `${JSON.stringify(next, null, 2)}\n`);
  await chmod(paths.configPath, 0o600);

  const url = `http://127.0.0.1:${port}/api/x402/fund/${ref}`;
  log(`Room ${roomId} accepts x402 top-ups of ${TOP_UP.credits} test credits for ${TOP_UP.price} test USDC, at most ${maxTopUps}, stewarded by ${steward}.`);
  if (previous.length) log(`The room's earlier funding link was replaced and no longer works.`);
  log(`Funding URL: ${url}`);
  log(`Serve it locally with PILOT_LOCAL_CONTROLS=1 pnpm dev --port ${port} (pass --port N to init if the app listens on another port).`);
  log(`Saved ${paths.configPath} (mode 600; facilitator ${saved.facilitatorUrl}).`);
  log(`Agent token ${tokenCreated ? "created" : "kept"} at ${paths.tokenPath} (mode 600); only the local payer sends it.`);
  log(`Wallets in ${paths.walletDir}${created.length ? ` (created ${created.map((spec) => spec.file).join(", ")})` : ""}:`);
  for (const role of ["payer", "payTo"] as const)
    for (const network of TESTNETS) log(`  ${role.padEnd(5)}  ${NETWORK_NAME[network].padEnd(13)}  ${wallets[role][network].address}`);
  for (const network of TESTNETS) {
    const configured = saved.payTo[network];
    if (configured && !sameAddress(network, configured, wallets.payTo[network].address))
      log(`Note: payTo on ${NETWORK_NAME[network]} stays ${configured} from the existing config, not the payto wallet.`);
  }
  if (created.some((spec) => spec.role === "payer"))
    log(`Fund the new payer wallets with test USDC at ${FAUCET} (Base Sepolia and Solana Devnet).`);
  if (created.some((spec) => spec.role === "payTo" && spec.network === SOLANA_DEVNET))
    log(`The new Solana payTo needs one devnet USDC deposit (the faucet works) to open its token account before it can be paid.`);
  log("Next: npm run x402:setup -- check (read-only).");
  return { ref, url, created: created.map((spec) => spec.file), config: saved };
}

export type CheckLevel = "PASS" | "WARN" | "FAIL";
export type CheckLine = { level: CheckLevel; topic: string; detail: string };
const line = (level: CheckLevel, topic: string, detail: string): CheckLine => ({ level, topic, detail });

export type Rpc = (method: string, params: unknown[]) => Promise<unknown>;

/** Plain JSON-RPC over the given fetch. Only read methods are ever passed in. */
export function jsonRpc(url: string, request: typeof fetch = fetch): Rpc {
  return async (method, params) => {
    const response = await request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`${method} returned HTTP ${response.status}`);
    const body = (await response.json()) as { result?: unknown; error?: { message?: unknown } };
    if (body.error) throw new Error(`${method} failed: ${String(body.error.message ?? "unknown error")}`);
    return body.result;
  };
}

/** USDC balanceOf(owner) on Base Sepolia, via eth_call. */
export async function baseUsdcBalance(rpc: Rpc, owner: string) {
  const data = `0x70a08231${owner.slice(2).toLowerCase().padStart(64, "0")}`;
  const result = await rpc("eth_call", [{ to: TESTNET_USDC[BASE_SEPOLIA], data }, "latest"]);
  if (typeof result !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(result))
    throw new Error("balanceOf returned an unexpected value");
  return BigInt(result);
}

/** The owner's associated devnet USDC account, the only one x402 pays from or into, and any other USDC accounts. */
export async function solanaUsdcAccount(rpc: Rpc, owner: string) {
  const mint = TESTNET_USDC[SOLANA_DEVNET];
  const [ata] = await findAssociatedTokenPda({ owner: address(owner), mint: address(mint), tokenProgram: TOKEN_PROGRAM_ADDRESS });
  const result = (await rpc("getTokenAccountsByOwner", [owner, { mint }, { encoding: "jsonParsed", commitment: "confirmed" }])) as
    { value?: unknown } | null;
  if (!result || !Array.isArray(result.value)) throw new Error("getTokenAccountsByOwner returned an unexpected value");
  let atomic: bigint | null = null;
  let elsewhere = 0n;
  for (const entry of result.value as { pubkey?: unknown; account?: { data?: { parsed?: { info?: { mint?: unknown; tokenAmount?: { amount?: unknown } } } } } }[]) {
    const info = entry?.account?.data?.parsed?.info;
    const amount = info?.tokenAmount?.amount;
    if (typeof entry?.pubkey !== "string" || info?.mint !== mint || typeof amount !== "string" || !/^\d{1,30}$/.test(amount))
      throw new Error("getTokenAccountsByOwner returned an unexpected account");
    if (entry.pubkey === ata) atomic = BigInt(amount);
    else elsewhere += BigInt(amount);
  }
  return { ata: String(ata), exists: atomic !== null, atomic: atomic ?? 0n, elsewhere };
}

export function parseSupported(raw: unknown): SupportedResponse {
  const body = raw as { kinds?: unknown; extensions?: unknown; signers?: unknown } | null;
  if (!body || typeof body !== "object" || !Array.isArray(body.kinds)) throw new Error("the response lists no kinds");
  const kinds = (body.kinds as unknown[]).filter((kind): kind is SupportedKind => !!kind && typeof kind === "object" &&
    typeof (kind as SupportedKind).scheme === "string" && typeof (kind as SupportedKind).network === "string");
  const signers = body.signers && typeof body.signers === "object" && !Array.isArray(body.signers)
    ? (body.signers as Record<string, string[]>) : {};
  return { kinds, extensions: Array.isArray(body.extensions) ? (body.extensions as string[]) : [], signers };
}

/** A v2 exact kind per offered network and, on Solana, the fee payer that buyers' transactions must name. */
export function supportedLines(supported: SupportedResponse, networks: readonly Testnet[]): CheckLine[] {
  return networks.map((network) => {
    const kind = supported.kinds.find((item) => item.x402Version === 2 && item.scheme === "exact" && item.network === network);
    if (!kind) return line("FAIL", "facilitator", `does not support x402 v2 exact on ${NETWORK_NAME[network]}`);
    if (network === BASE_SEPOLIA) return line("PASS", "facilitator", `supports x402 v2 exact on ${NETWORK_NAME[network]}`);
    const feePayer = kind.extra?.feePayer;
    if (typeof feePayer !== "string" || !SOLANA_ADDRESS.test(feePayer))
      return line("FAIL", "facilitator", "supports x402 v2 exact on Solana devnet but names no fee payer");
    const signers = supported.signers[network] ?? supported.signers["solana:*"];
    if (Array.isArray(signers) && !signers.includes(feePayer))
      return line("WARN", "facilitator", `Solana devnet fee payer ${feePayer} is not among its listed signers`);
    return line("PASS", "facilitator", `supports x402 v2 exact on Solana devnet with fee payer ${feePayer}`);
  });
}

// Lets check build the route's real offer from the response it already read; nothing can verify or settle.
const readOnlyFacilitator = (supported: SupportedResponse): FacilitatorClient => ({
  getSupported: async () => structuredClone(supported),
  verify: () => Promise.reject(new Error("x402 setup check is read-only.")),
  settle: () => Promise.reject(new Error("x402 setup check is read-only.")),
});

export type CheckDeps = SetupPaths & { fetch?: typeof fetch; rpcUrls?: Record<Testnet, string>; rooms?: RoomReader | null };

/** A read-only readiness checklist: config, wallets, facilitator, balances and, with Supabase, rooms. */
export async function check(deps: CheckDeps): Promise<CheckLine[]> {
  const request = deps.fetch ?? fetch;
  const urls = deps.rpcUrls ?? RPC_URLS;
  const lines: CheckLine[] = [];
  const add = (level: CheckLevel, topic: string, detail: string) => { lines.push(line(level, topic, detail)); };
  const attempt = async (topic: string, subject: string, run: () => Promise<void>) => {
    try { await run(); } catch (error) { add("FAIL", topic, `${subject}: ${(error as Error).message}`); }
  };

  let loaded: FundingConfig | null = null;
  try {
    loaded = await loadFundingConfig(deps.configPath);
    const rooms = loaded ? Object.keys(loaded.rooms).length : 0;
    if (!loaded) add("FAIL", "config", `${deps.configPath} does not exist; run init first`);
    else if (!rooms) add("FAIL", "config", "no room is opted in; run init");
    else add("PASS", "config", `${rooms} room(s) opted in; facilitator ${loaded.facilitatorUrl}`);
  } catch (error) {
    add("FAIL", "config", (error as Error).message);
  }
  const config = loaded;

  const token = await agentTokenProblem(deps.tokenPath);
  add(token ? "FAIL" : "PASS", "agent", token?.problem ?? `token ${deps.tokenPath} exists with mode 600`);

  const wallets = await inspectWallets(deps.walletDir);
  for (const item of wallets) {
    if (!item.ok) { add("FAIL", "wallet", item.missing ? `${item.file} is missing; run init to create it` : item.problem); continue; }
    add("PASS", "wallet", `${item.role} on ${NETWORK_NAME[item.network]}: ${item.wallet.address}`);
    if (item.wallet.mode & 0o077) add("WARN", "wallet", `${item.file} is readable by other users; chmod 600 it`);
  }
  const own = (role: WalletRole, network: Testnet) => {
    const found = wallets.find((item) => item.role === role && item.network === network);
    return found?.ok ? found.wallet.address : undefined;
  };
  const networks = config ? TESTNETS.filter((network) => config.payTo[network]) : [...TESTNETS];
  if (config) for (const network of TESTNETS) {
    const configured = config.payTo[network], mine = own("payTo", network);
    if (!configured) add("WARN", "config", `payTo names no ${NETWORK_NAME[network]} address, so the route does not offer it`);
    else if (mine && !sameAddress(network, configured, mine))
      add("WARN", "config", `payTo on ${NETWORK_NAME[network]} is ${configured}, not the payto wallet ${mine}`);
  }

  const facilitatorUrl = config?.facilitatorUrl ?? DEFAULT_FACILITATOR_URL;
  let supported: SupportedResponse | null = null;
  try {
    const response = await request(`${facilitatorUrl}/supported`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    supported = parseSupported(await response.json());
  } catch (error) {
    add("FAIL", "facilitator", `${facilitatorUrl}/supported could not be read: ${(error as Error).message}`);
  }
  const kinds = supported;
  if (kinds) {
    const found = supportedLines(kinds, networks);
    lines.push(...found);
    if (config && networks.length && found.every((item) => item.level !== "FAIL"))
      await attempt("offer", "the route could not build its offer", async () => {
        await createPaymentPort(config, { facilitator: readOnlyFacilitator(kinds) })
          .offer({ url: "http://127.0.0.1/api/x402/fund/check", description: "x402 setup check", mimeType: "application/json" });
        add("PASS", "offer", `the route builds its ${TOP_UP.price} test USDC offer on ${networks.map((network) => NETWORK_NAME[network]).join(" and ")}`);
      });
  }

  const enough = (atomic: bigint) => atomic >= TOP_UP_ATOMIC
    ? `enough for ${atomic / TOP_UP_ATOMIC} top-up(s)`
    : `one top-up needs ${formatUsd(TOP_UP_ATOMIC)}; request test USDC at ${FAUCET}`;
  for (const network of networks) {
    const rpc = jsonRpc(urls[network], request);
    const name = NETWORK_NAME[network];
    const payer = own("payer", network), payTo = config?.payTo[network] ?? own("payTo", network);
    if (network === BASE_SEPOLIA) {
      if (payer) await attempt("balance", `payer on ${name}`, async () => {
        const atomic = await baseUsdcBalance(rpc, payer);
        add(atomic >= TOP_UP_ATOMIC ? "PASS" : "FAIL", "balance", `payer on ${name} holds ${formatUsd(atomic)} test USDC; ${enough(atomic)}`);
      });
      if (payTo) await attempt("balance", `payTo on ${name}`, async () => {
        add("PASS", "balance", `payTo on ${name} holds ${formatUsd(await baseUsdcBalance(rpc, payTo))} test USDC`);
      });
      continue;
    }
    if (payer) await attempt("balance", `payer on ${name}`, async () => {
      const account = await solanaUsdcAccount(rpc, payer);
      if (!account.exists) add("FAIL", "balance", `payer on ${name} has no USDC account (${account.ata}); request devnet USDC at ${FAUCET}`);
      else add(account.atomic >= TOP_UP_ATOMIC ? "PASS" : "FAIL", "balance",
        `payer on ${name} holds ${formatUsd(account.atomic)} test USDC in ${account.ata}; ${enough(account.atomic)}`);
      if (account.elsewhere > 0n)
        add("WARN", "balance", `payer on ${name} holds ${formatUsd(account.elsewhere)} more test USDC outside ${account.ata}, which x402 cannot spend`);
    });
    if (payTo) await attempt("balance", `payTo on ${name}`, async () => {
      const account = await solanaUsdcAccount(rpc, payTo);
      if (account.exists) add("PASS", "balance", `payTo's ${name} USDC account ${account.ata} exists and holds ${formatUsd(account.atomic)} test USDC`);
      else add("FAIL", "balance", `payTo's ${name} USDC account ${account.ata} does not exist, so Solana payments would fail; send devnet USDC to ${payTo} once (for example from ${FAUCET}) to open it`);
    });
  }

  // The route cannot run without Supabase, so its absence is a failure even with no room configured.
  const reader = deps.rooms;
  if (!reader)
    add("FAIL", "supabase", "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are not set, and the route needs them: put them in .env.local, which npm run x402:setup -- check reads. Room and steward checks were skipped");
  else for (const [ref, room] of Object.entries(config?.rooms ?? {}))
    await attempt("room", `room ${room.roomId}`, async () => {
      const evidence = await reader(room);
      const exists = evidence.state.stewardExists;
      add(exists ? "PASS" : "FAIL", "steward", `${room.stewardProfileId} ${exists ? "exists" : "was not found"} for room ${room.roomId}`);
      const refusal = fundingRefusal(evidence.state, evidence.activeTopUps, room.maxTopUps);
      add(refusal ? "FAIL" : "PASS", "room",
        `${room.roomId} (ref ${ref.slice(0, 6)}…): ${describeRoom(evidence, room)}; ${refusal ? `the route would refuse: ${refusal}` : "the route can offer a top-up"}`);
    });
  return lines;
}

export const renderCheck = (lines: CheckLine[]) => [
  "x402 setup check (read-only; nothing is signed, sent or written)",
  ...lines.map((item) => `${item.level.padEnd(4)}  ${item.topic.padEnd(11)}  ${item.detail}`),
  `${lines.filter((item) => item.level === "FAIL").length} FAIL, ${lines.filter((item) => item.level === "WARN").length} WARN`,
].join("\n");

const USAGE = `Usage:
  npm run x402:setup -- init --room <roomId> --steward <profileUuid> [--max-top-ups 2] [--facilitator ${DEFAULT_FACILITATOR_URL}] [--replace] [--port 3005]
  npm run x402:setup -- check`;

async function main(argv: string[]) {
  // pnpm forwards the "--" separator; npm drops it.
  const [command, ...args] = argv[0] === "--" ? argv.slice(1) : argv;
  if (command === "init") {
    await init(args);
  } else if (command === "check" && !args.length) {
    const lines = await check({ ...defaultPaths(), rooms: supabaseConfigured() ? supabaseRoomReader(pilotAdmin()) : null });
    console.log(renderCheck(lines));
    if (lines.some((item) => item.level === "FAIL")) process.exitCode = 1;
  } else {
    console.error(USAGE);
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(`x402 setup: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
