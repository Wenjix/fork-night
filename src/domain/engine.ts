import { addAmounts, assertAmount, subtractAmount } from "./money.ts";
import { CURRENT_DEMO_PRICING, demoGenerationPricing, demoReuseFee } from "./pricing.ts";
import { preparedFandomContinuation } from "../lib/fandom-stories.ts";
import type {
  Amount,
  DemoState,
  FinishedExport,
  ForkOperation,
  ForkQuote,
  FundingAccount,
  Membership,
  Moment,
  Project,
  QuoteInput,
} from "./types.ts";

/** Fixture limits exercise bounded admission; these are not measured chain limits. */
export const DEMO_LIMITS = {
  maxAncestors: 32,
  maxPromptLength: 600,
  quoteLifetimeMs: 5 * 60_000,
  ...demoGenerationPricing(CURRENT_DEMO_PRICING),
} as const;

function userExists(state: DemoState, userId: string): void {
  if (!state.users.some((user) => user.id === userId))
    throw new Error("Unknown demo participant.");
}

function projectFor(state: DemoState, projectId: string): Project {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) throw new Error("Project not found.");
  return project;
}

function membershipFor(
  state: DemoState,
  userId: string,
  groupId: string,
): Membership {
  const membership = state.memberships.find(
    (item) => item.userId === userId && item.groupId === groupId,
  );
  if (!membership || membership.status !== "active")
    throw new Error("An accepted group invitation is required.");
  const group = state.groups.find((item) => item.id === groupId);
  if (!group || membership.acceptedTermsVersion !== group.termsVersion) {
    throw new Error(
      "Accept the group's current finished-work sharing terms first.",
    );
  }
  return membership;
}

/** Models the proposed access rule. Browser fixtures are not a security boundary. */
export function assertProjectAccess(
  state: DemoState,
  userId: string,
  projectId: string,
): void {
  userExists(state, userId);
  const project = projectFor(state, projectId);
  if (project.visibility === "private") {
    if (!project.groupId) throw new Error("The private project has no group.");
    const member = membershipFor(state, userId, project.groupId);
    if (member.acceptedTermsVersion !== project.termsVersion)
      throw new Error("Project sharing terms need review.");
  }
}

export function canAccessProject(
  state: DemoState,
  userId: string,
  projectId: string,
): boolean {
  try {
    assertProjectAccess(state, userId, projectId);
    return true;
  } catch {
    return false;
  }
}

/** Internal tree traversal. Callers showing private data must check access first. */
export function getPath(
  state: DemoState,
  projectId: string,
  momentId: string,
): Moment[] {
  const project = projectFor(state, projectId);
  const seen = new Set<string>();
  const reversed: Moment[] = [];
  let cursor: string | null = momentId;
  while (cursor !== null) {
    if (seen.has(cursor))
      throw new Error("The story contains a cyclic parent link.");
    seen.add(cursor);
    const moment = state.moments.find((item) => item.id === cursor);
    if (!moment || moment.projectId !== projectId)
      throw new Error("Choose a published moment in this project.");
    if (!Number.isSafeInteger(moment.version) || moment.version < 1)
      throw new Error("Invalid published moment version.");
    reversed.push(moment);
    if (reversed.length > DEMO_LIMITS.maxAncestors)
      throw new Error(
        "This path exceeds the demo's supported ancestry limit. Choose an earlier moment.",
      );
    cursor = moment.parentId;
  }
  const path = reversed.reverse();
  if (path[0]?.id !== project.seedId)
    throw new Error(
      "The complete path must begin at this project's published seed.",
    );
  return path;
}

export function getFundingAccount(
  state: DemoState,
  userId: string,
  projectId: string,
): FundingAccount {
  assertProjectAccess(state, userId, projectId);
  const project = projectFor(state, projectId);
  const account = state.accounts.find((item) =>
    project.visibility === "open"
      ? item.kind === "personal" && item.ownerId === userId
      : item.kind === "group" && item.groupId === project.groupId,
  );
  if (!account)
    throw new Error(
      "The project's funding account is unavailable; no alternate account will be charged.",
    );
  return account;
}

