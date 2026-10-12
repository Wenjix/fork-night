import { env } from "cloudflare:workers";

/** Read Worker bindings at request time; never bake credentials into a client build. */
export function waitlistSettings(): Record<string, string | undefined> {
  const bindings = env as Record<string, unknown>;
  const value = (name: string) => typeof bindings[name] === "string" ? bindings[name] : undefined;
  return {
    FORK_NIGHT_PUBLIC_URL: value("FORK_NIGHT_PUBLIC_URL"),
    SUPABASE_URL: value("SUPABASE_URL"),
    SUPABASE_SECRET_KEY: value("SUPABASE_SECRET_KEY"),
  };
}
