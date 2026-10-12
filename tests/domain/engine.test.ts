import test from "node:test";
import assert from "node:assert/strict";
import {
  DEMO_LIMITS,
  DEMO_UNIT,
  acceptGroupTerms,
  assertLedgerConservation,
  assertProjectAccess,
  createDemoState,
  deliverFork,
  discardFork,
  exportBranch,
  formatCredits,
  getFundingAccount,
  getOperation,
  getPath,
  getQuote,
  parseCredits,
  publishFork,
  removeMember,
  reserveFork,
  setMemberLimit,
  topUp,
  withdraw,
} from "../../src/domain/index.ts";
import type { DemoState, ForkQuote } from "../../src/domain/index.ts";

const now = Date.UTC(2026, 8, 29, 20);
const quote = (
  state: DemoState,
  overrides: Partial<Parameters<typeof getQuote>[1]> = {},
) =>
  getQuote(state, {
    userId: "priya",
    projectId: "midnight-signal",
    parentId: "sea",
    prompt: "Let the lantern reveal a forgotten path.",
    now,
    ...overrides,
  });
const reserve = (state: DemoState, terms: ForkQuote) =>
  reserveFork(state, terms, { now });

test("integer credit conversion preserves all six decimal places and rejects unsafe input", () => {
  assert.equal(parseCredits("0.000001"), 1);
  assert.equal(parseCredits("1.005"), 1_005_000);
  assert.equal(formatCredits(1_005_000), "1.005");
  assert.equal(formatCredits(DEMO_UNIT), "1.00");
  for (const invalid of ["-1", "1.0000001", "NaN", "1e8", "9007199254.740992"])
    assert.throws(() => parseCredits(invalid));
});

test("ancestor fees include the complete selected path, excluding siblings and descendants", () => {
  const state = createDemoState();
  const terms = quote(state);
  assert.deepEqual(terms.pathIds, ["seed", "signal", "sea"]);
  assert.deepEqual(
    terms.ancestorFees.map((fee) => fee.beneficiaryId),
    ["sam", "priya", "jules"],
  );
  assert.equal(terms.upstreamTotal, 150_000);
  assert.equal(terms.totalMax, 330_000);
  assert.equal(quote(state, { parentId: "seed" }).totalMax, 220_000);
  assert.equal(quote(state, { parentId: "reply" }).upstreamTotal, 230_000);
  assertLedgerConservation(state);
});

test("quote tampering rejects omitted, duplicate, unrelated or substituted recipients even under the cap", () => {
  const state = createDemoState();
  const terms = quote(state);
  const variants = [
    { ...terms, ancestorFees: terms.ancestorFees.slice(1) },
    {
      ...terms,
      ancestorFees: [
        terms.ancestorFees[0],
        terms.ancestorFees[0],
        terms.ancestorFees[2],
      ],
    },
    {
      ...terms,
      ancestorFees: terms.ancestorFees.map((fee, index) =>
        index === 0 ? { ...fee, beneficiaryId: "jules" } : fee,
      ),
    },
    { ...terms, pathIds: ["seed", "harbor"] },
    { ...terms, totalMax: terms.totalMax + 1 },
    { ...terms, fundingAccountId: "personal-sam" },
  ];
  for (const forged of variants)
    assert.throws(() => reserve(state, forged), /Quote terms/);
  assert.equal(state.operations.length, 0);
  assert.equal(
    state.accounts.find((item) => item.id === "personal-priya")!.available,
    8 * DEMO_UNIT,
  );
});

test("reservation and expiry require fresh bounded authorization, not just a balance top-up", () => {
  const state = createDemoState();
  const funded = topUp(state, {
    userId: "priya",
    projectId: "midnight-signal",
    amount: DEMO_UNIT,
  });
  assert.equal(funded.operations.length, 0);
  const terms = quote(funded);
  assert.throws(
    () => reserveFork(funded, terms, { now: terms.expiresAt }),
    /expired/,
  );
  assert.throws(() => reserveFork(funded, terms, { now: now - 1 }), /expired/);
  const held = reserve(funded, terms);
  assert.equal(
    getFundingAccount(held, "priya", "midnight-signal").reserved,
    terms.totalMax,
  );
  assert.strictEqual(reserve(held, terms), held);
  assert.equal(
    held.ledger.filter((entry) => entry.kind === "reservation").length,
    1,
  );
});

