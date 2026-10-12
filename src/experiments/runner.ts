import { join, resolve } from "node:path";
import { DeterministicFakeProvider, fakeQuote } from "./fake-provider.ts";
import {
  buildInheritedPackage,
  EXPERIMENT_LIMITS,
  loadFixtures,
} from "./fixtures.ts";
import {
  formatUsd,
  parseUsd,
  summarizeCosts,
  toTestTokenUnits,
} from "./money.ts";
import {
  canonicalJson,
  digest,
  validateAttemptId,
  withAttemptLock,
  writeArtifact,
  writeJson,
} from "./storage.ts";
import {
  CANDIDATE_FILES,
  readExperimentRecord,
  readLocalFile,
  validateCandidateManifest,
  validateExperimentRecord,
  validateFixtureResponse,
  validatePanelSvg,
  validateResponseShape,
} from "./validation.ts";
import type { ExperimentRecord, FakeResponse } from "./types.ts";

export interface RunExperimentOptions {
  fixtureId: string;
  attemptId?: string;
  rootDirectory?: string;
  maximumSimulatedExpenseUsd?: string;
  provider?: "fake" | "paid";
  paidApproval?: { apiKey?: string; approvedBudgetUsd?: string };
}

/** This deterministic runner never dispatches paid requests. */
export function requirePaidAdapter(
  approval: RunExperimentOptions["paidApproval"],
): never {
  if (
    !approval?.apiKey?.trim() ||
    !approval.approvedBudgetUsd ||
    parseUsd(approval.approvedBudgetUsd) === 0n
  ) {
    throw new Error(
      "Paid execution is disabled: a server-side API key and explicit positive approved USD budget are required. No request was made.",
    );
  }
  throw new Error(
    "Paid execution is disabled in the deterministic runner. Use the separate experiment:openai command for explicitly paid experiments. Credentials were not used and no request was made.",
  );
}

const now = () => new Date().toISOString();
const defaultRoot = () => resolve(".local/experiments");
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

function event(
  record: ExperimentRecord,
  type: string,
  detail: string,
  durationMs?: number,
): void {
  record.events.push({
    at: now(),
    type,
    detail,
    ...(durationMs === undefined ? {} : { durationMs }),
  });
}

