import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { TERMS_VERSION, parseState, type CommandResult, type PendingCommand, type Seat } from "./model.ts";

type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];
type WorldDatabase = { public: {
  Tables: Record<string, never>; Views: Record<string, never>; Enums: Record<string, never>; CompositeTypes: Record<string, never>;
  Functions: {
    world_demo_read: { Args: { p_run_id: string }; Returns: Json };
    world_demo_create: { Args: { p_run_id: string; p_terms_version: string }; Returns: Json };
    world_demo_join: { Args: { p_run_id: string; p_token: string; p_terms_version: string }; Returns: Json };
    world_demo_command: { Args: { p_run_id: string; p_request_id: string; p_revision: number; p_kind: string; p_payload: Json }; Returns: Json };
  };
} };
export type WorldClient = SupabaseClient<WorldDatabase>;
const clients = new Map<Seat, WorldClient>();
export function worldClient(seat: Seat): WorldClient {
  const existing = clients.get(seat);
  if (existing) return existing;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("The rehearsal backend is not configured. Add the public Supabase settings and restart the app.");
  const client = createClient<WorldDatabase>(url, key, { auth: {
    storageKey: `fork-night-world-demo-${seat}`, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false,
  } });
  clients.set(seat, client);
  return client;
}
const joins = new WeakMap<WorldClient, Promise<void>>();
export async function ensureGuest(client: WorldClient): Promise<void> {
  const pending = joins.get(client);
  if (pending) return pending;
  const promise = (async () => {
    const restored = await client.auth.getSession();
    if (restored.error) throw new Error("Your guest session could not be restored. Reconnect before trying again.");
    if (restored.data.session) {
      const verified = await client.auth.getUser();
      if (verified.error || !verified.data.user) throw new Error("Your saved session could not be verified. Reconnect before trying again.");
    } else {
      const created = await client.auth.signInAnonymously();
      if (created.error || !created.data.user) throw new Error("A guest session could not be started. Reconnect and try again.");
    }
  })();
  joins.set(client, promise);
  try { await promise; } finally { joins.delete(client); }
}
export class CommandError extends Error {
  readonly rejected: boolean;
  constructor(message: string, rejected: boolean) { super(message); this.rejected = rejected; }
}
const explain = (error: { code?: string; message: string }) => {
  if (error.code === "P0001") return error.message;
  if (error.code === "42501") return "Your session cannot make this change. Reopen the invitation in the browser where you joined.";
  if (error.code === "22P02") return "This link or action is incomplete. Refresh the rehearsal and choose the work again.";
  return "The rehearsal could not be reached. Your work is kept here; reconnect and try again.";
};
export async function readWorld(client: WorldClient, runId: string) {
  const { data, error } = await client.rpc("world_demo_read", { p_run_id: runId }).abortSignal(AbortSignal.timeout(15000));
  if (error) throw new Error(explain(error));
  return parseState(data);
}
export async function createWorld(client: WorldClient, runId: string) {
  await ensureGuest(client);
  const { data, error } = await client.rpc("world_demo_create", { p_run_id: runId, p_terms_version: TERMS_VERSION }).abortSignal(AbortSignal.timeout(15000));
  if (error) throw new Error(explain(error));
  return parseState(data);
}
export async function joinWorld(client: WorldClient, runId: string, token: string) {
  await ensureGuest(client);
  const { data, error } = await client.rpc("world_demo_join", { p_run_id: runId, p_token: token, p_terms_version: TERMS_VERSION }).abortSignal(AbortSignal.timeout(15000));
  if (error) throw new Error(explain(error));
  return parseState(data);
}
export async function commandWorld(client: WorldClient, pending: PendingCommand): Promise<CommandResult> {
  const { data, error } = await client.rpc("world_demo_command", {
    p_run_id: pending.runId, p_request_id: pending.requestId, p_revision: pending.revision,
    p_kind: pending.kind, p_payload: pending.payload,
  }).abortSignal(AbortSignal.timeout(15000));
  if (error) throw new CommandError(explain(error), ["P0001", "42501", "22P02", "23505"].includes(error.code));
  if (!data || typeof data !== "object" || Array.isArray(data) || typeof data.resultId !== "string") {
    throw new CommandError("The action was sent, but its receipt could not be read. Check the saved action before trying again.", false);
  }
  return { state: parseState(data.state), resultId: data.resultId, replayed: data.replayed === true };
}
