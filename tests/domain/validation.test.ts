import test from "node:test";
import assert from "node:assert/strict";
import {
  acceptGroupTerms,
  createDemoState,
  deliverFork,
  discardFork,
  getQuote,
  publishFork,
  removeMember,
  reserveFork,
  topUp,
  validateDemoState,
  withdraw,
} from "../../src/domain/index.ts";
import type { DemoState } from "../../src/domain/index.ts";

const now = Date.UTC(2026, 8, 29, 20);
function withOperation(
  stage: "reserved" | "delivered" | "published" | "discarded",
  privateProject = false,
): DemoState {
  let state = createDemoState();
  const quote = getQuote(state, {
    userId: "priya",
    projectId: privateProject ? "tidepool" : "midnight-signal",
    parentId: privateProject ? "tidepool-lantern" : "sea",
    prompt: "Let the lantern lead us home.",
    now,
  });
  state = reserveFork(state, quote, { now });
  const id = `op-${quote.id}`;
  if (stage !== "reserved") state = deliverFork(state, id);
  if (stage === "published")
    state = publishFork(state, id, "Thank you for the story.", {
      now: now + 1,
    });
  if (stage === "discarded") state = discardFork(state, id, { now: now + 1 });
  return state;
}

test("valid JSON snapshots restore at every lifecycle stage without mutation", () => {
  const states = [
    createDemoState(),
    ...["reserved", "delivered", "published", "discarded"].flatMap((stage) => [
      withOperation(stage as "reserved", false),
      withOperation(stage as "reserved", true),
    ]),
  ];
  let funded = topUp(createDemoState(), {
    userId: "priya",
    projectId: "paper-moon",
    amount: 500_000,
    requestId: "persist-top-up",
  });
  funded = withdraw(funded, {
    userId: "priya",
    amount: 200_000,
    requestId: "persist-withdrawal",
  });
  funded = acceptGroupTerms(funded, {
    userId: "jules",
    groupId: "tidepool-friends",
  });
  states.push(funded);
  for (const state of states) {
    const json = JSON.stringify(state);
    const restored: unknown = JSON.parse(json);
    assert.doesNotThrow(() => validateDemoState(restored));
    assert.equal(JSON.stringify(restored), json);
  }
});

test("removed members' legitimate held, delivered and closed records remain restorable", () => {
  for (const stage of [
    "reserved",
    "delivered",
    "published",
    "discarded",
  ] as const) {
    const state = removeMember(withOperation(stage, true), {
      actorId: "sam",
      groupId: "tidepool-friends",
      userId: "priya",
    });
    assert.doesNotThrow(() =>
      validateDemoState(JSON.parse(JSON.stringify(state))),
    );
  }
});

test("rejects missing arrays, sparse entries, unknown fields, malformed money and unsupported versions", () => {
  for (const value of [
    null,
    [],
    { version: 1 },
    { ...createDemoState(), version: 2 },
    { ...createDemoState(), projects: null },
  ])
    assert.throws(() => validateDemoState(value));
  const mutations: ((state: DemoState) => void)[] = [
    (state) => {
      state.users[0].name = 42 as unknown as string;
    },
    (state) => {
      state.moments[0].panels.length = 0;
    },
    (state) => {
      state.moments[0].panels[0].imageUrl =
        "https://external.example/tracking.png";
    },
    (state) => {
      state.accounts[0].available = -1;
    },
    (state) => {
      state.accounts[0].reserved = 0.5;
    },
    (state) => {
      state.accounts[0].deposited = Number.MAX_SAFE_INTEGER + 1;
    },
    (state) => {
      state.generationSpent = Number.NaN;
    },
    (state) => {
      state.claims.sam = Number.POSITIVE_INFINITY;
    },
    (state) => {
      (state.groups[0] as unknown as Record<string, unknown>).secret =
        "unknown-version-field";
    },
    (state) => {
      delete state.moments[2];
    },
  ];
  for (const mutate of mutations) {
    const state = createDemoState();
    mutate(state);
    assert.throws(() => validateDemoState(state));
  }
});

