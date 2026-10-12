import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/supabase/database.types.ts";

/** Server/worker only. Never import this module from a client component. */
export function pilotAdmin() {
  if (typeof window !== "undefined")
    throw new Error("Server-only generation client");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Generation storage is not configured.");
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (url, init) =>
        fetch(url, { ...init, signal: AbortSignal.timeout(30_000) }),
    },
  });
}
