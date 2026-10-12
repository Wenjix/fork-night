/** Server-only runtime settings. The Cloudflare export supplies a bindings adapter. */
export function waitlistSettings(): Record<string, string | undefined> {
  return {
    FORK_NIGHT_PUBLIC_URL: process.env.FORK_NIGHT_PUBLIC_URL,
    SUPABASE_URL: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  };
}
