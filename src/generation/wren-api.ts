import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/supabase/database.types.ts";
import { isUuid } from "../lib/pilot.ts";
import { WREN_ROOM, parseWrenIntent } from "../lib/pilot-wren.ts";
import { pilotAdmin } from "./client.ts";
import { executionEnvironment } from "./execution.ts";
import { dispatchWrenRequest, type WrenGateway } from "./wren-dispatch.ts";
import { asWrenClient, wrenView, type WrenRequest } from "./wren-types.ts";

const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store", Vary: "Authorization" } });
async function readBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let size = 0, body = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) return body + decoder.decode();
    size += chunk.value.byteLength;
    if (size > 4096) { await reader.cancel(); return null; }
    body += decoder.decode(chunk.value, { stream: true });
  }
}

export async function handleWrenRequest(request: Request, options: { gateway?: WrenGateway } = {}) {
  const header = request.headers.get("authorization"), url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!header?.startsWith("Bearer ")) return reply({ error: "Join as a guest or sign in before asking Wren." }, 401);
  if (!url || !key) return reply({ error: "Wren is being set up. Your story is still here." }, 503);
  const base = createClient<Database>(url, key, { global: { headers: { Authorization: header } }, auth: { persistSession: false, autoRefreshToken: false } });
  const client = asWrenClient(base);
  const user = await base.auth.getUser(header.slice(7));
  if (user.error?.name === "AuthRetryableFetchError" || (user.error?.status ?? 0) >= 500)
    return reply({ error: "Your storyteller account could not be checked. Keep the same request and try again." }, 503);
  if (user.error || !user.data.user) return reply({ error: "Reconnect your storyteller account before asking Wren." }, 401);
  try {
    if (request.method === "GET") {
      const query = new URL(request.url).searchParams, id = query.get("requestId");
      if (id) {
        if (!isUuid(id)) return reply({ error: "Choose a saved Wren request." }, 400);
        const result = await client.rpc("pilot_refresh_wren_request", { p_request_id: id });
        if (result.error) return reply({ error: result.error.code === "P0001" ? "That private Wren request is unavailable." : "Your saved Wren status could not be checked." }, result.error.code === "P0001" ? 404 : 503);
        return reply({ request: wrenView(result.data) });
      }
      if (query.get("room") !== WREN_ROOM) return reply({ error: "Wren continues Kessler Ward here." }, 400);
      const [latest, policy] = await Promise.all([
        client.from("pilot_wren_requests").select("id").eq("maker_id", user.data.user.id).eq("room_id", WREN_ROOM).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        asWrenClient(pilotAdmin()).from("pilot_wren_limits").select("enabled").eq("id", true).single(),
      ]);
      if (latest.error || policy.error) return reply({ error: "Wren’s saved status could not be checked." }, 503);
      let current: WrenRequest | null = null;
      if (latest.data) {
        const refreshed = await client.rpc("pilot_refresh_wren_request", { p_request_id: latest.data.id });
        if (refreshed.error) return reply({ error: "Your saved Wren request could not be checked." }, 503);
        current = refreshed.data;
      }
      return reply({ enabled: policy.data.enabled, request: current ? wrenView(current) : null });
    }
    if (request.method !== "POST") return reply({ error: "Use GET or POST." }, 405);
    const raw = await readBody(request);
    if (raw === null) return reply({ error: "Keep the Wren brief under 500 characters." }, 413);
    let value: unknown;
    try { value = JSON.parse(raw); } catch { return reply({ error: "Choose a source moment and write a brief." }, 400); }
    const intent = parseWrenIntent(value);
    if (!intent) return reply({ error: "Choose a Kessler Ward moment and write a brief of 1–500 characters." }, 400);
    const environment = executionEnvironment();
    const saved = await client.rpc("pilot_request_wren", { p_request_id: intent.requestId, p_room_id: intent.roomId, p_parent_id: intent.parentId, p_brief: intent.brief });
    if (saved.error) return saved.error.code === "P0001"
      ? reply({ error: saved.error.message, rejected: true }, 409)
      : reply({ error: "Your Wren request may already be saved. Check or retry this same request before changing it." }, 503);
    await dispatchWrenRequest(saved.data.id, saved.data.dispatch_version, { environment, gateway: options.gateway });
    return reply({ request: wrenView(saved.data) }, ["pending", "planning", "funding", "generating"].includes(saved.data.state) ? 202 : 200);
  } catch { return reply({ error: "Wren’s saved request needs checking. Retry the same request; no new image or payment is authorized by that check." }, 503); }
}
