import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * The isolated MPP adapter (vendor/mpp-adapter): mppx 0.13.4 and viem 2.57.3 in their own folder with their
 * own lockfile, so the app's root dependency tree never changes. Everything the door needs from mppx, viem,
 * ox or Tempo goes through this interface; the app's own viem is never used for MPP. The module loads only
 * at run time, after the route's gate, through a turbopackIgnore import of a resolved file URL.
 */
export type Eip1193Request = (args: { method: string; params?: unknown }) => Promise<unknown>;
export type AdapterError = { kind: "expired" | "payment" | "revert" | "other"; name: string; message: string };
export type MppChallenge = {
  id: string;
  realm: string;
  method: string;
  intent: string;
  expires?: string;
  opaque?: string;
  request: Record<string, unknown>;
};
export type MppCredential = { challenge: MppChallenge; payload: unknown; source?: string };
export type RouteOptions = { request: { amount: string }; realm: string; meta: Record<string, string> };
export type DecodedTransaction = {
  type: string | null;
  from: string | null;
  chainId: number | null;
  validBefore: number | null;
  sponsored: boolean;
  calls: { to: string | null; data: string }[];
  /** keccak256 of the canonical signed bytes, lowercase: the on-chain hash when no fee payer co-signs. */
  hash: string;
};
export type BroadcastResult = (
  | { ok: true; reference: string; status: string; receipt: Record<string, unknown>; receiptHeader: string }
  | { ok: false; error: AdapterError }
) & { attempted: boolean; sentHash: string | null };
export interface MppChargeServer {
  /** A fresh HMAC-bound challenge; no network call. */
  challenge(input: { amount: string; meta: Record<string, string>; expires?: string }): Promise<{ header: string; id: string; expires: string | null }>;
  verifyChallenge(challenge: MppChallenge): boolean;
  /** mppx validateCredential: no replay marker, no co-signing, no broadcast. */
  validate(credential: MppCredential, options: RouteOptions): Promise<{ ok: true } | { ok: false; error: AdapterError }>;
  /** mppx broadcastCredential, with whether the transaction left the process. Never throws. */
  broadcast(credential: MppCredential, options: RouteOptions): Promise<BroadcastResult>;
}
/** Made by the adapter; viem keeps the key in a closure. */
export type MppAccount = { readonly address: string };
export interface MppAdapter {
  adapterVersion: number;
  versions: { mppx: string; viem: string };
  chainId: number;
  rpcUrl: string;
  createChargeServer(options: {
    secretKey: string;
    realm: string;
    currency: string;
    recipient: string;
    chainId: number;
    request?: Eip1193Request;
  }): MppChargeServer;
  /** Throws when the bytes are not a Tempo transaction. */
  decodeTransaction(signed: string): Promise<DecodedTransaction>;
  /** Null without a Payment scheme; throws when the credential cannot be decoded. */
  readCredential(authorization: string): MppCredential | null;
  /** Throws when the header holds no Payment challenge. */
  parseChallengeHeader(header: string): MppChallenge;
  readReceiptHeader(header: string | null): Record<string, unknown> | null;
  keccakUtf8(value: string): string;
  generatePrivateKey(): string;
  /** Throws for an invalid key, without quoting it. */
  addressOf(privateKey: string): string;
  accountFromKey(privateKey: string): MppAccount;
  createPayment(options: {
    account: MppAccount;
    challenge: MppChallenge;
    expectedRecipient: string;
    request?: Eip1193Request;
  }): Promise<{ credential: string; transaction: string; validBefore: number | null; payer: string }>;
  /** The public Moderato faucet (tempo_fundAddress); returns its transaction hashes. Testnet only. */
  faucet(options: { address: string; request?: Eip1193Request }): Promise<string[]>;
}

/**
 * The reviewed adapter: its version and library versions, and the SHA-256 of its index.mjs and lockfile, checked
 * before the module is imported (so the version report of a different file is never trusted). The frozen install
 * makes node_modules match the pinned lockfile's integrity hashes.
 */
export const ADAPTER_PINS = {
  adapterVersion: 1,
  mppx: "0.13.4",
  viem: "2.57.3",
  indexSha256: "f79388cfc91b00c1de75ebb2dce6725e3296d5ec00db2ed03a283c10323c2d28",
  lockfileSha256: "a2ef9c3d3b6093aad57ffd18296934305a6b8021c6a9465003b7d35c8001e7c8",
} as const;
export const ADAPTER_INSTALL_HINT =
  "Install it once with: cd vendor/mpp-adapter && pnpm install --frozen-lockfile --ignore-scripts (its own lockfile; the app's dependencies do not change).";
