import assert from "node:assert/strict";
import test from "node:test";
import { transactionStorageKey, type ReleaseClient, type StoragePort, type WalletProvider } from "../../src/lib/onchain/client.ts";
import { prepareRelease } from "../../src/lib/onchain/model.ts";
import { ReleaseSession } from "../../src/lib/onchain/session.ts";
import { config, curator, makerWallet, moments, prepared, snapshot, transactionHash } from "./release-fixtures.ts";

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
class Wallet implements WalletProvider {
  account = curator;
  chainId: number = config.chainId;
  listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  async request({ method }: { method: string }) {
    if (method === "eth_accounts") return [this.account];
    if (method === "eth_chainId") return `0x${this.chainId.toString(16)}`;
    throw new Error(`Unexpected wallet request: ${method}`);
  }
  on(event: string, listener: (...args: unknown[]) => void) {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener); this.listeners.set(event, listeners);
  }
  removeListener(event: string, listener: (...args: unknown[]) => void) { this.listeners.get(event)?.delete(listener); }
  emit(event: string) { this.listeners.get(event)?.forEach(listener => listener()); }
}
function harness() {
  const wallet = new Wallet(), records = new Map<string, string>();
  const storage: StoragePort = { getItem: key => records.get(key) ?? null, setItem: (key, value) => { records.set(key, value); }, removeItem: key => { records.delete(key); } };
  let destroyed = 0;
  const calls: { operation: string; args: unknown[] }[] = [];
  const client: Pick<ReleaseClient, "load" | "verify" | "connect" | "execute" | "recover" | "retry" | "destroy"> = {
    load: async () => snapshot(), verify: async () => {},
    connect: async () => ({ browser: undefined as never, account: wallet.account }),
    execute: async (...args) => { calls.push({ operation: "execute", args }); return transactionHash; },
    recover: async (...args) => { calls.push({ operation: "recover", args }); return { complete: false, hash: undefined }; },
    retry: async (...args) => { calls.push({ operation: "retry", args }); return transactionHash; },
    destroy: () => { destroyed++; },
  };
  const session = new ReleaseSession(prepared, config, client, { wallet: () => wallet, storage: () => storage });
  return { session, client, wallet, storage, records, calls, destroyed: () => destroyed };
}

test("a wrapped Privy insufficient-balance rejection explains gas funding without exposing the signed request", async t => {
  const h = harness(), key = transactionStorageKey(config, curator, prepared.projectId);
  t.after(() => h.session.stop());
  const details = "Missing or invalid parameters. Request body: eth_sendRawTransaction 0xSIGNED_REQUEST. Details: Signer had insufficient balance. Version: viem@2.56.5";
  h.client.execute = async (...args) => {
    h.calls.push({ operation: "execute", args }); h.records.set(key, "saved registration");
    throw Object.assign(new Error(`could not coalesce error (${details})`), {
      code: "UNKNOWN_ERROR", error: { code: -32000, message: details },
    });
  };
  h.session.start(); await h.session.connect(); h.session.accept(true);
  await h.session.perform("register", 3);
  assert.match(h.session.getSnapshot().error, /test MON.*gas/);
  assert.doesNotMatch(h.session.getSnapshot().error, /coalesce|sendRawTransaction|SIGNED_REQUEST|viem/);
  assert.equal(h.session.getSnapshot().pending, true);
  await h.session.recover();
  assert.equal(h.calls.filter(call => call.operation === "execute").length, 1);
  assert.equal(h.session.getSnapshot().pending, true);
  assert.match(h.session.getSnapshot().notice, /Retry saved action/);
});

test("other wrapped wallet failures hide request data without inventing a funding problem", async t => {
  const h = harness(); t.after(() => h.session.stop());
  h.client.execute = async () => { throw Object.assign(new Error("could not coalesce error: eth_sendRawTransaction 0xSIGNED_REQUEST"), {
    code: "UNKNOWN_ERROR", error: { code: -32000, message: "Missing or invalid parameters." },
  }); };
  h.session.start(); await h.session.connect();
  await h.session.perform("support");
  assert.match(h.session.getSnapshot().error, /Check any saved action/);
  assert.doesNotMatch(h.session.getSnapshot().error, /coalesce|sendRawTransaction|SIGNED_REQUEST|test MON/);
});

