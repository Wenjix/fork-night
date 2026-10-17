"use client";

import { useContext, useEffect, useId, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import type { Session, SupabaseClient, User } from "@supabase/supabase-js";
import { ChevronDown, UserRound, Wallet } from "lucide-react";
import type { Database } from "../lib/supabase/database.types.ts";
import { createSignOutRequest, expireCookie, forgetPrivySession, forgetSignedOut, privySessionStored, sessionKey, signedOutHere } from "../lib/supabase/signout-request.ts";
import { HeaderAccountVisibility } from "./app-header.tsx";
import "@/app/header-account.css";

type Client = SupabaseClient<Database>;

/** The storyteller this browser holds, as its stored session says. The chip only displays it, so it is never verified here. */
export type Storyteller = { id: string; anonymous: boolean; google: boolean; wallet?: string; name?: string };

export function storyteller(user: Pick<User, "id" | "is_anonymous" | "identities">, name?: string | null): Storyteller {
  const web3 = user.identities?.find(identity => identity.provider === "web3");
  const address = (web3?.identity_data?.custom_claims ?? web3?.identity_data)?.address;
  return {
    id: user.id,
    anonymous: user.is_anonymous !== false,
    google: !!user.identities?.some(identity => identity.provider === "google"),
    wallet: typeof address === "string" && /^(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/.test(address) ? address : undefined,
    name: name?.trim() || undefined,
  };
}

const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

/** The storyteller name, else a short wallet address, else the kind of account. */
export function accountLabel(account: Storyteller) {
  return account.name ?? (account.wallet ? shortAddress(account.wallet) : account.anonymous ? "Guest" : account.google ? "Google account" : "Saved account");
}

export function accountDetail(account: Storyteller) {
  if (account.anonymous) return "Guest in this browser, with no saved sign-in.";
  if (account.wallet) return account.name ? `Signed in with your wallet ${shortAddress(account.wallet)}.` : "Signed in with your wallet.";
  return account.google ? "Saved with Google." : "Saved account.";
}

/** Like /pilot's own sign-out: only a saved account's Privy session needs the bridge that /pilot mounts. */
export function needsPilotTrip(account: Storyteller, storage: Pick<Storage, "getItem">, privyConfigured = !!process.env.NEXT_PUBLIC_PRIVY_APP_ID) {
  return privyConfigured && !account.anonymous && privySessionStored(storage);
}

/** Like /pilot's identity menu: Google sign-in waits for a Privy app, which prepares the in-app wallet after it. */
export function canSaveWithGoogle(account: Storyteller, privyConfigured = !!process.env.NEXT_PUBLIC_PRIVY_APP_ID) {
  return privyConfigured && account.anonymous;
}

// localStorage fires "storage" only in other tabs, so this tab announces its own sign-out.
const SESSION_CHANGED = "fork-night:storyteller-session";
/** Reads that never throw, for checks made while rendering: a blocked localStorage throws on access. */
const savedHere: Pick<Storage, "getItem"> = { getItem: key => { try { return window.localStorage.getItem(key); } catch { return null; } } };

function subscribeSession(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(SESSION_CHANGED, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(SESSION_CHANGED, onChange);
  };
}

function sessionStored() {
  const key = sessionKey();
  return !!key && savedHere.getItem(key) !== null;
}

/** The storyteller account in the shared header. Wrappers with their own account menu hide it through HeaderAccountVisibility. */
export default function HeaderAccount() {
  return useContext(HeaderAccountVisibility) ? <AccountChip /> : null;
}

function AccountChip() {
  const stored = useSyncExternalStore(subscribeSession, sessionStored, () => false);
  // The server and hydration render the empty box. The account appears in the same pass as the page's
  // first effects, so a view that hides the chip on mount (/pilot's loading state) never shows it.
  const [mounted, setMounted] = useState(false);
  const [notice, setNotice] = useState("");
  const focusSignIn = useRef(false);
  useEffect(() => {
    setMounted(true);
    // /pilot's sign-out trip ends with a fresh load of the page it left: that page, and no other, confirms it as
    // the in-page sign-out does. A stopped return leaves the flag for that page only.
    let tab: Storage;
    try { tab = window.sessionStorage; } catch { return; }
    if (sessionStored() || !signedOutHere(tab, window.location.pathname)) return;
    focusSignIn.current = true;
    setNotice("Signed out of this browser.");
    // "/" replaces its header while it restores a #/project route, so the chip that stays clears the flag: after a
    // second, or sooner when the page is left (a link, a reload) or the visitor presses or types. A header link that
    // only switches "/"'s view also replaces the header, with no pagehide, so the next view does not confirm again. A
    // key still held from the trip repeats; that must not clear the flag before the restore remounts the chip. Once
    // forgotten, nothing is left listening: the timer and the listeners go too.
    const until = ["pagehide", "pointerdown", "keydown"];
    const stop = () => { window.clearTimeout(shown); for (const type of until) window.removeEventListener(type, forget, true); };
    const forget = (event?: Event) => {
      if ((event as KeyboardEvent | undefined)?.repeat) return;
      forgetSignedOut(tab);
      stop();
    };
    for (const type of until) window.addEventListener(type, forget, true);
    const shown = window.setTimeout(forget, 1000);
    return stop;
  }, []);
  useEffect(() => { if (stored) setNotice(""); }, [stored]);
  function signedOut() {
    focusSignIn.current = true;
    setNotice("Signed out of this browser.");
    window.dispatchEvent(new Event(SESSION_CHANGED));
  }
  return <div className="fn-account">
    {mounted && (stored ? <StorytellerMenu onSignedOut={signedOut} /> : <SignInLink focus={focusSignIn} />)}
    <span className="fn-account-sr" role="status">{notice}</span>
  </div>;
}

function SignInLink({ focus }: { focus?: RefObject<boolean> }) {
  const link = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (!focus?.current) return;
    focus.current = false;
    link.current?.focus();
  }, [focus]);
  return <a ref={link} className="fn-account-signin" href="/pilot">
    <UserRound size={18} aria-hidden="true" />
    <span className="fn-account-signin-label">Sign in</span>
    <span className="fn-account-sr"> to your storyteller account</span>
  </a>;
}

