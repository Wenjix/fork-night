import { assertLedgerConservation, DEMO_LIMITS, getPath } from "./engine.ts";
import { addAmounts } from "./money.ts";
import type { DemoState } from "./types.ts";
import { isApprovedArtUrl, isStoryArtUrl } from "../lib/art.ts";

type Check = (value: unknown, path: string) => void;
const fail = (path: string): never => {
  throw new Error(
    `Saved demo data is invalid at ${path}. Reset the local demo to continue.`,
  );
};
const ensure = (condition: unknown, path: string): void => {
  if (!condition) fail(path);
};
const object = (value: unknown, path: string): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return fail(path);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return fail(path);
  return value as Record<string, unknown>;
};
const text =
  (max: number, min = 1): Check =>
  (value, path) =>
    ensure(
      typeof value === "string" && value.length >= min && value.length <= max,
      path,
    );
const choice =
  (...options: unknown[]): Check =>
  (value, path) =>
    ensure(options.includes(value), path);
const money: Check = (value, path) =>
  ensure(
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0,
    path,
  );
const positiveInteger: Check = (value, path) => {
  money(value, path);
  ensure((value as number) > 0, path);
};
const time: Check = (value, path) => {
  money(value, path);
  ensure(
    (value as number) <= Number.MAX_SAFE_INTEGER - DEMO_LIMITS.quoteLifetimeMs,
    path,
  );
};
const id: Check = (value, path) => {
  text(200)(value, path);
  ensure(
    /^[A-Za-z0-9][A-Za-z0-9:_-]*$/.test(value as string) &&
      !["__proto__", "constructor", "prototype"].includes(value as string),
    path,
  );
};
const nullable =
  (check: Check): Check =>
  (value, path) => {
    if (value !== null) check(value, path);
  };
const list =
  (check: Check, max = 10_000): Check =>
  (value, path) => {
    if (!Array.isArray(value) || value.length > max) return fail(path);
    for (let index = 0; index < value.length; index += 1)
      check(value[index], `${path}[${index}]`);
  };
const shape =
  (
    required: Record<string, Check>,
    optional: Record<string, Check> = {},
  ): Check =>
  (value, path) => {
    const record = object(value, path);
    for (const [key, check] of Object.entries(required))
      check(record[key], `${path}.${key}`);
    for (const key of Object.keys(record)) {
      if (Object.hasOwn(required, key)) continue;
      if (!Object.hasOwn(optional, key)) fail(`${path}.${key}`);
      optional[key](record[key], `${path}.${key}`);
    }
  };
