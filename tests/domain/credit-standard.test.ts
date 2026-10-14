import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEMO_UNIT,
  assertLedgerConservation,
  createDemoState,
  deliverFork,
  discardFork,
  getOperation,
  getQuote,
  publishFork,
  reserveFork,
  validateDemoState,
} from "../../src/domain/index.ts";
import { extendFandomDemo } from "../../src/domain/fandom-fixtures.ts";
import { extendSocialDemo } from "../../src/social/model.ts";
import { restoreLocalWorkspace } from "../../src/social/navigation.ts";
import { pilotCreditCost } from "../../src/lib/pilot-format.ts";

const extendCatalog = (state: ReturnType<typeof createDemoState>) =>
  extendFandomDemo(extendSocialDemo(state));
const legacyWorkspace = () => JSON.parse(readFileSync(
  new URL("../../fixtures/legacy-credit-workspace.json", import.meta.url), "utf8",
));

test("every local room uses whole-credit prices and the pilot keeps its panel rate", () => {
  const state = extendCatalog(createDemoState());
  for (const project of state.projects) {
    const quote = getQuote(state, {
      userId: project.creatorId,
      projectId: project.id,
      parentId: project.seedId,
      prompt: "Let the story continue.",
      now: 1000,
    });
    assert.equal(quote.generationMax, DEMO_UNIT, project.id);
    assert.ok(quote.ancestorFees.every(fee => fee.amount === DEMO_UNIT), project.id);
    if (project.visibility === "private") assert.equal(quote.upstreamTotal, 0);
  }
  assert.deepEqual([1, 2, 3].map(pilotCreditCost), [1, 1, 2]);
});

test("legacy holds, deliveries and receipts survive refresh and settle at their original rates", () => {
  const saved = legacyWorkspace();
  const restored = restoreLocalWorkspace(saved, extendCatalog);
  assert.deepEqual(restored.state.operations, saved.state.operations);
  assert.deepEqual(restored.state.ledger, saved.state.ledger);
  // Restoring adds Wren, the prepared rooms' AI agent author, with nothing to claim; every saved claim is unchanged.
  assert.deepEqual(restored.state.claims, { ...saved.state.claims, wren: 0 });
  assert.equal(restored.draft, saved.draft);
  assert.equal(restored.operationId, saved.operationId);
  assert.deepEqual(restored.state.moments.slice(0, saved.state.moments.length), saved.state.moments);

  let state = restored.state;
  const historical = structuredClone(state.operations.find(item => item.status === "published")!);
  const held = state.operations.find(item => item.status === "reserved")!;
  const delivered = state.operations.find(item => item.status === "delivered")!;
  assert.strictEqual(reserveFork(state, held.quote, { now: held.quote.expiresAt }), state);
  assert.throws(() => reserveFork(state, { ...held.quote, id: `${held.quote.id}-new` }, { now: held.quote.issuedAt }), /Request a new quote/);
  state = deliverFork(state, held.id);
  assert.equal(getOperation(state, held.id).generationActual, 120_000);
  state = publishFork(state, held.id, "The original agreement stands.", { now: held.quote.issuedAt + 10 });
  assert.equal(getOperation(state, held.id).settledAmount, 270_000);
  assert.equal(getOperation(state, held.id).releasedAmount, 60_000);
  state = discardFork(state, delivered.id, { now: delivered.quote.issuedAt + 10 });
  assert.equal(getOperation(state, delivered.id).settledAmount, 120_000);
  assert.equal(getOperation(state, delivered.id).releasedAmount, 210_000);
  assert.deepEqual(getOperation(state, historical.id), historical);
  assertLedgerConservation(state);
  validateDemoState(state);

  const quote = getQuote(state, {
    userId: "priya", projectId: "midnight-signal",
    parentId: historical.publishedMomentId!, prompt: "Start a new continuation.",
    now: held.quote.expiresAt + 1000,
  });
  assert.equal(quote.generationMax, DEMO_UNIT);
  assert.deepEqual(quote.ancestorFees.map(fee => fee.amount), Array(4).fill(DEMO_UNIT));
  assert.equal(quote.totalMax, 5 * DEMO_UNIT);
  state = publishFork(deliverFork(reserveFork(state, quote, { now: quote.issuedAt }), `op-${quote.id}`), `op-${quote.id}`, "", { now: quote.issuedAt + 1 });
  assertLedgerConservation(state);
  validateDemoState(state);
});
