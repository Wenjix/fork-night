import { createHash } from "node:crypto";
import { assistIdentity, assistReply, AssistError } from "./assist.ts";
import { pilotAdmin } from "./client.ts";
import { isUuid, pilotPanels, pilotPath } from "../lib/pilot.ts";
import { WREN } from "../lib/agents/wren.ts";
import type { Json } from "../lib/supabase/database.types.ts";
import { parseProgressionPlan, parseProgressionReview, progressionPlanSchema, progressionReviewSchema, PROGRESSION_INSTRUCTIONS, PROGRESSION_REVIEW_INSTRUCTIONS } from "../lib/wren-progression.ts";

/** One durable shape allowance per provider call, including the separate critique. */
export async function handleResidentPlan(request: Request) {
  const { client, actor } = await assistIdentity(request);
  if (actor !== WREN.profileId) throw new AssistError("This planner is for Wren's existing storyteller identity.", 403);
  const reader = request.body?.getReader();
  if (!reader) throw new AssistError("Provide the saved mission request.");
  let raw = "", size = 0; const decoder = new TextDecoder();
  for (;;) {
    const next = await reader.read(); if (next.done) break;
    size += next.value.byteLength;
    if (size > 4096) { await reader.cancel(); throw new AssistError("The mission request is too large.", 413); }
    raw += decoder.decode(next.value, { stream: true });
  }
  raw += decoder.decode();
  let body; try { body = JSON.parse(raw); } catch { throw new AssistError("Provide a valid mission request."); }
  if (!body || body.roomId !== "kessler-ward" || !isUuid(body.requestId) || !isUuid(body.parentId) || !["plan", "review"].includes(body.phase) ||
    typeof body.brief !== "string" || !body.brief.trim() || body.brief.length > 500 || body.phase === "review" && (!isUuid(body.planRequestId) || body.planRequestId === body.requestId))
    throw new AssistError("Choose Wren's Kessler parent and bounded planning request.");
  if (!process.env.OPENAI_API_KEY) throw new AssistError("The planner is being set up.", 503);
  const story = await client.from("pilot_moments").select("*").eq("room_id", body.roomId).order("created_at").limit(500);
  if (story.error) throw new AssistError("The published ancestry could not be read.", 503);
  const path = pilotPath(story.data, body.roomId, body.parentId);
  if (!path.length || path.length > 10) throw new AssistError("Choose a path with room for three more scenes.");
  const admin = pilotAdmin();
  let plan;
  if (body.phase === "review") {
    const prior = await admin.from("pilot_assist_requests").select("result,state,input_digest").eq("id", body.planRequestId).eq("maker_id", actor)
      .eq("room_id", body.roomId).eq("parent_id", body.parentId).eq("kind", "shape").maybeSingle();
    if (prior.error || prior.data?.state !== "complete") throw new AssistError("Finish the saved plan before reviewing it.", 409);
    const expected = digest({ version: 1, phase: "plan", brief: body.brief, planRequestId: null });
    if (prior.data.input_digest !== expected) throw new AssistError("The saved plan belongs to a different mission brief.", 409);
    plan = parseProgressionPlan((prior.data.result as { plan?: unknown })?.plan);
  }
  const inputDigest = digest({ version: 1, phase: body.phase, brief: body.brief, planRequestId: body.phase === "review" ? body.planRequestId : null });
  const claimed = await admin.rpc("pilot_claim_assist", { p_actor: actor, p_request_id: body.requestId, p_room_id: body.roomId,
    p_parent_id: body.parentId, p_kind: "shape", p_digest: inputDigest });
  if (claimed.error) throw new AssistError(claimed.error.code === "P0001" ? claimed.error.message : "The planning allowance could not be checked.", 409);
  const claim = claimed.data as { claimed: boolean; request: { id: string; state: string; result: Json } };
  if (!claim.claimed) {
    if (claim.request.state === "complete") return assistReply(claim.request.result);
    throw new AssistError("This saved planning call is unresolved or failed. It will not be purchased again.", 409);
  }
  try {
    const reviewing = body.phase === "review";
    const response = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", redirect: "error", signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4.1-mini-2025-04-14", store: false, max_completion_tokens: reviewing ? 800 : 2200,
        messages: [{ role: "system", content: reviewing ? PROGRESSION_REVIEW_INSTRUCTIONS : PROGRESSION_INSTRUCTIONS },
          { role: "user", content: JSON.stringify({ story: path.map(moment => ({ title: moment.title, captions: pilotPanels(moment.panels).map(panel => panel.caption) })), brief: body.brief, ...(reviewing ? { plan } : {}) }) }],
        response_format: { type: "json_schema", json_schema: { name: reviewing ? "resident_progression_review" : "resident_progression_plan", strict: true,
          schema: reviewing ? progressionReviewSchema : progressionPlanSchema } } }),
    });
    const output = await response.json();
    if (!response.ok || output.choices?.[0]?.finish_reason !== "stop" || output.choices[0].message.refusal) throw new Error("Incomplete planning response.");
    const value = JSON.parse(output.choices[0].message.content);
    const result = reviewing ? { review: parseProgressionReview(value) } : { plan: parseProgressionPlan(value) };
    const saved = await admin.from("pilot_assist_requests").update({ state: "complete", result: result as unknown as Json,
      usage: output.usage ?? null, provider_request_id: response.headers.get("x-request-id") }).eq("id", claim.request.id).eq("state", "pending").select("id").maybeSingle();
    if (saved.error || !saved.data) throw new Error("The planning result could not be saved.");
    return assistReply(result);
  } catch {
    await admin.from("pilot_assist_requests").update({ state: "failed" }).eq("id", claim.request.id).eq("state", "pending");
    throw new AssistError("The saved planning call did not finish. No image was requested; its allowance remains consumed.", 503);
  }
}
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
