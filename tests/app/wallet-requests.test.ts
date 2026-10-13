import assert from "node:assert/strict";
import test from "node:test";
import { id, Wallet, ZeroAddress } from "ethers";
import { createWalletRequestHandler, type RequestStore } from "../../src/lib/onchain/wallet-request-server.ts";
import { denialMessage, requestMessage, RequestProblem, signWalletMessage, verifyWalletRequest, type WalletRequest, type WalletRequestProof } from "../../src/lib/onchain/wallet-requests.ts";
import { projectKey } from "../../src/lib/onchain/model.ts";
import { config as baseConfig, makers, moments } from "./release-fixtures.ts";

const curator = new Wallet(id("fork-night test curator")), maker = new Wallet(id("fork-night test maker"));
const config = { ...baseConfig, curator: curator.address };
const now = 1791820000;
const proof: WalletRequestProof = { id: "10000000-0000-4000-8000-000000000020", maker_id: makers[3]!, moment_id: moments[3].id, wallet_address: maker.address, issued_at: now };
function harness({ open = true } = {}) {
  const records = new Map<string, WalletRequest>(); let recorded = ZeroAddress, writes = 0, chainReads = 0;
  const store: RequestStore = {
    open: async () => open, list: async () => [...records.values()], get: async key => records.get(key) ?? null,
    submit: async payload => {
      if (payload.moment_id !== moments[3].id || payload.maker_id !== makers[3]) throw new RequestProblem("Choose your own published scene.", 409);
      if (records.has(payload.id)) return records.get(payload.id)!;
      writes++;
      const row: WalletRequest = { ...payload, room_id: "midnight-signal", project_id: projectKey(config.curator, "midnight-signal"),
        maker_label: "Tester", moment_title: moments[3].title, state: "pending", created_at: new Date(now * 1000).toISOString(), decided_at: null };
      records.set(row.id, row); return row;
    },
    decide: async (key, state) => { const row = records.get(key)!; writes++; const next = { ...row, state }; records.set(key, next); return next; },
  };
  const handler = createWalletRequestHandler({ config, store, actor: async token => token === "maker-token" ? makers[3]! : null,
    maker: async () => { chainReads++; return recorded; }, now: () => now });
  const post = (body: unknown, token = "maker-token") => handler(new Request("http://localhost/api/pilot/wallet-requests", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
  }));
  return { handler, post, records, get writes() { return writes; }, get chainReads() { return chainReads; }, approve: () => { recorded = maker.address; } };
}
test("an authenticated maker signs its actual wallet and publishes one request; replay keeps the original", async () => {
  const h = harness(), signature = await maker.signMessage(requestMessage(proof, config));
  const input = { action: "submit", proof, signature };
  assert.equal((await h.post(input)).status, 200);
  assert.equal((await h.post(input)).status, 200);
  assert.equal(h.writes, 1);
  const list = await h.handler(new Request("http://localhost/api/pilot/wallet-requests?room=midnight-signal"));
  const { requests } = await list.json();
  assert.equal(requests[0].wallet_address, maker.address);
  assert.equal(requests[0].maker_label, "Tester");
});
test("requester identity, requested wallet, source scene and project are covered by the signature", async () => {
  const signature = await maker.signMessage(requestMessage(proof, config));
  const h = harness();
  assert.equal((await h.post({ action: "submit", proof, signature }, "bad-token")).status, 401);
  assert.equal((await h.post({ action: "submit", proof: { ...proof, maker_id: makers[1] }, signature })).status, 403);
  assert.equal((await h.post({ action: "submit", proof: { ...proof, wallet_address: curator.address }, signature })).status, 403);
  assert.equal((await h.post({ action: "submit", proof: { ...proof, moment_id: moments[1].id }, signature })).status, 403);
  assert.throws(() => verifyWalletRequest(proof, signature, { ...config, address: curator.address }, makers[3]!, now));
  assert.equal(h.writes, 0);
});
test("expired signatures and requests for a closed room cannot create a pending request", async () => {
  const h = harness(), stale = { ...proof, issued_at: now - 301 };
  assert.equal((await h.post({ action: "submit", proof: stale, signature: await maker.signMessage(requestMessage(stale, config)) })).status, 400);
  assert.equal(h.writes, 0);
  const closed = harness({ open: false });
  assert.equal((await closed.post({ action: "submit", proof, signature: await maker.signMessage(requestMessage(proof, config)) })).status, 404);
  assert.equal((await closed.handler(new Request("http://localhost/api/pilot/wallet-requests?room=midnight-signal"))).status, 404);
  assert.equal(closed.writes, 0);
  assert.equal(closed.chainReads, 0);
});
test("a correctly signed request still needs a published scene owned by the authenticated maker", async () => {
  const h = harness(), otherScene = { ...proof, moment_id: moments[1].id };
  assert.equal((await h.post({ action: "submit", proof: otherScene, signature: await maker.signMessage(requestMessage(otherScene, config)) })).status, 409);
  assert.equal(h.writes, 0);
});
test("an already approved maker cannot request a replacement payout wallet", async () => {
  const h = harness(); h.approve();
  assert.equal((await h.post({ action: "submit", proof, signature: await maker.signMessage(requestMessage(proof, config)) })).status, 409);
  assert.equal(h.writes, 0);
});
test("denial requires the configured curator signature over the exact pending request", async () => {
  const h = harness(); await h.post({ action: "submit", proof, signature: await maker.signMessage(requestMessage(proof, config)) });
  const row = h.records.get(proof.id)!;
  const input = { action: "deny", id: row.id, issuedAt: now };
  assert.equal((await h.post({ ...input, signature: await maker.signMessage(denialMessage(row, now, config)) })).status, 403);
  assert.equal(h.records.get(row.id)?.state, "pending");
  assert.equal((await h.post({ ...input, signature: await curator.signMessage(denialMessage(row, now, config)) })).status, 200);
  assert.equal(h.records.get(row.id)?.state, "denied");
});
test("approval status follows verified onchain maker state, and denial cannot revoke that approval", async () => {
  const h = harness(); await h.post({ action: "submit", proof, signature: await maker.signMessage(requestMessage(proof, config)) });
  assert.equal((await h.post({ action: "confirm", id: proof.id })).status, 409);
  assert.equal(h.records.get(proof.id)?.state, "pending");
  h.approve();
  const row = h.records.get(proof.id)!;
  assert.equal((await h.post({ action: "deny", id: proof.id, issuedAt: now, signature: await curator.signMessage(denialMessage(row, now, config)) })).status, 200);
  assert.equal(h.records.get(proof.id)?.state, "approved");
});
test("a denial cannot be replayed against another request, wallet, project or signature purpose", async () => {
  const h = harness(); await h.post({ action: "submit", proof, signature: await maker.signMessage(requestMessage(proof, config)) });
  const row = h.records.get(proof.id)!, input = { action: "deny", id: row.id, issuedAt: now };
  for (const message of [
    denialMessage({ ...row, id: "10000000-0000-4000-8000-000000000021" }, now, config),
    denialMessage({ ...row, wallet_address: curator.address }, now, config),
    denialMessage(row, now, { ...config, chainId: config.chainId === 10143 ? 31337 : 10143 }),
    requestMessage({ ...proof, wallet_address: curator.address }, config),
  ]) assert.equal((await h.post({ ...input, signature: await curator.signMessage(message) })).status, 403);
  assert.equal(h.records.get(row.id)?.state, "pending");
  assert.equal(h.writes, 1);
});
test("unfunded wallets can sign a request, while a changed account or network cannot sign it", async () => {
  const calls: string[] = [];
  const provider = { request: async ({ method }: { method: string }) => {
    calls.push(method);
    if (method === "eth_chainId") return `0x${config.chainId.toString(16)}`;
    if (method === "eth_accounts") return [maker.address];
    if (method === "personal_sign") return maker.signMessage(requestMessage(proof, config));
    throw new Error(`Unexpected wallet method: ${method}`);
  } };
  const signature = await signWalletMessage(provider, maker.address, requestMessage(proof, config), config.chainId);
  assert.equal(verifyWalletRequest(proof, signature, config, makers[3]!, now).wallet_address, maker.address);
  assert.equal(calls.includes("eth_getBalance"), false);
  assert.equal(calls.includes("eth_sendTransaction"), false);
  await assert.rejects(signWalletMessage(provider, curator.address, requestMessage(proof, config), config.chainId), /wallet or network changed/);
  await assert.rejects(signWalletMessage(provider, maker.address, requestMessage(proof, config), 1), /wallet or network changed/);
});
test("malformed and oversized requests fail before any storage mutation", async () => {
  const h = harness();
  const response = await h.handler(new Request("http://localhost/api/pilot/wallet-requests", { method: "POST", body: "x".repeat(4097) }));
  assert.equal(response.status, 413);
  assert.equal((await h.post({ action: "submit", proof: { ...proof, wallet_address: ZeroAddress }, signature: "invalid" })).status, 400);
  assert.equal((await h.post({ action: "unknown" })).status, 400);
  assert.equal(h.writes, 0);
  assert.equal(h.chainReads, 0);
});
