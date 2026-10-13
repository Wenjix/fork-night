import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { loadMppAdapter, type MppAdapter, type MppChallenge } from "../../src/mpp/adapter.ts";
import { MPP_MEMO_TAG, TRANSFER_WITH_MEMO_TOPIC, memoMatcher, moderatoReader } from "../../src/mpp/chain.ts";
import { createChargePort, roomTagFor } from "../../src/mpp/charge.ts";
import { handleMppFunding, type PresentedCharge } from "../../src/mpp/funding.ts";
import { MPP_REALM, PATHUSD, TRANSFER_WITH_MEMO_SELECTOR, mppIntentId, mppRecordPaths, mppRefillRequestId } from "../../src/mpp/ids.ts";
import { fundMppRoom, resumeMppAttempt } from "../../src/mpp/payer.ts";
import { AGENT_TOKEN_HEADER } from "../../src/x402/config.ts";
import { uuidv5 } from "../../src/x402/ids.ts";
import { blockNetwork, CHALLENGE_KEY, PAY_TO, REF, doorConfig, doorRooms, fakeModerato, mppRequest } from "./mpp-fakes.ts";
import { memoryLedger, memoryStore } from "./x402-fakes.ts";

blockNetwork();

// Offline smoke test of the REAL isolated adapter (vendor/mpp-adapter: mppx 0.13.4, viem 2.57.3) on a scripted
// Moderato. It runs when the adapter is installed (cd vendor/mpp-adapter && pnpm install --frozen-lockfile) and is
// skipped otherwise; every other MPP test uses the stand-in in mpp-fakes.ts.
const path = fileURLToPath(new URL("../../vendor/mpp-adapter/index.mjs", import.meta.url));
let adapter: MppAdapter | null = null;
let missing = "";
try { adapter = await loadMppAdapter(path); } catch (error) { missing = (error as Error).message; }
const smoke = (name: string, run: (t: TestContext, adapter: MppAdapter) => Promise<void>) =>
  test(name, adapter ? {} : { skip: `the isolated MPP adapter is not installed: ${missing}` }, (t) => run(t, adapter!));
const room = doorRooms()[REF];

function setup(real: MppAdapter) {
  const chain = fakeModerato(real);
  const port = createChargePort(doorConfig(), { challengeKey: CHALLENGE_KEY, adapter: real, rpc: chain.request });
  const account = real.accountFromKey(`0x${"11".repeat(32)}`);
  const sign = (challenge: MppChallenge) =>
    real.createPayment({ account, challenge, expectedRecipient: PAY_TO, request: chain.request }).then((paid) => paid.credential);
  const offered = async () => real.parseChallengeHeader((await port.offer(room)).header);
  const presented = async (credential: string) => {
    const charge = await port.present(credential, room);
    assert(!("invalid" in charge), JSON.stringify(charge));
    return charge as PresentedCharge;
  };
  return { chain, port, account, sign, offered, presented };
}

smoke("the installed adapter is the reviewed one, and its keccak256 matches the reader's constants", async (_t, real) => {
  assert.deepEqual(real.versions, { mppx: "0.13.4", viem: "2.57.3" });
  assert.equal(real.chainId, 42431);
  assert.equal(real.keccakUtf8("TransferWithMemo(address,address,uint256,bytes32)"), TRANSFER_WITH_MEMO_TOPIC);
  assert.equal(real.keccakUtf8("mpp").slice(2, 10), MPP_MEMO_TAG);
  assert.equal(real.keccakUtf8("transferWithMemo(address,uint256,bytes32)").slice(0, 10), TRANSFER_WITH_MEMO_SELECTOR);
  const key = real.generatePrivateKey();
  assert.match(real.addressOf(key), /^0x[0-9a-fA-F]{40}$/);
  const account = real.accountFromKey(key);
  assert.equal(account.address, real.addressOf(key));
  assert(!JSON.stringify(account).includes(key.slice(2)), "an account never shows its key");
  assert.throws(() => real.addressOf("0x1234"), /not a valid secp256k1 private key/);
  // The faucet call is plain JSON-RPC through the adapter's client.
  const asked: unknown[] = [];
  const hashes = await real.faucet({ address: account.address, request: async ({ method, params }) => {
    asked.push([method, params]);
    return [`0x${"12".repeat(32)}`, "not-a-hash"];
  } });
  assert.deepEqual(hashes, [`0x${"12".repeat(32)}`]);
  assert.deepEqual(asked, [["tempo_fundAddress", [account.address]]]);
});

