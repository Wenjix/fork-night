import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import type { Database } from "../lib/supabase/database.types.ts";
import { isUuid, pilotContext, pilotPanels, pilotPath } from "../lib/pilot.ts";
import { canonicalJson, digest } from "../experiments/storage.ts";
import { parseUsd } from "../experiments/money.ts";
import {
  inspectOpenAiPanelResponse,
  prepareOpenAiPanel,
  readOpenAiUsage,
} from "../experiments/openai-images.ts";
import { sendOpenAiPanel } from "../experiments/openai-live.ts";
import { pilotAdmin } from "./client.ts";
import { readStored, saveStored } from "./storage.ts";
import { validPilotCaptions } from "../lib/pilot-format.ts";
import { executionEnvironment, maintainClaim, type Execution } from "./execution.ts";

function parseReply(body: string) {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

/** Trigger owns execution. Postgres owns dispatch uniqueness, holds and delivery. */
export async function generatePilotContinuation(operationId: string, execution: Execution, signal?: AbortSignal) {
  if (!isUuid(operationId)) throw new Error("Invalid contribution ID.");
  const environment = executionEnvironment(execution.environment);
  if (!execution.runId || !Number.isSafeInteger(execution.dispatchVersion) || execution.dispatchVersion < 1)
    throw new Error("The saved execution is unavailable.");
  const client = pilotAdmin();
  const claimToken = randomUUID();
  const claim = {
    p_operation_id: operationId,
    p_claim_token: claimToken,
    p_version: execution.dispatchVersion,
    p_environment: environment,
    p_run_id: execution.runId,
  };
  const claimed = await client.rpc("pilot_claim_execution", claim);
  if (claimed.error)
    throw new Error("Could not claim the saved generation job.");
  if (!claimed.data)
    return { operationId, status: "already-claimed-or-finished" };
  const heartbeat = maintainClaim(client, claim, signal);
  let stopped: string | undefined;
  let deferred = false;
  try {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("Image generation is not configured.");
    const operationResult = await client
      .from("pilot_operations")
      .select("*")
      .eq("id", operationId)
      .single();
    if (operationResult.error)
      throw new Error("The saved continuation is unavailable.");
    const operation = operationResult.data;
    const room = await client
      .from("pilot_rooms")
      .select("is_open")
      .eq("id", operation.room_id)
      .single();
    if (room.error || !room.data.is_open)
      throw new Error("This room is unavailable.");
    const moments = await client
      .from("pilot_moments")
      .select("*")
      .eq("room_id", operation.room_id)
      .limit(500);
    if (moments.error) throw new Error("The story could not be loaded.");
    const path = pilotPath(
      moments.data,
      operation.room_id,
      operation.parent_id,
    );
    const captions = operation.requested_captions;
    if (!validPilotCaptions(captions))
      throw new Error("A preview of one to three panels is required.");
    const source = pilotPanels(path.at(-1)!.panels).at(-1)!;
    let original: Buffer;
    if (source.imagePath) {
      const saved = await readStored(client, "pilot-media", source.imagePath);
      if (!saved || digest(saved) !== source.sha256)
        throw new Error("The parent image could not be verified.");
      original = saved;
    } else {
      // pilotPanels already restricts these to exact packaged assets and frames.
      const [asset, fragment] = source.imageUrl!.split("#");
      const frame = Number(fragment.split("=")[1]);
      const sheet = await readFile(resolve("public", asset.slice(1)));
      const metadata = await sharp(sheet).metadata();
      const width = Math.floor(metadata.width! / 3),
        height = Math.floor(metadata.height! / 2);
      original = await sharp(sheet)
        .extract({
          left: (frame % 3) * width,
          top: Math.floor(frame / 3) * height,
          width,
          height,
        })
        .png()
        .toBuffer();
    }
    let previous: Buffer | undefined;
    for (let index = 0; index < captions.length; index++) {
      const panelNumber = (index + 1) as 1 | 2 | 3;
      const request = await prepareOpenAiPanel({
        clientRequestId: `pilot-${operationId}-panel-${panelNumber}`,
        panelNumber,
        prompt: [
          // Keep legacy two-panel inputs byte-identical for receipt recovery.
          `Draw only panel ${panelNumber} of this ${captions.length === 2 ? "two" : captions.length}-panel story continuation. One full-bleed illustration; no lettering, captions, grid or watermark.`,
          "Image 1 is the last panel of the chosen parent. Preserve its character identity, clothing and visual style.",
          ...(previous
            ? [
                captions.length === 2
                  ? "Image 2 is this continuation's first panel. Advance its action with a distinct composition."
                  : "Image 2 is this continuation's preceding panel. Advance its action with a distinct composition.",
              ]
            : []),
          "Selected story path (creative context):",
          pilotContext(path),
          "Requested continuation:",
          operation.prompt,
          `${captions.length === 2 ? "The two beats" : "The panels"}, in order: ${JSON.stringify(captions)}`,
          `Draw this beat only: ${captions[panelNumber - 1]}`,
        ].join("\n"),
        references: [
          { role: "original", bytes: original },
          ...(previous
            ? [{ role: "previous-panel" as const, bytes: previous }]
            : []),
        ],
      });
      const prefix = `${operationId}/${panelNumber}`;
      await saveStored(
        client,
        "pilot-receipts",
        `${prefix}-request.json`,
        Buffer.from(canonicalJson(request)),
      );
      const begin = await client.rpc("pilot_begin_panel", {
        p_operation_id: operationId,
        p_panel_number: panelNumber,
        p_input_digest: request.inputDigest,
        p_claim_token: claimToken,
      });
      if (begin.error?.code === "P0002") {
        const waiting = await client.rpc("pilot_defer_job", { p_operation_id: operationId, p_claim_token: claimToken });
        if (waiting.error) throw new Error("Your saved generation needs checking.");
        deferred = true;
        break;
      }
      if (begin.error)
        throw new Error(
          "Generation is paused while a previous request is checked.",
        );
      if (begin.data) {
        await heartbeat.check();
        // No automatic retry. The durable intent already exists before this POST.
        const start = performance.now();
        // Persist transport uncertainty. A missing reply is not a known charge.
        const response = await sendOpenAiPanel(request, key).catch(() => ({
          status: 0,
          requestId: null,
          body: "",
        }));
        const receipt = {
          inputDigest: request.inputDigest,
          clientRequestId: request.clientRequestId,
          elapsedMs: Math.round(performance.now() - start),
          ...response,
        };
        await saveStored(
          client,
          "pilot-receipts",
          `${prefix}-response.json`,
          Buffer.from(canonicalJson(receipt)),
        );
      }
      const saved = await readStored(
        client,
        "pilot-receipts",
        `${prefix}-response.json`,
      );
      if (!saved)
        throw new Error(
          "A provider reply is missing. Your allowance is held while we check it; no new request was sent.",
        );
      const receipt = JSON.parse(saved.toString("utf8")) as {
        inputDigest: string;
        clientRequestId: string;
        status: number;
        body: string;
        requestId: string | null;
        elapsedMs: number;
      };
      if (
        receipt.inputDigest !== request.inputDigest ||
        receipt.clientRequestId !== request.clientRequestId
      )
        throw new Error(
          "The saved provider reply did not match this continuation.",
        );
      const existing = await client
        .from("pilot_panel_accounting")
        .select("response_digest,expense_micro,expense_known")
        .eq("operation_id", operationId)
        .eq("panel_number", panelNumber)
        .single();
      if (
        existing.error ||
        (existing.data.response_digest &&
          existing.data.response_digest !== digest(saved))
      )
        throw new Error("The saved reply failed its integrity check.");
      let expense: number | null = null,
        imagePath: string | null = null,
        imageDigest: string | null = null;
      let state = "failed",
        code: string | null = "invalid_provider_output";
      try {
        const raw = parseReply(receipt.body);
        try {
          const micro = parseUsd(
            readOpenAiUsage(raw?.usage).calculatedExpenseUsd,
          );
          if (micro <= BigInt(Number.MAX_SAFE_INTEGER)) expense = Number(micro);
        } catch {
          /* Keep the reservation until cost can be established. */
        }
        if (receipt.status < 200 || receipt.status >= 300) {
          const candidate = raw?.error?.code;
          code =
            receipt.status === 0
              ? "provider_unreachable"
              : typeof candidate === "string" &&
                  /^[a-z0-9_-]{1,100}$/.test(candidate)
                ? candidate
                : "provider_error";
        } else {
          const result = await inspectOpenAiPanelResponse(raw);
          // Failures from here are recoverable from the saved raw response.
          state = "uncertain";
          code = "storage_pending";
          const webp = await sharp(result.png).webp({ quality: 86 }).toBuffer();
          imagePath = `${operationId}/${panelNumber}.webp`;
          await saveStored(client, "pilot-media", imagePath, webp);
          imageDigest = digest(webp);
          previous = result.png;
          state = "complete";
          code = null;
        }
      } finally {
        // Historical booked amounts are immutable; corrections use the audited ledger.
        expense = existing.data.expense_micro ?? expense;
        // Generated RPC types do not express nullable PostgreSQL arguments.
        const recorded = await client.rpc("pilot_record_panel", {
          p_operation_id: operationId,
          p_panel_number: panelNumber,
          p_claim_token: claimToken,
          p_state: state,
          p_response_digest: digest(saved),
          p_image_path: imagePath,
          p_image_digest: imageDigest,
          p_expense_micro: expense,
          p_request_id: receipt.requestId,
          p_elapsed_ms: receipt.elapsedMs,
          p_error_code: code,
        } as Database["public"]["Functions"]["pilot_record_panel"]["Args"]);
        if (recorded.error)
          throw new Error(
            "The generation receipt could not be recorded. The saved result will be checked before any retry.",
          );
      }
      if (state !== "complete")
        throw new Error(
          code === "moderation_blocked"
            ? "This request could not be completed. Try changing the story idea."
            : "A complete image could not be delivered. No room credit was used.",
        );
      if (expense === null && !existing.data.expense_known && panelNumber < captions.length)
        throw new Error("The saved image is being checked before another panel can start.");
    }
  } catch (error) {
    // Only our bounded, authored messages reach the guest; never raw provider errors.
    stopped =
      error instanceof Error &&
      /^[A-Za-z][A-Za-z0-9 .,;'’-]{1,239}$/.test(error.message)
        ? error.message
        : "Generation was interrupted. Check the saved result before trying again.";
  } finally {
    heartbeat.stop();
  }
  if (deferred) return { operationId, status: "waiting" };
  const finished = await client.rpc("pilot_finish_job", {
    p_operation_id: operationId,
    p_claim_token: claimToken,
    ...(stopped ? { p_error: stopped } : {}),
  });
  if (finished.error)
    throw new Error(
      "The delivery record needs recovery. No new provider request will be sent for a recorded panel.",
    );
  return { operationId, status: stopped ? "needs-review" : "delivered" };
}
