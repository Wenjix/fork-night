import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getAddress, isAddress, ZeroAddress } from "ethers";
import type { Database } from "./database.types.ts";
import type { WalletProvider } from "../onchain/client.ts";

type Client = SupabaseClient<Database>;
export type WalletChoice = { owner: string; mode: "embedded" | "external" };

export function walletAccountAddress(user: User | null | undefined) {
  if (!user || user.is_anonymous !== false) return "";
  for (const identity of user.identities ?? []) {
    if (identity.provider !== "web3") continue;
    const claims = identity.identity_data?.custom_claims ?? identity.identity_data;
    if (claims?.chain !== "ethereum") continue;
    const address = claims.address;
    if (typeof address === "string" && isAddress(address) && getAddress(address) !== ZeroAddress) return getAddress(address);
  }
  return "";
}

export function useEmbeddedWalletByDefault(user: User | null | undefined) {
  return !!user && user.is_anonymous === false
    && !!user.identities?.some(identity => identity.provider === "google")
    && !user.identities.some(identity => identity.provider === "web3");
}

export function accountWalletMode(user: User | null | undefined, enabled: boolean, choice?: WalletChoice): "embedded" | "external" {
  if (!user || user.is_anonymous !== false) return "external";
  if (choice?.owner === user.id && (choice.mode === "external" || enabled)) return choice.mode;
  return enabled && useEmbeddedWalletByDefault(user) ? "embedded" : "external";
}

export function walletSignInUrl(currentUrl: string) {
  const url = new URL(currentUrl);
  url.pathname = "/pilot";
  url.search = "";
  url.hash = "";
  return url.href;
}

export async function startWalletLogin(client: Client, wallet: WalletProvider | undefined, currentUrl: string): Promise<User> {
  if (!wallet) throw new Error("Open this page in a browser with MetaMask or another Ethereum wallet enabled.");
  const restored = await client.auth.getSession();
  if (restored.error) throw new Error("Your current session could not be restored. Refresh before signing in.");
  const before = restored.data.session?.user.id;
  if (before) {
    const verified = await client.auth.getUser(restored.data.session!.access_token);
    if (verified.error || verified.data.user?.id !== before) throw new Error("Your current account could not be verified. Refresh before signing in.");
    const profile = await client.from("pilot_profiles").select("id").eq("id", before).maybeSingle();
    if (profile.error) throw new Error("Your current storyteller could not be checked. Refresh before signing in.");
    if (profile.data) throw new Error(verified.data.user?.is_anonymous
      ? "Keep this guest's byline and drafts in this browser. Use a separate browser profile for wallet sign-in; your guest can still use a browser wallet for testnet actions."
      : "You are already signed in. Use the release panel to connect a browser wallet, or sign out to switch accounts.");
  }
  let selected = "";
  try {
    const { data, error } = await client.auth.signInWithWeb3({
      chain: "ethereum",
      statement: "Sign in to Fork Night. This signature does not authorize a payment or a payout-wallet approval.",
      options: { url: walletSignInUrl(currentUrl), signInWithEthereum: { expirationTime: new Date(Date.now() + 300_000) } },
      wallet: {
        get address() { return selected; },
        on: (event, listener) => wallet.on?.(event, listener as (...args: unknown[]) => void),
        removeListener: (event, listener) => wallet.removeListener?.(event, listener as (...args: unknown[]) => void),
        request: async input => {
          const result = await wallet.request({ method: input.method, params: Array.isArray(input.params) ? input.params : undefined });
          if (input.method === "eth_requestAccounts" && Array.isArray(result) && typeof result[0] === "string") selected = getAddress(result[0]);
          if (input.method === "personal_sign") {
            const current = await client.auth.getSession();
            if (current.error || current.data.session?.user.id !== before) throw new Error("Your account changed while signing. Review your sign-in again.");
          }
          return result;
        },
      },
    });
    if (error?.code === "web3_provider_disabled") throw new Error("Wallet sign-in is awaiting room setup. You can still join as a guest.");
    if (error || !data.user || !data.session) throw new Error("Wallet sign-in did not finish. Reconnect your wallet and try again.");
    return data.user;
  } catch (reason) {
    if (reason instanceof Error && /account changed while signing|awaiting room setup|Wallet sign-in did not finish/.test(reason.message)) throw reason;
    throw new Error("Wallet sign-in did not finish. Your current account is preserved. Try again when your wallet is ready.");
  }
}
