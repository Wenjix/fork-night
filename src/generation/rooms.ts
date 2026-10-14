import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/supabase/database.types.ts";
import { parseRoomIntent } from "../lib/pilot-rooms.ts";

const reply = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "no-store", Vary: "Authorization" },
});

export async function createPilotRoom(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return reply({ error: "Choose your storyteller name first." }, 401);
  if (Number(request.headers.get("content-length") ?? 0) > 2048) return reply({ error: "Room request is too large." }, 413);
  let intent;
  try {
    const text = await request.text();
    if (text.length > 2048) return reply({ error: "Room request is too large." }, 413);
    const value = JSON.parse(text);
    if (Object.keys(value).some(key => !["requestId", "templateId", "templateVersion", "title"].includes(key)))
      return reply({ error: "Choose a prepared opening and room title." }, 400);
    intent = parseRoomIntent(value);
  } catch { return reply({ error: "Choose a prepared opening and room title." }, 400); }
  if (!intent) return reply({ error: "Choose a prepared opening and a title of 1–80 characters." }, 400);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return reply({ error: "Shared rooms are being set up." }, 503);
  const client = createClient<Database>(url, key, {
    global: { headers: { Authorization: authorization }, fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(15_000) }) },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const user = await client.auth.getUser(authorization.slice(7));
    if (user.error || !user.data.user) return reply({ error: "Your storyteller account needs reconnecting." }, 401);
    const result = await client.rpc("pilot_create_room", {
      p_request_id: intent.requestId, p_template_id: intent.templateId,
      p_template_version: intent.templateVersion, p_title: intent.title,
    });
    if (result.error) {
      if (result.error.code === "P0001") return reply({ error: result.error.message, rejected: true }, 409);
      // A gateway error can follow a committed transaction. Keep the same intent.
      return reply({ error: "Your room could not be confirmed. Check the same room request." }, 503);
    }
    return reply(result.data, 201);
  } catch { return reply({ error: "Your room could not be confirmed. Check the same room request." }, 503); }
}
