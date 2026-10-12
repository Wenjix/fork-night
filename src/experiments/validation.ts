import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { EXPERIMENT_LIMITS } from "./fixtures.ts";
import { parseUsd, summarizeCosts, sumUsd, toTestTokenUnits } from "./money.ts";
import { canonicalJson, digest, validateAttemptId } from "./storage.ts";
import type { Artifact, ExperimentRecord, FakeResponse } from "./types.ts";

export const CANDIDATE_FILES = [
  "panel-1.svg",
  "panel-2.svg",
  "captions.json",
  "candidate.json",
  "preview.html",
] as const;
const LOCAL_FILES = new Set<string>([
  ...CANDIDATE_FILES,
  "record.json",
  "provider-response.json",
]);
const SHA256 = /^[a-f0-9]{64}$/;
const REQUEST_ID = /^fake_[a-f0-9]{24}$/;
const MAX_LOCAL_FILE_BYTES = 2 * 1024 * 1024;

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;
const counter = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const oneOf = (value: unknown, choices: readonly unknown[]) =>
  choices.includes(value);
const timestamp = (value: unknown) =>
  text(value) && !Number.isNaN(Date.parse(value));
const stringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(text);
const captions = (value: unknown): value is [string, string] =>
  stringArray(value) &&
  value.length === 2 &&
  value.every((item) => item.trim().length > 0);
const usd = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  try {
    parseUsd(value);
    return true;
  } catch {
    return false;
  }
};

function requireRecord(condition: unknown, detail: string): asserts condition {
  if (!condition)
    throw new Error(`Invalid persisted experiment record: ${detail}`);
}

function validUsage(value: unknown): value is FakeResponse["usage"] {
  return (
    object(value) &&
    counter(value.inputTokens) &&
    counter(value.outputTokens) &&
    counter(value.images)
  );
}

function validArtifact(value: unknown): value is Artifact {
  return (
    object(value) &&
    text(value.path) &&
    CANDIDATE_FILES.includes(value.path as (typeof CANDIDATE_FILES)[number]) &&
    typeof value.sha256 === "string" &&
    SHA256.test(value.sha256) &&
    counter(value.bytes) &&
    value.bytes > 0 &&
    value.bytes <= MAX_LOCAL_FILE_BYTES
  );
}

