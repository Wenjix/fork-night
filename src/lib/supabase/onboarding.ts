import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "./database.types.ts";
import type { StoragePort } from "../onchain/client.ts";

export const GOOGLE_LINK_KEY = "fork-night:google-link";
type Client = SupabaseClient<Database>;
export const isSavedAccount = (user: User | null | undefined) => !!user && user.is_anonymous === false;

export async function signOutPilotAccount(client: Client, storage: StoragePort) {
  const result = await client.auth.signOut({ scope: "local" });
  if (result.error) throw new Error("Your account could not be signed out. Refresh and try again.");
  try { storage.removeItem(GOOGLE_LINK_KEY); }
  catch { /* Sign-out succeeds even if optional callback storage is unavailable. */ }
}

export async function createEmbeddedWalletIfCurrent(getToken: () => Promise<string | undefined>, createWallet: () => Promise<unknown>, isCurrent: () => boolean) {
  if (!isCurrent()) return;
  const token = await getToken();
  if (token && isCurrent()) await createWallet();
}

type LinkedAccount = { type: string; customUserId?: string; walletClientType?: string; chainType?: string; address?: string };
export function embeddedAddressForMaker(makerId: string, accounts: LinkedAccount[]) {
  if (!makerId || !accounts.some(account => account.type === "custom_auth" && account.customUserId === makerId)) return undefined;
  return accounts.find(account => account.type === "wallet" && account.walletClientType === "privy" && account.chainType === "ethereum")?.address;
}

export function googleReturnUrl(current: string) {
  const url = new URL(current);
  url.pathname = "/pilot";
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (!["room", "moment", "create"].includes(key)) url.searchParams.delete(key);
  }
  if (url.searchParams.get("create") !== "1" || url.searchParams.has("room")) url.searchParams.delete("create");
  url.searchParams.set("onboarding", "1");
  return url.href;
}

export async function startGoogleLogin(client: Client, currentUrl: string, storage: StoragePort, mode: "link" | "return") {
  const session = await client.auth.getSession();
  if (session.error) throw new Error("Your session could not be restored. Refresh before signing in.");
  const verified = session.data.session ? await client.auth.getUser() : undefined;
  if (verified?.error || (verified && !verified.data.user)) throw new Error("Your storyteller identity could not be verified. Refresh before signing in.");
  const user = verified?.data.user;
  const options = { redirectTo: googleReturnUrl(currentUrl) };
  if (mode === "link") {
    if (!user) throw new Error("Choose your storyteller name before signing in with Google.");
    if (isSavedAccount(user)) return;
    storage.setItem(GOOGLE_LINK_KEY, user.id);
    const result = await client.auth.linkIdentity({ provider: "google", options });
    if (result.error) {
      storage.removeItem(GOOGLE_LINK_KEY);
      throw new Error("Google could not be linked to this storyteller. Your guest work is preserved. Check that Google sign-in and identity linking are enabled.");
    }
  } else {
    // Returning sign-in is available before making a guest profile. Existing
    // guests link their account instead of silently abandoning its work.
    if (user?.is_anonymous) {
      const profile = await client.from("pilot_profiles").select("id").eq("id", user.id).maybeSingle();
      if (profile.error) throw new Error("Your guest work could not be checked. Refresh before switching accounts.");
      if (profile.data) throw new Error("Keep this guest's byline by linking Google from your storyteller identity. Sign in to another account in a separate browser profile.");
    }
    storage.removeItem(GOOGLE_LINK_KEY);
    const result = await client.auth.signInWithOAuth({ provider: "google", options });
    if (result.error) throw new Error("Google sign-in could not start. You can still join as a guest.");
  }
}

export function checkGoogleLink(user: User, storage: StoragePort) {
  const expected = storage.getItem(GOOGLE_LINK_KEY);
  if (!expected) return;
  if (user.id !== expected) throw new Error("Google returned a different storyteller account. The two bylines have not been merged. Use a separate browser profile to sign in to that account.");
  if (isSavedAccount(user)) storage.removeItem(GOOGLE_LINK_KEY);
}

export function googleCallbackError(currentUrl: string) {
  const url = new URL(currentUrl);
  const hash = new URLSearchParams(url.hash.slice(1));
  const code = url.searchParams.get("error_code") ?? hash.get("error_code");
  if (!code && !url.searchParams.has("error") && !hash.has("error")) return "";
  if (code === "identity_already_exists") return "That Google account already belongs to another storyteller. Keep this guest session open and use a separate browser profile to sign in to the existing account.";
  return "Google sign-in did not finish. Your guest work is preserved; try signing in again.";
}

export async function walletAuthToken(client: Client, userId: string) {
  const saved = await client.auth.getSession();
  if (saved.error || !saved.data.session) throw new Error("Sign in with Google before preparing your wallet.");
  const session = saved.data.session;
  const verified = await client.auth.getUser(session.access_token);
  if (verified.error || !isSavedAccount(verified.data.user) || verified.data.user!.id !== userId) {
    throw new Error("Your storyteller account changed. Refresh before opening its wallet.");
  }
  let algorithm: unknown;
  try { algorithm = JSON.parse(atob(session.access_token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/"))).alg; }
  catch { throw new Error("Your sign-in token could not be checked. Refresh and try again."); }
  if (!["ES256", "RS256"].includes(String(algorithm))) {
    throw new Error("Wallet sign-in needs the project's public JWT signing keys. Google is saved; the operator needs to finish the wallet setup.");
  }
  return session.access_token;
}
