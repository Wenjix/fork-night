"use client";

import { Component, createContext, lazy, Suspense, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { isAuthRetryableFetchError, type SupabaseClient, type User } from "@supabase/supabase-js";
import type { Database } from "../lib/supabase/database.types.ts";
import type { WalletProvider } from "../lib/onchain/client.ts";
import { pilotBrowserClient } from "../lib/supabase/pilot-client.ts";
import { checkGoogleLink, googleCallbackError, isSavedAccount, signOutPilotAccount, startGoogleLogin, withoutGoogleCallbackError } from "../lib/supabase/onboarding.ts";
import { accountWalletMode, startWalletLogin, type WalletChoice } from "../lib/supabase/wallet-login.ts";
import { discoverBrowserWallets, type BrowserSignInWallet } from "../lib/wallets/browser-wallets.ts";
import { clearVisitorIdeas, moveVisitorIdeas } from "../lib/pilot-rooms.ts";

export type EmbeddedWalletState = { owner: string; address: string; provider?: WalletProvider; loading: boolean; error: string; prepare?: () => void };
const emptyWallet: EmbeddedWalletState = { owner: "", address: "", loading: false, error: "" };
export type PilotAccount = {
  client?: SupabaseClient<Database>; user?: User; loading: boolean; error: string; enabled: boolean;
  /** A Google return that did not finish. It is shown until dismissed and never blocks the room. */
  notice?: string; dismissNotice?: () => void;
  signIn: (mode: "link" | "return") => Promise<void>;
  signInWallet: (wallet: BrowserSignInWallet) => Promise<void>; authenticatingWallet: boolean;
  browserWallets?: BrowserSignInWallet[]; externalProvider?: WalletProvider;
  selectBrowserWallet?: (wallet: Extract<BrowserSignInWallet, { chain: "ethereum" }>) => void;
  signOut: () => Promise<void>;
  wallet: EmbeddedWalletState; walletMode: "embedded" | "external";
  chooseWallet: (mode: "embedded" | "external") => void;
};
export const PilotAccountContext = createContext<PilotAccount | undefined>(undefined);
const PrivyBridge = lazy(() => import("./pilot-privy.tsx"));
export const usePilotAccount = () => useContext(PilotAccountContext);
export const browserWallet = () => typeof window === "undefined" ? undefined : (window as unknown as { ethereum?: WalletProvider }).ethereum;
const ignoreWallet = () => {};
const privySessionStored = () => {
  try { return !!(localStorage.getItem("privy:token") || localStorage.getItem("privy:refresh_token")); }
  catch { return false; }
};

class WalletBoundary extends Component<{ children: ReactNode; owner: string; onWallet: (wallet: EmbeddedWalletState) => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() {
    this.props.onWallet({ owner: this.props.owner, address: "", loading: false, error: "Your in-app wallet could not load. Refresh to try again, or use a browser wallet for testnet actions.", prepare: () => window.location.reload() });
  }
  render() { return this.state.failed ? null : this.props.children; }
}

export function PilotAccountProvider({ children }: { children: ReactNode }) {
  const enabled = !!process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const [client, setClient] = useState<SupabaseClient<Database>>();
  const [user, setUser] = useState<User>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [authenticatingWallet, setAuthenticatingWallet] = useState(false);
  const walletLoginActive = useRef(false);
  const [wallet, setWallet] = useState(emptyWallet);
  const [walletChoice, setWalletChoice] = useState<WalletChoice>();
  const [browserWallets, setBrowserWallets] = useState<BrowserSignInWallet[]>([]);
  const [externalWallet, setExternalWallet] = useState<{ owner: string; provider: WalletProvider }>();
  const privySignOut = useRef<(() => Promise<void>) | undefined>(undefined);
  const [bridgeRestarts, setBridgeRestarts] = useState(0);
  const [retiring, setRetiring] = useState(false);
  // True once this page has settled signed out, so a later account arrived in-page.
  const settledAsVisitor = useRef(false);
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
    if (!connected) { setLoading(false); return; }
    setClient(connected);
    let active = true;
    async function verify() {
      const attempt = ++version.current;
      const saved = await connected!.auth.getSession();
      if (!active || attempt !== version.current) return;
      const verified = saved.data.session ? await connected!.auth.getUser(saved.data.session.access_token) : undefined;
      if (!active || attempt !== version.current) return;
      // Report a cancelled or refused Google return once, then drop it from the address.
      const callback = googleCallbackError(window.location.href);
      if (callback) {
        setNotice(callback);
        window.history.replaceState(window.history.state, "", withoutGoogleCallbackError(window.location.href));
      }
      try {
        const failure = saved.error ?? verified?.error;
        // A dropped connection while re-checking keeps the verified storyteller signed in.
        const current = currentUser.current;
        if (current && isAuthRetryableFetchError(failure) && (saved.data.session?.user.id ?? current.id) === current.id) return;
        if (failure) throw new Error("Your storyteller account could not be verified. Refresh to reconnect.");
        const next = verified?.data.user ?? undefined;
        if (next) checkGoogleLink(next, window.sessionStorage);
        // A visitor who joins or signs in without leaving this page keeps its unsent ideas:
        // a guest join or a wallet sign-in, including a guest who then links Google. A Google
        // "return" sign-in leaves the page, so, like any account that arrives with a page load,
        // it adopts none.
        if (next && settledAsVisitor.current) {
          try { moveVisitorIdeas(window.localStorage, next.id); }
          catch { /* The ideas stay under the visitor key. */ }
        }
        settledAsVisitor.current = !next;
        setUser(next);
        setError("");
      } catch (reason) {
        setUser(undefined);
        setError(reason instanceof Error ? reason.message : "Your account could not be restored. Refresh to reconnect.");
      } finally { setLoading(false); }
    }
    void verify();
    // Keep Supabase calls outside its auth callback to avoid taking its lock
    // recursively while the callback is delivering a sign-in event.
    const listener = connected.auth.onAuthStateChange((_event, session) => {
      // The same account (a token refresh, or auth-js re-checking a returning tab)
      // is re-verified quietly, so the in-app wallet's bridge stays mounted.
      if (session?.user.id !== currentUser.current?.id) {
        setUser(previous => previous?.id === session?.user.id ? previous : undefined);
        setLoading(true);
      }
      queueMicrotask(() => { if (active) void verify(); });
    });
    return () => { active = false; version.current++; listener.data.subscription.unsubscribe(); };
  }, []);
  const walletMode = accountWalletMode(user, enabled, walletChoice);
  const chooseWallet = (mode: "embedded" | "external") => setWalletChoice({ owner: subject, mode });
  useEffect(() => { setWallet(emptyWallet); }, [subject, user?.is_anonymous]);
  const signIn = useCallback(async (mode: "link" | "return") => {
    if (!client || !enabled) throw new Error("Google sign-in is awaiting setup. You can still join as a guest.");
    if (error) setError("");
    setNotice("");
    await startGoogleLogin(client, window.location.href, window.sessionStorage, mode);
  }, [client, enabled, error]);
  const currentWallet = wallet.owner === subject && isSavedAccount(user) ? wallet : emptyWallet;
  const signInWallet = useCallback(async (choice: BrowserSignInWallet) => {
    if (!client) throw new Error("Account sign-in is awaiting room setup. You can keep reading.");
    if (walletLoginActive.current) throw new Error("A wallet sign-in is already in progress. Finish its wallet prompts before trying again.");
    walletLoginActive.current = true; setAuthenticatingWallet(true); setError("");
    try {
      const signedIn = choice.chain === "solana"
        ? await startWalletLogin(client, choice.provider, window.location.href, "solana")
        : await startWalletLogin(client, choice.provider, window.location.href);
      if (choice.chain === "ethereum") setExternalWallet({ owner: signedIn.id, provider: choice.provider });
      else setExternalWallet(undefined);
    }
    finally { walletLoginActive.current = false; setAuthenticatingWallet(false); }
  }, [client]);
  async function signOut() {
    if (!client) return;
    let endPrivy = privySignOut.current;
    // Switching to a browser wallet unmounts the bridge but can leave its Privy session
    // stored. Mount the bridge just to end that session, waiting up to 3 seconds for it.
    if (!endPrivy && enabled && isSavedAccount(user) && privySessionStored()) {
      setRetiring(true);
      const until = Date.now() + 3000;
      while (!privySignOut.current && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 50));
      endPrivy = privySignOut.current;
    }
    try {
      // End the in-app wallet's Privy session while its bridge is still mounted. If
      // Privy is unreachable, its logout finishes in the background after 3 seconds;
      // if it fails, signing out of this browser still goes ahead.
      await Promise.race([endPrivy?.().catch(() => undefined), new Promise(resolve => setTimeout(resolve, 3000))]);
      await signOutPilotAccount(client, window.sessionStorage);
    } catch (reason) {
      // Only the Supabase sign-out can fail here. The account is still signed in,
      // so a fresh bridge reconnects its wallet.
      if (endPrivy) setBridgeRestarts(value => value + 1);
      throw reason;
    } finally { setRetiring(false); }
    version.current++;
    settledAsVisitor.current = true;
    try { clearVisitorIdeas(window.localStorage); }
    catch { /* Sign-out succeeds even if idea storage is unavailable. */ }
    setUser(undefined); setWallet(emptyWallet); setWalletChoice(undefined); setExternalWallet(undefined); setError(""); setNotice(""); setLoading(false);
  }
  const ethereumWallets = browserWallets.filter(wallet => wallet.chain === "ethereum");
  const externalProvider = externalWallet?.owner === subject ? externalWallet.provider : ethereumWallets.length === 1 ? ethereumWallets[0].provider : undefined;
  function selectBrowserWallet(choice: Extract<BrowserSignInWallet, { chain: "ethereum" }>) {
    setExternalWallet({ owner: subject, provider: choice.provider });
    chooseWallet("external");
  }
  const provisionEmbedded = !loading && !authenticatingWallet && isSavedAccount(user) && walletMode === "embedded";
  return <PilotAccountContext.Provider value={{ client, user, loading: loading || authenticatingWallet, error, notice, dismissNotice: () => setNotice(""), enabled, signIn, signInWallet, authenticatingWallet, signOut, wallet: currentWallet, walletMode, chooseWallet, browserWallets, externalProvider, selectBrowserWallet }}>
    {children}
    {enabled && client && (provisionEmbedded || retiring) && <WalletBoundary key={`${subject}:${bridgeRestarts}`} owner={subject} onWallet={provisionEmbedded ? updateWallet : ignoreWallet}><Suspense fallback={null}><PrivyBridge client={client} user={user} loading={loading} onWallet={provisionEmbedded ? updateWallet : ignoreWallet} signOut={privySignOut} logoutOnly={!provisionEmbedded} /></Suspense></WalletBoundary>}
  </PilotAccountContext.Provider>;
}
