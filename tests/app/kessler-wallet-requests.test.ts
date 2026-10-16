import assert from "node:assert/strict";
import test from "node:test";
import { id, Wallet, ZeroAddress } from "ethers";
import { createWalletRequestHandler, type RequestStore } from "../../src/lib/onchain/wallet-request-server.ts";
import { denialMessage, requestMessage, verifyWalletRequest, walletRequestApi, type WalletRequest, type WalletRequestProof } from "../../src/lib/onchain/wallet-requests.ts";
import { projectKey } from "../../src/lib/onchain/model.ts";
import { config as baseConfig, makers, moments } from "./release-fixtures.ts";

const maker = new Wallet(id("kessler request test maker")), curator = new Wallet(id("kessler request test curator"));
const config = { ...baseConfig, curator: curator.address }, now = 1792040000;
const roomId = "kessler-ward";
const proof: WalletRequestProof = { id: "40000000-0000-4000-8000-000000000001", moment_id: moments[3].id,
  maker_id: makers[3]!, wallet_address: maker.address, issued_at: now };

test("Kessler wallet ownership signatures bind its own project and cannot be replayed into Midnight", async () => {
  const message = requestMessage(proof, config, roomId);
  assert.ok(message.includes(projectKey(config.curator, roomId)), "Kessler request must name its own project");
  assert.notEqual(message, requestMessage(proof, config));
  const signature = await maker.signMessage(message);
  assert.equal(verifyWalletRequest(proof, signature, config, proof.maker_id, now, roomId).wallet_address, maker.address);
  assert.throws(() => verifyWalletRequest(proof, signature, config, proof.maker_id, now), /signature/);
  assert.throws(() => requestMessage(proof, config, "paper-moon"), /release room/);
});

test("the Kessler request handler scopes listing, submission and curator decisions to that project", async () => {
  let row: WalletRequest | null = null, writes = 0;
  const store: RequestStore = {
    open: async () => true, list: async () => row ? [row] : [], get: async () => row,
    submit: async payload => { writes++; return row = { ...payload, room_id: roomId, project_id: projectKey(config.curator, roomId),
      maker_label: "Tester", moment_title: "A real continuation", state: "pending", created_at: "2026-10-15T00:00:00Z", decided_at: null }; },
    decide: async (_id, state) => { writes++; return row = { ...row!, state }; },
  };
  const handler = createWalletRequestHandler({ roomId, config, store, actor: async () => proof.maker_id, maker: async () => ZeroAddress, now: () => now });
  const post = (body: unknown, room = roomId) => handler(new Request(`https://example.test/api/pilot/wallet-requests?room=${room}`, {
    method: "POST", headers: { Authorization: "Bearer guest-token" }, body: JSON.stringify(body),
  }));
  assert.equal((await handler(new Request(`https://example.test/api/pilot/wallet-requests?room=${roomId}`))).status, 200);
  assert.equal((await handler(new Request("https://example.test/api/pilot/wallet-requests?room=midnight-signal"))).status, 400);
  const signature = await maker.signMessage(requestMessage(proof, config, roomId));
  assert.equal((await post({ action: "submit", proof, signature })).status, 200);
  assert.equal(writes, 1);
  assert.equal((await post({ action: "deny", id: proof.id, issuedAt: now, signature: await curator.signMessage(denialMessage(row!, now, config)) })).status, 200);
  assert.equal(row!.state, "denied");
  assert.equal((await post({ action: "submit", proof, signature }, "midnight-signal")).status, 400);
  assert.equal(writes, 2);
  row = { ...row!, room_id: "midnight-signal", project_id: projectKey(config.curator, "midnight-signal") };
  assert.equal((await post({ action: "confirm", id: proof.id })).status, 404);
  assert.equal(writes, 2);
});

test("browser wallet-request reads and writes retain their selected room, with legacy Midnight defaults", async () => {
  const originalFetch = globalThis.fetch;
  const calls: { url: string; method: string }[] = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? "GET" });
    return Response.json({ requests: [] });
  };
  try {
    await walletRequestApi(undefined, undefined, undefined, roomId);
    await walletRequestApi({ action: "confirm", id: proof.id }, undefined, undefined, roomId);
    await walletRequestApi();
    await walletRequestApi({ action: "confirm", id: proof.id });
    assert.deepEqual(calls, [
      { url: "/api/pilot/wallet-requests?room=kessler-ward", method: "GET" },
      { url: "/api/pilot/wallet-requests?room=kessler-ward", method: "POST" },
      { url: "/api/pilot/wallet-requests?room=midnight-signal", method: "GET" },
      { url: "/api/pilot/wallet-requests", method: "POST" },
    ]);
    await assert.rejects(walletRequestApi(undefined, undefined, undefined, "paper-moon"), /release room/);
    assert.equal(calls.length, 4);
  } finally { globalThis.fetch = originalFetch; }
});