function validTime(time: number): void {
  if (
    !Number.isSafeInteger(time) ||
    time < 0 ||
    time > Number.MAX_SAFE_INTEGER - DEMO_LIMITS.quoteLifetimeMs
  )
    throw new Error("Invalid operation time.");
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** A deterministic fixture identifier, deliberately not a cryptographic signature. */
function fixtureId(value: unknown): string {
  let hash = 2166136261;
  for (const char of canonical(value))
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16);
}

export function getQuote(state: DemoState, input: QuoteInput): ForkQuote {
  assertProjectAccess(state, input.userId, input.projectId);
  const project = projectFor(state, input.projectId);
  const prompt = input.prompt.trim();
  if (prompt.length < 3 || prompt.length > DEMO_LIMITS.maxPromptLength) {
    throw new Error(
      `Describe your continuation in 3–${DEMO_LIMITS.maxPromptLength} characters.`,
    );
  }
  const issuedAt = input.now ?? Date.now();
  validTime(issuedAt);
  const path = getPath(state, input.projectId, input.parentId);
  // Leave room for the new published moment; never silently truncate ancestry.
  if (path.length >= DEMO_LIMITS.maxAncestors)
    throw new Error(
      "This path is at the demo's ancestry limit. Choose an earlier moment.",
    );
  const account = getFundingAccount(state, input.userId, input.projectId);
  const ancestorFees =
    project.visibility === "private"
      ? []
      : path.map((moment) => {
          userExists(state, moment.beneficiaryId);
          return {
            momentId: moment.id,
            version: moment.version,
            beneficiaryId: moment.beneficiaryId,
            amount: demoReuseFee(moment),
          };
        });
  const upstreamTotal = addAmounts(...ancestorFees.map((item) => item.amount));
  const terms = {
    userId: input.userId,
    projectId: input.projectId,
    parentId: input.parentId,
    parentVersion: path[path.length - 1].version,
    fundingAccountId: account.id,
    prompt,
    ancestorFees,
    pathIds: path.map((moment) => moment.id),
    upstreamTotal,
    generationMax: DEMO_LIMITS.generationMax,
    totalMax: addAmounts(upstreamTotal, DEMO_LIMITS.generationMax),
    issuedAt,
    expiresAt: issuedAt + DEMO_LIMITS.quoteLifetimeMs,
    termsVersion: project.termsVersion,
    pricingVersion: CURRENT_DEMO_PRICING,
  };
  return { id: `q-${input.userId}-${issuedAt}-${fixtureId(terms)}`, ...terms };
}

export function getOperation(
  state: DemoState,
  operationId: string,
): ForkOperation {
  const operation = state.operations.find((item) => item.id === operationId);
  if (!operation) throw new Error("Fork operation not found.");
  return operation;
}

function active(operation: ForkOperation): boolean {
  return operation.status === "reserved" || operation.status === "delivered";
}

export function getMemberCommitted(
  state: DemoState,
  groupId: string,
  userId: string,
): Amount {
  return addAmounts(
    ...state.operations
      .filter(
        (operation) =>
          active(operation) &&
          operation.quote.userId === userId &&
          state.accounts.some(
            (account) =>
              account.id === operation.quote.fundingAccountId &&
              account.groupId === groupId,
          ),
      )
      .map((operation) => operation.quote.totalMax),
  );
}

