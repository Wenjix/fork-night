import type { PilotOperation } from "./pilot.ts";
import { pilotCreditCost } from "./pilot-format.ts";

export type PilotCredits = {
  limit: number; used: number; reserved: number; available: number; enabled: boolean;
  queued_requests?: number; generating_requests?: number; checking_requests?: number;
};
export type GenerationJob = { operation_id: string; state: string; panel_count: number; updated_at: string };
export type GenerationOperation = PilotOperation & { pilot_jobs?: GenerationJob | null };

export function generationStatus(operation: GenerationOperation, now = Date.now()) {
  const panels = Array.isArray(operation.requested_captions) ? operation.requested_captions.length : 2;
  const reserved = pilotCreditCost(panels);
  const lastUpdate = operation.pilot_jobs?.updated_at;
  const stale = !!lastUpdate && now - Date.parse(lastUpdate) >= 10 * 60 * 1000;
  if (operation.status === "queued") return { phase: "queued", step: 0, title: stale ? "Still waiting to start" : "Waiting to start",
    detail: "Your idea is saved and queued. Image generation has not started yet.", reserved };
  if (operation.status === "dispatching" && !stale) return { phase: "generating", step: 1, title: "Generating your images",
    detail: `Generation has started for your ${panels === 1 ? "panel" : `${panels} panels`}. The complete result will appear here for review.`, reserved };
  if (operation.status === "delivered") return { phase: "ready", step: 2, title: "Ready to review",
    detail: "Your images are saved privately. Publish my moment adds them to the shared story.", reserved: 0 };
  if (operation.status === "draft") return { phase: "starting", step: 0, title: "Starting your panel…",
    detail: "Your panel plan is saved. Image generation is starting now.", reserved: 0 };
  return { phase: "checking", step: 1, title: "Generation needs checking",
    detail: operation.generation_error ?? "No recent progress has been recorded. Check the saved result before trying another idea.", reserved };
}

export function roomActivity(credits: PilotCredits) {
  const counts = [credits.queued_requests, credits.generating_requests, credits.checking_requests];
  if (!counts.every(value => typeof value === "number" && Number.isInteger(value) && value >= 0)) return null;
  return { queued: counts[0]!, generating: counts[1]!, checking: counts[2]! };
}
