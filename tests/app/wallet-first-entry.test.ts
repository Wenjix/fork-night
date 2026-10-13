import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tsImport } from "tsx/esm/api";

const { GuestSignOutDialog, PilotIdentity, PilotAccountContext } = await tsImport("./wallet-first-fixtures.ts", import.meta.url);
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
