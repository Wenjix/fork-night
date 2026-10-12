export type FixtureScenario =
  | "success"
  | "lost-reply-recoverable"
  | "lost-reply-uncertain"
  | "storage-interruption"
  | "invalid-output";

export interface StoryMoment {
  id: string;
  projectId: string;
  parentId: string | null;
  version: number;
  published: boolean;
  maker: string;
  summary: string;
  captions: [string, string];
  characterVersionIds: string[];
  referenceIds: string[];
  reuseFeeUsd: string;
}

export interface StoryFixture {
  projectId: string;
  title: string;
  originality: string;
  characters: Array<{ id: string; description: string }>;
  references: Array<{
    id: string;
    description: string;
    reportedGenerationExpenseUsd: null;
  }>;
  moments: StoryMoment[];
}

export interface ExperimentFixture {
  id: string;
  title: string;
  kind: "seed" | "continuation" | "visible-reference-recreation";
  parentId: string | null;
  prompt: string;
  captions: [string, string];
  scenario: FixtureScenario;
  maximumSimulatedExpenseUsd: string;
}

export interface InheritedPackage {
  version: "inheritance-v1";
  projectId: string;
  parentId: string | null;
  moments: StoryMoment[];
  characters: StoryFixture["characters"];
  references: StoryFixture["references"];
  upstreamReuseFeesUsd: string;
}

export interface Expense {
  id: string;
  amountUsd: string;
  evidence: "simulated" | "provider-reported";
  scope: "new-production" | "ancestor";
}

export interface CostCandidate {
  id: string;
  technicallyDelivered: boolean;
  expenseIds: string[];
}

export interface CostSummary {
  currency: "USD";
  realProviderExpenseUsd: string;
  simulatedProviderExpenseUsd: string;
  proposedBillableGenerationUsd: string;
  selectedEligibleReuseBasisUsd: string | null;
  upstreamReuseFeesUsd: string;
  policy: "proposal-simulation-v1";
}

export interface FakeResponse {
  requestId: string;
  model: "fork-night-svg-fixture-v1";
  panels: Array<{ svg: string; width: number; height: number }>;
  captions: string[];
  usage: { inputTokens: number; outputTokens: number; images: number };
  simulatedExpenseUsd: string;
}

export interface Artifact {
  path: string;
  sha256: string;
  bytes: number;
}

export interface ExperimentRecord {
  schemaVersion: 1;
  id: string;
  fixtureId: string;
  fixtureKind: ExperimentFixture["kind"];
  provider: "deterministic-fake";
  evidence: "simulation-only; no provider API call or payment";
  status:
    | "prepared"
    | "dispatching"
    | "uncertain"
    | "storing"
    | "delivered"
    | "failed";
  createdAt: string;
  updatedAt: string;
  inputDigest: string;
  input: {
    fixture: ExperimentFixture;
    inherited: InheritedPackage;
    settings: {
      model: "fork-night-svg-fixture-v1";
      width: 1024;
      height: 768;
      panelCount: 2;
    };
  };
  providerRequestId: string | null;
  /** Optional for older v1 receipts; new saved responses always record a digest. */
  providerResponseDigest?: string | null;
  providerCapabilities: {
    idempotentSubmission: true;
    lookupByRequestKey: boolean;
    delivery: "synchronous-local-fixture";
    realProviderBehavior: "not-measured";
  };
  dispatchCount: number;
  retryCount: number;
  recoveryCount: number;
  usage: FakeResponse["usage"] | null;
  expenses: Expense[];
  accounting: CostSummary;
  allowance: {
    maximumSimulatedExpenseUsd: string;
    heldSimulatedExpenseUsd: string;
    realExpenseAllowanceUsd: "0.000000";
  };
  artifacts: Artifact[];
  events: Array<{
    at: string;
    type: string;
    detail: string;
    durationMs?: number;
  }>;
  validity: {
    technical: "pending" | "complete" | "invalid";
    continuity: "not-evaluated";
    artisticQuality: "not-evaluated";
    proposedPolicyOnly: true;
  };
  error: string | null;
}
