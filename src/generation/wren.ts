import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../lib/supabase/database.types.ts";
import { pilotAdmin } from "./client.ts";
import { executionEnvironment } from "./execution.ts";
import { dispatchGeneration } from "./dispatch.ts";
import { asWrenClient, type WrenPlan, type WrenRequest } from "./wren-types.ts";
import { planWrenScene, WrenPlanningError } from "./wren-plan.ts";
import { ensureWrenCredits } from "./wren-funding.ts";

export async function preparePrivateWren(requestId: string, execution: { environment: string; runId: string; dispatchVersion: number }, signal?: AbortSignal, options: {
  client?: SupabaseClient<Database>;
  plan?: (request: WrenRequest, client: SupabaseClient<Database>, signal?: AbortSignal) => Promise<WrenPlan>;
  fund?: typeof ensureWrenCredits;
  dispatch?: typeof dispatchGeneration;
} = {}) {
  const environment = executionEnvironment(execution.environment), base = options.client ?? pilotAdmin(), client = asWrenClient(base);
  const token = randomUUID();
  const claimed = await client.rpc("pilot_claim_wren_request", { p_request_id: requestId, p_claim_token: token,
    p_environment: environment, p_run_id: execution.runId, p_version: execution.dispatchVersion });
  if (claimed.error) throw new Error("The saved Wren request could not be claimed.");
  if (!claimed.data) return { requestId, state: "already-claimed-or-finished" };
  let request = claimed.data;
  async function finish(state: "blocked" | "failed" | "funding", message: string) {
    const result = await client.rpc("pilot_finish_wren_request", { p_request_id: requestId, p_claim_token: token, p_state: state, p_message: message });
    if (result.error) throw new Error("The saved Wren outcome needs checking.");
    return { requestId, state };
  }
  if (!request.plan) {
    let plan: WrenPlan;
    try { plan = await (options.plan ?? planWrenScene)(request, base, signal); }
    catch (error) {
      if (error instanceof WrenPlanningError) return finish("blocked", error.message);
      throw error;
    }
    const saved = await client.rpc("pilot_save_wren_plan", { p_request_id: requestId, p_claim_token: token, p_plan: plan as unknown as Json });
    if (saved.error) throw new Error("The saved Wren plan needs checking.");
    request = saved.data;
  }
  const funding = await (options.fund ?? ensureWrenCredits)({ requestId, roomId: request.room_id, claimToken: token,
    actorId: request.maker_id, requiredCredits: 1 });
  if (funding.state !== "ready") return finish(funding.state === "pending" ? "funding" : "blocked", funding.message ?? "Wren’s room credits need checking. No image was requested.");
  const admitted = await client.rpc("pilot_admit_wren", { p_request_id: requestId, p_claim_token: token });
  if (admitted.error) {
    if (admitted.error.code === "P0001") return finish("blocked", admitted.error.message);
    throw new Error("The saved continuation needs checking.");
  }
  // The ordinary generation outbox remains recoverable even if this acknowledgement is lost.
  await (options.dispatch ?? dispatchGeneration)(admitted.data.operation_id, admitted.data.dispatch_version, { client: base, environment });
  return { requestId, state: "generating", operationId: admitted.data.operation_id };
}
