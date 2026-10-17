import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tsImport } from "tsx/esm/api";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/supabase/database.types.ts";
import type { GenerationOperation } from "../../src/lib/pilot-generation.ts";
import { makers, moments } from "./release-fixtures.ts";

const { PilotContinuation, visibleContinuation } = await tsImport("../../src/components/pilot-continuation.tsx", import.meta.url);
const { PilotIdentity } = await tsImport("../../src/components/pilot-identity.tsx", import.meta.url);
const profile = { id: makers[3]!, display_name: "Tester", created_at: "2026-10-12T03:00:00Z" };
const operation: GenerationOperation = {
  id: "10000000-0000-4000-8000-000000000010", maker_id: profile.id, room_id: "midnight-signal",
  parent_id: moments[2].id, request_id: "10000000-0000-4000-8000-000000000012", title: "A continuation",
  prompt: "Private idea", requested_captions: ["First"], status: "delivered", created_at: "2026-10-12T03:00:00Z",
  panels: moments[3].panels, source_kind: "fixture", charged_units: 1, generation_error: null, published_moment_id: null,
  source_idea_id: null, source_idea_label: null, source_idea_body: null,
};
const actions = { join: () => {}, publish: () => {}, discard: () => {}, check: () => {}, continue: () => {}, share: () => {}, change: () => true, generate: () => {}, cancel: () => {}, useIdea: () => {}, inspect: () => {}, continueDraft: () => {}, startFresh: () => {} };
const props = { client: {} as SupabaseClient<Database>, selected: moments[3], moments, profile, operation,
  composing: false, composerVisible: true, busy: false, interrupted: false, inspecting: false, heading: { current: null }, actions };

test("a private delivered preview requires publication and busy publication cannot be sent again", () => {
  const ready = renderToStaticMarkup(createElement(PilotContinuation, props));
  assert.match(ready, /saved privately/);
  assert.match(ready, /Publish my moment/);
  assert.doesNotMatch(ready, /Invite the next storyteller|Connect testnet wallet/);
  const busy = renderToStaticMarkup(createElement(PilotContinuation, { ...props, busy: true }));
  assert.match(busy, /disabled=""[^>]*>Publish my moment/);
});
test("publication invites a peer on its own moment without leaving stale actions on another scene", () => {
  const published = { ...operation, status: "published", published_moment_id: moments[3].id };
  const html = renderToStaticMarkup(createElement(PilotContinuation, { ...props, operation: published }));
  assert.match(html, /Your moment is live\. Invite the next maker/);
  assert.match(html, /Copy invite link/);
  assert.match(html, /Continue from here/);
  assert.equal(visibleContinuation(published, moments[2].id), undefined);
  assert.equal(visibleContinuation({ ...operation, status: "discarded" }, moments[2].id)?.status, "discarded");
  assert.equal(visibleContinuation({ ...operation, status: "discarded" }, moments[3].id), undefined);
});
test("a saved idea whose generation never started can be retried, but not while a start is in flight", () => {
  const saved = { ...operation, status: "draft" };
  const idle = renderToStaticMarkup(createElement(PilotContinuation, { ...props, operation: saved }));
  assert.match(idle, /reserved when generation starts/);
  assert.match(idle, /Try again<\/button>/);
  assert.doesNotMatch(idle, /Generate saved idea/);
  const starting = renderToStaticMarkup(createElement(PilotContinuation, { ...props, operation: saved, busy: true }));
  assert.match(starting, /Starting your panel/);
  assert.doesNotMatch(starting, /Try again/);
});
test("guest entry and wallet identity remain separate and do not promise that a name selects a payout", () => {
  const join = renderToStaticMarkup(createElement(PilotContinuation, { ...props, profile: undefined, composing: true }));
  assert.match(join, /Your storyteller name/);
  assert.match(join, /No wallet needed/);
  assert.match(join, /guest identity and private drafts stay in this browser/);
  const identity = renderToStaticMarkup(createElement(PilotIdentity, { profile, disabled: false, onJoin: () => {} }));
  assert.match(identity, /Making as/);
  assert.match(identity, /Connecting another wallet changes your testnet role/);
  assert.match(identity, /keeps this storyteller name/);
});

test("opening the map unmounts the composer and its voice controls while retaining the draft", () => {
  const draft = { requestId: operation.request_id, roomId: operation.room_id, parentId: operation.parent_id, captions: [], stage: "idea", thought: "The boat returns" };
  const reading = renderToStaticMarkup(createElement(PilotContinuation, { ...props, operation: undefined, composing: true, draft }));
  assert.match(reading, /Preview my idea/);
  const map = renderToStaticMarkup(createElement(PilotContinuation, { ...props, operation: undefined, composing: true, composerVisible: false, draft }));
  assert.doesNotMatch(map, /Preview my idea|Hold to talk/);
  assert.equal(draft.thought, "The boat returns");
});

test("a restored browser draft opens on a choice card before the composer", () => {
  const draft = { requestId: operation.request_id, roomId: operation.room_id, parentId: operation.parent_id, captions: ["Saved panel"], stage: "preview" };
  const html = renderToStaticMarkup(createElement(PilotContinuation, { ...props, operation: undefined, composing: true, draft, recoveredDraft: true }));
  assert.match(html, /You have an unfinished draft\. Continue it or start fresh\./);
  assert.match(html, /Continue draft/);
  assert.match(html, /Start fresh/);
  assert.doesNotMatch(html, /Return to saved preview|Generate 1 panel/);
});

test("Google onboarding retains guest entry and keeps returning-account sign-in distinct", () => {
  const html = renderToStaticMarkup(createElement(PilotContinuation, {
    ...props, profile: undefined, composing: true,
    actions: { ...actions, google: () => {}, returning: () => {} },
  }));
  assert.match(html, /Continue with Google/);
  assert.match(html, /Join as a guest/);
  assert.match(html, /Already joined/);
  assert.match(html, /Sign in with Google/);
  assert.match(html, /Google saves your byline/);
  assert.match(html, /src="\/brands\/google-g.png"/);
  assert.match(html, /src="\/brands\/privy-symbol-black.svg"/);
  assert.match(html, /In-app wallet by/);
  assert.doesNotMatch(html, /Sign in with Privy/);
  assert.doesNotMatch(html, /Claim my|Freeze this release/);
});

test("wallet sign-in precedes name entry, and an authenticated visitor saves a name without another login", () => {
  const entry = renderToStaticMarkup(createElement(PilotContinuation, { ...props, profile: undefined, composing: true, actions: { ...actions, google: () => {} } }));
  assert.ok(entry.indexOf("Sign in with wallet") < entry.indexOf("Your storyteller name"));
  const named = renderToStaticMarkup(createElement(PilotContinuation, { ...props, profile: undefined, authenticated: true, composing: true, actions: { ...actions, google: () => {}, returning: () => {} } }));
  assert.match(named, /You’re signed in/);
  assert.match(named, /Save my storyteller name/);
  assert.doesNotMatch(named, /Continue with Google|Join as a guest|Sign in with wallet|Sign in with Google/);
});
