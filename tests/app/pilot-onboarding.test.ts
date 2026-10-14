import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/supabase/database.types.ts";
import { checkGoogleLink, createEmbeddedWalletIfCurrent, embeddedAddressForMaker, GOOGLE_LINK_KEY, googleCallbackError, googleReturnUrl, signOutPilotAccount, startGoogleLogin, walletAuthToken } from "../../src/lib/supabase/onboarding.ts";
import type { StoragePort } from "../../src/lib/onchain/client.ts";

const maker = "6affb211-2319-4aab-a0b2-cc3bb7fe636a";
function fixture() {
  const values = new Map<string, string>();
  const storage: StoragePort = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
  // signOutClears: like auth-js, the failed logout call removes this browser's session first.
  const state = { user: { id: maker, is_anonymous: true } as User | null, verificationError: false, linkError: false, signOutError: false, signOutClears: false, sessionError: false, profile: true, token: `${btoa(JSON.stringify({ alg: "ES256" }))}.payload.signature` };
  const calls: { action: string; options?: unknown }[] = [];
  const client = {
    auth: {
      getSession: async () => ({ data: { session: state.user && !state.sessionError ? { user: state.user, access_token: state.token } : null }, error: state.sessionError ? new Error("storage unavailable") : null }),
      getUser: async () => ({ data: { user: state.user }, error: state.verificationError ? new Error("not verified") : null }),
      linkIdentity: async (options: unknown) => { calls.push({ action: "link", options }); return { error: state.linkError ? new Error("provider disabled") : null }; },
      signInWithOAuth: async (options: unknown) => { calls.push({ action: "signIn", options }); return { error: null }; },
      signOut: async (options: unknown) => {
        calls.push({ action: "signOut", options });
        if (state.signOutError) { if (state.signOutClears) state.user = null; return { error: new Error("logout failed") }; }
        state.user = null; return { error: null };
      },
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.profile ? { id: maker } : null, error: null }) }) }) }),
  } as unknown as SupabaseClient<Database>;
  return { client, state, calls, storage, values };
}

test("guest and saved sign-out affect only this browser and keep draft records", async () => {
  for (const anonymous of [true, false]) {
    const h = fixture(); h.state.user!.is_anonymous = anonymous;
    h.storage.setItem(GOOGLE_LINK_KEY, maker);
    h.storage.setItem("private-draft", "saved idea");
    await signOutPilotAccount(h.client, h.storage);
    assert.deepEqual(h.calls, [{ action: "signOut", options: { scope: "local" } }]);
    assert.equal(h.state.user, null);
    assert.equal(h.storage.getItem(GOOGLE_LINK_KEY), null);
    assert.equal(h.storage.getItem("private-draft"), "saved idea");
  }
});

test("failed sign-out preserves the account and unfinished identity-link check", async () => {
  const h = fixture(); h.state.signOutError = true; h.storage.setItem(GOOGLE_LINK_KEY, maker);
  await assert.rejects(signOutPilotAccount(h.client, h.storage), /could not be signed out/);
  assert.equal(h.state.user!.id, maker);
  assert.equal(h.storage.getItem(GOOGLE_LINK_KEY), maker);
});

test("a failed logout call after the session was removed here still signs out; a session that cannot be read does not", async () => {
  const h = fixture(); h.state.signOutError = true; h.state.signOutClears = true; h.storage.setItem(GOOGLE_LINK_KEY, maker);
  await signOutPilotAccount(h.client, h.storage);
  assert.equal(h.state.user, null);
  assert.equal(h.storage.getItem(GOOGLE_LINK_KEY), null);
  const unread = fixture(); unread.state.signOutError = true; unread.state.signOutClears = true; unread.state.sessionError = true;
  await assert.rejects(signOutPilotAccount(unread.client, unread.storage), /could not be signed out/);
});

test("a pending JWT check cannot create a wallet after sign-out or a wallet-mode change", async () => {
  let current = true, creates = 0;
  let finish!: (token: string) => void;
  const token = new Promise<string>(resolve => { finish = resolve; });
  const pending = createEmbeddedWalletIfCurrent(() => token, async () => { creates++; }, () => current);
  current = false;
  finish("fixture-jwt");
  await pending;
  assert.equal(creates, 0);
  await createEmbeddedWalletIfCurrent(async () => "fixture-jwt", async () => { creates++; }, () => true);
  assert.equal(creates, 1);
  await createEmbeddedWalletIfCurrent(async () => undefined, async () => { creates++; }, () => true);
  assert.equal(creates, 1);
});