smoke("a real mppx credential presents offline, and its memo binds this realm and challenge", async (_t, real) => {
  const { chain, sign, offered, presented, account } = setup(real);
  const challenge = await offered();
  assert.deepEqual(challenge.request, { amount: "1000000", currency: PATHUSD, methodDetails: { chainId: 42431, supportedModes: ["pull"] }, recipient: PAY_TO });
  const credential = await sign(challenge);
  chain.calls.length = 0;
  const charge = await presented(credential);
  assert.deepEqual(chain.calls, []);
  assert.equal(charge.payer, account.address.toLowerCase());
  const decoded = await real.decodeTransaction(charge.signedTransaction);
  assert.equal(decoded.hash, charge.transaction);
  assert.equal(decoded.calls.length, 1);
  const memo = `0x${decoded.calls[0].data.slice(138, 202)}`;
  assert(decoded.calls[0].data.startsWith("0x95777d59"), "one transferWithMemo call");
  assert(memoMatcher(MPP_REALM, challenge.id, real.keccakUtf8)(memo), "mppx's memo binds the realm and challenge");
  assert(!memoMatcher("another-realm", challenge.id, real.keccakUtf8)(memo));
  assert(!memoMatcher(MPP_REALM, "another-challenge", real.keccakUtf8)(memo));
  // The room tag travels in the HMAC-bound opaque field; mppx refuses it on another route.
  assert.equal(JSON.parse(Buffer.from(String(challenge.opaque), "base64url").toString()).r, roomTagFor(CHALLENGE_KEY, "lighthouse"));
  assert.match((await port(real).present(credential, doorRooms()["ref_paper_moon_bbbbbbbbbbbbbb"]) as { invalid: string }).invalid, /different funding link/);
});
const port = (real: MppAdapter) => createChargePort(doorConfig(), { challengeKey: CHALLENGE_KEY, adapter: real, rpc: fakeModerato(real).request });

smoke("verify and settle map real mppx outcomes: revert, outage, success, replay, lost answer, rejection, expiry", async (_t, real) => {
  const { chain, port: door, sign, offered, presented } = setup(real);
  const charge = await presented(await sign(await offered()));
  assert.deepEqual(await door.verify(charge), { valid: true });
  chain.setSimulation(Object.assign(new Error("execution reverted: TIP20 token error: InsufficientBalance"), { code: 3, data: "0x" }));
  const reverted = await door.verify(charge);
  assert.equal(reverted.valid, false);
  assert.match((reverted as { reason: string }).reason, /reverted.*InsufficientBalance/);
  chain.setSimulation(new TypeError("fetch failed"));
  await assert.rejects(door.verify(charge), /Could not validate the payment/);
  chain.setSimulation(null);

  const settled = await door.settle(charge);
  assert.equal(settled.kind, "settled");
  assert.equal((settled as { transaction: string }).transaction, charge.transaction);
  assert.equal(real.readReceiptHeader((settled as { receiptHeader: string }).receiptHeader)?.reference, charge.transaction);
  assert.equal(chain.sentRaw.length, 1);
  const again = await door.settle(charge);
  assert.deepEqual([again.kind, (again as { transaction: string | null }).transaction], ["pending", null]);
  assert.match((again as { reason: string }).reason, /already been used/);
  for (const mode of ["land-then-timeout", "reject"] as const) {
    chain.setBroadcast(mode);
    const next = await presented(await sign(await offered()));
    const result = await door.settle(next);
    assert.deepEqual([result.kind, (result as { transaction: string | null }).transaction], ["pending", next.transaction], mode);
  }
  chain.setBroadcast("land");
  const server = real.createChargeServer({ secretKey: CHALLENGE_KEY, realm: MPP_REALM, currency: PATHUSD, recipient: PAY_TO, chainId: 42431, request: chain.request });
  const past = real.parseChallengeHeader((await server.challenge({
    amount: "1", meta: { r: roomTagFor(CHALLENGE_KEY, "lighthouse") }, expires: new Date(Date.now() - 5_000).toISOString(),
  })).header);
  const sent = chain.sentRaw.length;
  const expired = await door.settle(await presented(await sign(past)));
  assert.equal(expired.kind, "failed");
  assert.match((expired as { reason: string }).reason, /expired/i);
  assert.equal(chain.sentRaw.length, sent);
});

