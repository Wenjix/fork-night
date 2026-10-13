import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { MppAccount, MppAdapter } from "./adapter.ts";
import { TEMPO_MODERATO } from "./ids.ts";

/** Throwaway Moderato wallets for the local proof, in the x402 wallet file format. Keys come from the adapter's viem. */
export type MppWalletRole = "payer" | "payTo";
export type MppWalletSpec = { role: MppWalletRole; file: string };
export const MPP_WALLETS: readonly MppWalletSpec[] = [
  { role: "payer", file: "payer-tempo-moderato.json" },
  { role: "payTo", file: "payto-tempo-moderato.json" },
];

/** Safe to print. Key material stays in this module or inside an adapter account. */
export type PublicMppWallet = MppWalletSpec & { network: typeof TEMPO_MODERATO; address: string; path: string; mode: number };
export type MppWalletCheck = MppWalletSpec & { path: string } & (
  | { ok: true; wallet: PublicMppWallet }
  | { ok: false; missing: boolean; problem: string }
);

export class MppWalletError extends Error {}

export const mppWalletDirectory = () => resolve(/*turbopackIgnore: true*/ process.env.MPP_WALLET_DIR ?? ".local/mpp/wallets");

const NOTE = "Throwaway TESTNET key generated for the local Fork Night MPP proof on Tempo Moderato. Never send mainnet assets to it.";
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const EVM_KEY = /^0x[0-9a-fA-F]{64}$/;

// Problems never quote the file or a library error: both can echo key material.
async function open(adapter: MppAdapter, dir: string, spec: MppWalletSpec): Promise<{ wallet: PublicMppWallet; key: string }> {
  function fail(problem: string): never {
    throw new MppWalletError(`${spec.file}: ${problem}`);
  }
  const path = join(dir, spec.file);
  const [text, info] = await Promise.all([readFile(path, "utf8"), stat(path)]);
  // A key file other users can read is never used, for signing or anything else.
  if (info.mode & 0o077) fail("is readable by other users; chmod 600 it");
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { fail("is not valid JSON"); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("must hold a JSON object");
  const file = raw as Record<string, unknown>;
  if (file.version !== 1) fail("version must be 1");
  if (file.kind !== "evm") fail('kind must be "evm"');
  if (file.role !== spec.role) fail(`role must be "${spec.role}"`);
  if (file.network !== TEMPO_MODERATO) fail(`network must be ${TEMPO_MODERATO}`);
  const claimed = typeof file.address === "string" ? file.address : "";
  if (!EVM_ADDRESS.test(claimed)) fail("address must be a 0x-prefixed EVM address");
  if (typeof file.privateKey !== "string" || !EVM_KEY.test(file.privateKey)) fail("privateKey must be 0x followed by 64 hex characters");
  let address: string;
  try { address = adapter.addressOf(file.privateKey); } catch { return fail("privateKey is not a valid secp256k1 key"); }
  if (address.toLowerCase() !== claimed.toLowerCase()) fail("privateKey does not match address");
  return { wallet: { ...spec, network: TEMPO_MODERATO, address, path, mode: info.mode & 0o777 }, key: file.privateKey };
}

/** One result per expected wallet file, never throwing for a missing or invalid file. */
export async function inspectMppWallets(adapter: MppAdapter, dir = mppWalletDirectory()): Promise<MppWalletCheck[]> {
  return Promise.all(MPP_WALLETS.map(async (spec): Promise<MppWalletCheck> => {
    const path = join(dir, spec.file);
    try {
      return { ...spec, path, ok: true, wallet: (await open(adapter, dir, spec)).wallet };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const problem = error instanceof MppWalletError ? error.message
        : code === "ENOENT" ? `${spec.file} is missing` : `${spec.file} could not be read (${code ?? "unknown error"})`;
      return { ...spec, path, ok: false, missing: code === "ENOENT", problem };
    }
  }));
}

/** Both wallets as public facts; throws naming every problem. */
export async function loadMppWallets(adapter: MppAdapter, dir = mppWalletDirectory()): Promise<Record<MppWalletRole, PublicMppWallet>> {
  const checks = await inspectMppWallets(adapter, dir);
  const problems = checks.flatMap((check) => (check.ok ? [] : [check.problem]));
  if (problems.length) throw new MppWalletError(`MPP wallets in ${dir}: ${problems.join("; ")}`);
  return Object.fromEntries(checks.map((check) => [check.role, (check as { wallet: PublicMppWallet }).wallet])) as Record<MppWalletRole, PublicMppWallet>;
}

/** For signing only: an adapter account keeps the key in a closure; only its address is visible. */
export async function mppSigner(adapter: MppAdapter, role: MppWalletRole, dir = mppWalletDirectory()): Promise<MppAccount> {
  const { key } = await open(adapter, dir, MPP_WALLETS.find((spec) => spec.role === role)!);
  return adapter.accountFromKey(key);
}

/** Writes only the wallet files that do not exist yet; an existing file is never replaced. */
export async function createMissingMppWallets(adapter: MppAdapter, dir = mppWalletDirectory(), now = () => new Date()) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const created: MppWalletSpec[] = [];
  for (const spec of MPP_WALLETS) {
    const path = join(dir, spec.file);
    const privateKey = adapter.generatePrivateKey();
    const body = {
      version: 1, kind: "evm", role: spec.role, network: TEMPO_MODERATO,
      address: adapter.addressOf(privateKey), privateKey, createdAt: now().toISOString(), note: NOTE,
    };
    try {
      await writeFile(path, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw error;
    }
    await chmod(path, 0o600);
    created.push(spec);
  }
  return created;
}
