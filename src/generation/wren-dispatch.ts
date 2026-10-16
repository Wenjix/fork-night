import { randomUUID } from "node:crypto";
import { idempotencyKeys, runs, tasks } from "@trigger.dev/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../lib/supabase/database.types.ts";
import type { prepareWrenContinuation } from "../trigger/wren.ts";
import { pilotAdmin } from "./client.ts";
import { executionEnvironment } from "./execution.ts";
import { asWrenClient } from "./wren-types.ts";

export interface WrenGateway {
  enqueue(requestId: string, version: number, environment: string): Promise<{ id: string }>;
  status(runId: string): Promise<string>;
}
export const wrenGateway: WrenGateway = {
  async enqueue(requestId, version, environment) {
    const key = await idempotencyKeys.create(`wren:${environment}:${requestId}:${version}`, { scope: "global" });
    return tasks.trigger<typeof prepareWrenContinuation>("fork-night-wren", { requestId, dispatchVersion: version }, { idempotencyKey: key, maxAttempts: 1 });
  },
  async status(runId) { return (await runs.retrieve(runId, { retry: { maxAttempts: 1 } })).status; },
};

export async function dispatchWrenRequest(requestId: string, version: number, options: {
  client?: SupabaseClient<Database>; gateway?: WrenGateway; environment?: string;
} = {}) {
  const client = asWrenClient(options.client ?? pilotAdmin()), gateway = options.gateway ?? wrenGateway;
  const environment = options.environment ?? executionEnvironment(), token = randomUUID();
  const leased = await client.rpc("pilot_lease_wren_dispatch", { p_request_id: requestId, p_version: version, p_environment: environment, p_token: token });
  if (leased.error) throw new Error("The private Wren request could not be checked.");
  if (!leased.data) return "already-saved";
  try {
    const run = await gateway.enqueue(requestId, version, environment);
    const ack = await client.rpc("pilot_ack_wren_dispatch", { p_request_id: requestId, p_version: version, p_token: token, p_run_id: run.id });
    return ack.error || !ack.data ? "pending-check" : "queued";
  } catch { return "pending-check"; }
}