export function reserveFork(
  state: DemoState,
  quote: ForkQuote,
  options: { now?: number } = {},
): DemoState {
  const existing = state.operations.find(
    (operation) => operation.id === `op-${quote.id}`,
  );
  if (existing) {
    if (canonical(existing.quote) !== canonical(quote))
      throw new Error("This operation identity already has different terms.");
    return state;
  }
  const now = options.now ?? Date.now();
  validTime(now);
  if (now < quote.issuedAt || now >= quote.expiresAt)
    throw new Error("This quote has expired. Review a fresh quote.");
  const expected = getQuote(state, {
    userId: quote.userId,
    projectId: quote.projectId,
    parentId: quote.parentId,
    prompt: quote.prompt,
    now: quote.issuedAt,
  });
  if (canonical(expected) !== canonical(quote))
    throw new Error(
      "Quote terms changed or the complete ancestor fees do not match. Request a new quote.",
    );
  const account = getFundingAccount(state, quote.userId, quote.projectId);
  if (account.available < quote.totalMax)
    throw new Error(
      account.kind === "group"
        ? "The group needs a recharge. Your personal balance will not be charged."
        : "Add demo credits to your personal balance before reserving this fork.",
    );
  if (account.groupId) {
    const member = membershipFor(state, quote.userId, account.groupId);
    if (!member.canSpend)
      throw new Error(
        "A group administrator must enable your spending permission.",
      );
    const committed = getMemberCommitted(state, account.groupId, quote.userId);
    if (
      addAmounts(member.spent, committed, quote.totalMax) > member.spendingLimit
    )
      throw new Error(
        "This reservation exceeds your group spending allowance.",
      );
  }
  const next = structuredClone(state);
  const nextAccount = next.accounts.find((item) => item.id === account.id)!;
  nextAccount.available = subtractAmount(nextAccount.available, quote.totalMax);
  nextAccount.reserved = addAmounts(nextAccount.reserved, quote.totalMax);
  const operation = {
    id: `op-${quote.id}`,
    quote: structuredClone(quote),
    status: "reserved" as const,
  };
  next.operations.push(operation);
  next.ledger.push({
    id: `reserve-${quote.id}`,
    kind: "reservation",
    accountId: account.id,
    userId: quote.userId,
    operationId: operation.id,
    amount: quote.totalMax,
    description:
      "Demo hold confirmed; no provider call or blockchain transaction.",
  });
  assertLedgerConservation(next);
  return next;
}

/** Deterministic successful delivery only; no paid provider call or retry policy. */
export function deliverFork(state: DemoState, operationId: string): DemoState {
  const operation = getOperation(state, operationId);
  if (operation.status !== "reserved") return state;
  const next = structuredClone(state);
  const updated = getOperation(next, operationId);
  const parent = next.moments.find(
    (moment) => moment.id === operation.quote.parentId,
  )!;
  const { generationActual } = demoGenerationPricing(operation.quote.pricingVersion);
  updated.status = "delivered";
  updated.generationActual = generationActual;
  const prepared = preparedFandomContinuation(operation.quote.projectId, parent);
  updated.candidate = {
    title: prepared?.title ?? "The story finds another way",
    panels: prepared?.panels ?? [
      {
        imageUrl: "/art/midnight-story.webp#frame=5",
        caption: "Mira held the lantern steady. The signal was changing.",
      },
      {
        imageUrl: "/art/midnight-story.webp#frame=3",
        caption:
          "Above the water, a new path appeared—waiting for someone to take the next step.",
      },
    ],
    storyContext: prepared
      ? `${parent.storyContext} ${prepared.panels.map(panel => panel.caption).join(" ")}`
      : `${parent.storyContext} The collaborators imagined a new path above the water.`,
    provider: "deterministic-fixture",
    receiptId: `fixture-receipt-${operationId}`,
    generationActual,
    eligibleReuseBasis: generationActual,
  };
  return next;
}