test("a saved action with a transaction hash asks for confirmation before a retry", async t => {
  const h = harness(); t.after(() => h.session.stop());
  h.records.set(transactionStorageKey(config, curator, prepared.projectId), "submitted action");
  h.client.recover = async () => ({ complete: false, hash: transactionHash });
  h.session.start(); await h.session.connect(); await h.session.recover();
  assert.equal(h.session.getSnapshot().receipt, transactionHash);
  assert.match(h.session.getSnapshot().notice, /Check its receipt/);
  assert.doesNotMatch(h.session.getSnapshot().notice, /Retry saved action/);
  assert.equal(h.session.getSnapshot().pending, true);
});

test("switching between embedded and external providers clears account and release consent", async t => {
  const h = harness();
  let selected: WalletProvider | undefined = h.wallet;
  const session = new ReleaseSession(prepared, config, h.client, { wallet: () => selected, storage: () => h.storage });
  t.after(() => session.stop());
  session.start(); await flush(); await session.connect(); session.accept(true);
  assert.equal(session.getSnapshot().accepted, true);
  const embedded = new Wallet(); embedded.account = makerWallet;
  selected = embedded; session.syncWallet();
  assert.equal(session.getSnapshot().account, "");
  assert.equal(session.getSnapshot().accepted, false);
  assert.equal(h.wallet.listeners.get("accountsChanged")?.size, 0);
  assert.equal(embedded.listeners.get("accountsChanged")?.size, 1);
  await session.perform("support");
  assert.equal(h.calls.length, 0);
  selected = undefined; session.syncWallet();
  assert.equal(embedded.listeners.get("accountsChanged")?.size, 0);
});

test("a delayed connection from an obsolete provider cannot become the connected payout wallet", async t => {
  const h = harness(), connect = deferred<{ browser: never; account: string }>();
  let selected: WalletProvider = h.wallet;
  h.client.connect = () => connect.promise;
  const session = new ReleaseSession(prepared, config, h.client, { wallet: () => selected, storage: () => h.storage });
  t.after(() => session.stop());
  session.start(); await flush();
  const pending = session.connect(); await flush();
  selected = new Wallet(); session.syncWallet();
  connect.resolve({ browser: undefined as never, account: curator }); await pending;
  assert.equal(session.getSnapshot().account, "");
  assert.match(session.getSnapshot().error, /wallet or network changed/);
});

