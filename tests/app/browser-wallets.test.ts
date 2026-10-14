import assert from "node:assert/strict";
import test from "node:test";
import { discoverBrowserWallets, type BrowserSignInWallet, type WalletWindow } from "../../src/lib/wallets/browser-wallets.ts";

test("EIP-6963 discovers both providers when a different extension owns window.ethereum", async () => {
  const host: WalletWindow = new EventTarget();
  const calls: string[] = [];
  const metamask = { request: async () => { calls.push("metamask"); return []; } };
  const phantom = { isPhantom: true, request: async () => { calls.push("phantom"); return []; } };
  host.ethereum = phantom;
  let latest: BrowserSignInWallet[] = [];
  host.addEventListener("eip6963:requestProvider", () => {
    for (const [uuid, name, provider] of [["one", "MetaMask", metamask], ["two", "Phantom", phantom]]) {
      host.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { info: { uuid, name }, provider } }));
    }
  });
  const stop = discoverBrowserWallets(host, wallets => { latest = wallets; });
  assert.deepEqual(latest.map(wallet => wallet.name), ["MetaMask", "Phantom"]);
  assert.equal(calls.length, 0, "Discovery never requests a connection or signature");
  const chosen = latest.find(wallet => wallet.name === "MetaMask");
  assert.equal(chosen?.chain, "ethereum");
  if (chosen?.chain === "ethereum") await chosen.provider.request({ method: "eth_requestAccounts" });
  assert.deepEqual(calls, ["metamask"], "The chosen provider wins over window.ethereum");
  stop();
});

test("multichain Phantom appears once in each chain and Solflare stays selectable", () => {
  const host: WalletWindow = new EventTarget();
  const evm = { isPhantom: true, request: async () => [] };
  const solana = { signMessage: async () => new Uint8Array(64) };
  host.ethereum = evm;
  host.phantom = { ethereum: evm, solana };
  host.solana = solana;
  host.solflare = { signMessage: async () => new Uint8Array(64) };
  let latest: BrowserSignInWallet[] = [];
  const stop = discoverBrowserWallets(host, wallets => { latest = wallets; });
  assert.deepEqual(latest.map(wallet => [wallet.name, wallet.chain]), [["Phantom", "ethereum"], ["Phantom", "solana"], ["Solflare", "solana"]]);
  stop();
});

test("legacy provider arrays stay selectable; malformed announcements are ignored and listeners are removed", () => {
  const host: WalletWindow = new EventTarget();
  host.ethereum = { request: async () => [], providers: [{ isMetaMask: true, request: async () => [] }, { isPhantom: true, request: async () => [] }] };
  let latest: BrowserSignInWallet[] = [], updates = 0;
  const stop = discoverBrowserWallets(host, wallets => { latest = wallets; updates++; });
  assert.deepEqual(latest.map(wallet => wallet.name), ["MetaMask", "Phantom"]);
  host.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { info: { uuid: "bad", name: "Bad wallet" }, provider: {} } }));
  assert.equal(updates, 1);
  stop();
  host.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { info: { uuid: "three", name: "New wallet" }, provider: { request: async () => [] } } }));
  assert.equal(updates, 1);
});