function closeOperation(
  state: DemoState,
  operationId: string,
  outcome: "published" | "discarded",
  thanks: string,
  now: number,
): DemoState {
  const operation = getOperation(state, operationId);
  if (operation.status === outcome) return state;
  if (operation.status !== "delivered" || !operation.candidate)
    throw new Error(
      "Review a delivered candidate before publishing or discarding it.",
    );
  if (outcome === "published")
    assertProjectAccess(
      state,
      operation.quote.userId,
      operation.quote.projectId,
    );
  validTime(now);
  const actual = operation.candidate.generationActual;
  assertAmount(actual);
  if (actual > operation.quote.generationMax)
    throw new Error("Generation exceeds the authorized maximum.");
  const feeTotal = outcome === "published" ? operation.quote.upstreamTotal : 0;
  const settledAmount = addAmounts(actual, feeTotal);
  const releasedAmount = subtractAmount(
    operation.quote.totalMax,
    settledAmount,
  );
  const next = structuredClone(state);
  const updated = getOperation(next, operationId);
  const account = next.accounts.find(
    (item) => item.id === operation.quote.fundingAccountId,
  );
  if (!account) throw new Error("The original funding account is missing.");
  account.reserved = subtractAmount(account.reserved, operation.quote.totalMax);
  account.available = addAmounts(account.available, releasedAmount);
  account.spent = addAmounts(account.spent, settledAmount);
  next.generationSpent = addAmounts(next.generationSpent, actual);
  if (account.groupId) {
    // Removal prevents publication, but must not strand a legitimate balance release.
    const member = next.memberships.find(
      (item) =>
        item.groupId === account.groupId &&
        item.userId === operation.quote.userId,
    );
    if (!member)
      throw new Error("The original member accounting record is missing.");
    member.spent = addAmounts(member.spent, settledAmount);
  }
  Object.assign(updated, {
    status: outcome,
    settledAmount,
    releasedAmount,
    settledAt: now,
  });
  if (outcome === "published") {
    const project = projectFor(next, operation.quote.projectId);
    // Revalidate published ancestry/version so a corrupt persisted state cannot rewrite the fork point.
    const path = getPath(next, project.id, operation.quote.parentId);
    if (
      canonical(path.map((moment) => moment.id)) !==
        canonical(operation.quote.pathIds) ||
      path[path.length - 1].version !== operation.quote.parentVersion
    )
      throw new Error("The authorized parent path changed.");
    for (const fee of operation.quote.ancestorFees)
      next.claims[fee.beneficiaryId] = addAmounts(
        next.claims[fee.beneficiaryId] ?? 0,
        fee.amount,
      );
    const publishedMomentId = `moment-${operation.id}`;
    const candidate = operation.candidate;
    const newMoment: Moment = {
      id: publishedMomentId,
      projectId: project.id,
      parentId: operation.quote.parentId,
      version: 1,
      authorId: operation.quote.userId,
      title: candidate.title,
      panels: structuredClone(candidate.panels),
      storyContext: candidate.storyContext,
      reuseFee:
        project.visibility === "open" ? candidate.eligibleReuseBasis : 0,
      beneficiaryId: operation.quote.userId,
      termsVersion: operation.quote.termsVersion,
      publishedAt: now,
      source: "demo-generation",
      ...(thanks.trim() ? { builtOnThanks: thanks.trim().slice(0, 280) } : {}),
    };
    next.moments.push(newMoment);
    updated.publishedMomentId = publishedMomentId;
  }
  next.ledger.push({
    id: `settle-${operationId}`,
    kind: outcome === "published" ? "publication" : "discard",
    accountId: account.id,
    userId: operation.quote.userId,
    operationId,
    amount: settledAmount,
    releasedAmount,
    description:
      outcome === "published"
        ? "Simulated publication: generation and agreed ancestor credits settled once."
        : "Valid demo delivery discarded: generation charged; ancestor hold released.",
  });
  assertLedgerConservation(next);
  return next;
}

export function publishFork(
  state: DemoState,
  operationId: string,
  thanks = "",
  options: { now?: number } = {},
): DemoState {
  return closeOperation(
    state,
    operationId,
    "published",
    thanks,
    options.now ?? Date.now(),
  );
}

