import { getAddress } from "viem";
import { pilotAdmin } from "../generation/client.ts";
import type { PrivyRest } from "../privy/rest.ts";
import { NightWatchError } from "./http.ts";

/**
 * Who is asking. A maker is a signed-in Supabase account (its id is also the pilot profile id); on
 * the Privy side the same id is the custom-auth id the browser's JWT bridge links, which is how the
 * server finds the maker's embedded wallet without trusting anything the browser posts.
 */

export type Maker = { id: string; displayName: string };

/** The maker's Privy embedded Ethereum wallet; `tee` wallets are the only ones that accept signers. */
export type EmbeddedWallet = { id: string; address: string; delegated: boolean; tee: boolean };

/** The two reads authentication needs. The default uses the service-role Supabase client. */
export type MakerLookup = {
  /** The verified account behind an access token, or null when the token is not valid. */
  user(token: string): Promise<{ id: string; saved: boolean } | null>;
  displayName(profileId: string): Promise<string | null>;
};

export const FALLBACK_DISPLAY_NAME = "Maker";
const SIGN_IN = "Sign in with Google on this machine to authorize a Night Watch.";
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export function supabaseMakerLookup(): MakerLookup {
  let admin: ReturnType<typeof pilotAdmin>;
  try {
    admin = pilotAdmin();
  } catch {
    throw new NightWatchError(503, "not_configured", "Supabase is not configured on this machine.");
  }
  return {
    async user(token) {
      const result = await admin.auth.getUser(token);
      if (result.error) {
        // An outage is not a bad token: say so instead of signing the maker out.
        if (result.error.name === "AuthRetryableFetchError" || (result.error.status ?? 0) >= 500) {
          throw new NightWatchError(503, "auth_unavailable", "Your sign-in could not be checked right now. Try again in a moment.");
        }
        return null;
      }
      const user = result.data.user;
      return user ? { id: user.id, saved: user.is_anonymous === false } : null;
    },
    async displayName(profileId) {
      const result = await admin.from("pilot_profiles").select("display_name").eq("id", profileId).maybeSingle();
      if (result.error) throw new Error(`The maker profile could not be read: ${result.error.message}`);
      return result.data?.display_name ?? null;
    },
  };
}

/**
 * Verifies the maker's Supabase access token. Guests are refused: only a saved (Google) account has a
 * Privy embedded wallet, and a Night Watch acts for exactly that wallet.
 */
export async function authenticateMaker(token: string, lookup?: MakerLookup): Promise<Maker> {
  if (!JWT.test(token)) throw new NightWatchError(401, "sign_in", SIGN_IN);
  const directory = lookup ?? supabaseMakerLookup();
  const user = await directory.user(token);
  if (!user) throw new NightWatchError(401, "sign_in", "Your sign-in has expired. Sign in again on this machine.");
  if (!user.saved) throw new NightWatchError(403, "google_required", SIGN_IN);
  let name: string | null = null;
  try {
    name = await directory.displayName(user.id);
  } catch (error) {
    console.error("[night-watch]", error instanceof Error ? error.message : error);
  }
  return { id: user.id, displayName: name?.replace(/\s+/g, " ").trim().slice(0, 80) || FALLBACK_DISPLAY_NAME };
}

type LinkedAccount = Record<string, unknown>;

/**
 * Mirrors the browser (`embeddedAddressForMaker` in onboarding.ts): the Privy user must carry this
 * maker's custom-auth link, then the first embedded Ethereum wallet that Privy holds server-side (has an id).
 */
export function embeddedWalletFor(makerId: string, accounts: readonly LinkedAccount[]): EmbeddedWallet | null {
  if (!makerId || !accounts.some((account) => account.type === "custom_auth" && account.custom_user_id === makerId)) return null;
  for (const account of accounts) {
    if (account.type !== "wallet" || account.chain_type !== "ethereum") continue;
    if (account.connector_type !== "embedded" && account.wallet_client_type !== "privy") continue;
    if (typeof account.id !== "string" || !account.id || typeof account.address !== "string") continue;
    let address: string;
    try {
      address = getAddress(account.address);
    } catch {
      continue;
    }
    return { id: account.id, address, delegated: account.delegated === true, tee: account.recovery_method === "privy-v2" };
  }
  return null;
}

export type PrivyMaker = { userId: string; wallet: EmbeddedWallet | null };

/** The maker's Privy user and embedded wallet, or null when Privy has never seen this maker. */
export async function findPrivyMaker(privy: Pick<PrivyRest, "userByCustomAuthId">, makerId: string): Promise<PrivyMaker | null> {
  const user = await privy.userByCustomAuthId(makerId);
  if (!user) return null;
  return { userId: user.id, wallet: embeddedWalletFor(makerId, Array.isArray(user.linked_accounts) ? user.linked_accounts : []) };
}

export async function findEmbeddedWallet(privy: Pick<PrivyRest, "userByCustomAuthId">, makerId: string): Promise<EmbeddedWallet | null> {
  return (await findPrivyMaker(privy, makerId))?.wallet ?? null;
}
