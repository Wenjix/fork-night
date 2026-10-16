"use client";

import { useState, type SyntheticEvent } from "react";
import { UserRound, Check, Copy, Wallet } from "lucide-react";
import type { Tables } from "../lib/supabase/database.types.ts";
import { isSavedAccount } from "../lib/supabase/onboarding.ts";
import { usePilotAccount } from "./pilot-account.tsx";
import { GoogleButton, PrivyMark, WalletProviderNote } from "./auth-branding.tsx";
import { useEmbeddedWalletByDefault, walletAccountIdentity } from "../lib/supabase/wallet-login.ts";
import { shortAddress } from "../lib/onchain/journey.ts";
import { WalletSignInButton } from "./pilot-wallet-signin.tsx";
import { PilotDialog } from "./pilot-dialog.tsx";

/** Focus after sign-out: the account entry's wallet sign-in, or the page's main region while that is off (a room with no selected moment). */
const signOutFocusTarget = () =>
  document.querySelector<HTMLElement>(".pilot-account-entry .pilot-wallet-signin button:not(:disabled)")
  ?? document.querySelector<HTMLElement>("main[tabindex]");

export function GuestSignOutDialog({ name, busy, disabled, error, blockedReason, onClose, onConfirm }: {
  name?: string; busy: boolean; disabled: boolean; error: string; blockedReason: string; onClose: () => void; onConfirm: () => void;
}) {
  return <PilotDialog title="Sign out of this guest account?" className="pilot-signout-dialog" dismissible={!busy} onClose={onClose} returnFocus={signOutFocusTarget}>
    {name ? <>
      <p>Your published moments stay credited to <strong>{name}</strong>.</p>
      <p>This guest has no saved login. After signing out, you cannot return to its private previews or publish as this byline. Save your byline with Google first if you want to return.</p>
    </> : <p>This guest has no saved login. After signing out, you cannot return to it.</p>}
    {disabled && blockedReason && <p role="status">{blockedReason}</p>}
    {error && <p role="alert">{error}</p>}
    <footer><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Keep this guest</button><button type="button" className="button danger" disabled={disabled || busy} onClick={onConfirm}>{busy ? "Signing out…" : "Sign out and switch accounts"}</button></footer>
  </PilotDialog>;
}