test("one personal balance funds two open projects and concurrent quotes cannot overspend", () => {
  let state = createDemoState();
  state = withdraw(state, { userId: "priya", amount: 7_600_000 });
  assert.equal(
    getFundingAccount(state, "priya", "midnight-signal").id,
    getFundingAccount(state, "priya", "paper-moon").id,
  );
  const first = quote(state);
  const second = quote(state, {
    projectId: "paper-moon",
    parentId: "paper-seed",
  });
  state = reserve(state, first);
  assert.throws(() => reserve(state, second), /Add demo credits/);
  assert.throws(
    () => withdraw(state, { userId: "priya", amount: 400_000 }),
    /Active holds/,
  );
  state = withdraw(state, { userId: "priya", amount: 70_000 });
  assert.equal(getFundingAccount(state, "priya", "paper-moon").available, 0);
  assert.equal(
    getFundingAccount(state, "sam", "paper-moon").available,
    12_500_000,
  );
  assertLedgerConservation(state);
});

test("publication settles and credits once, releases unused capacity, and preserves published versions", () => {
  const before = createDemoState();
  const beforeJson = JSON.stringify(before);
  const terms = quote(before);
  const id = `op-${terms.id}`;
  let state = deliverFork(reserve(before, terms), id);
  assert.strictEqual(deliverFork(state, id), state);
  state = publishFork(
    state,
    id,
    "Thanks, Sam and Jules, for a wonderful way in.",
    { now: now + 1_000 },
  );
  assert.equal(JSON.stringify(before), beforeJson);
  const operation = getOperation(state, id);
  assert.equal(operation.status, "published");
  assert.equal(operation.settledAmount, 270_000);
  assert.equal(operation.releasedAmount, 60_000);
  assert.deepEqual(state.claims, { sam: 40_000, priya: 60_000, jules: 50_000 });
  assert.equal(
    getFundingAccount(state, "priya", "midnight-signal").available,
    7_730_000,
  );
  const moment = state.moments.find(
    (item) => item.id === operation.publishedMomentId,
  )!;
  assert.equal(moment.parentId, "sea");
  assert.equal(moment.reuseFee, DEMO_LIMITS.generationActual); // Ancestor charges are not compounded into its own fee.
  assert.equal(moment.authorId, "priya");
  assert.deepEqual(
    state.moments.filter((item) => item.source === "fixture"),
    before.moments,
  );
  assert.strictEqual(publishFork(state, id), state);
  assert.strictEqual(reserve(state, terms), state);
  assert.throws(() => discardFork(state, id), /delivered candidate/);
  assertLedgerConservation(state);
});

test("discard bills valid generation only, restores ancestor holds, and cannot later publish", () => {
  let state = createDemoState();
  const terms = quote(state);
  const id = `op-${terms.id}`;
  state = reserve(state, terms);
  assert.throws(() => discardFork(state, id), /delivered candidate/); // No invented pre-delivery failure/refund policy.
  state = deliverFork(state, id);
  state = discardFork(state, id, { now: now + 1_000 });
  assert.equal(getOperation(state, id).settledAmount, 120_000);
  assert.equal(getOperation(state, id).releasedAmount, 210_000);
  assert.equal(
    getFundingAccount(state, "priya", "midnight-signal").available,
    7_880_000,
  );
  assert.deepEqual(state.claims, { sam: 0, priya: 0, jules: 0 });
  assert.strictEqual(discardFork(state, id), state);
  assert.throws(() => publishFork(state, id), /delivered candidate/);
  assert.equal(state.moments.length, createDemoState().moments.length);
  assertLedgerConservation(state);
});

test("private membership requires invitation and explicit terms before access or spending", () => {
  let state = createDemoState();
  assert.throws(
    () => assertProjectAccess(state, "jules", "tidepool"),
    /invitation/,
  );
  assert.throws(
    () =>
      topUp(state, {
        userId: "jules",
        projectId: "tidepool",
        amount: DEMO_UNIT,
      }),
    /invitation/,
  );
  assert.throws(
    () =>
      acceptGroupTerms(state, {
        userId: "unknown",
        groupId: "tidepool-friends",
      }),
    /Unknown/,
  );
  state = acceptGroupTerms(state, {
    userId: "jules",
    groupId: "tidepool-friends",
  });
  assert.doesNotThrow(() => assertProjectAccess(state, "jules", "tidepool"));
  const terms = quote(state, {
    userId: "jules",
    projectId: "tidepool",
    parentId: "tidepool-lantern",
  });
  assert.equal(terms.fundingAccountId, "pool-tidepool");
  assert.equal(terms.upstreamTotal, 0);
  assert.deepEqual(terms.ancestorFees, []);
});

