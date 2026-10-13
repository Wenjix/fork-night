"use client";

import { useState } from "react";
import { UserRound, Check, Copy, Wallet } from "lucide-react";
import type { Tables } from "../lib/supabase/database.types.ts";
import { isSavedAccount } from "../lib/supabase/onboarding.ts";
import { usePilotAccount } from "./pilot-account.tsx";
import { GoogleButton, PrivyMark, WalletProviderNote } from "./auth-branding.tsx";
import { useEmbeddedWalletByDefault, walletAccountAddress } from "../lib/supabase/wallet-login.ts";
import { shortAddress } from "../lib/onchain/journey.ts";
import { WalletSignInButton } from "./pilot-wallet-signin.tsx";
import { PilotDialog } from "./pilot-dialog.tsx";

export function GuestSignOutDialog({ name, busy, disabled, error, blockedReason, onClose, onConfirm }: {
  name: string; busy: boolean; disabled: boolean; error: string; blockedReason: string; onClose: () => void; onConfirm: () => void;
}) {
  return <PilotDialog title="Sign out of this guest account?" className="pilot-signout-dialog" dismissible={!busy} onClose={onClose} returnFocus={() => document.querySelector<HTMLElement>(".pilot-wallet-signin button")}>
    <p>Your published moments stay credited to <strong>{name}</strong>.</p>
    <p>This guest has no saved login. After signing out, you cannot return to its private previews or publish as this byline. Save your byline with Google first if you want to return.</p>
    {disabled && blockedReason && <p role="status">{blockedReason}</p>}
    {error && <p role="alert">{error}</p>}
    <footer><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Keep this guest</button><button type="button" className="button danger" disabled={disabled || busy} onClick={onConfirm}>{busy ? "Signing out…" : "Sign out and switch accounts"}</button></footer>
  </PilotDialog>;
}

export function PilotIdentity({ profile, disabled, onJoin, signOutBlockedReason = "" }: { profile?: Tables<"pilot_profiles">; disabled: boolean; onJoin: () => void; signOutBlockedReason?: string }) {
  const account = usePilotAccount();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [confirmGuestSignOut, setConfirmGuestSignOut] = useState(false);
  const saved = isSavedAccount(account?.user);
  const walletAddress = walletAccountAddress(account?.user);
  const googleAccount = useEmbeddedWalletByDefault(account?.user);
  async function save() {
    if (!account || working) return;
    setWorking(true); setError("");
    try { await account.signIn("link"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Google sign-in could not start. Try again."); }
    finally { setWorking(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(account!.wallet.address); setCopied(true); }
    catch { setError("The address could not be copied. Select and copy it below."); }
  }
  async function signOut() {
    if (!account || working || disabled) return;
    setWorking(true); setError("");
    try {
      await account.signOut();
      setConfirmGuestSignOut(false);
      requestAnimationFrame(() => document.querySelector<HTMLElement>(".pilot-wallet-signin button")?.focus());
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Sign-out could not finish. Try again."); }
    finally { setWorking(false); }
  }
  return profile || saved ? <><details className="pilot-guest-identity">
    <summary>{walletAddress ? <Wallet size={17} aria-hidden="true" /> : <UserRound size={17} aria-hidden="true" />}<span>{profile ? <>Making as <strong>{profile.display_name}</strong></> : walletAddress ? <>Wallet account <strong>{shortAddress(walletAddress)}</strong></> : googleAccount ? "Signed in with Google" : "Signed in"}</span></summary>
    <div className="pilot-guest-context">
      <strong>Your storyteller identity</strong>
      {saved ? <p><Check size={15} aria-hidden="true" /> {walletAddress ? "Signed in with your wallet." : googleAccount ? "Your storyteller account is saved with Google." : "Your storyteller account is saved."} Return with the same sign-in to find your published work and saved previews. Unsent ideas stay in this browser.</p> : <p>{profile!.display_name} is the guest in this browser. Your drafts and byline belong to this session.</p>}
      {!profile && <><p>Choose your public storyteller name when you start making. You can read or use the release controls now.</p><button type="button" className="button secondary" disabled={disabled} onClick={onJoin}>Choose my storyteller name</button></>}
      <p>Connecting another wallet changes your testnet role. It keeps this storyteller name.</p>
      {account?.enabled && !saved && <><GoogleButton type="button" disabled={disabled || working} onClick={() => void save()}>{working ? "Opening Google…" : "Save my byline with Google"}</GoogleButton><small>Keep this storyteller identity. An in-app wallet is prepared after sign-in.</small><WalletProviderNote /></>}
      {walletAddress && <div className="pilot-account-wallet"><strong>Your sign-in wallet</strong><code>{walletAddress}</code><small>Choose its account in your browser wallet. Connect it in the release panel for Monad testnet actions.</small></div>}
      {saved && (account?.walletMode === "embedded" || googleAccount && !!account?.wallet.address) && <div className="pilot-account-wallet" aria-live="polite">
        {account?.wallet.address ? <><div className="pilot-account-wallet-heading"><strong>Your in-app wallet</strong><PrivyMark /></div><div><code>{account.wallet.address}</code><button type="button" className="text-button" aria-label="Copy in-app wallet address" onClick={() => void copy()}><Copy size={15} aria-hidden="true" />{copied ? "Copied" : "Copy"}</button></div><small>Monad testnet. Add test MON before registering or claiming.</small></> : <p>{account?.wallet.error || "Preparing your in-app wallet…"}</p>}
        {account?.wallet.error && <button type="button" className="text-button" disabled={disabled} onClick={account.wallet.prepare}>Check wallet again</button>}
      </div>}
      {error && <p role="alert">{error}</p>}
      {account?.user && <button type="button" className="text-button pilot-signout-button" disabled={disabled || working} onClick={() => { setError(""); if (saved) void signOut(); else setConfirmGuestSignOut(true); }}>{working ? "Signing out…" : "Sign out of this browser"}</button>}
      {disabled && signOutBlockedReason && <small>{signOutBlockedReason}</small>}
    </div>
  </details>{confirmGuestSignOut && !saved && <GuestSignOutDialog name={profile!.display_name} busy={working} disabled={disabled} error={error} blockedReason={signOutBlockedReason} onClose={() => { if (!working) setConfirmGuestSignOut(false); }} onConfirm={() => void signOut()} />}</> : <div className="pilot-account-entry"><WalletSignInButton disabled={disabled} /><button className="button secondary pilot-join" type="button" disabled={disabled} onClick={onJoin}><UserRound size={17} aria-hidden="true" />Join this room</button></div>;
}