const media: Check = (value, path) => ensure(isStoryArtUrl(value), path);
const panel = shape({ imageUrl: media, caption: text(2_000) });
const panels: Check = (value, path) => {
  list(panel, 3)(value, path);
  ensure((value as unknown[]).length >= 1, path);
};
const member = shape({
  groupId: id,
  userId: id,
  role: choice("admin", "contributor"),
  status: choice("active", "invited", "removed"),
  acceptedTermsVersion: nullable(id),
  canSpend: choice(true, false),
  spendingLimit: money,
  spent: money,
});
const moment = shape(
  {
    id,
    projectId: id,
    parentId: nullable(id),
    version: positiveInteger,
    authorId: id,
    title: text(300),
    panels,
    storyContext: text(20_000),
    reuseFee: money,
    beneficiaryId: id,
    termsVersion: id,
    publishedAt: time,
    source: choice("fixture", "demo-generation", "local-original"),
  },
  { builtOnThanks: text(280) },
);
const quote = shape({
  id,
  userId: id,
  projectId: id,
  parentId: id,
  parentVersion: positiveInteger,
  fundingAccountId: id,
  prompt: text(DEMO_LIMITS.maxPromptLength, 3),
  ancestorFees: list(
    shape({
      momentId: id,
      version: positiveInteger,
      beneficiaryId: id,
      amount: money,
    }),
    DEMO_LIMITS.maxAncestors,
  ),
  pathIds: list(id, DEMO_LIMITS.maxAncestors),
  upstreamTotal: money,
  generationMax: money,
  totalMax: money,
  issuedAt: time,
  expiresAt: time,
  termsVersion: id,
  pricingVersion: choice("fixture-price-v1"),
});
const candidate = shape({
  title: text(300),
  panels,
  storyContext: text(20_000),
  provider: choice("deterministic-fixture"),
  receiptId: id,
  generationActual: money,
  eligibleReuseBasis: money,
});
const operation = shape(
  {
    id,
    quote,
    status: choice("reserved", "delivered", "published", "discarded"),
  },
  {
    candidate,
    generationActual: money,
    publishedMomentId: id,
    settledAmount: money,
    releasedAmount: money,
    settledAt: time,
  },
);
const ledger = shape(
  {
    id,
    kind: choice(
      "opening",
      "top-up",
      "withdrawal",
      "reservation",
      "publication",
      "discard",
    ),
    accountId: id,
    userId: id,
    amount: money,
    description: text(1_000),
  },
  { operationId: id, releasedAmount: money },
);
const claims: Check = (value, path) => {
  for (const [key, amount] of Object.entries(object(value, path))) {
    id(key, `${path}.${key}`);
    money(amount, `${path}.${key}`);
  }
};
const stateShape = shape({
  version: choice(1),
  users: list(
    shape({
      id,
      name: text(100),
      initials: text(4),
      color: (value, path) =>
        ensure(
          typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value),
          path,
        ),
    }),
  ),
  projects: list(
    shape({
      id,
      title: text(300),
      description: text(2_000),
      visibility: choice("open", "private"),
      groupId: nullable(id),
      creatorId: id,
      seedId: id,
      termsVersion: id,
      coverUrl: media,
    }),
  ),
  groups: list(
    shape({
      id,
      name: text(100),
      adminId: id,
      termsVersion: id,
      cartridgeCapacity: positiveInteger,
    }),
  ),
  memberships: list(member),
  moments: list(moment),
  accounts: list(
    shape({
      id,
      kind: choice("personal", "group"),
      ownerId: nullable(id),
      groupId: nullable(id),
      available: money,
      reserved: money,
      spent: money,
      deposited: money,
      withdrawn: money,
    }),
  ),
  operations: list(operation),
  ledger: list(ledger),
  claims,
  generationSpent: money,
});

function unique(values: string[], path: string): Set<string> {
  const set = new Set(values);
  ensure(set.size === values.length, path);
  return set;
}

/**
 * Validate local JSON before restoring it. This catches corruption and incompatible
 * snapshots, not a person deliberately editing their own demo. It authenticates
 * neither users nor payments. UI-only selected IDs must be reconciled separately.
 */
