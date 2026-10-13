import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.ts";

let browserClient: SupabaseClient<Database> | undefined;

export function pilotBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return undefined;
  return browserClient ??= createClient<Database>(url, key, { auth: { flowType: "pkce" } });
}