function refreshCosts(record: ExperimentRecord): void {
  record.accounting = summarizeCosts({
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
}

function previewHtml(record: ExperimentRecord): string {
  const escape = (value: string) =>
    value.replace(
      /[<>&"']/g,
      (character) =>
        ({
          "<": "&lt;",
          ">": "&gt;",
          "&": "&amp;",
          '"': "&quot;",
          "'": "&#39;",
        })[character]!,
    );
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fork Night experiment — ${escape(record.id)}</title>
<style>body{max-width:1100px;margin:40px auto;padding:0 20px;background:#f6f0e4;color:#253147;font:17px system-ui}h1{font:42px Georgia,serif}.panels{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}img{width:100%;display:block}figure{margin:0}figcaption{padding:12px 0}code{overflow-wrap:anywhere}@media(max-width:680px){.panels{grid-template-columns:1fr}}</style>
<p>Fork Night / Local experiment</p><h1>The Lantern Archive</h1><p>Deterministic SVG fixture. No AI model, blockchain or payment was used. Artistic quality and real continuity are not evaluated.</p>
<div class="panels">${record.input.fixture.captions.map((caption, index) => `<figure><img src="panel-${index + 1}.svg" alt="Original fixture illustration, panel ${index + 1}"><figcaption>${escape(caption)}</figcaption></figure>`).join("")}</div>
<p>Inherited path: ${record.input.inherited.moments.length ? record.input.inherited.moments.map((moment) => escape(moment.id)).join(" → ") : "none"}.</p>
<p>Simulated generation expense: $${record.accounting.simulatedProviderExpenseUsd}. Actual provider expense: $0.000000.</p><p>Attempt: <code>${escape(record.id)}</code>. See <a href="record.json">the durable receipt</a> and <a href="candidate.json">artifact manifest</a>.</p></html>\n`;
}

export async function runExperiment(
  options: RunExperimentOptions,
): Promise<ExperimentRecord> {
  if (options.provider === "paid") requirePaidAdapter(options.paidApproval);
  const { story, experiments } = await loadFixtures();
  const found = experiments.find((item) => item.id === options.fixtureId);
  if (!found)
    throw new Error(
      `Unknown fixture: ${options.fixtureId}. Use the list command.`,
    );
  const fixture = {
    ...found,
    maximumSimulatedExpenseUsd:
      options.maximumSimulatedExpenseUsd ?? found.maximumSimulatedExpenseUsd,
  };
  const attemptId = options.attemptId ?? `${fixture.id}-local`;
  validateAttemptId(attemptId);
  const root = resolve(options.rootDirectory ?? defaultRoot());
  const directory = join(root, attemptId);
  const inherited = buildInheritedPackage(story, fixture.parentId);
  const input = {
    fixture,
    inherited,
    settings: {
      model: "fork-night-svg-fixture-v1",
      width: 1024,
      height: 768,
      panelCount: 2,
    } as const,
  };
  const serializedInput = canonicalJson(input);
  if (Buffer.byteLength(serializedInput) > EXPERIMENT_LIMITS.maxInputBytes)
    throw new Error("Full experiment input exceeds the local size limit");
  const inputDigest = digest(serializedInput);
  const request = { attemptId, inputDigest, fixture, inherited };
  const provider = new DeterministicFakeProvider(root);
  const quote = fakeQuote(request);
  if (
    parseUsd(quote.simulatedExpenseUsd) >
    parseUsd(fixture.maximumSimulatedExpenseUsd)
  ) {
    throw new Error(
      "Fixture allowance cannot cover this request; generation was not submitted",
    );
  }

  return withAttemptLock(directory, async () => {
    const recordPath = join(directory, "record.json");
    const save = async (record: ExperimentRecord) => {
      record.updatedAt = now();
      refreshCosts(record);
      await writeJson(recordPath, record);
    };
    let record = await readExperimentRecord(directory, attemptId);
    if (record && record.inputDigest !== inputDigest)
      throw new Error(
        "Attempt ID belongs to different immutable inputs. Inspect it or use a new ID for a new attempt.",
      );
    if (record?.status === "delivered") {
      await verifyArtifacts(directory, record);
      return record;
    }
    if (record?.status === "failed") return record;
    if (!record) {
      record = {
        schemaVersion: 1,
        id: attemptId,
        fixtureId: fixture.id,
        fixtureKind: fixture.kind,
        provider: "deterministic-fake",
        evidence: "simulation-only; no provider API call or payment",
        status: "prepared",
        createdAt: now(),
        updatedAt: now(),
        inputDigest,
        input,
        providerRequestId: null,
        providerResponseDigest: null,
        providerCapabilities: {
          idempotentSubmission: true,
          lookupByRequestKey: fixture.scenario !== "lost-reply-uncertain",
          delivery: "synchronous-local-fixture",
          realProviderBehavior: "not-measured",
        },
        dispatchCount: 0,
        retryCount: 0,
        recoveryCount: 0,
        usage: null,
        expenses: [],
        accounting: summarizeCosts({
          expenses: [],
          candidates: [],
          selectedCandidateId: null,
          upstreamReuseFeesUsd: inherited.upstreamReuseFeesUsd,
        }),
        allowance: {
          maximumSimulatedExpenseUsd: formatUsd(
            parseUsd(fixture.maximumSimulatedExpenseUsd),
          ),
          heldSimulatedExpenseUsd: formatUsd(
            parseUsd(fixture.maximumSimulatedExpenseUsd),
          ),
          realExpenseAllowanceUsd: "0.000000",
        },
        artifacts: [],
        events: [],
        validity: {
          technical: "pending",
          continuity: "not-evaluated",
          artisticQuality: "not-evaluated",
          proposedPolicyOnly: true,
        },
        error: null,
      };
      event(
        record,
        "prepared",
        "Immutable input and local simulated allowance recorded before submission",
      );
      await writeJson(join(directory, "input.json"), input);
      await save(record);
    }

    let response: FakeResponse | null = null;
    if (record.status === "prepared") {
      record.status = "dispatching";
      record.dispatchCount += 1;
      event(
        record,
        "dispatch-intent",
        "One new local fixture request; never a real provider call",
      );
      await save(record);
      const start = performance.now();
      try {
        response = await provider.submit(request);
        event(
          record,
          "provider-returned",
          "Local result returned",
          Math.round(performance.now() - start),
        );
      } catch (error) {
        // Every post-dispatch exception is uncertain until reconciliation, not a retry signal.
        record.status = "uncertain";
        record.error = errorMessage(error);
        event(
          record,
          "outcome-uncertain",
          record.error,
          Math.round(performance.now() - start),
        );
        await save(record);
        return record;
      }
    } else {
      record.recoveryCount += 1;
      const start = performance.now();
      const savedResponse = await readLocalFile(
        directory,
        "provider-response.json",
      );
      if (savedResponse !== null) {
        if (
          record.providerResponseDigest &&
          digest(savedResponse) !== record.providerResponseDigest
        ) {
          throw new Error(
            "Saved provider response digest mismatch. Stop for operator review; do not overwrite or regenerate the result.",
          );
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(savedResponse.toString("utf8"));
        } catch {
          throw new Error("Invalid saved provider response: malformed JSON");
        }
        validateResponseShape(parsed);
        response = parsed;
        event(
          record,
          "reconcile-local",
          "Recovered the durable local response; no provider lookup or submission",
          Math.round(performance.now() - start),
        );
      } else {
        response = await provider.recover(request);
        event(
          record,
          "reconcile",
          response
            ? "Recovered the existing remote request; no resubmission"
            : "Outcome remains uncertain; the entire simulated allowance remains held",
          Math.round(performance.now() - start),
        );
      }
      if (!response) {
        record.status = "uncertain";
        record.error =
          "Accepted request cannot be located with the supported recovery method. Stop for operator review; do not create a replacement automatically.";
        await save(record);
        return record;
      }
    }

    validateResponseShape(response);
    const expectedRequestId = `fake_${digest(attemptId + inputDigest).slice(0, 24)}`;
    if (
      response.requestId !== expectedRequestId ||
      (record.providerRequestId !== null &&
        response.requestId !== record.providerRequestId) ||
      canonicalJson(response.usage) !== canonicalJson(quote.usage) ||
      response.simulatedExpenseUsd !== quote.simulatedExpenseUsd ||
      canonicalJson(response.captions) !== canonicalJson(fixture.captions)
    ) {
      throw new Error(
        "Invalid saved provider response: request identity, usage or captions do not match the immutable fixture",
      );
    }
    record.providerRequestId = response.requestId;
    record.usage = response.usage;
    record.expenses = [
      {
        id: `${response.requestId}:production`,
        amountUsd: response.simulatedExpenseUsd,
        evidence: "simulated",
        scope: "new-production",
      },
    ];
    record.status = "storing";
    record.error = null;
    await writeJson(join(directory, "provider-response.json"), response);
    record.providerResponseDigest = digest(canonicalJson(response));
    await save(record);

    try {
      validateFixtureResponse(response);
    } catch (error) {
      record.status = "failed";
      record.validity.technical = "invalid";
      record.error = errorMessage(error);
      record.allowance.heldSimulatedExpenseUsd = "0.000000";
      event(
        record,
        "delivery-invalid",
        "Fixture expense is retained; proposed candidate bill and reuse basis are not created",
      );
      await save(record);
      return record;
    }

    const storageStart = performance.now();
    try {
      const artifacts = [];
      artifacts.push(
        await writeArtifact(directory, "panel-1.svg", response.panels[0]!.svg),
      );
      if (
        fixture.scenario === "storage-interruption" &&
        !record.events.some(
          (item) => item.type === "injected-storage-interruption",
        )
      ) {
        event(
          record,
          "injected-storage-interruption",
          "Panel one exists; pause before panel two. Resume this same attempt.",
        );
        record.error =
          "Injected local artifact-storage interruption. Existing result will be retrieved without generation.";
        await save(record);
        return record;
      }
      artifacts.push(
        await writeArtifact(directory, "panel-2.svg", response.panels[1]!.svg),
      );
      artifacts.push(
        await writeArtifact(
          directory,
          "captions.json",
          canonicalJson(response.captions),
        ),
      );
      const manifest = {
        schemaVersion: 1,
        candidateId: record.id,
        inputDigest: record.inputDigest,
        providerRequestId: record.providerRequestId,
        panels: artifacts.slice(0, 2),
        captions: artifacts[2],
        permittedCredits: [
          ...inherited.moments.map((moment) => ({
            momentId: moment.id,
            maker: moment.maker,
          })),
          { maker: "Deterministic experiment fixture" },
        ],
        selection: "selected-for-experiment-only; not published",
        testQuoteConversion: {
          policy: "fixture-usd-to-mock-v1",
          simulatedUsdPerMockToken: "1.000000",
          decimals: 6,
          generationUnits: toTestTokenUnits(response.simulatedExpenseUsd),
          rounding: "exact; input limited to six decimals",
          realBacking: false,
        },
      };
      artifacts.push(
        await writeArtifact(
          directory,
          "candidate.json",
          canonicalJson(manifest),
        ),
      );
      record.artifacts = artifacts;
      record.status = "delivered";
      record.validity.technical = "complete";
      record.allowance.heldSimulatedExpenseUsd = "0.000000";
      refreshCosts(record);
      record.artifacts.push(
        await writeArtifact(directory, "preview.html", previewHtml(record)),
      );
      await verifyArtifacts(directory, record);
      event(
        record,
        "artifacts-verified",
        "Two controlled SVG panels, captions and digests saved; human continuity and live-provider quality remain unmeasured",
        Math.round(performance.now() - storageStart),
      );
      await save(record);
      return record;
    } catch (error) {
      record.status = "storing";
      record.error = errorMessage(error);
      record.allowance.heldSimulatedExpenseUsd =
        record.allowance.maximumSimulatedExpenseUsd;
      record.validity.technical = "pending";
      event(
        record,
        "storage-error",
        "Saved provider result must be recovered; no automatic new request",
      );
      await save(record);
      return record;
    }
  });
}

async function verifyArtifacts(
  directory: string,
  record: ExperimentRecord,
): Promise<void> {
  validateExperimentRecord(record, record.id);
  const files = new Map<string, Buffer>();
  for (const artifact of record.artifacts) {
    const contents = await readLocalFile(directory, artifact.path);
    if (contents === null)
      throw new Error(`Required candidate file is missing: ${artifact.path}`);
    if (
      digest(contents) !== artifact.sha256 ||
      contents.byteLength !== artifact.bytes
    ) {
      throw new Error(
        `Artifact digest mismatch: ${artifact.path}. The saved result must be investigated, not regenerated automatically.`,
      );
    }
    files.set(artifact.path, contents);
  }
  // All five allowlisted filenames and digests are validated before semantic reads.
  for (const path of CANDIDATE_FILES.slice(0, 2))
    validatePanelSvg(files.get(path)!.toString("utf8"));
  let savedCaptions: unknown;
  let manifest: unknown;
  try {
    savedCaptions = JSON.parse(files.get("captions.json")!.toString("utf8"));
    manifest = JSON.parse(files.get("candidate.json")!.toString("utf8"));
  } catch {
    throw new Error("Invalid candidate manifest or captions: malformed JSON");
  }
  if (
    canonicalJson(savedCaptions) !==
    canonicalJson(record.input.fixture.captions)
  )
    throw new Error(
      "Invalid candidate captions: required captions do not match the fixture",
    );
  validateCandidateManifest(manifest, record);
}

export async function inspectExperiment(
  attemptId: string,
  rootDirectory = defaultRoot(),
): Promise<ExperimentRecord> {
  validateAttemptId(attemptId);
  const directory = join(resolve(rootDirectory), attemptId);
  const record = await readExperimentRecord(directory, attemptId);
  if (!record) throw new Error(`Experiment does not exist: ${attemptId}`);
  if (record.status === "delivered") await verifyArtifacts(directory, record);
  return record;
}

export { loadFixtures } from "./fixtures.ts";
