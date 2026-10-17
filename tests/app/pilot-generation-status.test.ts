import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tsImport } from "tsx/esm/api";
import ts from "typescript";
import { generationStatus, type GenerationOperation, type PilotCredits } from "../../src/lib/pilot-generation.ts";

const { PilotGenerationStatus, PilotRoomActivity } = await tsImport("../../src/components/pilot-generation-status.tsx", import.meta.url);
const operation: GenerationOperation = {
  id: "10000000-0000-4000-8000-000000000010", maker_id: "10000000-0000-4000-8000-000000000011", room_id: "midnight-signal",
  parent_id: "10000000-0000-4000-8000-000000000001", request_id: "10000000-0000-4000-8000-000000000012",
  title: "A continuation", prompt: "Private idea", requested_captions: ["First", "Next", "Last"],
  status: "queued", created_at: "2026-10-11T12:00:00Z", panels: null, source_kind: null, charged_units: 0,
  generation_error: null, published_moment_id: null, source_idea_id: null, source_idea_label: null, source_idea_body: null,
};
const credits: PilotCredits = { limit: 5, used: 0, reserved: 2, available: 3, enabled: true, queued_requests: 1, generating_requests: 0, checking_requests: 0 };

test("a queued request is visibly waiting, distinct from real generation, and explains its reserved credits", () => {
  const queued = renderToStaticMarkup(createElement(PilotGenerationStatus, { operation }));
  const generating = renderToStaticMarkup(createElement(PilotGenerationStatus, { operation: { ...operation, status: "dispatching" } }));
  assert.match(queued, /Waiting to start/);
  assert.match(queued, /Image generation has not started yet/);
  assert.match(queued, /2.*room credits reserved/);
  assert.doesNotMatch(queued, /pilot-generation-active/);
  assert.match(generating, /Generating your images/);
  assert.match(generating, /Usually about 30 seconds/);
  assert.match(generating, /pilot-generation-active/);
  assert.notEqual(generationStatus(operation).title, generationStatus({ ...operation, status: "dispatching" }).title);
});
test("a saved operation starts with spinner copy and no second generate button", () => {
  const html = renderToStaticMarkup(createElement(PilotGenerationStatus, { operation: { ...operation, status: "draft" } }));
  assert.match(html, /Starting your panel…/);
  assert.match(html, /Image generation is starting now/);
  assert.match(html, /pilot-generation-active/);
  assert.doesNotMatch(html, /Saved, ready to generate|Generate saved idea/);
  const idle = renderToStaticMarkup(createElement(PilotGenerationStatus, { operation: { ...operation, status: "draft" }, starting: false }));
  assert.match(idle, /Not started yet/);
  assert.match(idle, /Try again to start it/);
  assert.doesNotMatch(idle, /starting now|pilot-generation-active/);
});
test("stale and interrupted work does not animate as if new progress were arriving", () => {
  const old = { ...operation, status: "dispatching", pilot_jobs: { operation_id: operation.id, state: "running", panel_count: 3, updated_at: "2020-01-01T00:00:00Z" } };
  const stale = renderToStaticMarkup(createElement(PilotGenerationStatus, { operation: old }));
  assert.match(stale, /Generation needs checking/);
  assert.doesNotMatch(stale, /pilot-generation-active/);
  const interrupted = renderToStaticMarkup(createElement(PilotGenerationStatus, { operation: { ...operation, status: "dispatching" }, interrupted: true }));
  assert.match(interrupted, /Showing the last recorded state/);
  assert.doesNotMatch(interrupted, /pilot-generation-active/);
});
test("delivery clearly asks for private review and explicit publication", () => {
  const ready = renderToStaticMarkup(createElement(PilotGenerationStatus, { operation: { ...operation, status: "delivered", charged_units: 2 } }));
  assert.match(ready, /Ready to review/);
  assert.match(ready, /saved privately/);
  assert.match(ready, /Publish my moment/);
  assert.doesNotMatch(ready, /credits reserved|pilot-generation-active/);
});
test("room activity uses job counts rather than calling two reserved credits two generating requests", () => {
  const html = renderToStaticMarkup(createElement(PilotRoomActivity, { credits }));
  assert.match(html, /1 queued/);
  assert.match(html, /2.*reserved for unfinished requests/);
  assert.doesNotMatch(html, /2 generating|pilot-generation-active|Private idea/);
  const mixed = renderToStaticMarkup(createElement(PilotRoomActivity, { credits: { ...credits, queued_requests: 0, generating_requests: 1, checking_requests: 1 } }));
  assert.match(mixed, /1 generating/);
  assert.match(mixed, /1.*request needs checking/);
});
test("an older database or lost connection cannot fabricate active generation", () => {
  const { queued_requests, generating_requests, checking_requests, ...legacy } = credits;
  const fallback = renderToStaticMarkup(createElement(PilotRoomActivity, { credits: legacy }));
  assert.match(fallback, /detailed activity is unavailable/);
  assert.doesNotMatch(fallback, /\d generating|pilot-generation-active/);
  const interrupted = renderToStaticMarkup(createElement(PilotRoomActivity, { credits: { ...credits, generating_requests: 1 }, interrupted: true }));
  assert.match(interrupted, /Last saved room activity/);
  assert.doesNotMatch(interrupted, /pilot-generation-active/);
});
test("sharing exposes the exact selected moment link even when a browser share API completes silently", async () => {
  const source = ts.createSourceFile("shared-pilot.tsx", await readFile("src/components/shared-pilot.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let share: ts.FunctionDeclaration | undefined;
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "share") share = node;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(share);
  const run = new Function("selected", "window", "roomId", "pilotMomentLink", "navigator", "setShareUrl", "setNotice", `return (${share.getText(source)})();`);
  for (const navigator of [{ share: async () => {} }, { clipboard: { writeText: async () => {} } }, {}]) {
    let visible = "";
    await run({ id: "published", title: "Selected", maker_label: "tester" }, { location: { origin: "http://localhost:3005" } }, "midnight-signal",
      () => "http://localhost:3005/pilot?room=midnight-signal&moment=published", navigator, (url: string) => { visible = url; }, () => {});
    assert.equal(visible, "http://localhost:3005/pilot?room=midnight-signal&moment=published");
  }
});