/** Validate the entire persisted boundary before using status, counters or file paths. */
export function validateExperimentRecord(
  value: unknown,
  expectedId: string,
): asserts value is ExperimentRecord {
  requireRecord(object(value), "expected an object");
  requireRecord(
    value.schemaVersion === 1 && value.id === expectedId,
    "schema version or attempt identity mismatch",
  );
  validateAttemptId(expectedId);
  requireRecord(
    text(value.fixtureId) &&
      oneOf(value.fixtureKind, [
        "seed",
        "continuation",
        "visible-reference-recreation",
      ]),
    "invalid fixture identity",
  );
  requireRecord(
    value.provider === "deterministic-fake" &&
      value.evidence === "simulation-only; no provider API call or payment",
    "invalid evidence/provider",
  );
  requireRecord(
    oneOf(value.status, [
      "prepared",
      "dispatching",
      "uncertain",
      "storing",
      "delivered",
      "failed",
    ]),
    "invalid status",
  );
  requireRecord(
    timestamp(value.createdAt) && timestamp(value.updatedAt),
    "invalid timestamps",
  );
  requireRecord(
    typeof value.inputDigest === "string" && SHA256.test(value.inputDigest),
    "invalid input digest",
  );
  requireRecord(
    object(value.input) &&
      object(value.input.fixture) &&
      object(value.input.inherited) &&
      object(value.input.settings),
    "invalid input structure",
  );
  const { fixture, inherited, settings } = value.input;
  requireRecord(
    fixture.id === value.fixtureId &&
      fixture.kind === value.fixtureKind &&
      text(fixture.title) &&
      text(fixture.prompt),
    "invalid fixture input",
  );
  requireRecord(
    fixture.parentId === null || text(fixture.parentId),
    "invalid parent",
  );
  requireRecord(
    captions(fixture.captions) && usd(fixture.maximumSimulatedExpenseUsd),
    "invalid captions or simulated cap",
  );
  requireRecord(
    oneOf(fixture.scenario, [
      "success",
      "lost-reply-recoverable",
      "lost-reply-uncertain",
      "storage-interruption",
      "invalid-output",
    ]),
    "invalid scenario",
  );
  requireRecord(
    settings.model === "fork-night-svg-fixture-v1" &&
      settings.width === 1024 &&
      settings.height === 768 &&
      settings.panelCount === 2,
    "invalid model settings",
  );
  requireRecord(
    inherited.version === "inheritance-v1" &&
      text(inherited.projectId) &&
      inherited.parentId === fixture.parentId,
    "invalid inherited identity",
  );
  requireRecord(
    Array.isArray(inherited.moments) &&
      inherited.moments.length <= EXPERIMENT_LIMITS.maxAncestors,
    "invalid moment list",
  );
  let previousId: string | null = null;
  const momentIds = new Set<string>();
  const fees: string[] = [];
  for (const moment of inherited.moments) {
    requireRecord(
      object(moment) &&
        text(moment.id) &&
        !momentIds.has(moment.id) &&
        moment.projectId === inherited.projectId,
      "invalid or duplicate inherited moment",
    );
    requireRecord(
      moment.parentId === previousId &&
        moment.published === true &&
        counter(moment.version) &&
        moment.version > 0,
      "invalid published ancestry",
    );
    requireRecord(
      text(moment.maker) &&
        text(moment.summary) &&
        captions(moment.captions) &&
        stringArray(moment.characterVersionIds) &&
        stringArray(moment.referenceIds) &&
        usd(moment.reuseFeeUsd),
      "invalid moment contents",
    );
    previousId = moment.id;
    momentIds.add(moment.id);
    fees.push(moment.reuseFeeUsd);
  }
  requireRecord(
    previousId === inherited.parentId &&
      inherited.upstreamReuseFeesUsd === sumUsd(fees),
    "incomplete path or incorrect ancestor subtotal",
  );
  requireRecord(
    Array.isArray(inherited.characters) &&
      inherited.characters.every(
        (item) => object(item) && text(item.id) && text(item.description),
      ),
    "invalid character versions",
  );
  requireRecord(
    Array.isArray(inherited.references) &&
      inherited.references.every(
        (item) =>
          object(item) &&
          text(item.id) &&
          text(item.description) &&
          item.reportedGenerationExpenseUsd === null,
      ),
    "invalid imported references",
  );
  requireRecord(
    Buffer.byteLength(canonicalJson(value.input)) <=
      EXPERIMENT_LIMITS.maxInputBytes &&
      digest(canonicalJson(value.input)) === value.inputDigest,
    "input digest mismatch",
  );
  requireRecord(
    value.providerRequestId === null ||
      (typeof value.providerRequestId === "string" &&
        REQUEST_ID.test(value.providerRequestId)),
    "invalid provider identity",
  );
  requireRecord(
    value.providerResponseDigest === undefined ||
      value.providerResponseDigest === null ||
      (typeof value.providerResponseDigest === "string" &&
        SHA256.test(value.providerResponseDigest)),
    "invalid provider-response digest",
  );
  requireRecord(
    object(value.providerCapabilities) &&
      value.providerCapabilities.idempotentSubmission === true &&
      typeof value.providerCapabilities.lookupByRequestKey === "boolean" &&
      value.providerCapabilities.delivery === "synchronous-local-fixture" &&
      value.providerCapabilities.realProviderBehavior === "not-measured",
    "invalid provider capabilities",
  );
  requireRecord(
    counter(value.dispatchCount) &&
      counter(value.retryCount) &&
      counter(value.recoveryCount),
    "invalid request counters",
  );
  requireRecord(
    value.usage === null || validUsage(value.usage),
    "invalid usage",
  );
  requireRecord(
    Array.isArray(value.expenses) &&
      value.expenses.every(
        (expense) =>
          object(expense) &&
          text(expense.id) &&
          usd(expense.amountUsd) &&
          expense.evidence === "simulated" &&
          expense.scope === "new-production",
      ),
    "invalid simulated expenses",
  );
  requireRecord(
    object(value.allowance) &&
      usd(value.allowance.maximumSimulatedExpenseUsd) &&
      usd(value.allowance.heldSimulatedExpenseUsd) &&
      value.allowance.realExpenseAllowanceUsd === "0.000000",
    "invalid allowance",
  );
  requireRecord(
    parseUsd(value.allowance.maximumSimulatedExpenseUsd) ===
      parseUsd(fixture.maximumSimulatedExpenseUsd) &&
      parseUsd(value.allowance.heldSimulatedExpenseUsd) <=
        parseUsd(value.allowance.maximumSimulatedExpenseUsd),
    "invalid allowance bounds",
  );
  requireRecord(
    Array.isArray(value.events) &&
      value.events.every(
        (entry) =>
          object(entry) &&
          timestamp(entry.at) &&
          text(entry.type) &&
          text(entry.detail) &&
          (entry.durationMs === undefined || counter(entry.durationMs)),
      ),
    "invalid events",
  );
  requireRecord(
    value.error === null || typeof value.error === "string",
    "invalid error details",
  );
  requireRecord(
    object(value.validity) &&
      value.validity.continuity === "not-evaluated" &&
      value.validity.artisticQuality === "not-evaluated" &&
      value.validity.proposedPolicyOnly === true,
    "invalid validity evidence",
  );
  const technical =
    value.status === "delivered"
      ? "complete"
      : value.status === "failed"
        ? "invalid"
        : "pending";
  requireRecord(
    value.validity.technical === technical,
    "status and technical validity disagree",
  );
  requireRecord(
    Array.isArray(value.artifacts) && value.artifacts.every(validArtifact),
    "artifact names or metadata are invalid",
  );
  const paths = value.artifacts.map((artifact) => artifact.path);
  requireRecord(
    new Set(paths).size === paths.length,
    "duplicate artifact names",
  );
  if (value.status === "delivered") {
    requireRecord(
      paths.length === CANDIDATE_FILES.length &&
        CANDIDATE_FILES.every((path) => paths.includes(path)),
      "delivered candidate requires exactly five expected files",
    );
    requireRecord(
      value.providerRequestId !== null &&
        value.usage !== null &&
        value.expenses.length > 0 &&
        value.allowance.heldSimulatedExpenseUsd === "0.000000",
      "incomplete delivery receipt",
    );
  }
  const record = value as unknown as ExperimentRecord;
  let expectedAccounting;
  try {
    expectedAccounting = summarizeCosts({
      expenses: record.expenses,
      candidates: [
        {
          id: record.id,
          technicallyDelivered: record.status === "delivered",
          expenseIds: record.expenses.map((expense) => expense.id),
        },
      ],
      selectedCandidateId: record.status === "delivered" ? record.id : null,
      upstreamReuseFeesUsd: record.input.inherited.upstreamReuseFeesUsd,
    });
  } catch {
    throw new Error(
      "Invalid persisted experiment record: inconsistent expense identities",
    );
  }
  requireRecord(
    canonicalJson(record.accounting) === canonicalJson(expectedAccounting),
    "accounting does not match recorded dependencies",
  );
}