export class MppAdapterError extends Error {}

// The opt-out keeps Turbopack from tracing the adapter (and the project) into the route bundle. MPP_ADAPTER is
// honored only under test (NODE_ENV=test); a dev or production server always loads the vendored adapter.
export const mppAdapterPath = () =>
  resolve(/*turbopackIgnore: true*/ (process.env.NODE_ENV === "test" && process.env.MPP_ADAPTER) || "vendor/mpp-adapter/index.mjs");

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** The file at path and the lockfile beside it must be the pinned ones; read before anything is imported. */
async function checkPinnedFiles(path: string) {
  let index: Buffer;
  try {
    index = await readFile(/*turbopackIgnore: true*/ path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new MppAdapterError(`The MPP adapter is not installed at ${path}. ${ADAPTER_INSTALL_HINT}`);
    throw new MppAdapterError(`The MPP adapter at ${path} could not be read (${(error as NodeJS.ErrnoException).code ?? "unknown error"}).`);
  }
  // The opt-outs keep Turbopack from tracing lockfiles into the route bundle.
  const lockfilePath = resolve(/*turbopackIgnore: true*/ dirname(path), "pnpm-lock.yaml");
  const lockfile = await readFile(/*turbopackIgnore: true*/ lockfilePath).catch(() => null);
  if (sha256(index) !== ADAPTER_PINS.indexSha256 || !lockfile || sha256(lockfile) !== ADAPTER_PINS.lockfileSha256)
    throw new MppAdapterError(`The MPP adapter at ${path} is not the reviewed adapter: its index.mjs or pnpm-lock.yaml differs from the pinned SHA-256.`);
}

const FUNCTIONS = [
  "createChargeServer", "decodeTransaction", "readCredential", "parseChallengeHeader", "readReceiptHeader",
  "keccakUtf8", "generatePrivateKey", "addressOf", "accountFromKey", "createPayment", "faucet",
] as const;

/** The loaded module must be the reviewed adapter: version, pins, chain and every function. */
export function checkAdapter(module: unknown): MppAdapter {
  const adapter = module as Partial<MppAdapter> | null;
  if (!adapter || adapter.adapterVersion !== ADAPTER_PINS.adapterVersion)
    throw new MppAdapterError("The MPP adapter is not version 1.");
  if (adapter.versions?.mppx !== ADAPTER_PINS.mppx || adapter.versions?.viem !== ADAPTER_PINS.viem)
    throw new MppAdapterError(`The MPP adapter must load mppx ${ADAPTER_PINS.mppx} and viem ${ADAPTER_PINS.viem}; it loaded mppx ${adapter.versions?.mppx} and viem ${adapter.versions?.viem}. ${ADAPTER_INSTALL_HINT}`);
  if (adapter.chainId !== 42431) throw new MppAdapterError("The MPP adapter is not for Tempo Moderato.");
  const missing = FUNCTIONS.filter((name) => typeof adapter[name] !== "function");
  if (missing.length) throw new MppAdapterError(`The MPP adapter lacks ${missing.join(", ")}.`);
  return adapter as MppAdapter;
}

const loaded = new Map<string, Promise<MppAdapter>>();

/** Loads the adapter once per path, only if its files are the pinned ones. A failed load is retried on the next call. */
export function loadMppAdapter(path = mppAdapterPath()): Promise<MppAdapter> {
  let pending = loaded.get(path);
  if (!pending) {
    pending = checkPinnedFiles(path).then(() => import(/* turbopackIgnore: true */ pathToFileURL(path).href).then(
      (module: unknown) => checkAdapter(module),
      (error: Error & { code?: string }) => {
        throw new MppAdapterError(error.code === "ERR_MODULE_NOT_FOUND"
          ? `The MPP adapter is not installed at ${path}. ${ADAPTER_INSTALL_HINT}`
          : `The MPP adapter at ${path} could not be loaded (${error.message.split("\n")[0]}). ${ADAPTER_INSTALL_HINT}`);
      },
    ));
    pending.catch(() => { if (loaded.get(path) === pending) loaded.delete(path); });
    loaded.set(path, pending);
  }
  return pending;
}
