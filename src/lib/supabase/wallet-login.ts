import type { SolanaWallet, SupabaseClient, User } from "@supabase/supabase-js";
import { getAddress, isAddress, ZeroAddress } from "ethers";
import { isAddress as isSolanaAddress } from "@solana/kit";
import type { Database } from "./database.types.ts";
import type { WalletProvider } from "../onchain/client.ts";
import type { SolanaProvider } from "../wallets/browser-wallets.ts";

type Client = SupabaseClient<Database>;
export type WalletChoice = { owner: string; mode: "embedded" | "external" };
export type WalletAccount = { chain: "ethereum" | "solana"; address: string };

export function walletAccountIdentity(user: User | null | undefined): WalletAccount | undefined {
  if (!user || user.is_anonymous !== false) return;
  for (const identity of user.identities ?? []) {
    if (identity.provider !== "web3") continue;
    const claims = identity.identity_data?.custom_claims ?? identity.identity_data;
    const address = claims?.address;
    if (typeof address !== "string") continue;
    if (claims?.chain === "ethereum" && isAddress(address) && getAddress(address) !== ZeroAddress) return { chain: "ethereum", address: getAddress(address) };
    if (claims?.chain === "solana" && isSolanaAddress(address)) return { chain: "solana", address };
  }
}

export const walletAccountAddress = (user: User | null | undefined) => walletAccountIdentity(user)?.address ?? "";

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

class WalletLoginError extends Error {}

function providerError(reason: unknown) {
  const code = reason && typeof reason === "object" && "code" in reason ? reason.code : undefined;
  if (code === 4001 || code === "ACTION_REJECTED") return "Wallet sign-in was cancelled. Choose your wallet again when you're ready.";
  if (code === -32002) return "A wallet request is already open. Finish or dismiss it in your wallet, then try signing in again.";
  if (code === 4100) return "Your wallet has not allowed this site to connect. Unlock it and approve the connection, then try again.";
  if (code === 4900 || code === 4901) return "Your wallet is disconnected. Open it, reconnect, and try signing in again.";
  return "";
}

export function startWalletLogin(client: Client, wallet: WalletProvider | undefined, currentUrl: string, chain?: "ethereum"): Promise<User>;
export function startWalletLogin(client: Client, wallet: SolanaProvider | undefined, currentUrl: string, chain: "solana"): Promise<User>;
export async function startWalletLogin(client: Client, wallet: WalletProvider | SolanaProvider | undefined, currentUrl: string, chain: "ethereum" | "solana" = "ethereum"): Promise<User> {
  if (!wallet) throw new WalletLoginError(`Open this page in a browser with ${chain === "solana" ? "Phantom, Solflare or another Solana" : "MetaMask or another Ethereum"} wallet enabled.`);
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
      : "You are already signed in. Sign out to switch accounts, or continue with this wallet for Monad release actions.");
  }
  let selected = "";
  let walletFailure: unknown;
  let walletStep = "connection";
  async function unchangedAccount() {
    const current = await client.auth.getSession();
    if (current.error || current.data.session?.user.id !== before) throw new WalletLoginError("Your account changed while signing. Review your sign-in again.");
  }
  async function walletCall<T>(call: () => Promise<T>) {
    walletFailure = undefined;
    try { return await call(); }
    catch (reason) { walletFailure = reason; throw reason; }
  }
  const statement = "Sign in to Fork Night. This signature does not authorize a payment or a payout-wallet approval.";
  const url = walletSignInUrl(currentUrl);
  const expirationTime = new Date(Date.now() + 300_000);
  try {
    let solana: SolanaWallet | undefined;
    if (chain === "solana") {
      const provider = wallet as SolanaProvider;
      if (provider.signIn) {
        solana = { signIn: async (...inputs) => {
          const output = await walletCall(() => provider.signIn!(...inputs));
          await unchangedAccount();
          return output;
        } };
      } else {
        if (provider.connect) await walletCall(() => provider.connect!());
        if (!provider.publicKey || !provider.signMessage) throw new WalletLoginError("Connect and unlock your Solana wallet, then try signing in again.");
        solana = {
          publicKey: provider.publicKey,
          signMessage: async (message, encoding) => {
            const result = await walletCall(() => provider.signMessage!(message, encoding));
            const signature = result instanceof Uint8Array ? result : result?.signature;
            if (!(signature instanceof Uint8Array) || signature.length !== 64) throw new WalletLoginError("Your Solana wallet returned an unsupported signature. Update the wallet and try again.");
            await unchangedAccount();
            return signature;
          },
        };
      }
    }
    const { data, error } = await client.auth.signInWithWeb3(chain === "solana" ? {
      chain: "solana", wallet: solana, statement,
      options: { url, signInWithSolana: { chainId: "devnet", expirationTime: expirationTime.toISOString() } },
    } : {
      chain: "ethereum",
      statement,
      options: { url, signInWithEthereum: { expirationTime } },
      wallet: {
        get address() { return selected; },
        on: (event, listener) => (wallet as WalletProvider).on?.(event, listener as (...args: unknown[]) => void),
        removeListener: (event, listener) => (wallet as WalletProvider).removeListener?.(event, listener as (...args: unknown[]) => void),
        request: async input => {
          walletStep = input.method === "eth_chainId" ? "network" : input.method === "personal_sign" ? "signature" : "connection";
          const provider = wallet as WalletProvider;
          let result = await walletCall(() => provider.request({ method: input.method, params: Array.isArray(input.params) ? input.params : undefined }));
          if (input.method === "eth_chainId" && Number(result) !== 10143) {
            const chainId = "0x279f";
            try { await walletCall(() => provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] })); }
            catch (reason) {
              if (!(reason && typeof reason === "object" && "code" in reason && reason.code === 4902)) throw reason;
              await walletCall(() => provider.request({ method: "wallet_addEthereumChain", params: [{ chainId, chainName: "Monad Testnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: ["https://testnet-rpc.monad.xyz"], blockExplorerUrls: ["https://testnet.monadscan.com"] }] }));
              await walletCall(() => provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] }));
            }
            result = await walletCall(() => provider.request({ method: "eth_chainId" }));
            if (Number(result) !== 10143) throw new WalletLoginError("Choose Monad testnet in your wallet, then try signing in again.");
          }
          if (input.method === "eth_requestAccounts" && Array.isArray(result) && typeof result[0] === "string") selected = getAddress(result[0]);
          if (input.method === "personal_sign") await unchangedAccount();
          return result;
        },
      },
    });
    if (error?.code === "web3_provider_disabled") throw new WalletLoginError(`${chain === "solana" ? "Solana" : "Ethereum"} wallet sign-in is awaiting room setup. You can still join as a guest.`);
    if (error && /domain|uri|redirect|origin/i.test(error.message)) throw new WalletLoginError("Wallet sign-in needs this live URL allowed in Supabase Authentication → URL Configuration. Ask the room host to add this app's origin.");
    if (error?.status === 429) throw new WalletLoginError("Too many sign-in attempts. Wait a few minutes, then try again.");
    if (error || !data.user || !data.session) throw new WalletLoginError("Wallet sign-in could not be verified. Check your connection and try again.");
    return data.user;
  } catch (reason) {
    if (reason instanceof WalletLoginError) throw reason;
    throw new WalletLoginError(providerError(walletFailure ?? reason) || (walletStep === "network"
      ? "Your wallet could not select Monad testnet. Choose Monad testnet in the wallet, or use MetaMask, then try again. Your current account is preserved."
      : "Your wallet could not complete sign-in. Unlock it, check for an open connection or signature request, and try again. Your current account is preserved."));
  }
}
