import test from "node:test";
import assert from "node:assert/strict";
import { createDemoState } from "../../src/domain/fixtures.ts";
import { getQuote, reserveFork, deliverFork } from "../../src/domain/engine.ts";
import { extendSocialDemo } from "../../src/social/model.ts";
import {
  formatSocialRoute,
  parseSocialRoute,
  rememberWorkspaceDraft,
  restoreLocalWorkspace,
  switchWorkspaceContext,
  unfinishedDrafts,
  type LocalWorkspace,
  type SocialRoute,
} from "../../src/social/navigation.ts";

function workspace(): LocalWorkspace {
  return {
    state: createDemoState(), userId: "sam", projectId: "midnight-signal",
    selectedId: "signal", draft: "The lighthouse starts singing.", operationId: null,
    drafts: {},
  };
}

test("all social destinations round-trip through addressable hash routes", () => {
  const routes: SocialRoute[] = [
    { kind: "lobby" }, { kind: "spaces" }, { kind: "desk" },
    { kind: "guild", guildId: "paper-lantern" },
    { kind: "hall", guildId: "paper-lantern" },
    { kind: "ideas", boardId: "tidepool-board" },
    { kind: "project", projectId: "midnight-signal" },
    { kind: "project", projectId: "blade-runner-memory", view: "images-to-video" },
  ];
  for (const route of routes)
    assert.deepEqual(parseSocialRoute(formatSocialRoute(route)), route);
  assert.deepEqual(parseSocialRoute("#/guild/paper-lantern/"), routes[3]);
});

test("the prepared film route belongs only to its recorded room", () => {
  assert.deepEqual(parseSocialRoute("#/project/blade-runner-memory/images-to-video/"), {
    kind: "project", projectId: "blade-runner-memory", view: "images-to-video",
  });
  for (const hash of ["#/project/paper-moon/images-to-video", "#/guild/blade-runner-memory/images-to-video", "#/project/blade-runner-memory/unknown", "#/project/blade-runner-memory/images-to-video?live=1"])
    assert.deepEqual(parseSocialRoute(hash), { kind: "lobby" });
  assert.equal(formatSocialRoute({ kind: "project", projectId: "paper-moon", view: "images-to-video" }), "#/project/paper-moon");
});

test("empty and malformed hash routes safely open the lobby", () => {
  for (const hash of ["", "#", "#/", "#/project", "#/project/%", "#/project/%2fsecret", "#/project/../x", "#/guild/__proto__", "#/guild/constructor", "#/guild/a?private=1", "#/unknown/private", "javascript:alert(1)"])
    assert.deepEqual(parseSocialRoute(hash), { kind: "lobby" }, hash);
});

test("switching projects and collaborators preserves every unsent prompt and starting point", () => {
  let current = workspace();
  current = switchWorkspaceContext(current, "sam", "paper-moon");
  assert.equal(current.draft, "");
  current.draft = "The paper moon folds into a bird.";
  current = switchWorkspaceContext(current, "priya", "midnight-signal");
  assert.equal(current.draft, "");
  current.draft = "A reply arrives in a bottle.";
  current.selectedId = "sea";
  current = switchWorkspaceContext(current, "sam", "midnight-signal");
  assert.equal(current.draft, "The lighthouse starts singing.");
  assert.equal(current.selectedId, "signal");
  current = switchWorkspaceContext(current, "priya", "midnight-signal");
  assert.equal(current.draft, "A reply arrives in a bottle.");
  assert.equal(current.selectedId, "sea");
  current = switchWorkspaceContext(current, "sam", "paper-moon");
  assert.equal(current.draft, "The paper moon folds into a bird.");
  assert.equal(unfinishedDrafts(current).length, 3);
});

test("a browser refresh retains active and inactive local draft slots", () => {
  let current = workspace();
  current = switchWorkspaceContext(current, "sam", "paper-moon");
  current.draft = "Fold the sky into a kite.";
  current.ideaId = "an-idea-on-the-board";
  const saved = JSON.parse(JSON.stringify(rememberWorkspaceDraft(current)));
  let restored = restoreLocalWorkspace(saved);
  assert.equal(restored.draft, "Fold the sky into a kite.");
  assert.equal(restored.ideaId, "an-idea-on-the-board");
  restored = switchWorkspaceContext(restored, "sam", "midnight-signal");
  assert.equal(restored.draft, "The lighthouse starts singing.");
  assert.equal(restored.selectedId, "signal");
});

test("reading another moment does not rebase an unsent draft", () => {
  let current = workspace();
  current.draftSourceId = "signal";
  current.selectedId = "harbor";
  current = restoreLocalWorkspace(JSON.parse(JSON.stringify(rememberWorkspaceDraft(current))));
  assert.equal(current.selectedId, "harbor");
  assert.equal(unfinishedDrafts(current)[0].selectedId, "signal");
  current = switchWorkspaceContext(current, "sam", "paper-moon");
  current = switchWorkspaceContext(current, "sam", "midnight-signal");
  assert.equal(current.selectedId, "signal");
  assert.equal(current.draft, "The lighthouse starts singing.");
});

test("reserved and delivered operations survive navigation without an extra hold", () => {
  for (const delivered of [false, true]) {
    let current = workspace();
    const quote = getQuote(current.state, {
      userId: current.userId, projectId: current.projectId,
      parentId: current.selectedId, prompt: current.draft,
    });
    current.state = reserveFork(current.state, quote);
    current.operationId = `op-${quote.id}`;
    if (delivered) current.state = deliverFork(current.state, current.operationId);
    const before = structuredClone(current.state);
    current = switchWorkspaceContext(current, "jules", "paper-moon");
    current = restoreLocalWorkspace(JSON.parse(JSON.stringify(rememberWorkspaceDraft(current))));
    current = switchWorkspaceContext(current, "sam", "midnight-signal");
    assert.equal(current.operationId, `op-${quote.id}`);
    assert.equal(current.selectedId, "signal");
    assert.equal(current.draft, "The lighthouse starts singing.");
    assert.deepEqual(current.state, before);
  }
});

test("legacy single-workspace saves migrate without resetting a ledger or draft", () => {
  const old = workspace();
  const { drafts: _drafts, ...legacy } = old;
  const restored = restoreLocalWorkspace(legacy, extendSocialDemo);
  assert.equal(restored.draft, old.draft);
  assert.equal(restored.selectedId, old.selectedId);
  assert.deepEqual(restored.state.accounts.filter((account) => old.state.accounts.some((item) => item.id === account.id)), old.state.accounts);
  assert.deepEqual(restored.state.ledger, old.state.ledger);
  assert.equal(unfinishedDrafts(restored).length, 1);
  assert.deepEqual(extendSocialDemo(restored.state), restored.state);
});

test("restoration rejects broken money records and cannot adopt another maker's operation", () => {
  const current = workspace();
  const quote = getQuote(current.state, { userId: "priya", projectId: "midnight-signal", parentId: "signal", prompt: "The keeper returns." });
  current.state = reserveFork(current.state, quote);
  current.operationId = `op-${quote.id}`;
  assert.equal(restoreLocalWorkspace(current).operationId, null);
  const damaged = structuredClone(current);
  damaged.state.accounts[0].reserved = 12;
  assert.throws(() => restoreLocalWorkspace(damaged));
});
