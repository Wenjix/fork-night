import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../lib/supabase/database.types.ts";

/**
 * The release panel loads every scene's image from the shared `pilot-media` bucket. A Night Watch
 * moment's image lives on this machine instead, so this wraps the Supabase client: downloads under a
 * Night Watch moment id come from the local image route (the same bytes, so the panel's sha256 check
 * still holds); everything else, including auth, goes to the real client unchanged.
 */
export function withNightWatchMedia(client: SupabaseClient<Database>, momentIds: ReadonlySet<string>): SupabaseClient<Database> {
  if (!momentIds.size) return client;
  const bucket = (real: ReturnType<SupabaseClient<Database>["storage"]["from"]>) =>
    new Proxy(real, {
      get(target, property) {
        if (property === "download") {
          return async (path: string, ...rest: unknown[]) => {
            const momentId = path.split("/")[0];
            if (!momentIds.has(momentId)) return (target.download as (...args: unknown[]) => unknown)(path, ...rest);
            try {
              const response = await fetch(`/api/night-watch/moments/${encodeURIComponent(momentId)}/image`, { cache: "no-store" });
              if (!response.ok) return { data: null, error: new Error("Image unavailable") };
              return { data: await response.blob(), error: null };
            } catch (error) {
              return { data: null, error: error instanceof Error ? error : new Error("Image unavailable") };
            }
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  const storage = new Proxy(client.storage, {
    get(target, property) {
      if (property === "from") {
        return (id: string) => (id === "pilot-media" ? bucket(target.from(id)) : target.from(id));
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return new Proxy(client, {
    get(target, property) {
      if (property === "storage") return storage;
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