export function discardFork(
  state: DemoState,
  operationId: string,
  options: { now?: number } = {},
): DemoState {
  return closeOperation(
    state,
    operationId,
    "discarded",
    "",
    options.now ?? Date.now(),
  );
}

export function topUp(
  state: DemoState,
  input: {
    userId: string;
    projectId: string;
    amount: Amount;
    requestId?: string;
  },
): DemoState {
  assertAmount(input.amount);
  if (input.amount === 0) throw new Error("Enter an amount greater than zero.");
  const account = getFundingAccount(state, input.userId, input.projectId);
  const id = `top-up-${input.requestId ?? `local-${state.ledger.length}`}`;
  const old = state.ledger.find((entry) => entry.id === id);
  if (old) {
    if (
      old.accountId !== account.id ||
      old.userId !== input.userId ||
      old.amount !== input.amount
    )
      throw new Error("This top-up identity already has different terms.");
    return state;
  }
  const next = structuredClone(state);
  const updated = next.accounts.find((item) => item.id === account.id)!;
  updated.available = addAmounts(updated.available, input.amount);
  updated.deposited = addAmounts(updated.deposited, input.amount);
  next.ledger.push({
    id,
    kind: "top-up",
    accountId: account.id,
    userId: input.userId,
    amount: input.amount,
    description:
      account.kind === "group"
        ? "Demo contribution to the shared pool; no ownership or allowance change."
        : "Fictional demo credits added; no wallet or provider funding.",
  });
  assertLedgerConservation(next);
  return next;
}

export function withdraw(
  state: DemoState,
  input: { userId: string; amount: Amount; requestId?: string },
): DemoState {
  userExists(state, input.userId);
  assertAmount(input.amount);
  if (input.amount === 0) throw new Error("Enter an amount greater than zero.");
  const account = state.accounts.find(
    (item) => item.kind === "personal" && item.ownerId === input.userId,
  );
  if (!account) throw new Error("Your personal account is unavailable.");
  const id = `withdraw-${input.requestId ?? `local-${state.ledger.length}`}`;
  const old = state.ledger.find((entry) => entry.id === id);
  if (old) {
    if (
      old.accountId !== account.id ||
      old.userId !== input.userId ||
      old.amount !== input.amount
    )
      throw new Error("This withdrawal identity already has different terms.");
    return state;
  }
  if (input.amount > account.available)
    throw new Error(
      "Only available personal funds can be withdrawn. Active holds stay reserved.",
    );
  const next = structuredClone(state);
  const updated = next.accounts.find((item) => item.id === account.id)!;
  updated.available = subtractAmount(updated.available, input.amount);
  updated.withdrawn = addAmounts(updated.withdrawn, input.amount);
  next.ledger.push({
    id,
    kind: "withdrawal",
    accountId: account.id,
    userId: input.userId,
    amount: input.amount,
    description: "Simulated personal withdrawal; no wallet transfer occurred.",
  });
  assertLedgerConservation(next);
  return next;
}

export function acceptGroupTerms(
  state: DemoState,
  input: { userId: string; groupId: string },
): DemoState {
  userExists(state, input.userId);
  const group = state.groups.find((item) => item.id === input.groupId);
  const member = state.memberships.find(
    (item) => item.groupId === input.groupId && item.userId === input.userId,
  );
  if (!group || !member || member.status === "removed")
    throw new Error("A current invitation is required to join this group.");
  const next = structuredClone(state);
  const updated = next.memberships.find(
    (item) => item.groupId === input.groupId && item.userId === input.userId,
  )!;
  updated.status = "active";
  updated.acceptedTermsVersion = group.termsVersion;
  return next;
}

