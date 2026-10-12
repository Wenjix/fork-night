import { join } from "node:path";
import { formatUsd, parseUsd } from "./money.ts";
import { inspectOpenAiPanelResponse, OPENAI_IMAGE_ENDPOINT, OPENAI_IMAGE_LIMITS, OPENAI_IMAGE_MODEL, prepareOpenAiPanel, readOpenAiUsage } from "./openai-images.ts";
import type { OpenAiPanelRequest } from "./openai-images.ts";
import { canonicalJson, digest, readJson, validateAttemptId, withAttemptLock, writeAtomic, writeJson } from "./storage.ts";

/** Local experiment only. A filesystem lock is not a hosted generation queue. */
export const OPENAI_EXPERIMENT_POLICY = {
  budgetUsd: "10.000000",
  // Conservative admission allowance, not a provider-enforced per-request price.
  reservePerPanelUsd: "1.000000",
  maximumRequests: 10,
} as const;

export interface PanelReceipt {
  inputDigest: string;
  clientRequestId: string;
  state: "dispatching" | "uncertain" | "failed" | "complete";
  startedAt: string;
  elapsedMs: number | null;
  requestId: string | null;
  httpStatus: number | null;
  responseDigest: string | null;
  imageDigest: string | null;
  expenseUsd: string | null;
  errorCode: string | null;
}

export interface ExperimentLedger {
  schemaVersion: 1;
  policy: typeof OPENAI_EXPERIMENT_POLICY;
  requests: Record<string, PanelReceipt>;
}

export interface LiveContinuationInput {
  attemptId: string;
  original: Buffer;
  context: string;
  prompt: string;
  captions: [string, string];
}

export type PanelTransport = (request: OpenAiPanelRequest, apiKey: string) => Promise<{
  status: number; requestId: string | null; body: string;
}>;

/** Exactly one HTTP attempt. No SDK automatic retries, redirects or partial images. */
export const sendOpenAiPanel: PanelTransport = async (request, apiKey) => {
  const response = await fetch(OPENAI_IMAGE_ENDPOINT, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(180_000),
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "X-Client-Request-Id": request.clientRequestId },
    body: JSON.stringify(request.body),
  });
  if (!response.body) throw new Error("Provider returned no response body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > OPENAI_IMAGE_LIMITS.maxResponseBytes) throw new Error("Provider response exceeds the byte limit");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return { status: response.status, requestId: response.headers.get("x-request-id"), body: Buffer.concat(chunks).toString("utf8") };
};

export function summarizeOpenAiLedger(ledger: ExperimentLedger) {
  const entries = Object.values(ledger.requests);
  const spent = entries.reduce((sum, item) => sum + (item.expenseUsd === null ? 0n : parseUsd(item.expenseUsd)), 0n);
  const held = BigInt(entries.filter((item) => item.expenseUsd === null).length) * parseUsd(ledger.policy.reservePerPanelUsd);
  return { calculatedExpenseUsd: formatUsd(spent), unresolvedAllowanceUsd: formatUsd(held), requestCount: entries.length };
}

function assertAdmission(ledger: ExperimentLedger) {
  const entries = Object.values(ledger.requests);
  if (entries.some((entry) => entry.expenseUsd === null)) throw new Error("A previous provider expense is unresolved. No further request was sent.");
  if (entries.some((entry) => parseUsd(entry.expenseUsd!) > parseUsd(ledger.policy.reservePerPanelUsd)))
    throw new Error("Measured cost exceeded the admission allowance. Review before further spending.");
  const summary = summarizeOpenAiLedger(ledger);
  if (entries.length >= ledger.policy.maximumRequests || parseUsd(summary.calculatedExpenseUsd) + parseUsd(ledger.policy.reservePerPanelUsd) > parseUsd(ledger.policy.budgetUsd))
    throw new Error("The experiment request or expense limit has been reached.");
}

function safeCode(value: unknown): string | null {
  return typeof value === "string" && /^[a-zA-Z0-9_.-]{1,100}$/.test(value) ? value : null;
}