test("rejects duplicate identities, missing references, cycles and cross-project ancestry", () => {
  const mutations: ((state: DemoState) => void)[] = [
    (state) => {
      state.users.push({ ...state.users[0] });
    },
    (state) => {
      state.accounts.push({ ...state.accounts[0], id: "duplicate-owner" });
    },
    (state) => {
      state.memberships.push({ ...state.memberships[0] });
    },
    (state) => {
      state.accounts[0].ownerId = "missing-user";
    },
    (state) => {
      state.groups[0].adminId = "missing-user";
    },
    (state) => {
      state.projects[0].seedId = "missing-seed";
    },
    (state) => {
      state.moments[1].parentId = "sea";
    },
    (state) => {
      state.moments[1].parentId = "paper-seed";
    },
    (state) => {
      state.moments[0].beneficiaryId = "unregistered-payee";
    },
    (state) => {
      state.projects[2].groupId = "missing-group";
    },
    (state) => {
      state.claims.unregistered = 0;
    },
  ];
  for (const mutate of mutations) {
    const state = createDemoState();
    mutate(state);
    assert.throws(() => validateDemoState(state));
  }
});

test("rejects corrupted quote identity, draft types and incomplete beneficiary lists", () => {
  const mutations: ((state: DemoState) => void)[] = [
    (state) => {
      state.operations[0].id = "another-operation";
    },
    (state) => {
      state.operations[0].quote.userId = "sam";
    },
    (state) => {
      state.operations[0].quote.fundingAccountId = "pool-tidepool";
    },
    (state) => {
      state.operations[0].quote.parentVersion += 1;
    },
    (state) => {
      state.operations[0].quote.prompt = "x".repeat(601);
    },
    (state) => {
      state.operations[0].quote.prompt = "   ";
    },
    (state) => {
      state.operations[0].quote.ancestorFees.splice(0, 1);
    },
    (state) => {
      state.operations[0].quote.ancestorFees[0].beneficiaryId = "jules";
    },
    (state) => {
      state.operations[0].quote.pathIds.push("harbor");
    },
    (state) => {
      state.operations[0].quote.expiresAt += 1;
    },
    (state) => {
      state.operations[0].quote.totalMax += 1;
    },
    (state) => {
      state.operations[0].candidate!.panels[0].caption =
        null as unknown as string;
    },
    (state) => {
      state.operations[0].candidate!.receiptId = "wrong-receipt";
    },
    (state) => {
      state.operations[0].candidate!.eligibleReuseBasis += 1;
    },
    (state) => {
      state.operations[0].status = "reserved";
    },
  ];
  for (const mutate of mutations) {
    const state = withOperation("delivered");
    mutate(state);
    assert.throws(() => validateDemoState(state));
  }
});

test("rejects inconsistent finished outputs, releases and duplicate settlement events", () => {
  const mutations: ((state: DemoState) => void)[] = [
    (state) => {
      state.operations[0].settledAmount! += 1;
    },
    (state) => {
      state.operations[0].releasedAmount! += 1;
    },
    (state) => {
      state.operations[0].settledAt = now - 1;
    },
    (state) => {
      state.operations[0].publishedMomentId = "missing-output";
    },
    (state) => {
      state.moments[state.moments.length - 1].parentId = "harbor";
    },
    (state) => {
      state.moments[state.moments.length - 1].reuseFee += 1;
    },
    (state) => {
      state.moments[state.moments.length - 1].panels[0].caption =
        "A different settled output.";
    },
    (state) => {
      state.ledger.pop();
    },
    (state) => {
      state.ledger.push({
        ...state.ledger[state.ledger.length - 1],
        id: "duplicate-settlement",
      });
    },
    (state) => {
      state.claims.sam -= 1;
      state.claims.jules += 1;
    }, // Global conservation alone would miss a swapped beneficiary.
    (state) => {
      state.accounts[1].available += 1;
    },
    (state) => {
      state.generationSpent += 1;
      state.claims.jules -= 1;
    },
  ];
  for (const mutate of mutations) {
    const state = withOperation("published");
    mutate(state);
    assert.throws(() => validateDemoState(state));
  }
});

test("rejects private pool authority drift and lost member spending commitments", () => {
  const mutations: ((state: DemoState) => void)[] = [
    (state) => {
      state.memberships[1].acceptedTermsVersion = null;
    },
    (state) => {
      state.memberships[1].spendingLimit = 1;
    },
    (state) => {
      state.memberships[1].spent = 0;
    },
    (state) => {
      state.accounts[3].ownerId = "sam";
    },
    (state) => {
      state.operations[0].quote.fundingAccountId = "personal-priya";
    },
  ];
  for (const mutate of mutations) {
    const state = withOperation("published", true);
    mutate(state);
    assert.throws(() => validateDemoState(state));
  }
});