type Shown =
  | { status: "loading" }
  | { status: "none" }
  | { status: "unread" }
  | { status: "ready"; client: Client; account: Storyteller; named: boolean };

function StorytellerMenu({ onSignedOut }: { onSignedOut: () => void }) {
  const [shown, setShown] = useState<Shown>({ status: "loading" });
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [error, setError] = useState("");
  const menu = useRef<HTMLDetailsElement>(null);
  const signOutButton = useRef<HTMLButtonElement>(null);
  const warning = useRef<HTMLParagraphElement>(null);
  const warningId = useId();
  // Where focus goes once the guest confirmation opens or closes; the button that had it is gone by then.
  const focusAfterConfirm = useRef<RefObject<HTMLElement | null> | null>(null);
  useEffect(() => {
    focusAfterConfirm.current?.current?.focus();
    focusAfterConfirm.current = null;
  }, [confirming]);

  useEffect(() => {
    let live = true;
    let stop = () => {};
    let account: Storyteller | undefined;
    let name: { id: string; value?: string; read: boolean } | undefined;
    const render = (client: Client) => setShown(account
      ? { status: "ready", client, account: { ...account, name: name?.id === account.id ? name.value : undefined }, named: name?.id === account.id && name.read }
      : { status: "none" });
    async function show(client: Client, session: Session | null) {
      account = session ? storyteller(session.user) : undefined;
      render(client);
      // One read of the account's own profile row; a token refresh or a returning tab keeps the name.
      if (!account || name?.id === account.id) return;
      const id = account.id;
      name = { id, read: false };
      let value: string | undefined;
      try { value = (await client.from("pilot_profiles").select("display_name").eq("id", id).maybeSingle()).data?.display_name; }
      catch { /* The label falls back to the wallet or the kind of account. */ }
      if (!live || name.id !== id) return;
      name = { id, value: value?.trim() || undefined, read: true };
      render(client);
    }
    void (async () => {
      let client: Client | undefined;
      try { client = (await import("../lib/supabase/pilot-client.ts")).pilotBrowserClient(); }
      catch { /* The client did not load; /pilot can still manage the account. */ }
      if (!live) return;
      if (!client) { setShown({ status: "unread" }); return; }
      const connected = client;
      async function refresh() {
        const saved = await connected.auth.getSession().catch(() => undefined);
        if (!live) return;
        if (!saved || saved.error) setShown(previous => previous.status === "ready" ? previous : { status: "unread" });
        else await show(connected, saved.data.session);
      }
      const listener = connected.auth.onAuthStateChange((event, session) => {
        if (event === "INITIAL_SESSION") return;
        // supabase-js holds its auth lock while it delivers this event; read the profile after it returns.
        setTimeout(() => { if (live) void show(connected, session); }, 0);
      });
      // Another tab can switch accounts without a broadcast this tab hears.
      const key = sessionKey();
      const changed = (event: StorageEvent) => { if (event.key === key || event.key === null) void refresh(); };
      window.addEventListener("storage", changed);
      stop = () => { listener.data.subscription.unsubscribe(); window.removeEventListener("storage", changed); };
      await refresh();
    })();
    return () => { live = false; stop(); };
  }, []);

  useEffect(() => {
    // The trip replaces this page's history entry, so it never comes back from the back-forward cache
    // after /pilot. A page restored mid sign-out (Back, then Forward, before /pilot loaded) is usable at once,
    // without waiting for the next press or key. Back from Google's consent screen restores the page the same way.
    const restored = (event: PageTransitionEvent) => { if (event.persisted) { setBusy(false); setGoogleBusy(false); } };
    window.addEventListener("pageshow", restored);
    return () => window.removeEventListener("pageshow", restored);
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (refocus: boolean) => {
      if (menu.current) menu.current.open = false;
      if (refocus) menu.current?.querySelector("summary")?.focus();
    };
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) close(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") close(true); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  if (shown.status === "none") return <SignInLink />;
  const ready = shown.status === "ready" ? shown : undefined;
  const account = ready?.account;

  async function signOut() {
    if (!ready || busy || googleBusy) return;
    setBusy(true); setError("");
    let privyLeft = false;
    if (needsPilotTrip(ready.account, savedHere)) {
      try {
        // Replace, not assign: /pilot replaces its own entry with the return path, so Back does not land here twice.
        window.location.replace(createSignOutRequest(window.sessionStorage, window.location.href));
        // A cancelled navigation (a leave prompt answered "Stay", or Stop) fires no event, so the next press or key
        // gives the button back, even while a slow /pilot is still loading; a second click then starts the trip
        // again and its navigation replaces the pending one. A held key's repeats do not count, or a held Enter would
        // restart the trip with every repeat.
        const release = (event: Event) => {
          if ((event as KeyboardEvent).repeat) return;
          setBusy(false);
          for (const type of ["pointerdown", "keydown"]) window.removeEventListener(type, release, true);
        };
        for (const type of ["pointerdown", "keydown"]) window.addEventListener(type, release, true);
        return;
      }
      catch {
        // Without sessionStorage there is no safe request: sign out here, then remove the Privy session's keys as
        // /pilot does, since its bridge cannot end that session on this page.
        privyLeft = true;
      }
    }
    let helpers: [typeof import("../lib/supabase/onboarding.ts"), typeof import("../lib/pilot-rooms.ts")];
    try { helpers = await Promise.all([import("../lib/supabase/onboarding.ts"), import("../lib/pilot-rooms.ts")]); }
    catch {
      setBusy(false);
      setError("Sign-out could not load. Check your connection and try again.");
      return;
    }
    try { await helpers[0].signOutPilotAccount(ready.client, window.sessionStorage); }
    catch (reason) {
      setBusy(false);
      setError(reason instanceof Error ? reason.message : "Sign-out could not finish. Try again.");
      return;
    }
    if (privyLeft) {
      try { forgetPrivySession(window.localStorage, expireCookie); }
      catch { /* Storage may be what failed; the storyteller is signed out either way. */ }
    }
    try { helpers[1].clearVisitorIdeas(window.localStorage); }
    catch { /* Sign-out succeeds even if idea storage is unavailable. */ }
    onSignedOut();
  }
  function requestSignOut() {
    setError("");
    if (!account?.anonymous) { void signOut(); return; }
    focusAfterConfirm.current = warning;
    setConfirming(true);
  }
  async function saveWithGoogle() {
    if (!ready || googleBusy || busy || confirming) return;
    setGoogleBusy(true);
    setError("");
    try {
      const { startGoogleLogin } = await import("../lib/supabase/onboarding.ts");
      if (await startGoogleLogin(ready.client, window.location.href, window.sessionStorage, "link") !== "saved") return;
      // Saved in another tab: no redirect starts, so give the button back and let the refreshed session relabel the chip.
      setGoogleBusy(false);
      await ready.client.auth.refreshSession().catch(() => undefined);
    } catch (reason) {
      setGoogleBusy(false);
      setError(reason instanceof Error ? reason.message : "Google sign-in could not start. Try again.");
      if (menu.current) menu.current.open = true;
      setOpen(true);
    }
  }
  function keepGuest() {
    focusAfterConfirm.current = signOutButton;
    setConfirming(false);
  }

  const label = ready?.named ? accountLabel(ready.account) : shown.status === "unread" ? "Account" : undefined;
  const initial = account?.name ? Array.from(account.name)[0].toLocaleUpperCase() : undefined;
  const trip = !!account && needsPilotTrip(account, savedHere);
  const guest = !!ready && !!label && !!account?.anonymous;
  const displayLabel = guest ? `Guest · ${label}` : label;
  const saveable = guest && !!account && canSaveWithGoogle(account);
  return <div className={`fn-account-ready${saveable ? " fn-account-guest" : ""}`}>
    <details ref={menu} className="fn-account-menu" data-guest={saveable ? "true" : undefined} onToggle={event => {
      const opened = event.currentTarget.open;
      setOpen(opened);
      if (!opened && !busy && !googleBusy) { setConfirming(false); setError(""); }
    }}>
      <summary aria-busy={displayLabel ? undefined : true}>
        <span className="fn-account-avatar" aria-hidden="true">
          {initial ?? (account?.wallet ? <Wallet size={16} /> : <UserRound size={16} />)}
        </span>
        <span className="fn-account-text">
          <span className="fn-account-sr">Your storyteller account: </span>
          {!guest && <span className="fn-account-eyebrow" aria-hidden="true">Signed in</span>}
          {displayLabel ? <span className="fn-account-name">{displayLabel}</span> : <span className="fn-account-name fn-account-pending"><span className="fn-account-sr">checking</span></span>}
        </span>
        <ChevronDown className="fn-account-chevron" size={16} aria-hidden="true" />
      </summary>
      <div className="fn-account-panel">
        <strong className="fn-account-heading">Your storyteller account</strong>
        {account && displayLabel ? <p className="fn-account-who"><strong>{displayLabel}</strong><span>{accountDetail(account)}</span></p>
          : shown.status === "unread" ? <p>Your account could not load here. <a href="/pilot">Open Shared rooms</a> to manage it.</p>
          : <p>Checking your account…</p>}
        {saveable && !confirming && <button type="button" className="fn-account-save-google-menu" disabled={googleBusy || busy} onClick={() => void saveWithGoogle()}>{googleBusy ? "Opening Google…" : "Save with Google"}</button>}
        {ready && (confirming
          ? <div className="fn-account-confirm" role="group" aria-labelledby={warningId}>
            <p id={warningId} ref={warning} tabIndex={-1}><strong>{"This guest can't be recovered."}</strong></p>
            <div className="fn-account-confirm-actions">
              <button type="button" className="fn-account-keep" disabled={busy} onClick={keepGuest}>Keep this guest</button>
              <button type="button" className="fn-account-danger" disabled={busy} onClick={() => void signOut()}>{busy ? "Signing out…" : "Sign out"}</button>
            </div>
          </div>
          : <button ref={signOutButton} type="button" className="fn-account-signout" disabled={busy || googleBusy} onClick={requestSignOut}>{busy ? "Signing out…" : "Sign out of this browser"}</button>)}
        {ready && trip && !confirming && <small>Stops at Shared rooms to end your in-app wallet session, then brings you back here.</small>}
        {error && <p className="fn-account-error" role="alert">{error}</p>}
      </div>
    </details>
    {saveable && !confirming && <button type="button" className="fn-account-save-google" disabled={googleBusy || busy} onClick={() => void saveWithGoogle()}>{googleBusy ? "Opening Google…" : "Save with Google"}</button>}
  </div>;
}
