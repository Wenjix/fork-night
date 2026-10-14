/**
 * The Night Watch's local API contract, shared by the routes and the /night-watch page.
 * Every route is local-only (404 unless PILOT_LOCAL_CONTROLS=1 on a loopback request) and, except
 * GET /world, requires the maker's Supabase access token as `Authorization: Bearer …`.
 * Amounts are strings of base units; times are ISO strings.
 */

export const NIGHT_WATCH_ROOM = "midnight-signal";

export type ApiError = { error: string; code?: string };

/** One panel as the page shows it. `imageUrl` is a same-origin URL or a signed storage URL. */
export type WorldPanel = { caption: string; imageUrl: string | null; sha256?: string | null };

export type WorldMoment = {
  id: string;
  parentId: string | null;
  makerId: string | null;
  makerLabel: string;
  title: string;
  panels: WorldPanel[];
  createdAt: string;
  /** "pilot" moments come from the shared room; "night-watch" moments were published here. */
  source: "pilot" | "night-watch";
  /** Present for Night Watch moments: the job and kit version that prepared it. */
  nightWatch?: { jobId: string; kitVersion: string; candidate: number } | null;
};

export type WorldKitView = {
  id: string;
  version: string;
  digest: string;
  title: string;
  creator: string;
  disclosure: string;
  lore: string[];
  style: string[];
  rules: string[];
  starters: string[];
  participation: string[];
  references: { label: string; imageUrl: string }[];
};

export type WorldResponse = {
  room: { id: string; title: string; description: string };
  kit: WorldKitView;
  moments: WorldMoment[];
  /** The latest moment by someone other than the room starter on the default path, if any. */
  friendContribution: { momentId: string; makerLabel: string } | null;
  /** Default fork point: the newest moment on the path the release proof uses. */
  defaultForkPointId: string;
  credits: { limit: number; used: number; reserved: number; available: number; enabled: boolean } | null;
};

export type ConsentTerms = {
  purpose: string;
  roomId: string;
  network: "eip155:84532";
  token: string;
  payTo: string;
  maxPaymentAtomic: string;
  totalAllowanceAtomic: string;
  maxPayments: number;
  attemptAllowance: number;
  deadline: string;
  revocation: string;
};

export type MeResponse = {
  maker: { id: string; displayName: string };
  privy: {
    configured: boolean;
    /** The maker's Privy embedded EVM wallet, when the server can see it. */
    wallet: { id: string; address: string; delegated: boolean; tee: boolean } | null;
    signerId: string | null;
  };
  sessions: SessionView[];
  jobs: JobSummary[];
  runner: { lastSeen: string | null; alive: boolean };
};

export type SessionView = {
  id: string;
  state: "awaiting_signer" | "active" | "revoked" | "expired";
  roomId: string;
  walletAddress: string;
  deadline: string;
  limits: {
    maxPaymentAtomic: string;
    totalAllowanceAtomic: string;
    maxPayments: number;
    attemptAllowance: number;
    payTo: string;
    token: string;
    chainId: number;
  };
  remainingAtomic: string;
  payments: PaymentView[];
  revokedAt: string | null;
};

export type PaymentView = {
  id: string;
  jobId: string;
  amountAtomic: string;
  state: "reserved" | "signed" | "settled" | "released";
  transaction: string | null;
  explorerUrl: string | null;
  creditsAdded: number | null;
  updatedAt: string;
};

/** POST /api/night-watch/sessions */
export type CreateSessionRequest = { hours: number; maxPayments: 0 | 1 | 2; attemptAllowance: 1 | 2 | 3 };
export type CreateSessionResponse = {
  session: SessionView;
  consent: ConsentTerms;
  /** What the page passes to Privy's addSigners. */
  signer: { signerId: string; policyIds: string[]; address: string };
};

/** POST /api/night-watch/sessions/[id]/confirm */
export type SessionResponse = { session: SessionView };

/** POST /api/night-watch/sessions/[id]/revoke: whether Privy's policy now refuses everything, in words. */
export type RevokeSessionResponse = SessionResponse & { privyPolicyRevoked: boolean; message: string };

export type JobState =
  | "scheduled"
  | "checking"
  | "topping_up"
  | "waiting_payment"
  | "generating"
  | "ready"
  | "blocked"
  | "failed"
  | "published";

export type JobSummary = {
  id: string;
  state: JobState;
  sessionId: string;
  forkPointId: string;
  createdAt: string;
  runAfter: string;
  updatedAt: string;
  message: string;
};

export type CandidateView = {
  number: number;
  state: "pending" | "delivered" | "failed" | "uncertain";
  caption: string;
  /** Private image URL; fetch it with the bearer token (no-store). */
  imagePath: string | null;
  sha256: string | null;
  expenseUsd: string | null;
  published: boolean;
};