/** No arbitrary path, symlink, directory or pipe can become an artifact read. */
export async function readLocalFile(
  directory: string,
  name: string,
): Promise<Buffer | null> {
  const path = resolve(directory, name);
  if (!LOCAL_FILES.has(name) || dirname(path) !== resolve(directory))
    throw new Error("Unsafe local experiment file path");
  let handle;
  try {
    handle = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    if ((error as NodeJS.ErrnoException).code === "ELOOP")
      throw new Error(
        `A symbolic link is not permitted for an experiment file: ${name}`,
      );
    throw error;
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_LOCAL_FILE_BYTES)
      throw new Error(`Invalid experiment file type or size: ${name}`);
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

export async function readExperimentRecord(
  directory: string,
  id: string,
): Promise<ExperimentRecord | null> {
  const bytes = await readLocalFile(directory, "record.json");
  if (bytes === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("Invalid persisted experiment record: malformed JSON");
  }
  validateExperimentRecord(parsed, id);
  return parsed;
}

export function validateResponseShape(
  value: unknown,
): asserts value is FakeResponse {
  if (
    !object(value) ||
    typeof value.requestId !== "string" ||
    !REQUEST_ID.test(value.requestId) ||
    value.model !== "fork-night-svg-fixture-v1" ||
    !validUsage(value.usage) ||
    !usd(value.simulatedExpenseUsd) ||
    !Array.isArray(value.panels) ||
    value.panels.length > 2 ||
    !value.panels.every(
      (panel) =>
        object(panel) &&
        text(panel.svg) &&
        counter(panel.width) &&
        counter(panel.height),
    ) ||
    !stringArray(value.captions) ||
    value.captions.length > 2
  ) {
    throw new Error(
      "Invalid saved provider response: malformed metadata or output structure",
    );
  }
}

export function validatePanelSvg(svg: string): void {
  if (
    !svg.startsWith(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="768" viewBox="0 0 1024 768"',
    ) ||
    !svg.endsWith("</svg>\n")
  ) {
    throw new Error("Invalid deterministic SVG panel or unexpected dimensions");
  }
}

export function validateFixtureResponse(response: FakeResponse): void {
  validateResponseShape(response);
  if (response.panels.length !== 2 || !captions(response.captions)) {
    throw new Error(
      "Incomplete candidate: two panels and two nonempty captions are required",
    );
  }
  for (const panel of response.panels) {
    if (panel.width !== 1024 || panel.height !== 768)
      throw new Error(
        "Invalid deterministic SVG panel or unexpected dimensions",
      );
    validatePanelSvg(panel.svg);
  }
}

export function validateCandidateManifest(
  value: unknown,
  record: ExperimentRecord,
): void {
  const files = new Map(
    record.artifacts.map((artifact) => [artifact.path, artifact]),
  );
  if (
    !object(value) ||
    value.schemaVersion !== 1 ||
    value.candidateId !== record.id ||
    value.inputDigest !== record.inputDigest ||
    value.providerRequestId !== record.providerRequestId ||
    canonicalJson(value.panels) !==
      canonicalJson([files.get("panel-1.svg"), files.get("panel-2.svg")]) ||
    canonicalJson(value.captions) !==
      canonicalJson(files.get("captions.json")) ||
    value.selection !== "selected-for-experiment-only; not published" ||
    !Array.isArray(value.permittedCredits)
  ) {
    throw new Error(
      "Invalid candidate manifest: required media or candidate identity does not match the receipt",
    );
  }
  const conversion = value.testQuoteConversion;
  if (
    !object(conversion) ||
    conversion.policy !== "fixture-usd-to-mock-v1" ||
    conversion.simulatedUsdPerMockToken !== "1.000000" ||
    conversion.decimals !== 6 ||
    conversion.generationUnits !==
      toTestTokenUnits(record.accounting.simulatedProviderExpenseUsd) ||
    conversion.rounding !== "exact; input limited to six decimals" ||
    conversion.realBacking !== false
  ) {
    throw new Error(
      "Invalid candidate manifest: test-only amount conversion does not match the receipt",
    );
  }
}
