/**
 * A sign-out that the site header hands to /pilot.
 *
 * The header's account chip signs a storyteller out on the page it is on. A browser that also
 * holds a Privy in-app wallet session can end it only on /pilot, where PilotAccountProvider
 * mounts the Privy bridge. The chip then stores a one-time token in this tab's sessionStorage
 * and replaces its own history entry with /pilot?signout=<token>&return=<path>.
 *
 * Contract for /pilot (PilotAccountProvider):
 * 1. Once per page load, call consumeSignOutRequest(window.sessionStorage, window.location.href).
 *    Guard the call with a ref: React StrictMode runs effects twice in development, and the
 *    request is gone after the first call.
 * 2. Whatever it returns, when hasSignOutRequest(href) is true, replace the address with
 *    withoutSignOutRequest(href) (history.replaceState), so a reload, a bookmark or a shared
 *    link never carries the token.
 * 3. null: do nothing more. The token was missing, wrong, expired or already used.
 *    sessionStorage belongs to one tab of this origin, so a link from another site or another
 *    tab cannot sign anyone out (logout CSRF).
 * 4. { returnTo }: from the moment the request is read, the account bar shows "Signing out of this
 *    browser…" (the account context's signingOut flag) and the rest of the entrance is inert, so a
 *    click cannot leave halfway. The request is read in an effect when the provider mounts, so
 *    until /pilot's scripts have loaded, its static shell ("Opening the rooms…") and the header's
 *    links still work. Following a link or going Back then leaves the session stored, the request
 *    unused in this tab and the /pilot?signout=… entry in history; returning to that entry, or
 *    reloading it, within SIGNOUT_REQUEST_TTL_MS finishes the sign-out. Once the status shows,
 *    leaving anyway (Back, a reload, closing the tab) still signs this browser out: while the
 *    status is up, a pagehide listener removes the stored Supabase session (sessionKey()) and
 *    Privy's (forgetPrivySession()), as a failed logout call would.
 *    Once the account has loaded, call the provider's own signOut() when someone is signed in,
 *    when the account check failed (the session may still be stored) or when a Privy session is
 *    stored (a session the server ended can leave it behind). signOut() ends the Privy session (it
 *    waits up to 3 s for a Privy bridge that is not mounted yet, then gives Privy's logout up to
 *    3 s), signs out of this browser (scope local) and clears the visitor's unsent ideas. The chip
 *    has already asked an anonymous guest to confirm, so do not ask again.
 *    - On success, or when there was nothing to sign out: forgetPrivySession(), since an
 *      unreachable Privy finishes its own cleanup only after this page has left. Then, when
 *      returnTo is a path, markSignedOut(window.sessionStorage, returnTo) and
 *      window.location.replace(returnTo), so history holds the start page once and its chip, on
 *      that path only, confirms the sign-out. The status, and the pagehide listener with it, stays
 *      until the next press or key, in case the navigation is stopped; a held key's repeats do
 *      not end it. When returnTo is null, the status ends and the page stays on /pilot, now signed
 *      out.
 *    - On failure: stay on /pilot and show the error under the account bar. The status ends, and
 *      the pagehide listener with it, so leaving keeps the session, as the error says. A scope-local
 *      sign-out does not call GET /auth/v1/user, but auth-js first refreshes an access token that
 *      has expired, and a refresh that cannot reach Supabase fails the sign-out and keeps the
 *      session. When the account had loaded, the bar's own sign-out remains. After a failed
 *      account check no account is loaded: the bar shows the visitor entry, with no sign-out, and
 *      the error asks for a refresh. The start page is no longer in history, since the chip
 *      replaced it.
 * 5. Never navigate anywhere else: returnTo is always a same-origin path starting with one "/".
 */

export const SIGNOUT_REQUEST_KEY = "fork-night:signout-request";
export const SIGNOUT_PARAM = "signout";
export const RETURN_PARAM = "return";
/** The trip takes seconds; an older request is refused. */
export const SIGNOUT_REQUEST_TTL_MS = 5 * 60_000;

const TOKEN = /^[0-9a-f]{32}$/;
type SignOutRequest = { token: string; at: number };