export type JobEvent = { at: string; step: string; detail: string };

/** POST /api/night-watch/jobs */
export type CreateJobRequest = { sessionId: string; forkPointId: string; brief: string; startInSeconds: number };

/** GET /api/night-watch/jobs/[id] and POST /api/night-watch/jobs */
export type JobResponse = {
  job: JobSummary & {
    brief: string;
    attempts: number;
    kit: { id: string; version: string; digest: string };
    forkPoint: { id: string; title: string; makerLabel: string };
    capacity: { neededCredits: number; availableAtCheck: number | null; charged: number; refunded: number };
    payment: PaymentView | null;
    receipt: {
      network: "eip155:84532";
      transaction: string | null;
      explorerUrl: string | null;
      creditsAdded: number | null;
      roomId: string;
      amountAtomic: string | null;
      payer: string | null;
    } | null;
    expense: { operatorPaidUsd: string; model: string; images: number };
    candidates: CandidateView[];
    events: JobEvent[];
    publishedMomentId: string | null;
    /** Null for jobs from before the brain existed. */
    brain: BrainView | null;
  };
};

/** A model the Night Watch's brain called through TokenRouter, for labels and receipts. */
export type BrainModelView = { model: string; label: string; latencyMs: number | null };

/**
 * The Night Watch's brain for one job: what it read, planned and checked before anything was drawn.
 * `state: "plain"` means the brain was off or did not answer and the night used the plain prompts.
 * Staging text (the image direction) stays private on this machine; only captions and reasons show.
 */
export type BrainView = {
  state: "planned" | "plain";
  /** In words: what the brain did, or why the night used the plain prompts. */
  message: string;
  planner: BrainModelView | null;
  critic: BrainModelView | null;
  /** One or two sentences: what the story needs next, in the Night Watch's voice. */
  readOfTheRoom: string | null;
  /** The candidate the critic suggests looking at first, if it gave one. */
  pick: number | null;
  /** A short note for the morning, in the co-pilot's voice. */
  morningNote: string | null;
  candidates: {
    number: number;
    caption: string;
    why: string;
    /** The critic's verdict against the world kit; null when no critic answered. */
    check: { ok: boolean; note: string } | null;
    /** True when this candidate used the plain prompt instead of the brain's plan. */
    plain: boolean;
  }[];
  /** Operator-paid text inference for this job's brain, in USD (string, 6 decimals). */
  expenseUsd: string;
};

/** POST /api/night-watch/copilot: the desk co-pilot suggests briefs for a fork point. */
export type CopilotRequest = { forkPointId: string; draft?: string };
export type CopilotResponse = {
  copilot: BrainModelView;
  /** One sentence on what the story needs next at this fork point. */
  read: string;
  suggestions: { brief: string; why: string }[];
  expenseUsd: string;
};

/** POST /api/night-watch/jobs/[id]/publish */
export type PublishRequest = { candidate: number };
export type PublishResponse = { moment: WorldMoment };

/** GET /api/night-watch/edition?tip=<momentId> */
export type EditionResponse = {
  tipId: string;
  /** PilotMoment-shaped rows for <TestnetRelease>, the existing release UI. */
  moments: {
    id: string;
    room_id: string;
    parent_id: string | null;
    maker_id: string | null;
    maker_label: string;
    title: string;
    panels: unknown;
    created_at: string;
  }[];
  release: {
    id: string;
    projectId: string;
    tipId: string;
    manifestHash: string;
    beneficiaries: { address: string; claimableWei: string; claimedWei: string }[];
    receivedWei: string;
    paidWei: string;
    exists: boolean;
    finalizedBlock: number | null;
  } | null;
  claims: ClaimView[];
  helper: { address: string; balanceWei: string } | null;
};

export type ClaimView = {
  releaseId: string;
  beneficiary: string;
  state: "signed" | "broadcast" | "confirmed" | "finalized" | "failed";
  hash: string;
  amountWei: string;
  claimedWei: string | null;
  explorerUrl: string;
  updatedAt: string;
};

/** POST /api/night-watch/claims */
export type ClaimRequest = { releaseId: string; beneficiary: string };
export type ClaimResponse = { claim: ClaimView };

/** GET /api/night-watch/identity */
export type IdentityResponse = {
  registered: boolean;
  chainId: 10143;
  registry: string;
  agentId: string | null;
  owner: string | null;
  agentURI: string | null;
  card: {
    name: string;
    description: string;
    steward: string;
    service: string;
    kitVersion: string;
    capabilities: string[];
    evidence: { label: string; url: string }[];
  };
  transaction: string | null;
  explorerUrl: string | null;
  note: string;
};
