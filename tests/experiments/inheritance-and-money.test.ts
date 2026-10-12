import assert from "node:assert/strict";
import test from "node:test";
import {
  buildInheritedPackage,
  EXPERIMENT_LIMITS,
  loadFixtures,
} from "../../src/experiments/fixtures.ts";
import {
  formatUsd,
  parseUsd,
  summarizeCosts,
  toTestTokenUnits,
} from "../../src/experiments/money.ts";
import type { Expense } from "../../src/experiments/types.ts";

test("a fork inherits only its complete immutable path, not siblings or later character versions", async () => {
  const { story } = await loadFixtures();
  const inherited = buildInheritedPackage(story, "canal-signal");
  assert.deepEqual(
    inherited.moments.map((moment) => moment.id),
    ["archive-seed", "canal-signal"],
  );
  assert.deepEqual(
    inherited.characters.map((character) => character.id),
    ["mara-v1"],
  );
  assert.deepEqual(
    inherited.references.map((reference) => reference.id),
    ["archive-sketch-v1"],
  );
  assert.equal(inherited.upstreamReuseFeesUsd, "0.075000");
  assert.equal(inherited.references[0]!.reportedGenerationExpenseUsd, null);
  inherited.moments[0]!.summary = "Local edit";
  assert.notEqual(story.moments[0]!.summary, "Local edit");
  assert.equal(buildInheritedPackage(story, null).moments.length, 0);
});

test("unknown, unpublished, foreign, cyclic and oversized parents fail before generation", async () => {
  const { story } = await loadFixtures();
  assert.throws(
    () => buildInheritedPackage(story, "missing"),
    /Unknown parent/,
  );
  assert.throws(
    () => buildInheritedPackage(story, "unpublished-draft"),
    /published/,
  );
  const foreign = structuredClone(story);
  foreign.moments[0]!.projectId = "foreign-project";
  assert.throws(
    () => buildInheritedPackage(foreign, "canal-signal"),
    /another project/,
  );
  const cyclic = structuredClone(story);
  cyclic.moments[0]!.parentId = "canal-signal";
  assert.throws(() => buildInheritedPackage(cyclic, "canal-signal"), /Cyclic/);
  const oversized = structuredClone(story);
  const template = oversized.moments[0]!;
  oversized.moments = Array.from(
    { length: EXPERIMENT_LIMITS.maxAncestors + 1 },
    (_, index) => ({
      ...template,
      id: `node-${index}`,
      parentId: index ? `node-${index - 1}` : null,
    }),
  );
  assert.throws(
    () =>
      buildInheritedPackage(
        oversized,
        `node-${EXPERIMENT_LIMITS.maxAncestors}`,
      ),
    /limit/,
  );
  const tooLarge = structuredClone(story);
  tooLarge.moments[0]!.summary = "x".repeat(EXPERIMENT_LIMITS.maxInputBytes);
  assert.throws(
    () => buildInheritedPackage(tooLarge, "archive-seed"),
    /size limit/,
  );
});

test("USD and test units remain exact above JavaScript's safe integer range", () => {
  assert.equal(
    formatUsd(parseUsd("9007199254740993.123456")),
    "9007199254740993.123456",
  );
  assert.equal(toTestTokenUnits("0.000001"), "1");
  assert.equal(formatUsd(parseUsd("0.1") + parseUsd("0.2")), "0.300000");
  for (const invalid of [
    "-1",
    "NaN",
    "0.0000001",
    "1e3",
    "01",
    "Infinity",
    "1.",
  ]) {
    assert.throws(() => parseUsd(invalid), /Invalid/);
  }
});

test("provider cost, valid alternatives, shared production, and selected reuse basis are independent", () => {
  const expenses: Expense[] = [
    {
      id: "plan",
      amountUsd: "0.020000",
      evidence: "provider-reported",
      scope: "new-production",
    },
    {
      id: "a",
      amountUsd: "0.300000",
      evidence: "provider-reported",
      scope: "new-production",
    },
    {
      id: "b",
      amountUsd: "0.450000",
      evidence: "provider-reported",
      scope: "new-production",
    },
    {
      id: "failed",
      amountUsd: "0.100000",
      evidence: "provider-reported",
      scope: "new-production",
    },
    {
      id: "ancestor",
      amountUsd: "0.250000",
      evidence: "provider-reported",
      scope: "ancestor",
    },
  ];
  const candidates = [
    {
      id: "a",
      technicallyDelivered: true,
      expenseIds: ["plan", "a", "ancestor"],
    },
    {
      id: "b",
      technicallyDelivered: true,
      expenseIds: ["plan", "b", "ancestor"],
    },
    { id: "failed", technicallyDelivered: false, expenseIds: ["failed"] },
  ];
  const cost = summarizeCosts({
    expenses,
    candidates,
    selectedCandidateId: "b",
    upstreamReuseFeesUsd: "0.25",
  });
  assert.equal(cost.realProviderExpenseUsd, "0.870000");
  assert.equal(cost.proposedBillableGenerationUsd, "0.770000");
  assert.equal(cost.selectedEligibleReuseBasisUsd, "0.470000");
  assert.equal(cost.upstreamReuseFeesUsd, "0.250000");
  assert.equal(cost.simulatedProviderExpenseUsd, "0.000000");
  const discard = summarizeCosts({
    expenses,
    candidates,
    selectedCandidateId: null,
    upstreamReuseFeesUsd: "0.25",
  });
  assert.equal(discard.proposedBillableGenerationUsd, "0.770000");
  assert.equal(discard.selectedEligibleReuseBasisUsd, null);
  assert.throws(
    () =>
      summarizeCosts({
        expenses,
        candidates,
        selectedCandidateId: "failed",
        upstreamReuseFeesUsd: "0.25",
      }),
    /delivered/,
  );
});

test("duplicate expense identities and dangling dependencies are rejected", () => {
  const expense: Expense = {
    id: "one",
    amountUsd: "0.10",
    evidence: "simulated",
    scope: "new-production",
  };
  assert.throws(
    () =>
      summarizeCosts({
        expenses: [expense, expense],
        candidates: [],
        selectedCandidateId: null,
        upstreamReuseFeesUsd: "0",
      }),
    /Duplicate expense/,
  );
  assert.throws(
    () =>
      summarizeCosts({
        expenses: [expense],
        candidates: [
          { id: "a", technicallyDelivered: true, expenseIds: ["missing"] },
        ],
        selectedCandidateId: "a",
        upstreamReuseFeesUsd: "0",
      }),
    /Unknown candidate expense/,
  );
});