test("late chain reads cannot overwrite a newly selected story or a stopped session", async t => {
  const h = harness(), old = deferred<ReturnType<typeof snapshot>>(), latest = deferred<ReturnType<typeof snapshot>>();
  t.after(() => h.session.stop());
  let reads = 0;
  h.client.load = () => ++reads === 1 ? old.promise : latest.promise;
  h.session.start();
  const next = prepareRelease(moments, "midnight-signal", moments[1].id, curator);
  h.session.setPrepared(next);
  const current = { ...snapshot(), block: 200 };
  latest.resolve(current); await flush();
  old.resolve({ ...snapshot(), block: 50 }); await flush();
  assert.equal(h.session.getSnapshot().releaseId, next.id);
  assert.equal(h.session.getSnapshot().snapshot?.block, 200);
  const stopped = deferred<ReturnType<typeof snapshot>>();
  h.client.load = () => stopped.promise;
  void h.session.refresh(); h.session.stop();
  const before = h.session.getSnapshot();
  stopped.resolve(snapshot()); await flush();
  assert.equal(h.session.getSnapshot(), before);
});
test("consent follows the exact release while wallet context survives a branch change", async t => {
  const h = harness(); t.after(() => h.session.stop());
  h.session.start(); await h.session.connect(); h.session.accept(true);
  assert.equal(h.session.getSnapshot().accepted, true);
  h.session.setPrepared(prepareRelease([...moments], "midnight-signal", moments.at(-1)!.id, curator));
  assert.equal(h.session.getSnapshot().accepted, true);
  h.session.setPrepared(prepareRelease(moments, "midnight-signal", moments[1].id, curator));
  assert.equal(h.session.getSnapshot().account, curator);
  assert.equal(h.session.getSnapshot().accepted, false);
  assert.equal(h.session.getSnapshot().snapshot, undefined);
  await flush();
});
test("account and network changes clear consent and use the selected wallet's saved action", async t => {
  const h = harness(); t.after(() => h.session.stop());
  h.session.start(); await h.session.connect(); h.session.accept(true);
  h.wallet.account = makerWallet;
  h.records.set(transactionStorageKey(config, makerWallet, prepared.projectId), "saved maker action");
  h.wallet.emit("accountsChanged");
  assert.equal(h.session.getSnapshot().account, "");
  assert.equal(h.session.getSnapshot().accepted, false);
  await h.session.connect();
  assert.equal(h.session.getSnapshot().account, makerWallet);
  assert.equal(h.session.getSnapshot().pending, true);
  h.wallet.emit("chainChanged");
  assert.equal(h.session.getSnapshot().account, "");
  assert.equal(h.session.getSnapshot().accepted, false);
});
test("a late connect response does not expose an account or network that is no longer selected", async t => {
  for (const change of ["account", "network"]) {
    const h = harness(), connected = deferred<Awaited<ReturnType<typeof h.client.connect>>>();
    t.after(() => h.session.stop());
    h.client.connect = () => connected.promise;
    h.session.start(); const connecting = h.session.connect(); await flush();
    if (change === "account") h.wallet.account = makerWallet;
    else h.wallet.chainId = 1;
    connected.resolve({ browser: undefined as never, account: curator }); await connecting;
    assert.equal(h.session.getSnapshot().account, "");
    assert.match(h.session.getSnapshot().error, /selected wallet or network changed/);
    assert.equal(h.calls.length, 0);
  }
});
test("unknown sends remain pending and recovery checks do not send another transaction", async t => {
  const h = harness(), key = transactionStorageKey(config, curator, prepared.projectId);
  t.after(() => h.session.stop());
  h.client.execute = async (...args) => { h.calls.push({ operation: "execute", args }); h.records.set(key, "original payment key"); throw new Error("Confirmation interrupted"); };
  h.session.start(); await h.session.connect();
  await h.session.perform("support");
  assert.equal(h.session.getSnapshot().pending, true);
  await h.session.perform("support");
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].args[6], 10n ** 18n);
  await h.session.recover();
  assert.deepEqual(h.calls.map(call => call.operation), ["execute", "recover"]);
  assert.equal(h.records.get(key), "original payment key");
  await h.session.recover(true);
  assert.equal(h.calls.at(-1)?.operation, "retry");
  assert.equal(h.calls.at(-1)?.args[0], prepared);
  assert.equal(h.calls.at(-1)?.args[1], h.wallet);
  assert.equal(h.records.get(key), "original payment key");
});
test("consent, invalid amounts and concurrent actions stop before a send", async t => {
  const h = harness(), sent = deferred<string>(); t.after(() => h.session.stop());
  h.session.start(); await h.session.connect();
  await h.session.perform("register", 1);
  assert.equal(h.calls.length, 0);
  assert.match(h.session.getSnapshot().error, /Accept the testnet release terms/);
  await h.session.perform("support", 0, "", "0");
  assert.equal(h.calls.length, 0);
  h.client.execute = async (...args) => { h.calls.push({ operation: "execute", args }); return sent.promise; };
  const first = h.session.perform("support", 0, "", "0.03");
  await h.session.perform("support", 0, "", "0.03");
  assert.equal(h.calls.length, 1);
  sent.resolve(transactionHash); await first;
  assert.equal(h.session.getSnapshot().busy, null);
});
test("unavailable browser storage blocks sending with a useful explanation", async t => {
  const h = harness(); t.after(() => h.session.stop());
  h.storage.getItem = () => { throw new Error("Storage denied"); };
  h.session.start(); await h.session.connect();
  assert.equal(h.session.getSnapshot().pending, true);
  assert.match(h.session.getSnapshot().error, /Enable browser storage/);
  await h.session.perform("support", 0, "", "0.03");
  assert.equal(h.calls.length, 0);
});
test("a completed action for the previous story stays identified as such", async t => {
  const h = harness(), sent = deferred<string>(); t.after(() => h.session.stop());
  h.client.execute = async () => sent.promise;
  h.session.start(); await h.session.connect();
  const sending = h.session.perform("support", 0, "", "0.03");
  const next = prepareRelease(moments, "midnight-signal", moments[1].id, curator);
  h.session.setPrepared(next);
  sent.resolve(transactionHash); await sending;
  assert.equal(h.session.getSnapshot().releaseId, next.id);
  assert.match(h.session.getSnapshot().notice, /previous story/);
  assert.equal(h.session.getSnapshot().receipt, transactionHash);
});
test("mount cleanup rebinds wallet events and does not destroy an in-flight action", async () => {
  const h = harness(), sent = deferred<string>();
  h.session.start(); h.session.stop(); h.session.start(); await flush();
  assert.equal(h.destroyed(), 0);
  assert.equal(h.wallet.listeners.get("accountsChanged")?.size, 1);
  assert.equal(h.wallet.listeners.get("chainChanged")?.size, 1);
  await h.session.connect(); h.session.accept(true); h.wallet.emit("accountsChanged");
  assert.equal(h.session.getSnapshot().accepted, false);
  await h.session.connect();
  h.client.execute = async () => sent.promise;
  const sending = h.session.perform("support", 0, "", "0.03");
  h.session.stop(); await flush();
  assert.equal(h.destroyed(), 0);
  sent.resolve(transactionHash); await sending;
  assert.equal(h.destroyed(), 1);
  assert.equal(h.wallet.listeners.get("accountsChanged")?.size, 0);
});
test("successful refresh clears a read failure while retaining an action failure", async t => {
  const h = harness(); t.after(() => h.session.stop());
  h.client.load = async () => { throw new Error("Read interrupted"); };
  h.session.start(); await flush();
  assert.match(h.session.getSnapshot().error, /Read interrupted/);
  h.client.load = async () => snapshot(); await h.session.refresh();
  assert.equal(h.session.getSnapshot().error, "");
  h.client.execute = async () => { throw new Error("Maker approval required"); };
  await h.session.connect(); h.session.accept(true); await h.session.perform("register", 1);
  await h.session.refresh();
  assert.match(h.session.getSnapshot().error, /Maker approval required/);
});