test("group top-ups buy neither permissions nor allowance, and empty pools never charge personal funds", () => {
  let state = createDemoState();
  state = setMemberLimit(state, {
    actorId: "sam",
    groupId: "tidepool-friends",
    userId: "priya",
    limit: 100_000,
  });
  const initialMembers = structuredClone(state.memberships);
  const beforePersonal = structuredClone(
    getFundingAccount(state, "priya", "midnight-signal"),
  );
  state = topUp(state, {
    userId: "priya",
    projectId: "tidepool",
    amount: DEMO_UNIT,
    requestId: "group-contribution",
  });
  assert.deepEqual(state.memberships, initialMembers);
  assert.deepEqual(
    getFundingAccount(state, "priya", "midnight-signal"),
    beforePersonal,
  );
  const terms = quote(state, {
    projectId: "tidepool",
    parentId: "tidepool-seed",
  });
  assert.throws(() => reserve(state, terms), /allowance/);
  assert.throws(
    () =>
      setMemberLimit(state, {
        actorId: "priya",
        groupId: "tidepool-friends",
        userId: "priya",
        limit: 20 * DEMO_UNIT,
      }),
    /administrator/,
  );
  const pool = state.accounts.find((item) => item.id === "pool-tidepool")!;
  const removedAvailable = pool.available;
  pool.available = 0;
  pool.spent += removedAvailable;
  state.generationSpent += removedAvailable;
  assert.throws(
    () => reserve(state, terms),
    /personal balance will not be charged/,
  );
  assert.deepEqual(
    getFundingAccount(state, "priya", "midnight-signal"),
    beforePersonal,
  );
  assertLedgerConservation(state);
});

test("group allowance counts active holds and releases only unused capacity after discard", () => {
  let state = setMemberLimit(createDemoState(), {
    actorId: "sam",
    groupId: "tidepool-friends",
    userId: "priya",
    limit: 300_000,
  });
  const first = quote(state, {
    projectId: "tidepool",
    parentId: "tidepool-seed",
  });
  const second = quote(state, {
    projectId: "tidepool",
    parentId: "tidepool-lantern",
  });
  state = reserve(state, first);
  assert.throws(() => reserve(state, second), /allowance/);
  assert.throws(
    () =>
      setMemberLimit(state, {
        actorId: "sam",
        groupId: "tidepool-friends",
        userId: "priya",
        limit: 100_000,
      }),
    /commitments/,
  );
  state = discardFork(deliverFork(state, `op-${first.id}`), `op-${first.id}`, {
    now,
  });
  state = reserve(state, second);
  assert.equal(
    state.memberships.find((item) => item.userId === "priya")!.spent,
    120_000,
  );
  assert.equal(getFundingAccount(state, "priya", "tidepool").reserved, 180_000);
  assertLedgerConservation(state);
});

test("removal blocks access and publication without losing release accounting", () => {
  let state = createDemoState();
  const terms = quote(state, {
    projectId: "tidepool",
    parentId: "tidepool-seed",
  });
  const id = `op-${terms.id}`;
  state = deliverFork(reserve(state, terms), id);
  state = removeMember(state, {
    actorId: "sam",
    groupId: "tidepool-friends",
    userId: "priya",
  });
  assert.throws(
    () => assertProjectAccess(state, "priya", "tidepool"),
    /invitation/,
  );
  assert.throws(() => publishFork(state, id), /invitation/);
  assert.throws(
    () =>
      exportBranch(state, {
        userId: "priya",
        projectId: "tidepool",
        momentId: "tidepool-seed",
      }),
    /invitation/,
  );
  assert.throws(
    () =>
      acceptGroupTerms(state, { userId: "priya", groupId: "tidepool-friends" }),
    /current invitation/,
  );
  state = discardFork(state, id);
  assert.equal(
    state.accounts.find((item) => item.id === "pool-tidepool")!.reserved,
    0,
  );
  assertLedgerConservation(state);
});