/** 128 random bits as hex. */
export function newSignOutToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** supabase-js's default storage key for this project, which pilotBrowserClient() keeps. */
export function sessionKey(url = process.env.NEXT_PUBLIC_SUPABASE_URL) {
  if (!url) return undefined;
  try { return `sb-${new URL(url).hostname.split(".")[0]}-auth-token`; }
  catch { return undefined; }
}

/** Privy's session keys; privy:caid identifies the device and is not a sign-in. */
export function privySessionStored(storage: Pick<Storage, "getItem">) {
  try { return !!(storage.getItem("privy:token") || storage.getItem("privy:refresh_token")); }
  catch { return false; }
}

const PRIVY_ACTIVE_USER = "privy:active-user";
const PRIVY_SAVED_USERS = "privy:saved-users";

/**
 * Privy's own logout clears its session only once its logout call settles, which takes about 20 s
 * when privy.io is unreachable. This removes what that cleanup (destroyLocalState) removes, in both
 * of Privy's layouts; Privy JSON-encodes each value.
 * - The session this app writes: @privy-io/react-auth 3.48.1's own Session, which its custom-JWT
 *   sign-in fills (useSubscribeToJwtAuthWithFlag, then startAuthFlow/authenticate, then
 *   _storeAllTokens): privy:token, privy:refresh_token, privy:pat, privy:id_token when identity
 *   tokens are on, and the privy-token, privy-session and privy-id-token cookies.
 * - @privy-io/js-sdk-core 0.78.2's: those tokens with no user and under the active user (its identity
 *   token as "id-token"), the active user and its place in the saved users, the guest credential
 *   privy:guest:<appId> (only when the app id is known), and the matching cookies, privy-refresh-token
 *   and privy-<user>-… included.
 * privy:caid identifies the device and stays, as do other users' keys. Never throws.
 */
export function forgetPrivySession(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">, expireCookie: (name: string) => void, appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID) {
  let user: unknown = null;
  try { user = JSON.parse(storage.getItem(PRIVY_ACTIVE_USER) ?? "null"); }
  catch { /* No readable active user: clear the keys stored with no user. */ }
  const active = typeof user === "string" && user ? user : undefined;
  for (const scope of active ? [undefined, active] : [undefined]) {
    // With no user, react-auth's own session also keeps its identity token as "id_token".
    for (const name of scope ? ["token", "pat", "refresh_token", "id-token"] : ["token", "pat", "refresh_token", "id-token", "id_token"]) {
      try { storage.removeItem(scope ? `privy:${scope}:${name}` : `privy:${name}`); }
      catch { /* Blocked storage holds no session to clear. */ }
    }
    for (const name of ["token", "refresh-token", "id-token", "session"]) {
      try { expireCookie(scope ? `privy-${scope}-${name}` : `privy-${name}`); }
      catch { /* Cookies may be blocked too. */ }
    }
  }
  for (const key of [PRIVY_ACTIVE_USER, ...(appId ? [`privy:guest:${appId}`] : [])]) {
    try { storage.removeItem(key); }
    catch { /* As above. */ }
  }
  if (!active) return;
  try {
    // Privy stores the saved users as a JSON array that its storage JSON-encodes again.
    const raw = storage.getItem(PRIVY_SAVED_USERS);
    const saved: unknown = raw === null ? [] : JSON.parse(JSON.parse(raw));
    const rest = Array.isArray(saved) ? saved.filter(id => typeof id === "string" && id !== active) : [];
    if (rest.length) storage.setItem(PRIVY_SAVED_USERS, JSON.stringify(JSON.stringify(rest)));
    else storage.removeItem(PRIVY_SAVED_USERS);
  } catch { /* An unreadable list cannot restore a session without its tokens. */ }
}

/** Expires a cookie as Privy's cookie library removes it: host-only, path "/", the name URI-encoded. */
export function expireCookie(name: string) {
  document.cookie = `${encodeURIComponent(name)}=; Max-Age=0; Path=/`;
}

