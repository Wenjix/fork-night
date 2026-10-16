import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tsImport } from "tsx/esm/api";

const { GuestSignOutDialog, PilotIdentity, PilotAccountContext, WalletSignInDialog } = await tsImport("./wallet-first-fixtures.ts", import.meta.url);
import type { PilotAccount } from "../../src/components/pilot-account.tsx";
import type { User, UserIdentity } from "@supabase/supabase-js";
import { makerWallet, makers } from "./release-fixtures.ts";

test("the room offers wallet sign-in before a storyteller profile or name exists", () => {
  const html = renderToStaticMarkup(createElement(PilotIdentity, { profile: undefined, disabled: false, onJoin: () => {} }));
  assert.match(html, /Sign in with wallet/);
  assert.doesNotMatch(html, /<input/);
  assert.match(html, /Join this room/);
});

test("a wallet account can enter without a name and is not presented as a Google or embedded-wallet account", () => {
  const identity: UserIdentity = { id: "fixture-wallet", identity_id: "20000000-0000-4000-8000-000000000091", user_id: makers[3]!, provider: "web3", identity_data: { sub: `web3:ethereum:${makerWallet}`, custom_claims: { chain: "ethereum", address: makerWallet, network: "1" } } };
  const user: User = { id: makers[3]!, is_anonymous: false, aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-10-12T15:00:00Z", identities: [identity] };
  const account: PilotAccount = {
    user, loading: false, error: "", enabled: true, authenticatingWallet: false,
    signIn: async () => {}, signInWallet: async () => {}, signOut: async () => {},
    walletMode: "external", wallet: { owner: "", address: "", loading: false, error: "" }, chooseWallet: () => {},
  };
  const html = renderToStaticMarkup(createElement(PilotAccountContext.Provider, { value: account }, createElement(PilotIdentity, { profile: undefined, disabled: false, onJoin: () => {} })));
  assert.match(html, /Wallet account/);
  assert.match(html, /Signed in with your wallet/);
  assert.match(html, /Choose my storyteller name/);
  assert.match(html, /Sign out of this browser/);
  assert.doesNotMatch(html, /<input|saved with Google|Preparing your in-app wallet/);
});

test("an existing guest can sign out in the same browser to choose another login", () => {
  const user = { id: makers[3]!, is_anonymous: true } as User;
  const account: PilotAccount = {
    user, loading: false, error: "", enabled: true, authenticatingWallet: false,
    signIn: async () => {}, signInWallet: async () => {}, signOut: async () => {},
    walletMode: "external", wallet: { owner: "", address: "", loading: false, error: "" }, chooseWallet: () => {},
  };
  const profile = { id: user.id, display_name: "Tester", created_at: "2026-10-12T03:00:00Z" };
  const html = renderToStaticMarkup(createElement(PilotAccountContext.Provider, { value: account }, createElement(PilotIdentity, { profile, disabled: false, onJoin: () => {} })));
  assert.match(html, /Sign out of this browser/);
  assert.match(html, /Save my byline with Google/);
});

test("guest sign-out explains lost access, allows cancellation and blocks confirmation during an action", () => {
  const props = { name: "Tester", busy: false, disabled: false, error: "", blockedReason: "", onClose: () => {}, onConfirm: () => {} };
  const html = renderToStaticMarkup(createElement(GuestSignOutDialog, props));
  assert.match(html, /published moments stay credited to/);
  assert.match(html, /cannot return to its private previews or publish as this byline/);
  assert.match(html, /Keep this guest/);
  assert.match(html, /Sign out and switch accounts/);
  const waiting = renderToStaticMarkup(createElement(GuestSignOutDialog, { ...props, disabled: true, blockedReason: "Finish your preview first." }));
  assert.match(waiting, /Finish your preview first/);
  assert.match(waiting, /disabled=""[^>]*>Sign out and switch accounts/);
});

test("the chooser distinguishes EVM and Solana wallets, shows recoverable errors, and blocks duplicate prompts", () => {
  const props = {
    wallets: [
      { id: "meta", name: "MetaMask", chain: "ethereum" as const, provider: { request: async () => [] } },
      { id: "phantom", name: "Phantom", chain: "solana" as const, provider: { signMessage: async () => new Uint8Array(64) } },
    ], busy: false, selected: "", error: "", onClose: () => {}, onSelect: () => {},
  };
  const html = renderToStaticMarkup(createElement(WalletSignInDialog, props));
  assert.match(html, /Monad testnet wallets/);
  assert.match(html, /Solana devnet wallets/);
  assert.match(html, /MetaMask/); assert.match(html, /Phantom/);
  assert.match(html, /Signing in uses no gas/);
  assert.match(html, /releases and payouts currently use Monad testnet/);
  const busy = renderToStaticMarkup(createElement(WalletSignInDialog, { ...props, busy: true, selected: "phantom", error: "A wallet request is already open." }));
  assert.equal((busy.match(/class="pilot-wallet-choice" disabled=""/g) ?? []).length, 2);
  assert.match(busy, /role="alert">A wallet request is already open/);
  assert.match(busy, /Check your wallet/);
});

test("a Solana identity displays its real sign-in address and explains the separate Monad release wallet", () => {
  const address = "9xQeWvG816bUx9EPfEZRPsvfoGrkaCRqqjCoSSY8ob2r";
  const user: User = { id: makers[3]!, is_anonymous: false, aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-10-13T10:00:00Z", identities: [{ id: "solana-ui", identity_id: "solana-ui", user_id: makers[3]!, provider: "web3", identity_data: { custom_claims: { chain: "solana", address, network: "devnet" } } }] };
  const account: PilotAccount = { user, loading: false, error: "", enabled: true, authenticatingWallet: false, signIn: async () => {}, signInWallet: async () => {}, signOut: async () => {}, walletMode: "external", wallet: { owner: "", address: "", loading: false, error: "" }, chooseWallet: () => {} };
  const html = renderToStaticMarkup(createElement(PilotAccountContext.Provider, { value: account }, createElement(PilotIdentity, { disabled: false, onJoin: () => {} })));
  assert.match(html, new RegExp(address));
  assert.match(html, /Signed in with Solana/);
  assert.match(html, /connect an EVM or in-app wallet on Monad testnet/);
  assert.doesNotMatch(html, /saved with Google|Preparing your in-app wallet/);
});

test("a signed-out visitor sees Google sign-in in the header before wallet sign-in and naming", () => {
  const account: PilotAccount = { loading: false, error: "", enabled: true, authenticatingWallet: false, signIn: async () => {}, signInWallet: async () => {}, signOut: async () => {}, walletMode: "embedded", wallet: { owner: "", address: "", loading: false, error: "" }, chooseWallet: () => {} };
  const html = renderToStaticMarkup(createElement(PilotAccountContext.Provider, { value: account }, createElement(PilotIdentity, { profile: undefined, disabled: false, onJoin: () => {}, joinLabel: "Choose a storyteller name" })));
  assert.match(html, /Sign in with Google/);
  assert.match(html, /src="\/brands\/google-g.png"/);
  assert.ok(html.indexOf("Sign in with Google") < html.indexOf("Sign in with wallet"));
  assert.ok(html.indexOf("Sign in with wallet") < html.indexOf("Choose a storyteller name"));
  const withoutPrivy = renderToStaticMarkup(createElement(PilotAccountContext.Provider, { value: { ...account, enabled: false } }, createElement(PilotIdentity, { profile: undefined, disabled: false, onJoin: () => {} })));
  assert.doesNotMatch(withoutPrivy, /Sign in with Google/);
});