function assertAdmin(state: DemoState, actorId: string, groupId: string): void {
  const member = membershipFor(state, actorId, groupId);
  const group = state.groups.find((item) => item.id === groupId);
  if (member.role !== "admin" || group?.adminId !== actorId)
    throw new Error(
      "Only the group's administrator can change these permissions.",
    );
}

export function setMemberLimit(
  state: DemoState,
  input: { actorId: string; groupId: string; userId: string; limit: Amount },
): DemoState {
  assertAdmin(state, input.actorId, input.groupId);
  assertAmount(input.limit);
  const member = state.memberships.find(
    (item) => item.groupId === input.groupId && item.userId === input.userId,
  );
  if (!member || member.status === "removed")
    throw new Error("Group member not found.");
  if (
    input.limit <
    addAmounts(
      member.spent,
      getMemberCommitted(state, input.groupId, input.userId),
    )
  )
    throw new Error(
      "The new limit cannot erase already spent or reserved commitments.",
    );
  const next = structuredClone(state);
  next.memberships.find(
    (item) => item.groupId === input.groupId && item.userId === input.userId,
  )!.spendingLimit = input.limit;
  return next;
}

export function removeMember(
  state: DemoState,
  input: { actorId: string; groupId: string; userId: string },
): DemoState {
  assertAdmin(state, input.actorId, input.groupId);
  if (input.userId === input.actorId)
    throw new Error(
      "This demo does not implement administrator transfer or group closure.",
    );
  const next = structuredClone(state);
  const member = next.memberships.find(
    (item) => item.groupId === input.groupId && item.userId === input.userId,
  );
  if (!member) throw new Error("Group member not found.");
  member.status = "removed";
  return next;
}

export function exportBranch(
  state: DemoState,
  input: { userId: string; projectId: string; momentId: string },
): FinishedExport {
  assertProjectAccess(state, input.userId, input.projectId);
  const project = projectFor(state, input.projectId);
  const path = getPath(state, project.id, input.momentId);
  return {
    format: "fork-night-finished-branch",
    version: 1,
    mode: "local-demo",
    projectTitle: project.title,
    selectedMomentId: input.momentId,
    termsVersion: project.termsVersion,
    moments: path.map((moment) => ({
      id: moment.id,
      version: moment.version,
      parentId: moment.parentId,
      title: moment.title,
      panels: moment.panels.map((item) => ({
        imageUrl: item.imageUrl,
        caption: item.caption,
      })) as Moment["panels"],
      credit: {
        name:
          state.users.find((user) => user.id === moment.authorId)?.name ??
          "Contributor",
        ...(moment.builtOnThanks ? { thankYou: moment.builtOnThanks } : {}),
      },
      termsVersion: moment.termsVersion,
    })),
  };
}

/** Accounting proof for local fixtures; it is not a chain receipt verifier. */
export function assertLedgerConservation(state: DemoState): void {
  for (const account of state.accounts) {
    for (const amount of [
      account.available,
      account.reserved,
      account.spent,
      account.deposited,
      account.withdrawn,
    ])
      assertAmount(amount);
    if (
      account.deposited !==
      addAmounts(
        account.available,
        account.reserved,
        account.spent,
        account.withdrawn,
      )
    )
      throw new Error("Account accounting does not reconcile.");
    const held = addAmounts(
      ...state.operations
        .filter(
          (operation) =>
            active(operation) &&
            operation.quote.fundingAccountId === account.id,
        )
        .map((operation) => operation.quote.totalMax),
    );
    if (held !== account.reserved)
      throw new Error("Outstanding operation holds do not reconcile.");
  }
  const deposited = addAmounts(
    ...state.accounts.map((account) => account.deposited),
  );
  const accounted = addAmounts(
    ...state.accounts.flatMap((account) => [
      account.available,
      account.reserved,
      account.withdrawn,
    ]),
    ...Object.values(state.claims),
    state.generationSpent,
  );
  if (deposited !== accounted)
    throw new Error(
      "Demo credits are not conserved across balances and recipients.",
    );
}