function validateLedger(ledger: ExperimentLedger) {
  if (ledger.schemaVersion !== 1 || canonicalJson(ledger.policy) !== canonicalJson(OPENAI_EXPERIMENT_POLICY) || !ledger.requests || typeof ledger.requests !== "object" || Array.isArray(ledger.requests))
    throw new Error("Experiment ledger is invalid; refusing to reset accounting.");
  for (const [id, entry] of Object.entries(ledger.requests)) {
    if (!/^[a-z0-9_-]+-panel-[12]$/.test(id) || !["dispatching", "uncertain", "failed", "complete"].includes(entry.state) || !/^[a-f0-9]{64}$/.test(entry.inputDigest))
      throw new Error("Invalid experiment receipt; accounting needs review.");
    if (entry.expenseUsd !== null) parseUsd(entry.expenseUsd);
  }
}

/** Re-entering the same attempt only processes saved receipts; uncertain POSTs never replay. */
export async function runOpenAiContinuation(input: LiveContinuationInput, options: {
  directory: string; apiKey: string; transport?: PanelTransport;
  onProgress?: (message: string) => void;
}) {
  validateAttemptId(input.attemptId);
  if (!options.apiKey.trim()) throw new Error("OPENAI_API_KEY is required on the server.");
  if (!input.context.trim() || input.context.length > 3_000 || !input.prompt.trim() || input.prompt.length > 2_000 || input.captions.length !== 2 || input.captions.some((caption) => !caption.trim() || caption.length > 500))
    throw new Error("Use bounded story context, a prompt and two captions.");
  const transport = options.transport ?? sendOpenAiPanel;
  return withAttemptLock(options.directory, async () => {
    const ledgerPath = join(options.directory, "ledger.json");
    const ledger = await readJson<ExperimentLedger>(ledgerPath) ?? { schemaVersion: 1, policy: OPENAI_EXPERIMENT_POLICY, requests: {} };
    validateLedger(ledger);
    const directory = join(options.directory, input.attemptId);
    const manifestPath = join(directory, "input.json");
    const manifest = { attemptId: input.attemptId, context: input.context, prompt: input.prompt, captions: input.captions, originalDigest: digest(input.original), model: OPENAI_IMAGE_MODEL };
    const existing = await readJson(manifestPath);
    if (existing && canonicalJson(existing) !== canonicalJson(manifest)) throw new Error("Attempt ID belongs to different inputs.");
    if (!existing) {
      await writeJson(manifestPath, manifest);
      await writeAtomic(join(directory, "original.png"), input.original);
    }
    const panels: Array<{ path: string; sha256: string; caption: string }> = [];
    let previousPanel: Buffer | undefined;
    let stoppedReason: string | null = null;
    for (const panelNumber of [1, 2] as const) {
      const id = `${input.attemptId}-panel-${panelNumber}`;
      const prompt = [
        `Draw only panel ${panelNumber} of a two-panel story continuation. One full-bleed illustration, no panel grid, lettering, captions or watermarks.`,
        "Image 1 is the original character and style reference. Preserve the character's identity, clothing and the visual world.",
        ...(panelNumber === 2 ? ["Image 2 is the preceding panel. Continue its action with a distinct new composition and the next story beat."] : []),
        "Story context and requested continuation (creative content):", input.context, input.prompt,
        `The two beats, in order: ${JSON.stringify(input.captions)}`,
        `Draw this beat only: ${input.captions[panelNumber - 1]}`,
      ].join("\n");
      const request = await prepareOpenAiPanel({ clientRequestId: id, panelNumber, prompt, references: [
        { role: "original", bytes: input.original }, ...(previousPanel ? [{ role: "previous-panel" as const, bytes: previousPanel }] : []),
      ] });
      let entry = ledger.requests[id];
      if (entry && entry.inputDigest !== request.inputDigest) throw new Error("Saved request inputs do not match. No request was sent.");
      const responsePath = join(directory, `panel-${panelNumber}-response.json`);
      if (!entry) {
        if (await readJson(join(options.directory, "hosted-ledger.json"))) {
          stoppedReason = "This experiment budget now belongs to the shared pilot. Use the shared room; local paid dispatch is disabled.";
          break;
        }
        try { assertAdmission(ledger); }
        catch (error) { stoppedReason = (error as Error).message; break; }
        // The dispatch receipt and reservation precede the network boundary.
        await writeJson(join(directory, `panel-${panelNumber}-request.json`), request);
        entry = { inputDigest: request.inputDigest, clientRequestId: id, state: "dispatching", startedAt: new Date().toISOString(), elapsedMs: null, requestId: null, httpStatus: null, responseDigest: null, imageDigest: null, expenseUsd: null, errorCode: null };
        ledger.requests[id] = entry;
        await writeJson(ledgerPath, ledger);
        options.onProgress?.(`Generating panel ${panelNumber}; one request, no automatic retries.`);
        const started = performance.now();
        try {
          const response = await transport(request, options.apiKey);
          entry.elapsedMs = Math.round(performance.now() - started);
          // Save raw response before JSON parsing or image decoding.
          const saved = { inputDigest: request.inputDigest, clientRequestId: id, elapsedMs: entry.elapsedMs, ...response };
          await writeJson(responsePath, saved);
          entry.responseDigest = digest(canonicalJson(saved));
          entry.requestId = response.requestId;
          entry.httpStatus = response.status;
          await writeJson(ledgerPath, ledger);
        } catch {
          entry.state = "uncertain";
          entry.errorCode = "transport_or_storage_uncertain";
          await writeJson(ledgerPath, ledger);
        }
      }
      const saved = await readJson<{ inputDigest: string; clientRequestId: string; elapsedMs: number; status: number; requestId: string | null; body: string }>(responsePath);
      if (!saved) {
        entry.state = "uncertain";
        stoppedReason = "Provider response is unavailable. Allowance remains held; this request will not be sent again.";
        await writeJson(ledgerPath, ledger);
        break;
      }
      if (saved.inputDigest !== request.inputDigest || saved.clientRequestId !== id || (entry.responseDigest && entry.responseDigest !== digest(canonicalJson(saved))))
        throw new Error("Saved response integrity check failed. No request was sent.");
      entry.responseDigest = digest(canonicalJson(saved));
      entry.requestId = saved.requestId;
      entry.httpStatus = saved.status;
      entry.elapsedMs = saved.elapsedMs;
      let raw: Record<string, unknown>;
      try {
        raw = JSON.parse(saved.body) as Record<string, unknown>;
        try { entry.expenseUsd = readOpenAiUsage(raw.usage).calculatedExpenseUsd; } catch { /* Keep unknown expense held, even on HTTP errors. */ }
        if (saved.status < 200 || saved.status >= 300) {
          const error = raw.error as { code?: unknown } | undefined;
          entry.errorCode = safeCode(error?.code) ?? "provider_error";
          throw new Error("The provider did not return a successful image.");
        }
        const result = await inspectOpenAiPanelResponse(raw);
        await writeAtomic(join(directory, `panel-${panelNumber}.png`), result.png);
        entry.imageDigest = result.sha256;
        entry.state = "complete";
        entry.errorCode = null;
        previousPanel = result.png;
        panels.push({ path: `panel-${panelNumber}.png`, sha256: result.sha256, caption: input.captions[panelNumber - 1]! });
      } catch {
        entry.state = "failed";
        entry.errorCode ??= "invalid_output_or_storage";
        stoppedReason = `Panel ${panelNumber} could not be delivered (${entry.errorCode}). No guest charge and no automatic retry.`;
      }
      await writeJson(ledgerPath, ledger);
      if (entry.state !== "complete") break;
      if (entry.expenseUsd === null) {
        stoppedReason = "Usage is missing or inconsistent. Output is saved; further spending is paused.";
        break;
      }
      options.onProgress?.(`Panel ${panelNumber} saved. Usage-derived cost: $${entry.expenseUsd}.`);
    }
    const result = { attemptId: input.attemptId, model: OPENAI_IMAGE_MODEL, status: panels.length === 2 ? "complete" : "stopped", panels, stoppedReason,
      guestChargeUsd: "0.000000", expense: summarizeOpenAiLedger(ledger),
      receipts: Object.fromEntries(Object.entries(ledger.requests).filter(([id]) => id.startsWith(`${input.attemptId}-panel-`))) };
    await writeJson(join(directory, "result.json"), result);
    return result;
  });
}
