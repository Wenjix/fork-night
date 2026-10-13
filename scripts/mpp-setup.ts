import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { formatUsd } from "../src/experiments/money.ts";
import { writeAtomic } from "../src/experiments/storage.ts";
import { pilotAdmin } from "../src/generation/client.ts";
import { ADAPTER_INSTALL_HINT, loadMppAdapter, mppAdapterPath, type MppAdapter } from "../src/mpp/adapter.ts";
import { tempoRpc, type TempoRpc } from "../src/mpp/chain.ts";
import { createChargePort } from "../src/mpp/charge.ts";
import {
  CHALLENGE_KEY_PATTERN,
  challengeKeyPath,
  loadMppConfig,
  mppConfigPath,
  mppRoomFor,
  parseMppConfig,
  readChallengeKey,
  type MppDoorConfig,
  type MppRoom,
} from "../src/mpp/config.ts";
import {
  MODERATO_CHAIN_ID,
  MPP_COMMANDS,
  MPP_TOP_UP,
  PATHUSD,
  TEMPO_MODERATO,
  mppExplorerUrl,
  sameAddress,
} from "../src/mpp/ids.ts";
import { activeMppTopUps } from "../src/mpp/records.ts";
import {
  MppWalletError,
  createMissingMppWallets,
  inspectMppWallets,
  loadMppWallets,
  mppWalletDirectory,
} from "../src/mpp/wallets.ts";
import {
  ROOM_PATTERN,
  agentTokenPath,
  fundingConfigPath,
  loadFundingConfig,
  readAgentToken,
  type FundingConfig,
} from "../src/x402/config.ts";
import { fundingRefusal, supabaseFundingLedger, type RoomFundingState } from "../src/x402/ledger.ts";
import { supabaseReceiptStore } from "../src/x402/store.ts";
import { supabaseConfigured } from "./x402-status.ts";

// Operator setup for the local, testnet-only MPP top-up on Tempo Moderato. Rooms, stewards and funding
// references come from the x402 opt-in (npm run x402:setup); this adds the MPP rail's own wallets, key and limit.
// Keys and signatures come from the isolated adapter in vendor/mpp-adapter; the root package.json has no mpp:* scripts.
// node --env-file-if-exists=.env.local scripts/mpp-setup.ts init --room <roomId> [--max-top-ups 2] [--port 3005] [--skip-faucet]
// node --env-file-if-exists=.env.local scripts/mpp-setup.ts faucet
// node --env-file-if-exists=.env.local scripts/mpp-setup.ts check

export class MppSetupError extends Error {}
export type MppSetupPaths = { configPath: string; walletDir: string; keyPath: string; fundingPath: string; tokenPath: string };
export const defaultMppPaths = (): MppSetupPaths => ({
  configPath: mppConfigPath(), walletDir: mppWalletDirectory(), keyPath: challengeKeyPath(),
  fundingPath: fundingConfigPath(), tokenPath: agentTokenPath(),
});
const TOP_UP_ATOMIC = BigInt(MPP_TOP_UP.atomic);

function integer(value: string, flag: string, min: number, max: number) {
  if (!/^\d{1,6}$/.test(value) || Number(value) < min || Number(value) > max)
    throw new MppSetupError(`${flag} must be a whole number from ${min} to ${max}.`);
  return Number(value);
}

