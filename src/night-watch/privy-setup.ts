import type { KeyObject } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { generateAuthorizationKey, parseAuthorizationKey, type PrivyCredentials } from "../privy/rest.ts";
import type { NightWatchStore } from "./store.ts";

/**
 * Local Privy setup for the Night Watch: the app's authorization key (never printed), the 1-of-1
 * key quorum users add as their Night Watch signer, and the developer-owned claim helper wallet.
 */

export type PrivySetup = {
  version: 1;
  appId: string;
  keyQuorumId: string;
  publicKey: string;
  createdAt: string;
  claimHelper?: { walletId: string; address: string; policyId: string; createdAt: string };
};

export const SETUP_RECORD = "privy/setup";
const KEY_FILE = "privy/authorization-key";

export function privyCredentials(env: NodeJS.ProcessEnv = process.env): PrivyCredentials | null {
  const appId = env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
  const appSecret = env.PRIVY_APP_SECRET?.trim();
  if (!appId || !appSecret) return null;
  return { appId, appSecret };
}

/** Reads the authorization key, creating it (mode 600) on first use. Its value is never logged. */
export async function authorizationKey(store: NightWatchStore, options: { create?: boolean } = {}): Promise<{ privateKey: KeyObject; publicKey: string; created: boolean }> {
  const path = join(store.root, KEY_FILE);
  try {
    const parsed = parseAuthorizationKey(await readFile(path, "utf8"));
    return { ...parsed, created: false };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" || !options.create) throw error;
  }
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(`${generateAuthorizationKey()}\n`);
  } finally {
    await handle.close();
  }
  return { ...parseAuthorizationKey(await readFile(path, "utf8")), created: true };
}

export async function readPrivySetup(store: NightWatchStore): Promise<PrivySetup | null> {
  return store.read<PrivySetup>(SETUP_RECORD);
}
