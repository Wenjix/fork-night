"use client";

import { Component, createContext, lazy, Suspense, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "../lib/supabase/database.types.ts";
import type { WalletProvider } from "../lib/onchain/client.ts";
import { pilotBrowserClient } from "../lib/supabase/pilot-client.ts";
import { checkGoogleLink, googleCallbackError, isSavedAccount, signOutPilotAccount, startGoogleLogin } from "../lib/supabase/onboarding.ts";
import { accountWalletMode, startWalletLogin, type WalletChoice } from "../lib/supabase/wallet-login.ts";

export type EmbeddedWalletState = { owner: string; address: string; provider?: WalletProvider; loading: boolean; error: string; prepare?: () => void };
const emptyWallet: EmbeddedWalletState = { owner: "", address: "", loading: false, error: "" };
export type PilotAccount = {
  client?: SupabaseClient<Database>; user?: User; loading: boolean; error: string; enabled: boolean;
  signIn: (mode: "link" | "return") => Promise<void>;
  signInWallet: () => Promise<void>; authenticatingWallet: boolean;
  signOut: () => Promise<void>;
  wallet: EmbeddedWalletState; walletMode: "embedded" | "external";
  chooseWallet: (mode: "embedded" | "external") => void;
};
export const PilotAccountContext = createContext<PilotAccount | undefined>(undefined);
const PrivyBridge = lazy(() => import("./pilot-privy.tsx"));
export const usePilotAccount = () => useContext(PilotAccountContext);
export const browserWallet = () => typeof window === "undefined" ? undefined : (window as unknown as { ethereum?: WalletProvider }).ethereum;

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
  const [authenticatingWallet, setAuthenticatingWallet] = useState(false);
  const walletLoginActive = useRef(false);
  const [wallet, setWallet] = useState(emptyWallet);
  const [walletChoice, setWalletChoice] = useState<WalletChoice>();
  const version = useRef(0);
  const currentUser = useRef(user);
  currentUser.current = user;
  const updateWallet = useCallback((next: EmbeddedWalletState) => {
    if (isSavedAccount(currentUser.current) && next.owner === currentUser.current!.id) setWallet(next);
  }, []);
  const subject = user?.id ?? "";
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
      try {
        if (saved.error || verified?.error) throw new Error("Your storyteller account could not be verified. Refresh to reconnect.");
        const next = verified?.data.user ?? undefined;
        if (next) checkGoogleLink(next, window.sessionStorage);
        setUser(next);
        setError(googleCallbackError(window.location.href));
      } catch (reason) {
        setUser(undefined);
        setError(reason instanceof Error ? reason.message : "Your account could not be restored. Refresh to reconnect.");
      } finally { setLoading(false); }
    }
    void verify();
    // Keep Supabase calls outside its auth callback to avoid taking its lock
    // recursively while the callback is delivering a sign-in event.
    const listener = connected.auth.onAuthStateChange((_event, session) => {
      setUser(previous => previous?.id === session?.user.id ? previous : undefined);
      setLoading(true);
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
    await startGoogleLogin(client, window.location.href, window.sessionStorage, mode);
  }, [client, enabled, error]);
  const currentWallet = wallet.owner === subject && isSavedAccount(user) ? wallet : emptyWallet;
  const signInWallet = useCallback(async () => {
    if (!client) throw new Error("Account sign-in is awaiting room setup. You can keep reading.");
    if (walletLoginActive.current) return;
    walletLoginActive.current = true; setAuthenticatingWallet(true); setError("");
    try { await startWalletLogin(client, browserWallet(), window.location.href); }
    finally { walletLoginActive.current = false; setAuthenticatingWallet(false); }
  }, [client]);
  async function signOut() {
    if (!client) return;
    await signOutPilotAccount(client, window.sessionStorage);
    version.current++;
    setUser(undefined); setWallet(emptyWallet); setWalletChoice(undefined); setError(""); setLoading(false);
  }
  const provisionEmbedded = !loading && !authenticatingWallet && isSavedAccount(user) && walletMode === "embedded";
  return <PilotAccountContext.Provider value={{ client, user, loading: loading || authenticatingWallet, error, enabled, signIn, signInWallet, authenticatingWallet, signOut, wallet: currentWallet, walletMode, chooseWallet }}>
    {children}
    {enabled && client && provisionEmbedded && <WalletBoundary key={subject} owner={subject} onWallet={updateWallet}><Suspense fallback={null}><PrivyBridge client={client} user={user} loading={loading} onWallet={updateWallet} /></Suspense></WalletBoundary>}
  </PilotAccountContext.Provider>;
}
