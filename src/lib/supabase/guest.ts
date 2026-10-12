import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "./database.types.ts";

type PilotClient = SupabaseClient<Database>;
type Profile = Tables<"pilot_profiles">;
const joins = new WeakMap<PilotClient, { name: string; promise: Promise<Profile> }>();

/**
 * Use a browser-scoped Auth client. A name labels the verified guest UUID;
 * it never selects an existing maker or transfers ownership.
 * Session/verification errors must not silently replace a returning guest.
 */
export async function joinPilotAsGuest(client: PilotClient, displayName: string): Promise<Profile> {
  const name = displayName.trim();
  if (!name || [...name].length > 60) throw new Error("Enter a name of 1–60 characters.");
  const joining = joins.get(client);
  if (joining) {
    if (joining.name !== name) throw new Error("Your guest session is still being saved. Try again in a moment.");
    return joining.promise;
  }

  const promise = join(client, name);
  joins.set(client, { name, promise });
  try { return await promise; }
  finally { joins.delete(client); }
}

async function join(client: PilotClient, name: string): Promise<Profile> {
  const restored = await client.auth.getSession();
  if (restored.error) throw new Error("Could not restore your guest session. Please reconnect and try again.");
  let userId: string;
  if (restored.data.session) {
    const verified = await client.auth.getUser();
    if (verified.error || !verified.data.user)
      throw new Error("Could not verify your saved session. Please reconnect before continuing.");
    userId = verified.data.user.id;
  } else {
    const created = await client.auth.signInAnonymously();
    if (created.error || !created.data.user)
      throw new Error("Could not start a guest session. Please try again in a moment.");
    userId = created.data.user.id;
  }
  const profile = await client.rpc("pilot_set_display_name", { p_name: name });
  if (profile.error || !profile.data || profile.data.id !== userId)
    throw new Error("Your session is saved, but your name could not be saved. Please try again.");
  return profile.data;
}