/** A same-origin path that starts with exactly one "/", normalised, or null. */
export function safeReturnPath(value: string | null | undefined, origin: string) {
  if (typeof value !== "string" || value.length > 2000 || !value.startsWith("/") || value.startsWith("//")) return null;
  // Browsers read "\" as "/" and drop tabs and newlines, so "/\evil.example" would leave the site.
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const url = new URL(value, origin);
    // Dot segments can collapse "/.//host" to "//host", which location.replace reads as another site.
    const path = `${url.pathname}${url.search}${url.hash}`;
    return url.origin === new URL(origin).origin && !path.startsWith("//") ? path : null;
  } catch { return null; }
}

/** /pilot sets this just before it returns to the chip's page, so that page confirms the sign-out. */
export const SIGNED_OUT_KEY = "fork-night:signed-out";
const SIGNED_OUT_TTL_MS = 30_000;

/** /pilot: the sign-out finished; the page it now returns to, and only that page, says so. Never throws. */
export function markSignedOut(storage: Pick<Storage, "setItem">, returnTo: string, now = Date.now()) {
  try { storage.setItem(SIGNED_OUT_KEY, JSON.stringify({ at: now, path: new URL(returnTo, "http://localhost").pathname })); }
  catch { /* The page then shows Sign in without the confirmation. */ }
}

/**
 * The chip: whether /pilot has just signed this tab out and returned to this page (the path alone, so "/"
 * restoring a #/project route still counts). A return that was stopped leaves the flag for that page only.
 * Never throws.
 */
export function signedOutHere(storage: Pick<Storage, "getItem">, pathname: string, now = Date.now()) {
  try {
    const flag = JSON.parse(storage.getItem(SIGNED_OUT_KEY) ?? "null") as { at?: unknown; path?: unknown } | null;
    return typeof flag?.at === "number" && flag.at > 0 && Math.abs(now - flag.at) < SIGNED_OUT_TTL_MS && flag.path === pathname;
  } catch { return false; }
}

export function forgetSignedOut(storage: Pick<Storage, "removeItem">) {
  try { storage.removeItem(SIGNED_OUT_KEY); }
  catch { /* It expires. */ }
}

/** The header chip records a one-time request in this tab and gets the /pilot address to open. Throws if sessionStorage refuses it. */
export function createSignOutRequest(storage: Pick<Storage, "setItem">, currentUrl: string, { token = newSignOutToken(), now = Date.now() } = {}) {
  const current = new URL(currentUrl);
  storage.setItem(SIGNOUT_REQUEST_KEY, JSON.stringify({ token, at: now } satisfies SignOutRequest));
  const query = new URLSearchParams({ [SIGNOUT_PARAM]: token });
  const back = safeReturnPath(`${current.pathname}${current.search}${current.hash}`, current.origin);
  if (back) query.set(RETURN_PARAM, back);
  return `/pilot?${query}`;
}

export function hasSignOutRequest(currentUrl: string) {
  try { return new URL(currentUrl).searchParams.has(SIGNOUT_PARAM); }
  catch { return false; }
}

/** The same address without the request, for history.replaceState. */
export function withoutSignOutRequest(currentUrl: string) {
  const url = new URL(currentUrl);
  url.searchParams.delete(SIGNOUT_PARAM);
  url.searchParams.delete(RETURN_PARAM);
  return url.href;
}

/**
 * /pilot: the request in this address, when this tab made it. A matching token is used up even if
 * it has expired; any other token leaves the stored one alone.
 */
export function consumeSignOutRequest(storage: Pick<Storage, "getItem" | "removeItem">, currentUrl: string, now = Date.now()): { returnTo: string | null } | null {
  let url: URL;
  try { url = new URL(currentUrl); }
  catch { return null; }
  const token = url.searchParams.get(SIGNOUT_PARAM);
  if (!token || !TOKEN.test(token)) return null;
  let stored: Partial<SignOutRequest> | null;
  try { stored = JSON.parse(storage.getItem(SIGNOUT_REQUEST_KEY) ?? "null"); }
  catch { return null; }
  if (!stored || stored.token !== token) return null;
  try { storage.removeItem(SIGNOUT_REQUEST_KEY); }
  catch { /* /pilot still drops the token from the address, so it cannot be followed again. */ }
  if (typeof stored.at !== "number" || now - stored.at > SIGNOUT_REQUEST_TTL_MS || stored.at - now > 60_000) return null;
  return { returnTo: safeReturnPath(url.searchParams.get(RETURN_PARAM), url.origin) };
}
