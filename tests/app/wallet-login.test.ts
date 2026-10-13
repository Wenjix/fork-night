import assert from "node:assert/strict";
import test from "node:test";
import { createClient, type SupabaseClient, type User, type UserIdentity } from "@supabase/supabase-js";
import { id, toUtf8String, verifyMessage, Wallet } from "ethers";
import type { Database } from "../../src/lib/supabase/database.types.ts";
import { accountWalletMode, startWalletLogin, useEmbeddedWalletByDefault, walletAccountAddress, walletSignInUrl } from "../../src/lib/supabase/wallet-login.ts";
import { joinPilotAsGuest } from "../../src/lib/supabase/guest.ts";

const maker = "20000000-0000-4000-8000-000000000090";
const signer = new Wallet(id("Fork Night wallet-login test fixture"));
// Supabase Auth serializes provider.Claims.CustomClaims under custom_claims.
const identity: UserIdentity = { id: "20000000-0000-4000-8000-000000000091", identity_id: "20000000-0000-4000-8000-000000000091", user_id: maker, provider: "web3", identity_data: { sub: `web3:ethereum:${signer.address}`, custom_claims: { chain: "ethereum", address: signer.address, network: "10143" } } };
const user: User = { id: maker, is_anonymous: false, app_metadata: { provider: "web3", providers: ["web3"] }, user_metadata: {}, aud: "authenticated", created_at: "2026-10-12T15:00:00Z", identities: [identity] };
function fixture({ reject = false, disabled = false } = {}) {
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  const methods: string[] = [];
  const client = createClient<Database>("https://wallet-auth.invalid", "public-fixture-key", {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const url = String(input), body = JSON.parse(String(init?.body ?? "{}")); requests.push({ url, body });
      if (url.endsWith("/auth/v1/user")) return Response.json(user);
      if (url.endsWith("/rest/v1/rpc/pilot_set_display_name")) return Response.json({ id: maker, display_name: body.p_name, created_at: user.created_at });
      assert.ok(url.endsWith("/auth/v1/token?grant_type=web3"), "Wallet sign-in must not create an anonymous session or profile");
      if (disabled) return Response.json({ error_code: "web3_provider_disabled", msg: "Private provider setup detail" }, { status: 400 });
      const token = [JSON.stringify({ alg: "ES256" }), JSON.stringify({ sub: maker, exp: Math.floor(Date.now() / 1000) + 3600 }), "fixture-signature"].map(value => Buffer.from(value).toString("base64url")).join(".");
      return Response.json({ access_token: token, refresh_token: "fixture-refresh", token_type: "bearer", expires_in: 3600, user });
    } },
  });
  const wallet = { request: async ({ method, params }: { method: string; params?: unknown }) => {
    methods.push(method);
    if (method === "eth_requestAccounts") return [signer.address];
    if (method === "eth_chainId") return "0x279f";
    if (method === "personal_sign") {
      if (reject) throw new Error("Rejected signature with PRIVATE_PROVIDER_DETAILS");
      return signer.signMessage(toUtf8String((params as string[])[0]));
    }
    throw new Error(`Unexpected wallet method ${method}`);
  } };
  return { client, wallet, methods, requests };
}

