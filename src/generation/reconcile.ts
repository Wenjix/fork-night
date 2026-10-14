import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../lib/supabase/database.types.ts";
import { readOpenAiUsage } from "../experiments/openai-images.ts";
import { digest } from "../experiments/storage.ts";
import { pilotAdmin } from "./client.ts";
import { dispatchGeneration, generationGateway, type GenerationGateway } from "./dispatch.ts";
import { executionEnvironment } from "./execution.ts";
import { readStored } from "./storage.ts";

export const TERMINAL_RUN_STATES = new Set(["COMPLETED", "CANCELED", "FAILED", "CRASHED", "SYSTEM_FAILURE", "EXPIRED", "TIMED_OUT"]);
type Panel = Database["public"]["Views"]["pilot_panel_accounting"]["Row"];

export function recoverableReceipt(panel: Panel, receipt: Buffer | null | undefined) {
  if (!receipt || (panel.response_digest && panel.response_digest !== digest(receipt))) return false;
  try {
    const saved = JSON.parse(receipt.toString("utf8"));
    if (saved.inputDigest !== panel.input_digest || saved.clientRequestId !== `pilot-${panel.operation_id}-panel-${panel.panel_number}`) return false;
    if (panel.expense_known) return true;
    if (!Number.isInteger(saved.status) || saved.status === 0) return false;
    readOpenAiUsage(JSON.parse(saved.body).usage);
    return true;
  } catch { return false; }
}

/** Bounded, repeatable checks. Provider POSTs exist only in the fenced image worker. */
export async function reconcileGeneration(options: {
  client?: SupabaseClient<Database>; gateway?: GenerationGateway; environment?: string; dryRun?: boolean;
} = {}) {
  const client = options.client ?? pilotAdmin();
  const gateway = options.gateway ?? generationGateway;
  const environment = options.environment ?? executionEnvironment();
  const now = new Date().toISOString();
  const due = await client.from("pilot_job_dispatches").select("*")
    .eq("environment", environment).in("state", ["pending", "dispatching", "queued", "running", "waiting"])
    .lte("next_check_at", now).order("next_check_at").limit(25);
  if (due.error) throw new Error("Saved dispatches could not be checked.");
  const started = Date.now();
  const checked: { operationId: string; result: string }[] = [];
  for (const dispatch of due.data) {
    if (Date.now() - started >= 60_000) break;
    try {
      if (!dispatch.run_id) {
        checked.push({ operationId: dispatch.operation_id, result: options.dryRun ? "would-dispatch" :
          await dispatchGeneration(dispatch.operation_id, dispatch.dispatch_version, { client, gateway, environment }) });
        continue;
      }
      const status = await gateway.status(dispatch.run_id);
      let recover = false;
      if (TERMINAL_RUN_STATES.has(status)) {
        const panels = await client.from("pilot_panel_accounting").select("*").eq("operation_id", dispatch.operation_id);
        if (panels.error) throw new Error("Saved receipts could not be checked.");
        recover = true;
        for (const panel of panels.data) {
          const receipt = await readStored(client, "pilot-receipts", `${panel.operation_id}/${panel.panel_number}-response.json`);
          if (!recoverableReceipt(panel, receipt)) { recover = false; break; }
        }
      }
      if (options.dryRun) {
        checked.push({ operationId: dispatch.operation_id, result: TERMINAL_RUN_STATES.has(status) ? (recover ? "would-recover" : "would-review") : "active" });
        continue;
      }
      const result = await client.rpc("pilot_reconcile_execution", {
        p_operation_id: dispatch.operation_id, p_version: dispatch.dispatch_version,
        p_run_id: dispatch.run_id, p_status: status, p_recover: recover,
      });
      if (result.error) throw new Error("The saved execution needs checking.");
      checked.push({ operationId: dispatch.operation_id, result: result.data });
    } catch {
      // An unavailable status API is not evidence of a failed run or refundable work.
      checked.push({ operationId: dispatch.operation_id, result: "check-unavailable" });
      if (!options.dryRun) await client.from("pilot_job_dispatches")
        .update({ error_code: "check_unavailable", next_check_at: new Date(Date.now() + 60_000).toISOString() })
        .eq("operation_id", dispatch.operation_id).eq("dispatch_version", dispatch.dispatch_version);
    }
  }
  if (!options.dryRun) {
    // Claims remain consumed. A late helper response must condition its write on pending.
    const expired = await client.from("pilot_assist_requests").update({ state: "failed" })
      .eq("state", "pending").lt("created_at", new Date(Date.now() - 120_000).toISOString());
    if (expired.error) throw new Error("Expired helper requests could not be checked.");
    const tick = await client.from("pilot_generation_budget").update({ last_reconcile_at: new Date().toISOString() })
      .eq("id", true).eq("execution_environment", environment);
    if (tick.error) throw new Error("The reconciliation checkpoint could not be saved.");
  }
  return { environment, dryRun: Boolean(options.dryRun), checked };
}
