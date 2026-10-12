import test from "node:test";
import assert from "node:assert/strict";
import {
  createDemoState,
  deliverFork,
  getQuote,
  publishFork,
  reserveFork,
} from "../../src/domain/index.ts";
import { projectActivity } from "../../src/social/activity.ts";

test("room activity distinguishes distinct makers, total moments and longest branch within one project", () => {
  const demo = createDemoState();
  assert.deepEqual(projectActivity(demo, "midnight-signal"), {
    contributors: 3,
    moments: 6,
    longestPath: 4,
  });
  assert.deepEqual(projectActivity(demo, "paper-moon"), {
    contributors: 1,
    moments: 1,
    longestPath: 1,
  });
  assert.deepEqual(projectActivity(demo, "missing"), {
    contributors: 0,
    moments: 0,
    longestPath: 0,
  });
  demo.moments.reverse();
  assert.deepEqual(projectActivity(demo, "midnight-signal"), {
    contributors: 3,
    moments: 6,
    longestPath: 4,
  });
});

test("reserved and delivered work does not inflate public activity; publishing advances it once", () => {
  let demo = createDemoState();
  const before = projectActivity(demo, "midnight-signal");
  const quote = getQuote(demo, {
    userId: "sam",
    projectId: "midnight-signal",
    parentId: "reply",
    prompt: "The lantern opens a doorway to tomorrow.",
  });
  demo = reserveFork(demo, quote);
  const operationId = `op-${quote.id}`;
  assert.deepEqual(projectActivity(demo, "midnight-signal"), before);
  demo = deliverFork(demo, operationId);
  assert.deepEqual(projectActivity(demo, "midnight-signal"), before);
  demo = publishFork(demo, operationId, "Thanks for the lantern.");
  assert.deepEqual(projectActivity(demo, "midnight-signal"), {
    contributors: 3,
    moments: 7,
    longestPath: 5,
  });
  demo = publishFork(demo, operationId, "Thanks for the lantern.");
  assert.deepEqual(projectActivity(demo, "midnight-signal"), {
    contributors: 3,
    moments: 7,
    longestPath: 5,
  });
  assert.deepEqual(projectActivity(demo, "paper-moon"), {
    contributors: 1,
    moments: 1,
    longestPath: 1,
  });
});
