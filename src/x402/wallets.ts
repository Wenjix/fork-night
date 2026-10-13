import { generateKeyPairSync } from "node:crypto";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createKeyPairSignerFromBytes, getBase58Decoder, type KeyPairSigner } from "@solana/kit";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { BASE_SEPOLIA, SOLANA_DEVNET, type Testnet } from "./ids.ts";

/** Throwaway testnet wallets for the local proof: the agent payer and the seller payTo on each testnet. */
export type WalletRole = "payer" | "payTo";
export type WalletSpec = { role: WalletRole; network: Testnet; file: string };
export const WALLETS: readonly WalletSpec[] = [
  { role: "payer", network: BASE_SEPOLIA, file: "payer-base-sepolia.json" },
  { role: "payer", network: SOLANA_DEVNET, file: "payer-solana-devnet.json" },
  { role: "payTo", network: BASE_SEPOLIA, file: "payto-base-sepolia.json" },
  { role: "payTo", network: SOLANA_DEVNET, file: "payto-solana-devnet.json" },
];

/** Safe to print. Key material stays in this module or inside a signer. */
export type PublicWallet = WalletSpec & { address: string; path: string; mode: number };
export type WalletCheck = WalletSpec & { path: string } & (
  | { ok: true; wallet: PublicWallet }
  | { ok: false; missing: boolean; problem: string }
);
export type Wallets = Record<WalletRole, Record<Testnet, PublicWallet>>;

export class WalletError extends Error {}

export const walletDirectory = () => resolve(/*turbopackIgnore: true*/ process.env.X402_WALLET_DIR ?? ".local/x402/wallets");

const NOTE = "Throwaway TESTNET key generated for the local Fork Night x402 proof. Never send mainnet assets to it.";
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const EVM_KEY = /^0x[0-9a-fA-F]{64}$/;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

type Opened = { wallet: PublicWallet; evm?: PrivateKeyAccount; svm?: KeyPairSigner };

// Problems never quote the file or a library error: both can echo key material.
async function open(dir: string, spec: WalletSpec): Promise<Opened> {
  function fail(problem: string): never {
    throw new WalletError(`${spec.file}: ${problem}`);
  }
  const path = join(dir, spec.file);
  const [text, info] = await Promise.all([readFile(path, "utf8"), stat(path)]);
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { fail("is not valid JSON"); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("must hold a JSON object");
  const file = raw as Record<string, unknown>;
  const evm = spec.network === BASE_SEPOLIA;
  if (file.version !== 1) fail("version must be 1");
  if (file.kind !== (evm ? "evm" : "svm")) fail(`kind must be "${evm ? "evm" : "svm"}"`);
  if (file.role !== spec.role) fail(`role must be "${spec.role}"`);
  if (file.network !== spec.network) fail(`network must be ${spec.network}`);
  const claimed = typeof file.address === "string" ? file.address : "";
  const opened = (address: string) => ({ ...spec, address, path, mode: info.mode & 0o777 });

  if (evm) {
    if (!EVM_ADDRESS.test(claimed)) fail("address must be a 0x-prefixed EVM address");
    if (typeof file.privateKey !== "string" || !EVM_KEY.test(file.privateKey))
      fail("privateKey must be 0x followed by 64 hex characters");
    let account: PrivateKeyAccount;
    try { account = privateKeyToAccount(file.privateKey as `0x${string}`); } catch { return fail("privateKey is not a valid secp256k1 key"); }
    if (account.address.toLowerCase() !== claimed.toLowerCase()) fail("privateKey does not match address");
    return { wallet: opened(account.address), evm: account };
  }
  if (!SOLANA_ADDRESS.test(claimed)) fail("address must be a base58 Solana address");
  const bytes = file.secretKey;
  if (!Array.isArray(bytes) || bytes.length !== 64 || !bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255))
    fail("secretKey must be an array of 64 bytes");
  const signer = await createKeyPairSignerFromBytes(Uint8Array.from(bytes as number[]))
    .catch(() => fail("secretKey is not a valid ed25519 key pair"));
  if (signer.address !== claimed) fail("secretKey does not match address");
  return { wallet: opened(signer.address), svm: signer };
}

/** One result per expected wallet file, never throwing for a missing or invalid file. */
export async function inspectWallets(dir = walletDirectory()): Promise<WalletCheck[]> {
  return Promise.all(WALLETS.map(async (spec): Promise<WalletCheck> => {
    const path = join(dir, spec.file);
    try {
      return { ...spec, path, ok: true, wallet: (await open(dir, spec)).wallet };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const problem = error instanceof WalletError ? error.message
        : code === "ENOENT" ? `${spec.file} is missing` : `${spec.file} could not be read (${code ?? "unknown error"})`;
      return { ...spec, path, ok: false, missing: code === "ENOENT", problem };
    }
  }));
}

/** All four wallets as public facts; throws naming every problem. */
export async function loadWallets(dir = walletDirectory()): Promise<Wallets> {
  const checks = await inspectWallets(dir);
  const problems = checks.flatMap((check) => (check.ok ? [] : [check.problem]));
  if (problems.length) throw new WalletError(`x402 wallets in ${dir}: ${problems.join("; ")}`);
  const wallets = { payer: {}, payTo: {} } as Wallets;
  for (const check of checks) if (check.ok) wallets[check.role][check.network] = check.wallet;
  return wallets;
}

const specFor = (role: WalletRole, network: Testnet) =>
  WALLETS.find((spec) => spec.role === role && spec.network === network)!;

/** For signing only: viem keeps the key in a closure, so nothing on the account reveals it. */
export async function evmSigner(role: WalletRole, dir = walletDirectory()) {
  return (await open(dir, specFor(role, BASE_SEPOLIA))).evm!;
}

/** For signing only: the key pair is a non-extractable WebCrypto key. */
export async function solanaSigner(role: WalletRole, dir = walletDirectory()) {
  return (await open(dir, specFor(role, SOLANA_DEVNET))).svm!;
}

// The Solana secret is seed || public key (Solana CLI layout).
function generate(spec: WalletSpec, createdAt: string) {
  const head = { version: 1, kind: spec.network === BASE_SEPOLIA ? "evm" : "svm", role: spec.role, network: spec.network };
  if (spec.network === BASE_SEPOLIA) {
    const privateKey = generatePrivateKey();
    return { ...head, address: privateKeyToAccount(privateKey).address, privateKey, createdAt, note: NOTE };
  }
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const seed = Buffer.from(privateKey.export({ format: "jwk" }).d ?? "", "base64url");
  const pub = Buffer.from(publicKey.export({ format: "jwk" }).x ?? "", "base64url");
  if (seed.length !== 32 || pub.length !== 32) throw new Error("Unexpected ed25519 key size.");
  return { ...head, address: getBase58Decoder().decode(pub), secretKey: [...seed, ...pub], createdAt, note: NOTE };
}

/** Writes only the wallet files that do not exist yet; an existing file is never replaced. */
export async function createMissingWallets(dir = walletDirectory(), now = () => new Date()) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const created: WalletSpec[] = [];
  for (const spec of WALLETS) {
    const path = join(dir, spec.file);
    try {
      await writeFile(path, `${JSON.stringify(generate(spec, now().toISOString()), null, 2)}\n`, { mode: 0o600, flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw error;
    }
    await chmod(path, 0o600);
    created.push(spec);
  }
  return created;
}