/** 32 random bytes, written once with mode 600 in a 700 directory; an existing key is kept and never printed. */
async function createChallengeKey(path: string) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await chmod(dirname(path), 0o700);
  try {
    await writeFile(path, `${randomBytes(32).toString("base64url")}\n`, { mode: 0o600, flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    await chmod(path, 0o600);
    return false;
  }
  await chmod(path, 0o600);
  return true;
}

/** What is wrong with a local secret file, never quoting it. */
async function secretFileProblem(path: string, read: (path: string) => Promise<string | null>, name: string, fix: string) {
  let value: string | null, mode: number;
  try {
    [value, mode] = await Promise.all([read(path), stat(path).then((info) => info.mode & 0o777)]);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOENT" ? `${path} is missing; ${fix}` : `${path} could not be read (${code ?? "unknown error"})`;
  }
  if (!value) return `${path} is not a valid ${name}; move it aside and ${fix}`;
  if (mode !== 0o600) return `${path} has mode ${mode.toString(8)}; chmod 600 it`;
  return null;
}

/** pathUSD-style TIP-20 balanceOf(owner) via eth_call. */
export async function tokenBalance(rpc: TempoRpc, token: string, owner: string) {
  const data = `0x70a08231${owner.slice(2).toLowerCase().padStart(64, "0")}`;
  const result = await rpc<string>("eth_call", [{ to: token, data }, "latest"]);
  if (typeof result !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(result)) throw new Error("balanceOf returned an unexpected value");
  return BigInt(result);
}

/**
 * Funds the payer from the public Moderato faucet (JSON-RPC tempo_fundAddress: test pathUSD,
 * alphaUSD, betaUSD, thetaUSD and OUSD). Testnet only; no key or sign-up.
 */
export async function fundPayer(
  rpc: TempoRpc,
  address: string,
  options: { adapter: MppAdapter; sleep?: (ms: number) => Promise<void>; attempts?: number },
) {
  const chainId = await rpc<string>("eth_chainId", []);
  if (Number(chainId) !== MODERATO_CHAIN_ID) throw new MppSetupError(`The RPC answered chain ${Number(chainId)}, not Tempo Moderato; nothing was requested.`);
  const before = await tokenBalance(rpc, PATHUSD, address);
  // The faucet call goes through the isolated adapter, over the same RPC.
  const hashes = await options.adapter.faucet({ address, request: ({ method, params }) => rpc(method, (params ?? []) as unknown[]) });
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  let after = await tokenBalance(rpc, PATHUSD, address);
  for (let attempt = 0; attempt < (options.attempts ?? 20) && after <= before; attempt += 1) {
    await sleep(1000);
    after = await tokenBalance(rpc, PATHUSD, address);
  }
  return { before, after, hashes };
}

/**
 * Opts one x402-opted-in room in to the MPP door with its own top-up limit. Creates only the
 * missing throwaway wallets and challenge key, keeps every other room, and writes the config atomically.
 */
export async function init(
  args: string[],
  paths = defaultMppPaths(),
  log: (line: string) => void = console.log,
  rpc: TempoRpc | null = tempoRpc(),
  adapter?: MppAdapter,
) {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      room: { type: "string" },
      "max-top-ups": { type: "string", default: "2" },
      port: { type: "string", default: "3005" },
      "skip-faucet": { type: "boolean", default: false },
    },
  });
  const roomId = values.room ?? "";
  if (!ROOM_PATTERN.test(roomId)) throw new MppSetupError("Pass --room <roomId> (lowercase letters, digits and hyphens).");
  const maxTopUps = integer(values["max-top-ups"], "--max-top-ups", 1, 20);
  const port = integer(values.port, "--port", 1, 65535);

  // Refuse before creating anything: the room must already be opted in through x402, which owns the steward and link.
  const funding = await loadFundingConfig(paths.fundingPath);
  const refs = Object.entries(funding?.rooms ?? {}).filter(([, room]) => room.roomId === roomId);
  if (!refs.length)
    throw new MppSetupError(`Room ${roomId} is not opted in at ${paths.fundingPath}; run npm run x402:setup -- init --room ${roomId} --steward <profileUuid> first.`);
  if (refs.length > 1) throw new MppSetupError(`Room ${roomId} has several funding links in ${paths.fundingPath}; keep one.`);
  if (!(await readAgentToken(paths.tokenPath)))
    throw new MppSetupError(`No valid agent token at ${paths.tokenPath}; run npm run x402:setup -- init first.`);
  let existing: Record<string, unknown> | null = null;
  let text: string | null = null;
  try { text = await readFile(paths.configPath, "utf8"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (text !== null) {
    try { existing = JSON.parse(text) as Record<string, unknown>; } catch {
      throw new MppSetupError(`${paths.configPath} is not valid JSON; fix or move it before running init.`);
    }
  }
  const current = existing ? parseMppConfig(existing) : null;
  const mpp = adapter ?? await loadMppAdapter();
  const broken = (await inspectMppWallets(mpp, paths.walletDir)).flatMap((item) => (item.ok || item.missing ? [] : [item.problem]));
  if (broken.length) throw new MppWalletError(`Fix or move these wallet files first: ${broken.join("; ")}`);
  const keyText = await readFile(paths.keyPath, "utf8").catch((error: NodeJS.ErrnoException) => (error.code === "ENOENT" ? null : Promise.reject(error)));
  if (keyText !== null && !CHALLENGE_KEY_PATTERN.test(keyText.trim()))
    throw new MppSetupError(`${paths.keyPath} is not a valid challenge key; move it aside only once no MPP payment is unresolved.`);

  const created = await createMissingMppWallets(mpp, paths.walletDir);
  const wallets = await loadMppWallets(mpp, paths.walletDir);
  const keyCreated = await createChallengeKey(paths.keyPath);
  const previous = current?.rooms[roomId]?.maxTopUps;
  const next = {
    version: 1,
    network: TEMPO_MODERATO,
    recipient: current?.recipient ?? wallets.payTo.address,
    currency: current?.currency ?? PATHUSD,
    rooms: { ...(existing?.rooms as Record<string, unknown> | undefined), [roomId]: { maxTopUps } },
  };
  const saved = parseMppConfig(next);
  await mkdir(dirname(paths.configPath), { recursive: true, mode: 0o700 });
  await writeAtomic(paths.configPath, `${JSON.stringify(next, null, 2)}\n`);
  await chmod(paths.configPath, 0o600);

  const [ref] = refs[0];
  const url = `http://127.0.0.1:${port}/api/mpp/fund/${ref}`;
  log(`Room ${roomId} accepts MPP top-ups on Tempo Moderato: ${MPP_TOP_UP.credits} test credits for ${MPP_TOP_UP.price}, at most ${maxTopUps} on this rail${
    previous !== undefined && previous !== maxTopUps ? ` (was ${previous})` : ""}. x402 top-ups keep their own limit.`);
  log(`Funding URL: ${url}`);
  log(`Serve it locally with PILOT_LOCAL_CONTROLS=1 pnpm dev --port ${port}; the payer sends the x402 agent token from ${paths.tokenPath}.`);
  log(`Saved ${paths.configPath} (mode 600; recipient ${saved.recipient}, token ${saved.currency}).`);
  log(`Challenge key ${keyCreated ? "created" : "kept"} at ${paths.keyPath} (mode 600; never rotate it while a payment is unresolved).`);
  log(`Wallets in ${paths.walletDir}${created.length ? ` (created ${created.map((spec) => spec.file).join(", ")})` : ""}:`);
  log(`  payer  Tempo Moderato  ${wallets.payer.address}`);
  log(`  payTo  Tempo Moderato  ${wallets.payTo.address}`);
  if (!sameAddress(saved.recipient, wallets.payTo.address))
    log(`Note: the recipient stays ${saved.recipient} from the existing config, not the payto wallet.`);
  if (!values["skip-faucet"] && rpc) {
    try {
      const balance = await tokenBalance(rpc, PATHUSD, wallets.payer.address);
      if (balance >= 2n * TOP_UP_ATOMIC) {
        log(`The payer holds ${formatUsd(balance)} test pathUSD; no faucet request needed.`);
      } else {
        const funded = await fundPayer(rpc, wallets.payer.address, { adapter: mpp });
        log(`Faucet: the payer went from ${formatUsd(funded.before)} to ${formatUsd(funded.after)} test pathUSD.`);
        for (const hash of funded.hashes) log(`  ${mppExplorerUrl(hash)}`);
      }
    } catch (error) {
      log(`WARN: the faucet request failed (${(error as Error).message}); run ${MPP_COMMANDS.setup} faucet later.`);
    }
  }
  log(`Next: ${MPP_COMMANDS.setup} check (read-only).`);
  return { ref, url, created: created.map((spec) => spec.file), config: saved };
}

export type CheckLevel = "PASS" | "WARN" | "FAIL";
export type CheckLine = { level: CheckLevel; topic: string; detail: string };
const line = (level: CheckLevel, topic: string, detail: string): CheckLine => ({ level, topic, detail });

export type MppRoomEvidence = { state: RoomFundingState; activeTopUps: number };
export type MppRoomReader = (room: MppRoom) => Promise<MppRoomEvidence>;
/** Selects and storage lists only. */
export function supabaseMppRoomReader(client: ReturnType<typeof pilotAdmin>): MppRoomReader {
  const ledger = supabaseFundingLedger(client), store = supabaseReceiptStore(client);
  return async (room) => {
    const [state, activeTopUps] = await Promise.all([ledger.state(room.roomId, room.stewardProfileId), activeMppTopUps(store, room.roomId)]);
    return { state, activeTopUps };
  };
}

/** A read-only readiness checklist: config, key, agent token, wallets, the chain, balances, the offer and rooms. */
export async function check(deps: MppSetupPaths & { rpc?: TempoRpc; rooms?: MppRoomReader | null; adapter?: MppAdapter | null }): Promise<CheckLine[]> {
  const rpc = deps.rpc ?? tempoRpc();
  const lines: CheckLine[] = [];
  const add = (level: CheckLevel, topic: string, detail: string) => { lines.push(line(level, topic, detail)); };
  const attempt = async (topic: string, subject: string, run: () => Promise<void>) => {
    try { await run(); } catch (error) { add("FAIL", topic, `${subject}: ${(error as Error).message}`); }
  };

  let config: MppDoorConfig | null = null;
  let funding: FundingConfig | null = null;
  try {
    config = await loadMppConfig(deps.configPath);
    if (!config) add("FAIL", "config", `${deps.configPath} does not exist; run init first`);
    else add(Object.keys(config.rooms).length ? "PASS" : "FAIL", "config",
      `${Object.keys(config.rooms).length} room(s) opted in; recipient ${config.recipient}; token ${config.currency}`);
  } catch (error) {
    add("FAIL", "config", (error as Error).message);
  }
  try { funding = await loadFundingConfig(deps.fundingPath); } catch (error) { add("FAIL", "x402", (error as Error).message); }
  const key = await secretFileProblem(deps.keyPath, readChallengeKey, "challenge key", "run init to create it");
  add(key ? "FAIL" : "PASS", "key", key ?? `challenge key ${deps.keyPath} exists with mode 600`);
  const token = await secretFileProblem(deps.tokenPath, readAgentToken, "agent token", "run npm run x402:setup -- init");
  add(token ? "FAIL" : "PASS", "agent", token ?? `token ${deps.tokenPath} exists with mode 600`);
  let adapter: MppAdapter | null = deps.adapter ?? null;
  if (!adapter && deps.adapter === undefined) adapter = await loadMppAdapter().catch((error: Error) => {
    add("FAIL", "adapter", error.message);
    return null;
  });
  if (adapter) add("PASS", "adapter", `mppx ${adapter.versions.mppx} and viem ${adapter.versions.viem} on chain ${adapter.chainId}, isolated in ${mppAdapterPath()}`);
  else if (deps.adapter === null) add("FAIL", "adapter", `the isolated MPP adapter is not loaded. ${ADAPTER_INSTALL_HINT}`);
  const wallets = adapter ? await inspectMppWallets(adapter, deps.walletDir) : [];
  for (const item of wallets) {
    if (!item.ok) { add("FAIL", "wallet", item.missing ? `${item.file} is missing; run init to create it` : item.problem); continue; }
    // A wallet file other users can read fails to load at all (wallets.ts), so it shows up as a FAIL above.
    add("PASS", "wallet", `${item.role} on Tempo Moderato: ${item.wallet.address}`);
  }
  const payer = wallets.find((item) => item.role === "payer");
  const payTo = wallets.find((item) => item.role === "payTo");
  if (config && payTo?.ok && !sameAddress(config.recipient, payTo.wallet.address))
    add("WARN", "config", `recipient ${config.recipient} is not the payto wallet ${payTo.wallet.address}`);
  const rooms: [string, MppRoom][] = [];
  if (config) for (const roomId of Object.keys(config.rooms)) {
    const refs = Object.entries(funding?.rooms ?? {}).filter(([, room]) => room.roomId === roomId);
    const room = refs.length === 1 && funding ? mppRoomFor(funding, config, refs[0][0]) : null;
    if (room) rooms.push([refs[0][0], room]);
    else add("FAIL", "room", `${roomId} has an MPP limit but ${refs.length ? "several x402 funding links" : "no x402 opt-in"}, so it has no MPP funding link`);
  }

  await attempt("chain", "Tempo Moderato", async () => {
    const chainId = Number(await rpc<string>("eth_chainId", []));
    add(chainId === MODERATO_CHAIN_ID ? "PASS" : "FAIL", "chain", `the RPC serves chain ${chainId}${chainId === MODERATO_CHAIN_ID ? " (Tempo Moderato testnet)" : ", not Tempo Moderato"}`);
  });
  const currency = config?.currency ?? PATHUSD;
  if (payer?.ok) await attempt("balance", "payer", async () => {
    const atomic = await tokenBalance(rpc, currency, payer.wallet.address);
    const fee = currency === PATHUSD ? "" : "; it also needs test pathUSD for fees";
    add(atomic >= TOP_UP_ATOMIC ? "PASS" : "FAIL", "balance", `payer holds ${formatUsd(atomic)} of the charge token; ${atomic >= TOP_UP_ATOMIC
      ? `enough for ${atomic / TOP_UP_ATOMIC} top-up(s)${fee}` : `run ${MPP_COMMANDS.setup} faucet`}`);
  });
  if (config) await attempt("balance", "recipient", async () => {
    add("PASS", "balance", `recipient ${config!.recipient} holds ${formatUsd(await tokenBalance(rpc, currency, config!.recipient))} of the charge token`);
  });
  const challengeKey = await readChallengeKey(deps.keyPath).catch(() => null);
  if (config && challengeKey && rooms.length && adapter) await attempt("offer", "the route could not build its offer", async () => {
    // Offline: building a challenge reads nothing from the chain.
    const port = createChargePort(config!, { challengeKey, adapter: adapter!, rpc: async ({ method }) => { throw new Error(`check is read-only (${method})`); } });
    await port.offer(rooms[0][1]);
    add("PASS", "offer", `the route builds its ${MPP_TOP_UP.price} pull-mode offer on Tempo Moderato`);
  });
  const reader = deps.rooms;
  if (!reader)
    add("FAIL", "supabase", `NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are not set, and the route needs them: put them in .env.local, which ${MPP_COMMANDS.setup} check reads. Room checks were skipped`);
  else for (const [ref, room] of rooms)
    await attempt("room", `room ${room.roomId}`, async () => {
      const evidence = await reader(room);
      const refusal = fundingRefusal(evidence.state, evidence.activeTopUps, room.maxTopUps);
      add(refusal ? "FAIL" : "PASS", "room", `${room.roomId} (ref ${ref.slice(0, 6)}…): ${evidence.state.open ? "open" : "closed"}; MPP top-ups ${evidence.activeTopUps} of ${room.maxTopUps}; ${
        refusal ? `the route would refuse: ${refusal}` : "the route can offer a top-up"}`);
    });
  return lines;
}

export const renderCheck = (lines: CheckLine[]) => [
  "MPP setup check (read-only; nothing is signed, sent or written)",
  ...lines.map((item) => `${item.level.padEnd(4)}  ${item.topic.padEnd(8)}  ${item.detail}`),
  `${lines.filter((item) => item.level === "FAIL").length} FAIL, ${lines.filter((item) => item.level === "WARN").length} WARN`,
].join("\n");

const USAGE = `Usage:
  ${MPP_COMMANDS.setup} init --room <roomId> [--max-top-ups 2] [--port 3005] [--skip-faucet]
  ${MPP_COMMANDS.setup} faucet
  ${MPP_COMMANDS.setup} check`;

async function main(argv: string[]) {
  // pnpm forwards the "--" separator; npm drops it.
  const [command, ...args] = argv[0] === "--" ? argv.slice(1) : argv;
  if (command === "init") {
    await init(args);
  } else if (command === "faucet" && !args.length) {
    const adapter = await loadMppAdapter();
    const { payer } = await loadMppWallets(adapter);
    const funded = await fundPayer(tempoRpc(), payer.address, { adapter });
    console.log(`Faucet: payer ${payer.address} went from ${formatUsd(funded.before)} to ${formatUsd(funded.after)} test pathUSD (testnet only).`);
    for (const hash of funded.hashes) console.log(`  ${mppExplorerUrl(hash)}`);
  } else if (command === "check" && !args.length) {
    const lines = await check({ ...defaultMppPaths(), rooms: supabaseConfigured() ? supabaseMppRoomReader(pilotAdmin()) : null });
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
    console.error(`mpp setup: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
