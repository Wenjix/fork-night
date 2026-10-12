import { createClient } from "@supabase/supabase-js";
import { pathToFileURL } from "node:url";

export async function checkPilotGeneration(client, roomId, makerName) {
  const pattern = makerName.trim().replace(/[\\%_]/g, character => `\\${character}`);
  const profiles = await client.from("pilot_profiles").select("id,display_name").ilike("display_name", pattern).limit(20);
  if (profiles.error) throw new Error("Could not read the guest profiles.");
  if (!profiles.data.length) return { roomId, makerName, matchingGuestAccounts: 0,
    message: "No guest profile with this display name was found in the configured pilot. Check the Making as name in the browser and the app's Supabase configuration.", requests: [] };
  const operations = await client.from("pilot_operations")
    .select("id,maker_id,status,charged_units,requested_captions,created_at,published_moment_id,pilot_jobs(state,panel_count,updated_at)")
    .eq("room_id", roomId).in("maker_id", profiles.data.map(profile => profile.id)).order("created_at", { ascending: false }).limit(20);
  if (operations.error) throw new Error("Could not read the saved generation state.");
  return { roomId, makerName, matchingGuestAccounts: profiles.data.length, requests: operations.data.map(operation => ({
    operationId: operation.id, guestId: operation.maker_id, status: operation.status,
    panelsRequested: Array.isArray(operation.requested_captions) ? operation.requested_captions.length : 0,
    roomCreditsUsed: operation.charged_units, savedAt: operation.created_at,
    publishedMomentId: operation.published_moment_id, job: operation.pilot_jobs,
  })) };
}

async function main() {
  const roomId = process.argv[2] ?? "midnight-signal", makerName = process.argv[3] ?? "tester";
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Configure the existing pilot's server-side Supabase settings first.");
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10000) }) } });
  console.log(JSON.stringify(await checkPilotGeneration(client, roomId, makerName), null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await main(); }
  catch { console.error("Read-only generation check failed. Check the existing Supabase connection and server configuration. No generation was submitted."); process.exitCode = 1; }
}