smoke("the door on the real adapter credits once, refuses a second transfer for one challenge, and resumes a lost answer", async (_t, real) => {
  const { chain, port: door, sign } = setup(real);
  const storage = memoryStore(), ledger = memoryLedger();
  const deps = {
    rooms: doorRooms(5), charges: door, chain: moderatoReader({ rpc: chain.rpc, keccak: real.keccakUtf8, sleep: async () => {}, spacingMs: 0 }),
    store: storage.store, ledger: ledger.ledger,
  };
  const challengeOf = (response: Response) => real.parseChallengeHeader(response.headers.get("WWW-Authenticate") ?? "");
  const post = (authorization?: string) => handleMppFunding(mppRequest(REF, undefined, authorization ? { headers: { authorization } } : {}), REF, deps);
  const challenge = challengeOf(await post());
  const credential = await sign(challenge);
  const paid = await post(credential);
  assert.equal(paid.status, 200, JSON.stringify(await paid.clone().json()));
  const hash = (await real.decodeTransaction((real.readCredential(credential)!.payload as { signature: string }).signature)).hash;
  assert.equal((await paid.json()).transaction, hash);
  assert.equal(real.readReceiptHeader(paid.headers.get("Payment-Receipt"))?.reference, hash);
  assert.deepEqual([...ledger.refills.keys()], [uuidv5(`eip155:42431:${hash}`)]);
  assert.equal(mppRefillRequestId(hash.toUpperCase().replace(/^0X/, "0x")), uuidv5(`eip155:42431:${hash}`));
  assert.equal((await post(await sign(challenge))).status, 409, "hazard A: a second transfer for one challenge");
  const replay = await post(credential);
  assert.equal(replay.status, 200, "hazard B: answered from the receipt");
  assert.equal((await replay.json()).replayed, true);
  assert.equal(chain.sentRaw.length, 1);

  chain.setBroadcast("land-then-timeout");
  const late = await sign(challengeOf(await post()));
  const timedOut = await post(late);
  assert.equal(timedOut.status, 202, "hazard C: the answer was lost after the send");
  assert.equal(timedOut.headers.get("WWW-Authenticate"), null);
  chain.setBroadcast("land");
  assert.equal((await post(late)).status, 200);
  assert.equal(chain.sentRaw.length, 2);
  assert.equal(ledger.refills.size, 2);
  assert.equal(storage.json(mppRecordPaths(mppIntentId(real.readCredential(late)!.challenge.id), "lighthouse").settlement).via, "chain");
});