/** Returning sign-in from the header; an in-app wallet is prepared after Google returns. */
function GoogleSignInButton({ disabled }: { disabled: boolean }) {
  const account = usePilotAccount();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  async function start() {
    if (!account || working) return;
    setWorking(true); setError("");
    // Success leaves the page for Google, so the button stays busy.
    try { await account.signIn("return"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Google sign-in could not start. Try again."); setWorking(false); }
  }
  return <div className="pilot-google-signin">
    <GoogleButton type="button" disabled={disabled || working} onClick={() => void start()}>{working ? "Opening Google…" : "Sign in with Google"}</GoogleButton>
    {error && <p role="alert">{error}</p>}
  </div>;
}

/** Why a room blocks sign-out right now, or "" when it may go ahead. Sign-out never needs a selected moment. */
export function roomSignOutBlock({ generating, drafting, walletBusy, checking, busy }: { generating: boolean; drafting: boolean; walletBusy: boolean; checking: boolean; busy: boolean }) {
  return generating ? "Finish generation or publish or discard your preview before signing out."
    : drafting ? "Finish or cancel your continuation before signing out."
    : walletBusy ? "Finish the wallet action in progress before signing out."
    : checking ? "Checking your storyteller account. You can sign out when it finishes."
    : busy ? "Wait for the current action to finish before signing out." : "";
}

export function PilotIdentity({ profile, disabled, signOutDisabled = disabled, onJoin, signOutBlockedReason = "", joinLabel = "Join this room" }: { profile?: Tables<"pilot_profiles">; disabled: boolean; signOutDisabled?: boolean; onJoin: () => void; signOutBlockedReason?: string; joinLabel?: string }) {
  const account = usePilotAccount();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [confirmGuestSignOut, setConfirmGuestSignOut] = useState(false);
  const saved = isSavedAccount(account?.user);
  const signInWallet = walletAccountIdentity(account?.user);
  const walletAddress = signInWallet?.address;
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
    if (!account || working || signOutDisabled) return;
    setWorking(true); setError("");
    try {
      await account.signOut();
      setConfirmGuestSignOut(false);
      requestAnimationFrame(() => signOutFocusTarget()?.focus({ preventScroll: true }));
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Sign-out could not finish. Try again."); }
    finally { setWorking(false); }
  }
  // On a phone the name can sit low on the page; bring the opened menu fully into view.
  function revealMenu(event: SyntheticEvent<HTMLDetailsElement>) {
    const menu = event.currentTarget;
    if (!menu.open) return;
    menu.querySelector(".pilot-guest-context")?.scrollIntoView({ block: "nearest" });
    // A menu taller than the screen shows its top, so bring sign-out at its foot (and why it waits) into view too.
    (menu.querySelector(".pilot-signout-button + small") ?? menu.querySelector(".pilot-signout-button"))?.scrollIntoView({ block: "nearest" });
  }
  const guestSignOut = confirmGuestSignOut && !saved && <GuestSignOutDialog name={profile?.display_name} busy={working} disabled={signOutDisabled} error={error} blockedReason={signOutBlockedReason} onClose={() => { if (!working) setConfirmGuestSignOut(false); }} onConfirm={() => void signOut()} />;
  return profile || saved ? <><details className="pilot-guest-identity" onToggle={revealMenu}>
    <summary>{walletAddress ? <Wallet size={17} aria-hidden="true" /> : <UserRound size={17} aria-hidden="true" />}<span>{profile ? <>Making as <strong>{profile.display_name}</strong></> : walletAddress ? <>Wallet account <strong>{shortAddress(walletAddress)}</strong></> : googleAccount ? "Signed in with Google" : "Signed in"}</span></summary>
    <div className="pilot-guest-context">
      <strong>Your storyteller identity</strong>
      {saved ? <p><Check size={15} aria-hidden="true" /> {walletAddress ? "Signed in with your wallet." : googleAccount ? "Your storyteller account is saved with Google." : "Your storyteller account is saved."} Return with the same sign-in to find your published work and saved previews. Unsent ideas stay in this browser.</p> : <p>{profile!.display_name} is the guest in this browser. Your drafts and byline belong to this session.</p>}
      {!profile && <><p>Choose your public storyteller name when you start making. You can read or use the release controls now.</p><button type="button" className="button secondary" disabled={disabled} onClick={onJoin}>Choose my storyteller name</button></>}
      <p>Connecting another wallet changes your testnet role. It keeps this storyteller name.</p>
      {account?.enabled && !saved && <><GoogleButton type="button" disabled={disabled || working} onClick={() => void save()}>{working ? "Opening Google…" : "Save my byline with Google"}</GoogleButton><small>Keep this storyteller identity. An in-app wallet is prepared after sign-in.</small><WalletProviderNote /></>}
      {walletAddress && <div className="pilot-account-wallet"><strong>Your sign-in wallet · {signInWallet?.chain === "solana" ? "Solana" : "EVM"}</strong><code>{walletAddress}</code><small>{signInWallet?.chain === "solana" ? "Signed in with Solana. For this demo's releases and payouts, connect an EVM or in-app wallet on Monad testnet. Your storyteller stays the same." : "Choose its account in your browser wallet. Connect it in the release panel for Monad testnet actions."}</small></div>}
      {saved && (account?.walletMode === "embedded" || googleAccount && !!account?.wallet.address) && <div className="pilot-account-wallet" aria-live="polite">
        {account?.wallet.address ? <><div className="pilot-account-wallet-heading"><strong>Your in-app wallet</strong><PrivyMark /></div><div><code>{account.wallet.address}</code><button type="button" className="text-button" aria-label="Copy in-app wallet address" onClick={() => void copy()}><Copy size={15} aria-hidden="true" />{copied ? "Copied" : "Copy"}</button></div><small>Monad testnet. Add test MON before registering or claiming.</small></> : <p>{account?.wallet.error || "Preparing your in-app wallet…"}</p>}
        {account?.wallet.error && <button type="button" className="text-button" disabled={disabled} onClick={account.wallet.prepare}>Check wallet again</button>}
      </div>}
      {error && <p role="alert">{error}</p>}
      {account?.user && <button type="button" className="text-button pilot-signout-button" disabled={signOutDisabled || working} onClick={() => { setError(""); if (saved) void signOut(); else setConfirmGuestSignOut(true); }}>{working ? "Signing out…" : "Sign out of this browser"}</button>}
      {signOutDisabled && signOutBlockedReason && <small>{signOutBlockedReason}</small>}
    </div>
  </details>{guestSignOut}</> : <div className="pilot-account-entry">{account?.enabled && <GoogleSignInButton disabled={disabled} />}<WalletSignInButton disabled={disabled} /><button className="button secondary pilot-join" type="button" disabled={disabled} onClick={onJoin}><UserRound size={17} aria-hidden="true" />{joinLabel}</button>
    {/* A guest whose name never saved still holds a session; the confirmation explains any wait. */}
    {account?.user && <button type="button" className="text-button pilot-signout-button" disabled={working} onClick={() => { setError(""); setConfirmGuestSignOut(true); }}>{working ? "Signing out…" : "Sign out of this browser"}</button>}
    {guestSignOut}</div>;
}
