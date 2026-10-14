"use client";

import { Component, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  PrivyProvider,
  useCreateWallet,
  usePrivy,
  useSigners,
  useSubscribeToJwtAuthWithFlag,
  useWallets,
  type LinkedAccountWithMetadata,
  type PrivyClientConfig,
} from "@privy-io/react-auth";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "../../lib/supabase/database.types.ts";
import type { WalletProvider } from "../../lib/onchain/client.ts";
import { pilotBrowserClient } from "../../lib/supabase/pilot-client.ts";
import {
  checkGoogleLink,
  createEmbeddedWalletIfCurrent,
  embeddedAddressForMaker,
  GOOGLE_LINK_KEY,
  googleCallbackError,
  isSavedAccount,
  signOutPilotAccount,
  walletAuthToken,
} from "../../lib/supabase/onboarding.ts";
import { accountWalletMode, startWalletLogin, type WalletChoice } from "../../lib/supabase/wallet-login.ts";
import { discoverBrowserWallets, type BrowserSignInWallet } from "../../lib/wallets/browser-wallets.ts";
import { PilotAccountContext, type EmbeddedWalletState, type PilotAccount } from "../pilot-account.tsx";
import { nightWatchReturnUrl, sameAddress } from "./api.ts";

/**
 * The Night Watch page's account: the same PilotAccount the pilot builds (Supabase session, Google
 * sign-in, Privy embedded wallet through the custom-JWT bridge), except that PrivyProvider wraps the
 * page, so the desk can add or remove the Night Watch signer and TestnetRelease gets the wallet.
 */

type Client = SupabaseClient<Database>;

export type NightWatchPrivy = {
  /** PrivyProvider is mounted with this server's app ID. */
  configured: boolean;
  /** Signed in to Privy as this maker, with an embedded EVM wallet found. */
  ready: boolean;
  address: string;
  /** Privy's server wallet ID for the embedded wallet (needed to add a signer). */
  walletId: string | null;
  /** The wallet already has additional signers. */
  delegated: boolean;
  /** The wallet runs in Privy's TEE execution mode, which session signers require. */
  tee: boolean;
  error: string;
  addSigner: (signerId: string, policyIds: string[]) => Promise<void>;
  /** Privy removes every additional signer on the wallet, not only the Night Watch one. */
  removeAllSigners: () => Promise<void>;
};

const unavailablePrivy = (error: string): NightWatchPrivy => ({
  configured: false,
  ready: false,
  address: "",
  walletId: null,
  delegated: false,
  tee: false,
  error,
  addSigner: async () => {
    throw new Error(error);
  },
  removeAllSigners: async () => {
    throw new Error(error);
  },
});

const MISSING_APP_ID = "This server has no Privy app ID (NEXT_PUBLIC_PRIVY_APP_ID), so a Night Watch signer cannot be added. The world stays readable.";

export const NightWatchPrivyContext = createContext<NightWatchPrivy>(unavailablePrivy(MISSING_APP_ID));
export const useNightWatchPrivy = () => useContext(NightWatchPrivyContext);

// Network and display follow src/components/pilot-privy.tsx so both pages open the same wallet.
const monadTestnet = {
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Test MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [process.env.NEXT_PUBLIC_MONAD_RPC_URL || "https://testnet-rpc.monad.xyz"] } },
  blockExplorers: { default: { name: "MonadScan", url: "https://testnet.monadscan.com" } },
} as const;

const PRIVY_CONFIG: PrivyClientConfig = {
  defaultChain: monadTestnet,
  supportedChains: [monadTestnet],
  appearance: { theme: "dark", accentColor: "#6941f6" },
  embeddedWallets: { ethereum: { createOnLogin: "off" }, showWalletUIs: true, priceDisplay: { primary: "native-token", secondary: null } },
};

const emptyWallet: EmbeddedWalletState = { owner: "", address: "", loading: false, error: "" };

/**
 * Google sign-in with the same guards as startGoogleLogin, returning to /night-watch instead of
 * /pilot. A guest with a byline links Google rather than silently switching accounts.
 */