smoke("the patron agent pays the door over loopback with the real adapter, and a lost answer is resumed unsigned", async (t, real) => {
  const { chain, port: door } = setup(real);
  const storage = memoryStore(), ledger = memoryLedger();
  const deps = { rooms: doorRooms(5), charges: door, chain: moderatoReader({ rpc: chain.rpc, keccak: real.keccakUtf8, sleep: async () => {}, spacingMs: 0 }), store: storage.store, ledger: ledger.ledger };
  const token = Buffer.alloc(32, 6).toString("base64url");
  const server = createServer(async (incoming, outgoing) => {
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) if (typeof value === "string") headers.set(name, value);
    const response = headers.get(AGENT_TOKEN_HEADER) === token
      ? await handleMppFunding(new Request(`http://${incoming.headers.host}${incoming.url}`, { method: incoming.method, headers }), REF, deps)
      : Response.json({ error: "Not found." }, { status: 404 });
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const recordDir = await mkdtemp(join(tmpdir(), "mpp-adapter-payments-"));
  t.after(() => rm(recordDir, { recursive: true, force: true }));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/mpp/fund/${REF}`;
  const account = real.accountFromKey(`0x${"77".repeat(32)}`);

  const credited = await fundMppRoom({ url, recordDir, agentToken: token, adapter: real, account, expected: { payTo: PAY_TO, currency: PATHUSD }, rpc: chain.request });
  assert.equal(credited.outcome, "credited", credited.message);
  chain.setBroadcast("land-then-timeout");
  const pending = await fundMppRoom({ url, recordDir, agentToken: token, adapter: real, account, expected: { payTo: PAY_TO }, rpc: chain.request });
  assert.equal(pending.outcome, "pending", pending.message);
  chain.setBroadcast("land");
  const resumed = await resumeMppAttempt(pending.recordFile!, { agentToken: token });
  assert.equal(resumed.outcome, "credited", resumed.message);
  assert.equal(chain.sentRaw.length, 2);
  assert.equal(ledger.refills.size, 2);
  assert.equal((await readdir(recordDir)).length, 2);
});

// Review fixes (12 October).

smoke("key errors never repeat key material, for an address or a signer", async (_t, real) => {
  // At or above the curve order, and zero: well-formed hex that is not a valid secp256k1 key.
  for (const key of [`0x${"ff".repeat(32)}`, `0x${"00".repeat(32)}`]) {
    for (const [name, use] of [["addressOf", real.addressOf], ["accountFromKey", real.accountFromKey]] as const) {
      assert.throws(() => use(key), (error: Error) => {
        assert.equal(error.message, "not a valid secp256k1 private key", `${name}(${key.slice(0, 6)}…)`);
        return true;
      });
    }
  }
});

smoke("the adapter resolves every module inside vendor/mpp-adapter, never the app's own packages", async (t) => {
  const folder = pathToFileURL(`${realpathSync(dirname(path))}/`).href;
  const out = join(await mkdtemp(join(tmpdir(), "mpp-adapter-resolve-")), "resolved.json");
  t.after(() => rm(dirname(out), { recursive: true, force: true }));
  const hook = `data:text/javascript,${encodeURIComponent(`import { registerHooks } from "node:module";
    import { writeFileSync } from "node:fs";
    const seen = new Set();
    registerHooks({ resolve(specifier, context, next) { const result = next(specifier, context); seen.add(result.url); return result; } });
    process.on("exit", () => { writeFileSync(process.env.RESOLVED_OUT, JSON.stringify([...seen])); });`)}`;
  await promisify(execFile)(process.execPath,
    ["--import", hook, "--input-type=module", "-e", `const adapter = await import(${JSON.stringify(pathToFileURL(path).href)}); if (adapter.chainId !== 42431) process.exit(3);`],
    { cwd: dirname(path), env: { PATH: process.env.PATH ?? "", RESOLVED_OUT: out } as unknown as NodeJS.ProcessEnv });
  const resolved = JSON.parse(await readFile(out, "utf8")) as string[];
  assert(resolved.length > 100, `only ${resolved.length} modules resolved`);
  const outside = resolved.filter((url) => !url.startsWith("node:") && !url.startsWith(folder));
  assert.deepEqual(outside, [], "every package the adapter loads comes from its own node_modules");
  assert(resolved.some((url) => url.includes("/node_modules/.pnpm/mppx@0.13.4")), "mppx came from the adapter's store");
});

smoke("the adapter's own RPC transport calls only the fixed Moderato URL and never follows a redirect", async (t, real) => {
  assert.equal(real.rpcUrl, "https://rpc.moderato.tempo.xyz");
  const seen: [string, RequestRedirect | undefined][] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    seen.push([new URL(String(input instanceof Request ? input.url : input)).href, init?.redirect]);
    return Response.json({ jsonrpc: "2.0", id: 1, result: [] });
  });
  assert.deepEqual(await real.faucet({ address: `0x${"12".repeat(20)}` }), []);
  assert.deepEqual(seen, [["https://rpc.moderato.tempo.xyz/", "error"]]);
});

smoke("a payment that names a sender in its fee-payer slot counts as sponsored, so present() refuses it before any record", async (_t, real) => {
  // ox takes `from` from a Tempo envelope's fee-payer slot when that slot holds an address (the "a fee payer will
  // sign" form), without recovering it from the signature. Such a payment must never present as unsponsored.
  const { TxEnvelopeTempo } = createRequire(realpathSync(join(dirname(path), "node_modules/viem/package.json")))("ox/tempo");
  const { port: charges, sign, offered } = setup(real);
  const credential = await sign(await offered());
  const wire = JSON.parse(Buffer.from(credential.replace(/^Payment\s+/, ""), "base64url").toString("utf8"));
  assert.equal((await real.decodeTransaction(wire.payload.signature)).sponsored, false, "a stock payment is unsponsored");
  const claimed = `0x${"be".repeat(20)}`;
  const spoofed = TxEnvelopeTempo.serialize(TxEnvelopeTempo.deserialize(wire.payload.signature), { sender: claimed });
  const decoded = await real.decodeTransaction(spoofed);
  assert.equal(decoded.from?.toLowerCase(), claimed, "the claimed sender is read, not recovered");
  assert.equal(decoded.sponsored, true);
  const forged = `Payment ${Buffer.from(JSON.stringify({ ...wire, payload: { type: "transaction", signature: spoofed }, source: `did:pkh:eip155:42431:${claimed}` })).toString("base64url")}`;
  assert.deepEqual(await charges.present(forged, room), { invalid: "Only an unsponsored Tempo transaction is accepted." });
});
