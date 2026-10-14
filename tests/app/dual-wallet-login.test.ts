import assert from "node:assert/strict";
import test from "node:test";
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { getBase58Decoder } from "@solana/kit";
import { createClient, type SolanaWallet, type SupabaseClient, type User } from "@supabase/supabase-js";
import { startWalletLogin, useEmbeddedWalletByDefault, walletAccountAddress } from "../../src/lib/supabase/wallet-login.ts";
import type { Database } from "../../src/lib/supabase/database.types.ts";

const seed = createHash("sha256").update("Fork Night Solana login test fixture only").digest();
const key = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]), format: "der", type: "pkcs8" });
const publicKey = createPublicKey(key);
const address = getBase58Decoder().decode(publicKey.export({ format: "der", type: "spki" }).subarray(-32));
const user: User = {
  id: "20000000-0000-4000-8000-000000000092", is_anonymous: false, aud: "authenticated",
  created_at: "2026-10-13T10:00:00Z", app_metadata: { provider: "web3" }, user_metadata: {},
  identities: [{ id: "solana-fixture", identity_id: "solana-fixture", user_id: "20000000-0000-4000-8000-000000000092", provider: "web3",
    identity_data: { custom_claims: { chain: "solana", address, network: "devnet" } } }],
};

function fixture(responseError?: { code: string; message: string }) {
  const requests: Record<string, unknown>[] = [];
  const client = createClient<Database>("https://wallet-auth.invalid", "public-fixture", {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      assert.equal(String(input), "https://wallet-auth.invalid/auth/v1/token?grant_type=web3");
      const body = JSON.parse(String(init?.body)); requests.push(body);
      if (responseError) return Response.json({ error_code: responseError.code, msg: responseError.message }, { status: 400 });
      assert.equal(body.chain, "solana");
      assert.ok(verify(null, Buffer.from(body.message), publicKey, Buffer.from(body.signature, "base64url")), "Auth receives a verifiable Ed25519 signature");
      const token = ["{}", JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 }), "fixture"].map(value => Buffer.from(value).toString("base64url")).join(".");
      return Response.json({ access_token: token, refresh_token: "fixture-refresh", token_type: "bearer", expires_in: 3600, user });
    } },
  });
  return { client, requests };
}

test("Phantom-style connect and signMessage authenticates on Solana devnet through the real SDK", async () => {
  const h = fixture();
  let connected = false;
  const wallet = {
    publicKey: null as { toBase58: () => string } | null,
    connect: async () => { connected = true; wallet.publicKey = { toBase58: () => address }; return { publicKey: wallet.publicKey }; },
    signMessage: async (message: Uint8Array) => {
      assert.equal(connected, true, "Connect before signing");
      return { signature: new Uint8Array(sign(null, message, key)), publicKey: wallet.publicKey! };
    },
  };
  const result = await startWalletLogin(h.client, wallet, "https://fork-night.vercel.app/pilot?room=midnight-signal#access_token=PRIVATE", "solana");
  assert.equal(result.id, user.id);
  assert.equal(walletAccountAddress(result), address);
  assert.equal(useEmbeddedWalletByDefault(result), false);
  assert.equal((await h.client.auth.getSession()).data.session?.user.id, user.id);
  assert.match(String(h.requests[0].message), /Chain ID: devnet/);
  assert.match(String(h.requests[0].message), /URI: https:\/\/fork-night.vercel.app\/pilot/);
  assert.doesNotMatch(String(h.requests[0].message), /PRIVATE|room=/);
});

test("native Solana signIn preserves its provider binding and devnet input", async () => {
  const h = fixture();
  const wallet = {
    signIn: async function(input: Parameters<NonNullable<SolanaWallet["signIn"]>>[0]) {
      assert.equal(this, wallet);
      assert.equal(input.domain, "fork-night.vercel.app");
      assert.equal(input.chainId, "devnet");
      const message = new TextEncoder().encode(`${input.domain} wants you to sign in with your Solana account:\n${address}\n\n${input.statement}\n\nURI: ${input.uri}\nVersion: 1\nChain ID: ${input.chainId}\nIssued At: ${input.issuedAt}\nExpiration Time: ${input.expirationTime}`);
      return { account: { address, publicKey: new Uint8Array(publicKey.export({ format: "der", type: "spki" }).subarray(-32)), chains: ["solana:devnet"] as const, features: ["solana:signIn"] as const }, signedMessage: message, signature: new Uint8Array(sign(null, message, key)) };
    },
  };
  assert.equal((await startWalletLogin(h.client, wallet, "https://fork-night.vercel.app/pilot", "solana")).id, user.id);
  assert.equal(h.requests.length, 1);
});

test("a pending Ethereum connection has a useful error even when the real SDK masks the provider exception", async () => {
  const h = fixture();
  const wallet = { request: async () => { throw Object.assign(new Error("PRIVATE_PROVIDER_DETAILS"), { code: -32002 }); } };
  await assert.rejects(startWalletLogin(h.client, wallet, "https://fork-night.vercel.app/pilot"), error => {
    assert.match(String(error), /request is already open/i);
    assert.doesNotMatch(String(error), /PRIVATE_PROVIDER_DETAILS/);
    return true;
  });
  assert.equal(h.requests.length, 0);
  assert.equal((await h.client.auth.getSession()).data.session, null);
});

test("the disabled Solana provider and an invalid live domain have distinct setup errors", async () => {
  for (const code of ["web3_provider_disabled", "validation_failed"]) {
    const h = fixture({ code, message: code === "validation_failed" ? "URI domain is not allowed: PRIVATE" : "PRIVATE" });
    const wallet = { publicKey: { toBase58: () => address }, signMessage: async (message: Uint8Array) => new Uint8Array(sign(null, message, key)) };
    await assert.rejects(startWalletLogin(h.client, wallet, "https://fork-night.vercel.app/pilot", "solana"), error => {
      assert.match(String(error), code === "validation_failed" ? /live URL.*Supabase/i : /Solana.*setup/i);
      assert.doesNotMatch(String(error), /PRIVATE/);
      return true;
    });
    assert.equal((await h.client.auth.getSession()).data.session, null);
  }
});

test("a session change during Solana signing stops the login before submission", async () => {
  let changed = false, posted = false;
  const client = { auth: {
    getSession: async () => ({ data: { session: changed ? { user: { id: "another-maker" } } : null }, error: null }),
    signInWithWeb3: async (credentials: { wallet: SolanaWallet }) => {
      await credentials.wallet.signMessage!(new Uint8Array([1, 2, 3]));
      posted = true;
      throw new Error("Must not post after a session change");
    },
  } } as unknown as SupabaseClient<Database>;
  const wallet = { publicKey: { toBase58: () => address }, signMessage: async () => { changed = true; return new Uint8Array(64); } };
  await assert.rejects(startWalletLogin(client, wallet, "https://fork-night.vercel.app/pilot", "solana"), /account changed while signing/);
  assert.equal(posted, false);
});