export async function nightWatchGoogleLogin(client: Client, currentUrl: string, storage: Storage, mode: "link" | "return") {
  const session = await client.auth.getSession();
  if (session.error) throw new Error("Your session could not be restored. Refresh before signing in.");
  const verified = session.data.session ? await client.auth.getUser() : undefined;
  if (verified?.error || (verified && !verified.data.user)) throw new Error("Your storyteller identity could not be verified. Refresh before signing in.");
  const user = verified?.data.user;
  const options = { redirectTo: nightWatchReturnUrl(currentUrl) };
  if (mode === "link") {
    if (!user) throw new Error("Choose your storyteller name in the pilot before linking Google.");
    if (isSavedAccount(user)) return;
    storage.setItem(GOOGLE_LINK_KEY, user.id);
    const result = await client.auth.linkIdentity({ provider: "google", options });
    if (result.error) {
      storage.removeItem(GOOGLE_LINK_KEY);
      throw new Error("Google could not be linked to this storyteller. Your guest work is preserved.");
    }
    return;
  }
  if (user?.is_anonymous) {
    const profile = await client.from("pilot_profiles").select("id").eq("id", user.id).maybeSingle();
    if (profile.error) throw new Error("Your guest work could not be checked. Refresh before switching accounts.");
    if (profile.data) throw new Error("This browser holds a guest byline. Save it with Google from the pilot first, or use a separate browser profile for your Google account.");
  }
  storage.removeItem(GOOGLE_LINK_KEY);
  const result = await client.auth.signInWithOAuth({ provider: "google", options });
  if (result.error) throw new Error("Google sign-in could not start. Try again.");
}

