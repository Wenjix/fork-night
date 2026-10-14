import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, ExecutionClaim } from "../lib/supabase/database.types.ts";

export type Execution = { environment: string; runId: string; dispatchVersion: number };
export const EXECUTION_ENVIRONMENTS = ["PRODUCTION", "DEVELOPMENT", "STAGING", "PREVIEW"] as const;

export function executionEnvironment(actual?: string) {
  const configured = process.env.PILOT_EXECUTION_ENV;
  if (!configured || !EXECUTION_ENVIRONMENTS.some(value => value === configured) || (actual && actual !== configured))
    throw new Error("The generation worker environment is not configured correctly.");
  return configured;
}

/** Renewal failure is sticky: a worker never revives its own expired claim. */
export function maintainClaim(client: SupabaseClient<Database>, claim: ExecutionClaim, signal?: AbortSignal) {
  let lost = false;
  let pending: Promise<void> | undefined;
  const check = () => {
    if (lost || signal?.aborted) return Promise.reject(new Error("Generation stopped while its saved result is checked."));
    if (pending) return pending;
    pending = (async () => {
      try {
        const result = await client.rpc("pilot_heartbeat", claim);
        if (result.error || result.data !== true) throw new Error("Worker claim expired.");
      } catch {
        lost = true;
        throw new Error("Generation stopped while its saved result is checked.");
      } finally {
        pending = undefined;
      }
    })();
    return pending;
  };
  const timer = setInterval(() => { void check().catch(() => {}); }, 20_000);
  timer.unref?.();
  return { check, stop: () => clearInterval(timer) };
}
