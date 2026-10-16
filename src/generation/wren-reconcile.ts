import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../lib/supabase/database.types.ts";
import { pilotAdmin } from "./client.ts";
import { executionEnvironment } from "./execution.ts";
import { TERMINAL_RUN_STATES } from "./reconcile.ts";
import { asWrenClient } from "./wren-types.ts";
import { dispatchWrenRequest, wrenGateway, type WrenGateway } from "./wren-dispatch.ts";

/** Replays orchestration only. The image outbox and funding receipt decide whether any work is new. */
export async function reconcileWrenRequests(options: {
  client?: SupabaseClient<Database>; environment?: string; gateway?: WrenGateway; dryRun?: boolean;
} = {}) {
  const base = options.client ?? pilotAdmin(), client = asWrenClient(base);
  const environment = options.environment ?? executionEnvironment(), gateway = options.gateway ?? wrenGateway;
  const due = await client.from("pilot_wren_requests").select("*").eq("environment", environment)
    .in("state", ["pending", "planning", "funding", "generating", "ready"])
    .lte("next_check_at", new Date().toISOString()).order("next_check_at").limit(12);
  if (due.error) throw new Error("The saved Wren requests could not be checked.");
  const checked: { requestId: string; result: string }[] = [];
  for (let request of due.data) {
    try {
      if (request.operation_id) {
        if (options.dryRun) { checked.push({ requestId: request.id, result: "would-observe" }); continue; }
        const observed = await client.rpc("pilot_observe_wren_request", { p_request_id: request.id });
        if (observed.error) throw new Error("Request check unavailable");
        checked.push({ requestId: request.id, result: observed.data.state });
        continue;
      }
      if (request.run_id) {
        const status = await gateway.status(request.run_id);
        if (!TERMINAL_RUN_STATES.has(status)) { checked.push({ requestId: request.id, result: "active" }); continue; }
        if (options.dryRun) { checked.push({ requestId: request.id, result: "would-resume" }); continue; }
        const retried = await client.rpc("pilot_retry_wren_request", { p_request_id: request.id, p_version: request.dispatch_version, p_run_id: request.run_id, p_status: status });
        if (retried.error) throw new Error("Request recovery unavailable");
        request = retried.data;
      }
      checked.push({ requestId: request.id, result: options.dryRun ? "would-dispatch" :
        await dispatchWrenRequest(request.id, request.dispatch_version, { client: base, environment, gateway }) });
    } catch { checked.push({ requestId: request.id, result: "check-unavailable" }); }
  }
  return { checked };
}