test("a first-time browser wallet authenticates through the real SDK before any guest or name is created", async () => {
  const h = fixture();
  const result = await startWalletLogin(h.client, h.wallet, "http://localhost:3005/pilot?room=midnight-signal&code=SECRET#access_token=SECRET");
  assert.equal(result.id, maker);
  assert.equal(walletAccountAddress(result), signer.address);
  assert.equal((await h.client.auth.getSession()).data.session?.user.id, maker);
  assert.deepEqual(h.methods, ["eth_requestAccounts", "eth_chainId", "personal_sign"]);
  assert.equal(h.requests.length, 1);
  const body = h.requests[0].body;
  assert.equal(body.chain, "ethereum");
  assert.equal(verifyMessage(String(body.message), String(body.signature)), signer.address);
  assert.match(String(body.message), /localhost:3005 wants you to sign in/);
  assert.match(String(body.message), /Chain ID: 10143/);
  assert.match(String(body.message), /URI: http:\/\/localhost:3005\/pilot/);
  assert.match(String(body.message), /Expiration Time:/);
  assert.doesNotMatch(String(body.message), /SECRET/);
  assert.equal(useEmbeddedWalletByDefault(result), false);
});
test("a returning wallet gets the same Auth identity without creating a new guest or profile", async () => {
  for (let index = 0; index < 2; index++) {
    const h = fixture();
    assert.equal((await startWalletLogin(h.client, h.wallet, "http://localhost:3005/pilot")).id, maker);
    assert.equal(h.requests.length, 1);
  }
});
test("naming a wallet account afterwards retains its authenticated UUID and does not make a guest", async () => {
  const h = fixture();
  await startWalletLogin(h.client, h.wallet, "http://localhost:3005/pilot");
  const profile = await joinPilotAsGuest(h.client, "Wallet storyteller");
  assert.equal(profile.id, maker);
  assert.equal(profile.display_name, "Wallet storyteller");
  assert.deepEqual(h.requests.map(request => new URL(request.url).pathname), ["/auth/v1/token", "/auth/v1/user", "/rest/v1/rpc/pilot_set_display_name"]);
  assert.equal(h.requests.some(request => /anonymous/.test(request.url)), false);
});
test("cancelled signatures and a disabled provider leave sign-in recoverable and expose no raw provider error", async () => {
  const cancelled = fixture({ reject: true });
  await assert.rejects(startWalletLogin(cancelled.client, cancelled.wallet, "http://localhost:3005/pilot"), error => {
    assert.match(String(error), /Wallet sign-in did not finish/); assert.doesNotMatch(String(error), /PRIVATE_PROVIDER/); return true;
  });
  assert.equal(cancelled.requests.length, 0);
  assert.equal((await cancelled.client.auth.getSession()).data.session, null);
  const unavailable = fixture({ disabled: true });
  await assert.rejects(startWalletLogin(unavailable.client, unavailable.wallet, "http://localhost:3005/pilot"), /awaiting room setup/);
  assert.equal((await unavailable.client.auth.getSession()).data.session, null);
});
test("existing guest or saved profiles cannot be silently replaced by a wallet login", async () => {
  for (const anonymous of [true, false]) {
    let attempts = 0;
    const client = { auth: {
      getSession: async () => ({ data: { session: { user: { id: maker }, access_token: "fixture" } }, error: null }),
      getUser: async () => ({ data: { user: { id: maker, is_anonymous: anonymous } }, error: null }),
      signInWithWeb3: async () => { attempts++; throw new Error("must not reach wallet login"); },
    }, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: maker }, error: null }) }) }) }) } as unknown as SupabaseClient<Database>;
    await assert.rejects(startWalletLogin(client, { request: async () => { throw new Error("must not request wallet"); } }, "http://localhost:3005/pilot"), anonymous ? /Keep this guest/ : /already signed in/);
    assert.equal(attempts, 0);
  }
});
test("only a saved Ethereum Web3 identity selects the external wallet default", () => {
  assert.equal(walletAccountAddress(user), signer.address);
  assert.equal(useEmbeddedWalletByDefault(user), false);
  assert.equal(walletAccountAddress({ ...user, is_anonymous: true }), "");
  const google: User = { ...user, identities: [{ ...identity, provider: "google", identity_data: { address: signer.address, chain: "ethereum" } }] };
  assert.equal(walletAccountAddress(google), "");
  assert.equal(useEmbeddedWalletByDefault(google), true);
  assert.equal(useEmbeddedWalletByDefault(undefined), false);
  assert.equal(walletSignInUrl("http://localhost:3005/pilot?code=TOKEN#access_token=TOKEN"), "http://localhost:3005/pilot");
});

test("Supabase's nested Web3 provider claims keep MetaMask login out of automatic embedded-wallet creation", () => {
  const native: User = { ...user, identities: [{ ...identity, identity_data: {
    sub: `web3:ethereum:${signer.address}`,
    custom_claims: { chain: "ethereum", address: signer.address, network: "1", domain: "localhost:3005" },
  } }] };
  assert.equal(useEmbeddedWalletByDefault(native), false, "A MetaMask login must not default to creating a Privy wallet");
  assert.equal(walletAccountAddress(native), signer.address);
});

test("incomplete or unsupported wallet identities never turn into automatic Google/Privy onboarding", () => {
  for (const identity_data of [undefined, {}, { custom_claims: { chain: "solana", address: signer.address } }, { custom_claims: { chain: "ethereum", address: "invalid" } }]) {
    const native: User = { ...user, identities: [{ ...identity, identity_data }] };
    assert.equal(walletAccountAddress(native), "");
    assert.equal(useEmbeddedWalletByDefault(native), false);
    assert.equal(accountWalletMode(native, true), "external");
  }
  assert.equal(useEmbeddedWalletByDefault({ ...user, identities: undefined }), false);
});

test("wallet choice belongs to the current account and embedded wallets need its explicit choice or verified Google identity", () => {
  const google: User = { ...user, id: "another-account", identities: [{ ...identity, provider: "google" }] };
  assert.equal(accountWalletMode(google, true), "embedded");
  assert.equal(accountWalletMode(user, true, { owner: google.id, mode: "embedded" }), "external");
  assert.equal(accountWalletMode(user, true, { owner: user.id, mode: "embedded" }), "embedded");
  assert.equal(accountWalletMode(google, true, { owner: google.id, mode: "external" }), "external");
  assert.equal(accountWalletMode(user, false, { owner: user.id, mode: "embedded" }), "external");
  assert.equal(accountWalletMode({ ...user, is_anonymous: true }, true, { owner: user.id, mode: "embedded" }), "external");
});
test("a session change during the signature blocks the native login before it can replace that account", async () => {
  let changed = false, posted = false;
  const client = { auth: {
    getSession: async () => ({ data: { session: changed ? { user: { id: "another-account" } } : null }, error: null }),
    signInWithWeb3: async (credentials: { wallet: { request: (input: { method: string }) => Promise<unknown> } }) => {
      await credentials.wallet.request({ method: "personal_sign" });
      posted = true;
      throw new Error("must not submit a login after the account changed");
    },
  } } as unknown as SupabaseClient<Database>;
  await assert.rejects(startWalletLogin(client, { request: async () => { changed = true; return "fixture-signature"; } }, "http://localhost:3005/pilot"), /account changed while signing/);
  assert.equal(posted, false);
});
