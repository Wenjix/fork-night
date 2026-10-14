import { randomUUID } from "node:crypto";
import { idempotencyKeys, runs, tasks } from "@trigger.dev/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../lib/supabase/database.types.ts";
import type { generateContinuation } from "../trigger/generate.ts";
import { pilotAdmin } from "./client.ts";
import { executionEnvironment } from "./execution.ts";

export interface GenerationGateway {
  enqueue(operationId: string, version: number, environment: string): Promise<{ id: string }>;
  status(runId: string): Promise<string>;
}

export const generationGateway: GenerationGateway = {
  async enqueue(operationId, version, environment) {
    const key = await idempotencyKeys.create(`pilot:${environment}:${operationId}:${version}`, { scope: "global" });
    return tasks.trigger<typeof generateContinuation>("fork-night-generate", {
      operationId, dispatchVersion: version,
    }, { idempotencyKey: key, maxAttempts: 1 });
  },
  async status(runId) { return (await runs.retrieve(runId, { retry: { maxAttempts: 1 } })).status; },
};

/** The database outbox survives either an enqueue failure or a lost acknowledgement. */
export async function dispatchGeneration(operationId: string, version: number, options: {
  client?: SupabaseClient<Database>; gateway?: GenerationGateway; environment?: string;
} = {}) {
  const client = options.client ?? pilotAdmin();
  const gateway = options.gateway ?? generationGateway;
  const environment = options.environment ?? executionEnvironment();
  const token = randomUUID();
  const lease = await client.rpc("pilot_lease_dispatch", {
    p_operation_id: operationId, p_version: version, p_environment: environment, p_token: token,
  });
  if (lease.error) throw new Error("The saved generation could not be checked.");
  if (!lease.data) return "already-saved" as const;
  try {
    const handle = await gateway.enqueue(operationId, version, environment);
    const saved = await client.rpc("pilot_ack_dispatch", {
      p_operation_id: operationId, p_version: version, p_token: token, p_run_id: handle.id,
    });
    if (saved.error || !saved.data) return "pending-check" as const;
    return "queued" as const;
  } catch {
    // The run may exist. Let the short lease expire, then repeat the same key.
    return "pending-check" as const;
  }
}