export function validateDemoState(value: unknown): asserts value is DemoState {
  stateShape(value, "state");
  const state = value as DemoState;
  const users = unique(
    state.users.map((item) => item.id),
    "users",
  );
  const projects = unique(
    state.projects.map((item) => item.id),
    "projects",
  );
  const groups = unique(
    state.groups.map((item) => item.id),
    "groups",
  );
  const moments = unique(
    state.moments.map((item) => item.id),
    "moments",
  );
  const accounts = unique(
    state.accounts.map((item) => item.id),
    "accounts",
  );
  unique(
    state.operations.map((item) => item.id),
    "operations",
  );
  unique(
    state.ledger.map((item) => item.id),
    "ledger",
  );
  unique(
    state.memberships.map((item) => `${item.groupId}/${item.userId}`),
    "memberships",
  );
  ensure(users.size > 0 && projects.size > 0, "initial fixtures");
  ensure(
    Object.keys(state.claims).length === users.size &&
      [...users].every((userId) => Object.hasOwn(state.claims, userId)),
    "claims identities",
  );

  for (const project of state.projects) {
    ensure(
      users.has(project.creatorId) && moments.has(project.seedId),
      `project ${project.id} references`,
    );
    const seed = state.moments.find((item) => item.id === project.seedId)!;
    ensure(
      seed.projectId === project.id && seed.parentId === null,
      `project ${project.id} seed`,
    );
    ensure(
      seed.source === "local-original" || isApprovedArtUrl(project.coverUrl),
      `project ${project.id} artwork`,
    );
    ensure(
      project.visibility === "open"
        ? project.groupId === null
        : project.groupId !== null && groups.has(project.groupId),
      `project ${project.id} funding mode`,
    );
    if (project.groupId)
      ensure(
        state.groups.find((item) => item.id === project.groupId)!
          .termsVersion === project.termsVersion,
        `project ${project.id} group terms`,
      );
  }
  for (const group of state.groups) {
    const admin = state.memberships.find(
      (item) => item.groupId === group.id && item.userId === group.adminId,
    );
    ensure(
      users.has(group.adminId) &&
        admin?.role === "admin" &&
        admin.status === "active",
      `group ${group.id} administrator`,
    );
  }
  for (const member of state.memberships) {
    ensure(
      users.has(member.userId) && groups.has(member.groupId),
      "membership references",
    );
    const group = state.groups.find((item) => item.id === member.groupId)!;
    ensure(
      member.role === "admin"
        ? member.userId === group.adminId
        : member.userId !== group.adminId,
      "membership role",
    );
    ensure(
      member.acceptedTermsVersion === null ||
        member.acceptedTermsVersion === group.termsVersion,
      "membership terms",
    );
    ensure(
      member.status !== "active" ||
        member.acceptedTermsVersion === group.termsVersion,
      "active membership terms",
    );
    ensure(
      member.spent <= member.spendingLimit,
      "membership spending allowance",
    );
  }
  for (const account of state.accounts) {
    ensure(
      account.kind === "personal"
        ? account.ownerId !== null &&
            users.has(account.ownerId) &&
            account.groupId === null
        : account.ownerId === null &&
            account.groupId !== null &&
            groups.has(account.groupId) &&
            account.withdrawn === 0,
      `account ${account.id} ownership`,
    );
  }
  for (const userId of users)
    ensure(
      state.accounts.filter(
        (item) => item.kind === "personal" && item.ownerId === userId,
      ).length === 1,
      `personal account for ${userId}`,
    );
  for (const groupId of groups)
    ensure(
      state.accounts.filter(
        (item) => item.kind === "group" && item.groupId === groupId,
      ).length === 1,
      `group account for ${groupId}`,
    );
  for (const moment of state.moments) {
    ensure(
      projects.has(moment.projectId) &&
        users.has(moment.authorId) &&
        users.has(moment.beneficiaryId),
      `moment ${moment.id} references`,
    );
    const project = state.projects.find(
      (item) => item.id === moment.projectId,
    )!;
    ensure(
      moment.termsVersion === project.termsVersion &&
        moment.beneficiaryId === moment.authorId,
      `moment ${moment.id} published terms`,
    );
    ensure(
      project.visibility !== "private" || moment.reuseFee === 0,
      `private moment ${moment.id} fees`,
    );
    getPath(state, moment.projectId, moment.id); // Includes same-project, root, cycle and depth checks.
    if (moment.source === "local-original")
      ensure(
        project.visibility === "open" &&
          moment.id === project.seedId &&
          moment.parentId === null &&
          moment.authorId === project.creatorId &&
          moment.reuseFee === 0 &&
          moment.version === 1 &&
          moment.builtOnThanks === undefined &&
          !state.operations.some((item) => item.publishedMomentId === moment.id),
        `moment ${moment.id} original seed`,
      );
    else
      ensure(
        moment.panels.every((panel) => isApprovedArtUrl(panel.imageUrl)),
        `moment ${moment.id} fixture artwork`,
      );
    if (moment.source === "demo-generation")
      ensure(
        state.operations.some(
          (item) =>
            item.status === "published" && item.publishedMomentId === moment.id,
        ),
        `moment ${moment.id} publication`,
      );
  }

  for (const operation of state.operations) {
    const quote = operation.quote;
    ensure(
      operation.id === `op-${quote.id}` &&
        users.has(quote.userId) &&
        projects.has(quote.projectId) &&
        accounts.has(quote.fundingAccountId),
      `operation ${operation.id} identities`,
    );
    const project = state.projects.find((item) => item.id === quote.projectId)!;
    const account = state.accounts.find(
      (item) => item.id === quote.fundingAccountId,
    )!;
    ensure(
      project.visibility === "open"
        ? account.kind === "personal" && account.ownerId === quote.userId
        : account.kind === "group" &&
            account.groupId === project.groupId &&
            state.memberships.some(
              (item) =>
                item.groupId === project.groupId &&
                item.userId === quote.userId,
            ),
      `operation ${operation.id} funding owner`,
    );
    const path = getPath(state, quote.projectId, quote.parentId);
    ensure(
      path.length < DEMO_LIMITS.maxAncestors &&
        quote.pathIds.length === path.length &&
        path.every((item, index) => item.id === quote.pathIds[index]),
      `operation ${operation.id} complete path`,
    );
    ensure(
      quote.parentVersion === path[path.length - 1].version &&
        quote.termsVersion === project.termsVersion,
      `operation ${operation.id} parent version`,
    );
    const pricedPath = project.visibility === "open" ? path : [];
    ensure(
      quote.ancestorFees.length === pricedPath.length &&
        pricedPath.every((item, index) => {
          const fee = quote.ancestorFees[index];
          return (
            fee.momentId === item.id &&
            fee.version === item.version &&
            fee.beneficiaryId === item.beneficiaryId &&
            fee.amount === item.reuseFee
          );
        }),
      `operation ${operation.id} complete fees`,
    );
    ensure(
      quote.upstreamTotal ===
        addAmounts(...quote.ancestorFees.map((fee) => fee.amount)) &&
        quote.generationMax === DEMO_LIMITS.generationMax &&
        quote.totalMax === addAmounts(quote.upstreamTotal, quote.generationMax),
      `operation ${operation.id} quote amounts`,
    );
    ensure(
      quote.expiresAt === quote.issuedAt + DEMO_LIMITS.quoteLifetimeMs &&
        quote.prompt.trim() === quote.prompt,
      `operation ${operation.id} quote bounds`,
    );
    if (operation.status === "reserved") {
      ensure(
        operation.candidate === undefined &&
          operation.generationActual === undefined,
        `operation ${operation.id} undelivered state`,
      );
    } else {
      const candidate = operation.candidate;
      ensure(
        candidate &&
          candidate.receiptId === `fixture-receipt-${operation.id}` &&
          candidate.generationActual === DEMO_LIMITS.generationActual &&
          operation.generationActual === candidate.generationActual &&
          candidate.eligibleReuseBasis === candidate.generationActual &&
          candidate.panels.every((panel) => isApprovedArtUrl(panel.imageUrl)) &&
          candidate.generationActual <= quote.generationMax,
        `operation ${operation.id} candidate receipt`,
      );
    }
    const closed =
      operation.status === "published" || operation.status === "discarded";
    if (closed) {
      const settled = addAmounts(
        operation.generationActual!,
        operation.status === "published" ? quote.upstreamTotal : 0,
      );
      ensure(
        operation.settledAmount === settled &&
          operation.releasedAmount === quote.totalMax - settled &&
          operation.settledAt !== undefined &&
          operation.settledAt >= quote.issuedAt,
        `operation ${operation.id} settlement`,
      );
    } else {
      ensure(
        operation.settledAmount === undefined &&
          operation.releasedAmount === undefined &&
          operation.settledAt === undefined,
        `operation ${operation.id} unsettled state`,
      );
    }
    if (operation.status === "published") {
      const published = state.moments.find(
        (item) => item.id === operation.publishedMomentId,
      );
      const candidate = operation.candidate!;
      ensure(
        published &&
          published.id === `moment-${operation.id}` &&
          published.source === "demo-generation" &&
          published.version === 1 &&
          published.projectId === quote.projectId &&
          published.parentId === quote.parentId &&
          published.authorId === quote.userId &&
          published.beneficiaryId === quote.userId &&
          published.title === candidate.title &&
          published.storyContext === candidate.storyContext &&
          published.publishedAt === operation.settledAt &&
          published.reuseFee ===
            (project.visibility === "open"
              ? candidate.eligibleReuseBasis
              : 0) &&
          published.panels.every(
            (panel, index) =>
              panel.imageUrl === candidate.panels[index].imageUrl &&
              panel.caption === candidate.panels[index].caption,
          ),
        `operation ${operation.id} published output`,
      );
    } else
      ensure(
        operation.publishedMomentId === undefined,
        `operation ${operation.id} unpublished state`,
      );
  }

  for (const entry of state.ledger) {
    ensure(
      accounts.has(entry.accountId) && users.has(entry.userId),
      `ledger ${entry.id} references`,
    );
    const operation = entry.operationId
      ? state.operations.find((item) => item.id === entry.operationId)
      : undefined;
    if (["reservation", "publication", "discard"].includes(entry.kind)) {
      ensure(
        operation &&
          operation.quote.fundingAccountId === entry.accountId &&
          operation.quote.userId === entry.userId,
        `ledger ${entry.id} operation`,
      );
      if (entry.kind === "reservation")
        ensure(
          entry.id === `reserve-${operation!.quote.id}` &&
            entry.amount === operation!.quote.totalMax &&
            entry.releasedAmount === undefined,
          `ledger ${entry.id} reservation`,
        );
      else
        ensure(
          entry.id === `settle-${operation!.id}` &&
            operation!.status ===
              (entry.kind === "publication" ? "published" : "discarded") &&
            entry.amount === operation!.settledAmount &&
            entry.releasedAmount === operation!.releasedAmount,
          `ledger ${entry.id} settlement`,
        );
    } else
      ensure(
        entry.operationId === undefined && entry.releasedAmount === undefined,
        `ledger ${entry.id} standalone record`,
      );
    const account = state.accounts.find((item) => item.id === entry.accountId)!;
    ensure(
      account.kind === "personal"
        ? account.ownerId === entry.userId
        : state.memberships.some(
            (item) =>
              item.groupId === account.groupId && item.userId === entry.userId,
          ),
      `ledger ${entry.id} account owner`,
    );
    if (entry.kind === "withdrawal")
      ensure(
        account.kind === "personal",
        `ledger ${entry.id} personal withdrawal`,
      );
  }
  for (const operation of state.operations) {
    ensure(
      state.ledger.filter(
        (entry) =>
          entry.operationId === operation.id && entry.kind === "reservation",
      ).length === 1,
      `operation ${operation.id} reservation record`,
    );
    const settlements = state.ledger.filter(
      (entry) =>
        entry.operationId === operation.id &&
        ["publication", "discard"].includes(entry.kind),
    );
    ensure(
      settlements.length ===
        (operation.status === "published" || operation.status === "discarded"
          ? 1
          : 0),
      `operation ${operation.id} settlement count`,
    );
  }
  for (const member of state.memberships) {
    const memberOperations = state.operations.filter(
      (item) =>
        item.quote.userId === member.userId &&
        state.accounts.find(
          (account) => account.id === item.quote.fundingAccountId,
        )?.groupId === member.groupId,
    );
    const committed = addAmounts(
      ...memberOperations
        .filter((item) => ["reserved", "delivered"].includes(item.status))
        .map((item) => item.quote.totalMax),
    );
    const spent = addAmounts(
      ...memberOperations
        .filter((item) => ["published", "discarded"].includes(item.status))
        .map((item) => item.settledAmount!),
    );
    ensure(member.spent === spent, "member settled allowance");
    ensure(
      addAmounts(member.spent, committed) <= member.spendingLimit,
      "member committed allowance",
    );
  }
  for (const account of state.accounts) {
    const entries = state.ledger.filter(
      (entry) => entry.accountId === account.id,
    );
    ensure(
      account.spent ===
        addAmounts(
          ...entries
            .filter((entry) =>
              ["opening", "publication", "discard"].includes(entry.kind),
            )
            .map((entry) => entry.amount),
        ),
      `account ${account.id} settled history`,
    );
    ensure(
      account.withdrawn ===
        addAmounts(
          ...entries
            .filter((entry) => entry.kind === "withdrawal")
            .map((entry) => entry.amount),
        ),
      `account ${account.id} withdrawal history`,
    );
  }
  for (const userId of users) {
    const owed = state.operations
      .filter((item) => item.status === "published")
      .flatMap((item) => item.quote.ancestorFees)
      .filter((fee) => fee.beneficiaryId === userId);
    ensure(
      state.claims[userId] === addAmounts(...owed.map((fee) => fee.amount)),
      `recipient ${userId} credits`,
    );
  }
  const generation = addAmounts(
    ...state.ledger
      .filter((entry) => entry.kind === "opening")
      .map((entry) => entry.amount),
    ...state.operations
      .filter((item) => ["published", "discarded"].includes(item.status))
      .map((item) => item.generationActual!),
  );
  ensure(state.generationSpent === generation, "generation expense history");
  assertLedgerConservation(state);
}