/** Drops the OAuth callback's code or error from the address bar once the session is settled. */
function clearCallbackParams() {
  const url = new URL(window.location.href);
  const keys = ["code", "error", "error_code", "error_description"];
  if (!keys.some((key) => url.searchParams.has(key)) && !/(?:^|[#&])(?:error|access_token)=/.test(url.hash)) return;
  for (const key of keys) url.searchParams.delete(key);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
}

class PrivyBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error("[night-watch] Privy could not load", error);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function NightWatchAccountProvider({ children }: { children: ReactNode }) {
  const enabled = !!process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const [client, setClient] = useState<Client>();
  const [user, setUser] = useState<User>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [authenticatingWallet, setAuthenticatingWallet] = useState(false);
  const walletLoginActive = useRef(false);
  const [wallet, setWallet] = useState(emptyWallet);
  const [walletChoice, setWalletChoice] = useState<WalletChoice>();
  const [browserWallets, setBrowserWallets] = useState<BrowserSignInWallet[]>([]);
  const [externalWallet, setExternalWallet] = useState<{ owner: string; provider: WalletProvider }>();
  const version = useRef(0);
  const currentUser = useRef(user);
  currentUser.current = user;
  const updateWallet = useCallback((next: EmbeddedWalletState) => {
    if (isSavedAccount(currentUser.current) && next.owner === currentUser.current!.id) setWallet(next);
  }, []);
  const subject = user?.id ?? "";
  useEffect(() => discoverBrowserWallets(window, setBrowserWallets), []);
  useEffect(() => {
    const connected = pilotBrowserClient();
    if (!connected) {
      setLoading(false);
      return;
    }
    setClient(connected);
    let active = true;
    async function verify() {
      const attempt = ++version.current;
      const saved = await connected!.auth.getSession();
      if (!active || attempt !== version.current) return;
      const verified = saved.data.session ? await connected!.auth.getUser(saved.data.session.access_token) : undefined;
      if (!active || attempt !== version.current) return;
      try {
        if (saved.error || verified?.error) throw new Error("Your storyteller account could not be verified. Refresh to reconnect.");
        const next = verified?.data.user ?? undefined;
        if (next) checkGoogleLink(next, window.sessionStorage);
        setUser(next);
        setError(googleCallbackError(window.location.href));
      } catch (reason) {
        setUser(undefined);
        setError(reason instanceof Error ? reason.message : "Your account could not be restored. Refresh to reconnect.");
      } finally {
        setLoading(false);
        clearCallbackParams();
      }
    }
    void verify();
    // Keep Supabase calls outside its auth callback so its lock is never taken recursively.
    const listener = connected.auth.onAuthStateChange((_event, session) => {
      setUser((previous) => (previous?.id === session?.user.id ? previous : undefined));
      setLoading(true);
      queueMicrotask(() => {
        if (active) void verify();
      });
    });
    return () => {
      active = false;
      version.current++;
      listener.data.subscription.unsubscribe();
    };
  }, []);
  // The Night Watch pays from the in-app wallet, so any saved account gets one, wallet sign-ins included.
  const walletMode = accountWalletMode(user, enabled, walletChoice);
  const chooseWallet = useCallback((mode: "embedded" | "external") => setWalletChoice({ owner: subject, mode }), [subject]);
  useEffect(() => {
    setWallet(emptyWallet);
  }, [subject, user?.is_anonymous]);
  const signIn = useCallback(async (mode: "link" | "return") => {
    if (!client) throw new Error("Google sign-in is awaiting setup on this server.");
    if (error) setError("");
    await nightWatchGoogleLogin(client, window.location.href, window.sessionStorage, mode);
  }, [client, error]);
  const currentWallet = wallet.owner === subject && isSavedAccount(user) ? wallet : emptyWallet;
  const signInWallet = useCallback(async (choice: BrowserSignInWallet) => {
    if (!client) throw new Error("Account sign-in is awaiting setup on this server.");
    if (walletLoginActive.current) throw new Error("A wallet sign-in is already in progress. Finish its wallet prompts before trying again.");
    walletLoginActive.current = true;
    setAuthenticatingWallet(true);
    setError("");
    try {
      const signedIn = choice.chain === "solana"
        ? await startWalletLogin(client, choice.provider, window.location.href, "solana")
        : await startWalletLogin(client, choice.provider, window.location.href);
      if (choice.chain === "ethereum") setExternalWallet({ owner: signedIn.id, provider: choice.provider });
      else setExternalWallet(undefined);
    } finally {
      walletLoginActive.current = false;
      setAuthenticatingWallet(false);
    }
  }, [client]);
  const signOut = useCallback(async () => {
    if (!client) return;
    await signOutPilotAccount(client, window.sessionStorage);
    version.current++;
    setUser(undefined);
    setWallet(emptyWallet);
    setWalletChoice(undefined);
    setExternalWallet(undefined);
    setError("");
    setLoading(false);
  }, [client]);
  const ethereumWallets = browserWallets.filter((item) => item.chain === "ethereum");
  const externalProvider = externalWallet?.owner === subject ? externalWallet.provider : ethereumWallets.length === 1 ? ethereumWallets[0].provider : undefined;
  const selectBrowserWallet = useCallback((choice: Extract<BrowserSignInWallet, { chain: "ethereum" }>) => {
    setExternalWallet({ owner: subject, provider: choice.provider });
    setWalletChoice({ owner: subject, mode: "external" });
  }, [subject]);
  const account: PilotAccount = {
    client,
    user,
    loading: loading || authenticatingWallet,
    error,
    enabled,
    signIn,
    signInWallet,
    authenticatingWallet,
    signOut,
    wallet: currentWallet,
    walletMode,
    chooseWallet,
    browserWallets,
    externalProvider,
    selectBrowserWallet,
  };
  const fallback = (message: string) => <NightWatchPrivyContext.Provider value={unavailablePrivy(message)}>{children}</NightWatchPrivyContext.Provider>;
  return <PilotAccountContext.Provider value={account}>
    {enabled
      ? <PrivyBoundary fallback={fallback("Privy could not load in this browser. Refresh to try again; the world stays readable.")}>
        <PrivyProvider appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!} clientId={process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID || undefined} config={PRIVY_CONFIG}>
          <PrivyBridge client={client} user={user} loading={loading} allowCreate={isSavedAccount(user)} onWallet={updateWallet}>{children}</PrivyBridge>
        </PrivyProvider>
      </PrivyBoundary>
      : fallback(MISSING_APP_ID)}
  </PilotAccountContext.Provider>;
}

type EmbeddedLinkedWallet = Extract<LinkedAccountWithMetadata, { type: "wallet" }>;

function embeddedLinkedWallet(accounts: LinkedAccountWithMetadata[], address: string): EmbeddedLinkedWallet | undefined {
  return accounts.find((account): account is EmbeddedLinkedWallet =>
    account.type === "wallet" && account.walletClientType === "privy" && account.chainType === "ethereum" && sameAddress(account.address, address));
}

type BridgeProps = {
  client?: Client;
  user?: User;
  loading: boolean;
  allowCreate: boolean;
  onWallet: (wallet: EmbeddedWalletState) => void;
  children: ReactNode;
};

/** The pilot's wallet bridge (custom-JWT sign-in, explicit wallet creation), plus signer controls. */
function PrivyBridge({ client, user, loading, allowCreate, onWallet, children }: BridgeProps) {
  const { ready, authenticated, user: privyUser } = usePrivy();
  const { ready: walletsReady, wallets } = useWallets();
  const { createWallet } = useCreateWallet();
  const { addSigners, removeSigners } = useSigners();
  const creation = useRef(createWallet);
  creation.current = createWallet;
  const [completedCreation, setCompletedCreation] = useState(0);
  const [bridgeError, setBridgeError] = useState("");
  const owner = client && isSavedAccount(user) ? user!.id : "";
  const current = useRef(owner);
  current.current = owner;
  const attempted = useRef("");
  const creating = useRef(false);
  useEffect(() => {
    setBridgeError("");
  }, [owner]);
  const failure = useCallback((error: Error) => {
    if (!current.current) return;
    setBridgeError(error.message);
    onWallet({ owner: current.current, address: "", loading: false, error: error.message, prepare: () => window.location.reload() });
  }, [onWallet]);
  const getExternalJwt = useCallback(async () => {
    if (!owner || !client) return undefined;
    try {
      return await walletAuthToken(client, owner);
    } catch (reason) {
      if (current.current === owner) failure(reason instanceof Error ? reason : new Error("Wallet sign-in could not be checked. Refresh to try again."));
      return undefined;
    }
  }, [client, owner, failure]);
  const { state } = useSubscribeToJwtAuthWithFlag({
    isLoading: loading,
    isAuthenticated: !!owner,
    getExternalJwt,
    onError: () => failure(new Error("Your Google account is saved. Wallet sign-in could not finish; check the Privy JWT integration, then refresh.")),
  });
  const accounts = privyUser?.linkedAccounts ?? [];
  const subjectMatches = !!owner && accounts.some((account) => account.type === "custom_auth" && account.customUserId === owner);
  const address = embeddedAddressForMaker(owner, accounts) ?? "";
  const linked = address ? embeddedLinkedWallet(accounts, address) : undefined;
  const embedded = address ? wallets.find((item) => item.walletClientType === "privy" && sameAddress(item.address, address)) : undefined;
  useEffect(() => {
    if (!owner || !ready || loading) return;
    if (state.status === "not-enabled") failure(new Error("Your Google account is saved. The operator needs to enable Privy's JWT integration before your in-app wallet can open."));
    else if (state.status === "done" && authenticated && !subjectMatches) failure(new Error("The wallet belongs to a different storyteller account. Refresh to reconnect your own account."));
  }, [owner, ready, loading, state.status, authenticated, subjectMatches, failure]);
  useEffect(() => {
    if (!owner || !ready || !authenticated || !walletsReady || !subjectMatches) return;
    let active = true;
    if (embedded) {
      onWallet({ owner, address: embedded.address, loading: true, error: "" });
      void embedded.getEthereumProvider().then(async (provider) => {
        const accountsList = await provider.request({ method: "eth_accounts" });
        if (!Array.isArray(accountsList) || !accountsList.some((account) => typeof account === "string" && sameAddress(account, embedded.address))) {
          throw new Error("Wallet address differs from the saved account.");
        }
        if (active && current.current === owner) {
          setBridgeError("");
          onWallet({ owner, address: embedded.address, provider, loading: false, error: "" });
        }
      }).catch(() => {
        if (active && current.current === owner) failure(new Error("Your wallet could not be opened. Refresh to reconnect."));
      });
    } else if (!address && allowCreate && !creating.current && attempted.current !== owner) {
      attempted.current = owner;
      creating.current = true;
      onWallet({ owner, address: "", loading: true, error: "" });
      void createEmbeddedWalletIfCurrent(getExternalJwt, () => creation.current(), () => active && current.current === owner).catch(() => {
        if (active && current.current === owner) failure(new Error("Your account is saved, but its wallet could not be created. Refresh to try again."));
      }).finally(() => {
        creating.current = false;
        if (active && current.current === owner) setCompletedCreation((value) => value + 1);
      });
    }
    return () => {
      active = false;
    };
    // Keyed on the address, as in the pilot bridge: Privy hands out new wallet objects on re-render.
  }, [owner, ready, authenticated, walletsReady, subjectMatches, embedded?.address, address, allowCreate, completedCreation, getExternalJwt, onWallet, failure]);
  const addSigner = useCallback(async (signerId: string, policyIds: string[]) => {
    if (!address) throw new Error("Your in-app wallet is not ready yet.");
    await addSigners({ address, signers: [{ signerId, policyIds }] });
  }, [addSigners, address]);
  const removeAllSigners = useCallback(async () => {
    if (!address) throw new Error("Your in-app wallet is not ready yet.");
    await removeSigners({ address });
  }, [removeSigners, address]);
  const value = useMemo<NightWatchPrivy>(() => ({
    configured: true,
    ready: ready && authenticated && subjectMatches && !!address,
    address,
    walletId: linked?.id ?? null,
    delegated: !!linked?.delegated,
    tee: String(linked?.recoveryMethod ?? "") === "privy-v2",
    error: bridgeError,
    addSigner,
    removeAllSigners,
  }), [ready, authenticated, subjectMatches, address, linked?.id, linked?.delegated, linked?.recoveryMethod, bridgeError, addSigner, removeAllSigners]);
  return <NightWatchPrivyContext.Provider value={value}>{children}</NightWatchPrivyContext.Provider>;
}