test("slow passive reads are coalesced, while a confirmed action requests fresh state", async t => {
  const h = harness(), old = deferred<ReturnType<typeof snapshot>>(); t.after(() => h.session.stop());
  h.session.start(); await h.session.connect();
  let reads = 0;
  h.client.load = async () => ++reads === 1 ? old.promise : { ...snapshot(), block: 300 };
  const first = h.session.refresh(), repeated = h.session.refresh();
  assert.equal(first, repeated);
  assert.equal(reads, 1);
  await h.session.perform("support", 0, "", "0.03");
  assert.equal(reads, 2);
  old.resolve({ ...snapshot(), block: 101 }); await first;
  assert.equal(h.session.getSnapshot().snapshot?.block, 300);
});

test("an account event during final connection checks cannot restore the previous wallet", async t => {
  const h = harness(); t.after(() => h.session.stop());
  const chain = deferred<string>();
  h.wallet.request = async ({ method }: { method: string }) => method === "eth_accounts" ? [curator] : chain.promise;
  h.session.start(); const connecting = h.session.connect(); await flush();
  h.wallet.account = makerWallet; h.wallet.emit("accountsChanged");
  chain.resolve(`0x${config.chainId.toString(16)}`); await connecting;
  assert.equal(h.session.getSnapshot().account, "");
  assert.match(h.session.getSnapshot().error, /selected wallet or network changed/);
});