test("duplicate deposit and withdrawal receipts are idempotent and reject conflicting replay", () => {
  let state = createDemoState();
  const topUpInput = {
    userId: "priya",
    projectId: "midnight-signal",
    amount: DEMO_UNIT,
    requestId: "receipt-1",
  };
  state = topUp(state, topUpInput);
  assert.strictEqual(topUp(state, topUpInput), state);
  assert.throws(
    () => topUp(state, { ...topUpInput, userId: "jules" }),
    /different terms/,
  );
  const withdrawal = {
    userId: "priya",
    amount: DEMO_UNIT,
    requestId: "withdraw-1",
  };
  state = withdraw(state, withdrawal);
  assert.strictEqual(withdraw(state, withdrawal), state);
  assert.throws(
    () => withdraw(state, { ...withdrawal, amount: 1 }),
    /different terms/,
  );
  assertLedgerConservation(state);
});

test("only same-project published cycle-free ancestors are eligible; oversized paths are refused intact", () => {
  const state = createDemoState();
  assert.throws(
    () => quote(state, { parentId: "paper-seed" }),
    /in this project/,
  );
  assert.throws(
    () => quote(state, { parentId: "private-draft-not-published" }),
    /published moment/,
  );
  state.moments.find((item) => item.id === "seed")!.parentId = "sea";
  assert.throws(() => quote(state), /cyclic/);
  const deep = createDemoState();
  let parent = deep.moments.find((item) => item.id === "seed")!;
  for (let index = 1; index < DEMO_LIMITS.maxAncestors; index += 1) {
    const next = {
      ...structuredClone(parent),
      id: `depth-${index}`,
      parentId: parent.id,
    };
    deep.moments.push(next);
    parent = next;
  }
  assert.equal(
    getPath(deep, "midnight-signal", parent.id).length,
    DEMO_LIMITS.maxAncestors,
  );
  assert.throws(() => quote(deep, { parentId: parent.id }), /ancestry limit/);
});

test("export includes exactly one finished path and explicit permitted fields; repeat export is free", () => {
  let state = createDemoState();
  const terms = quote(state, {
    projectId: "tidepool",
    parentId: "tidepool-lantern",
    prompt: "PRIVATE PROMPT NEVER EXPORTED",
  });
  const id = `op-${terms.id}`;
  state = publishFork(
    deliverFork(reserve(state, terms), id),
    id,
    "Thank you for the lantern.",
  );
  const selected = getOperation(state, id).publishedMomentId!;
  const prior = JSON.stringify(state);
  const branch = exportBranch(state, {
    userId: "priya",
    projectId: "tidepool",
    momentId: selected,
  });
  assert.deepEqual(
    branch.moments.map((item) => item.id),
    ["tidepool-seed", "tidepool-lantern", selected],
  );
  assert.deepEqual(Object.keys(branch.moments[0]).sort(), [
    "credit",
    "id",
    "panels",
    "parentId",
    "termsVersion",
    "title",
    "version",
  ]);
  assert.deepEqual(Object.keys(branch.moments[0].panels[0]).sort(), [
    "caption",
    "imageUrl",
  ]);
  const serialized = JSON.stringify(branch);
  for (const secret of [
    "PRIVATE PROMPT",
    "storyContext",
    "memberships",
    "groupId",
    "fundingAccountId",
    "ancestorFees",
    "receiptId",
  ])
    assert.equal(serialized.includes(secret), false, secret);
  assert.deepEqual(
    exportBranch(state, {
      userId: "priya",
      projectId: "tidepool",
      momentId: selected,
    }),
    branch,
  );
  assert.equal(JSON.stringify(state), prior);
});

test("all state needed to resume a delivered review survives JSON persistence", () => {
  const initial = createDemoState();
  const terms = quote(initial);
  const id = `op-${terms.id}`;
  const stored = JSON.stringify(deliverFork(reserve(initial, terms), id));
  const restored = JSON.parse(stored) as DemoState;
  assert.equal(
    getOperation(restored, id).candidate!.provider,
    "deterministic-fixture",
  );
  const published = publishFork(restored, id);
  assert.equal(getOperation(published, id).status, "published");
  assertLedgerConservation(published);
});