test("Google return preserves the selected story and excludes authorization/error parameters", () => {
  const result = new URL(googleReturnUrl("http://localhost:3005/pilot?room=midnight-signal&moment=123&code=SECRET&error_description=provider#access_token=SECRET"));
  assert.equal(result.origin, "http://localhost:3005");
  assert.equal(result.pathname, "/pilot");
  assert.equal(result.searchParams.get("room"), "midnight-signal");
  assert.equal(result.searchParams.get("moment"), "123");
  assert.equal(result.searchParams.get("onboarding"), "1");
  assert.equal(result.href.includes("SECRET"), false);
});
test("saving a guest with Google links the verified UUID instead of creating another account", async () => {
  const h = fixture();
  await startGoogleLogin(h.client, "http://localhost:3005/pilot?room=midnight-signal", h.storage, "link");
  assert.deepEqual(h.calls.map(call => call.action), ["link"]);
  assert.equal(h.storage.getItem(GOOGLE_LINK_KEY), maker);
  checkGoogleLink({ ...h.state.user!, is_anonymous: false }, h.storage);
  assert.equal(h.storage.getItem(GOOGLE_LINK_KEY), null);
});
test("linking failures preserve the guest and never fall back to signing into a different account", async () => {
  const h = fixture(); h.state.linkError = true;
  await assert.rejects(startGoogleLogin(h.client, "http://localhost:3005/pilot", h.storage, "link"), /guest work is preserved/);
  assert.equal(h.state.user!.id, maker);
  assert.deepEqual(h.calls.map(call => call.action), ["link"]);
  assert.equal(h.storage.getItem(GOOGLE_LINK_KEY), null);
});
test("a mismatched OAuth return cannot merge bylines or clear the identity check", () => {
  const h = fixture(); h.storage.setItem(GOOGLE_LINK_KEY, maker);
  assert.throws(() => checkGoogleLink({ id: "other", is_anonymous: false } as User, h.storage), /have not been merged/);
  assert.equal(h.storage.getItem(GOOGLE_LINK_KEY), maker);
  checkGoogleLink(h.state.user!, h.storage);
  assert.equal(h.storage.getItem(GOOGLE_LINK_KEY), maker);
});
test("returning sign-in cannot abandon an existing guest profile", async () => {
  const h = fixture();
  await assert.rejects(startGoogleLogin(h.client, "http://localhost:3005/pilot", h.storage, "return"), /separate browser profile/);
  assert.equal(h.calls.length, 0);
  h.state.user = null;
  await startGoogleLogin(h.client, "http://localhost:3005/pilot", h.storage, "return");
  assert.deepEqual(h.calls.map(call => call.action), ["signIn"]);
});
test("an unverified cached session cannot start Google account linking", async () => {
  const h = fixture(); h.state.verificationError = true;
  await assert.rejects(startGoogleLogin(h.client, "http://localhost:3005/pilot", h.storage, "link"), /could not be verified/);
  assert.equal(h.calls.length, 0);
});
test("wallet authentication uses a verified saved account and a public-key-signed token", async () => {
  const h = fixture();
  await assert.rejects(walletAuthToken(h.client, maker), /account changed/);
  h.state.user!.is_anonymous = false;
  assert.equal(await walletAuthToken(h.client, maker), h.state.token);
  await assert.rejects(walletAuthToken(h.client, "another-maker"), /account changed/);
  h.state.verificationError = true;
  await assert.rejects(walletAuthToken(h.client, maker), /account changed/);
  h.state.verificationError = false;
  h.state.token = `${btoa(JSON.stringify({ alg: "HS256" }))}.payload.signature`;
  await assert.rejects(walletAuthToken(h.client, maker), /public JWT signing keys/);
});
test("only the current creator's linked embedded EVM wallet can be selected", () => {
  const accounts = [
    { type: "custom_auth", customUserId: maker },
    { type: "wallet", walletClientType: "metamask", chainType: "ethereum", address: "external" },
    { type: "wallet", walletClientType: "privy", chainType: "solana", address: "solana" },
    { type: "wallet", walletClientType: "privy", chainType: "ethereum", address: "embedded" },
  ];
  assert.equal(embeddedAddressForMaker(maker, accounts), "embedded");
  assert.equal(embeddedAddressForMaker("other", accounts), undefined);
  assert.equal(embeddedAddressForMaker("", accounts), undefined);
  assert.equal(embeddedAddressForMaker(maker, accounts.slice(1)), undefined);
});
test("OAuth errors offer recovery without echoing tokens or provider-supplied text", () => {
  assert.match(googleCallbackError("http://localhost/pilot#error_code=identity_already_exists&error_description=SECRET"), /separate browser profile/);
  assert.equal(googleCallbackError("http://localhost/pilot?error=access_denied&error_description=SECRET").includes("SECRET"), false);
  assert.equal(googleCallbackError("http://localhost/pilot?room=midnight-signal"), "");
});
