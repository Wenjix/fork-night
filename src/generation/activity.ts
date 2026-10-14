import { pilotAdmin } from "./client.ts";

const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

export async function handleRoomActivity(request: Request) {
  const roomId = new URL(request.url).searchParams.get("room");
  if (!roomId || !/^[a-z][a-z0-9-]{0,63}$/.test(roomId)) return reply({ error: "Choose a story room." }, 400);
  try {
    const client = pilotAdmin();
    const room = await client.from("pilot_rooms").select("is_open").eq("id", roomId).maybeSingle();
    if (room.error) return reply({ error: "Room activity could not be checked." }, 503);
    if (!room.data?.is_open) return reply({ error: "Room is unavailable." }, 404);
    const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const count = () => client.from("pilot_jobs")
      .select("operation_id,pilot_operations!inner(room_id,charged_units)", { count: "exact", head: true })
      .eq("pilot_operations.room_id", roomId).eq("pilot_operations.charged_units", 0);
    const [queued, generating, checking] = await Promise.all([
      count().eq("state", "queued"),
      count().eq("state", "running").gt("updated_at", cutoff),
      count().or(`state.eq.uncertain,and(state.eq.running,updated_at.lte.${cutoff})`),
    ]);
    if ([queued, generating, checking].some(result => result.error || result.count === null)) return reply({ error: "Room activity could not be checked." }, 503);
    // Only totals leave the server. Private rows, bylines and claim tokens do not.
    // Every viewer sees the same totals, so Vercel's CDN may share them briefly; browsers still never store them.
    return reply({ queued_requests: queued.count, generating_requests: generating.count, checking_requests: checking.count }, 200,
      { "Vercel-CDN-Cache-Control": "max-age=5" });
  } catch { return reply({ error: "Room activity could not be checked." }, 503); }
}
