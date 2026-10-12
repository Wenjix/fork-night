import { pilotAdmin } from "./client.ts";

const reply = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const loopback = (host: string) =>
  ["localhost", "127.0.0.1", "[::1]", "::1"].includes(host);

/** Explicitly enabled operator controls on the loopback-bound local server. */
export function allowsLocalRefill(request: Request) {
  if (process.env.PILOT_LOCAL_CONTROLS !== "1" || process.env.VERCEL)
    return false;
  const url = new URL(request.url);
  if (!loopback(url.hostname)) return false;
  const host = request.headers.get("host");
  // Next normalizes a 127.0.0.1 request URL to localhost. Validate both as
  // loopback aliases, but compare the browser Origin with its actual Host.
  let browserOrigin = url.origin;
  if (host) {
    try {
      const browserUrl = new URL(`${url.protocol}//${host}`);
      if (!loopback(browserUrl.hostname) || browserUrl.host !== host || browserUrl.port !== url.port)
        return false;
      browserOrigin = browserUrl.origin;
    } catch { return false; }
  }
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded?.split(",").some((ip) => !loopback(ip.trim()))) return false;
  if (request.headers.get("x-fork-night-local") !== "1") return false;
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return false;
  if (request.method !== "GET" && request.headers.get("origin") !== browserOrigin)
    return false;
  return true;
}

export async function handleLocalRefill(request: Request) {
  if (!allowsLocalRefill(request)) return reply({ enabled: false }, 404);
  if (!process.env.SUPABASE_SECRET_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL)
    return reply({ enabled: false }, 503);
  if (request.method === "GET") return reply({ enabled: true });
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer "))
    return reply({ error: "Join as a guest before adding test credits." }, 401);
  if (Number(request.headers.get("content-length") ?? 0) > 1024)
    return reply({ error: "The refill request is too large." }, 413);
  let input: { roomId?: unknown; requestId?: unknown };
  try {
    const body = await request.text();
    if (body.length > 1024) return reply({ error: "The refill request is too large." }, 413);
    input = JSON.parse(body);
    if (!input || typeof input !== "object") throw new Error();
  } catch {
    return reply({ error: "Choose a room and try adding credits again." }, 400);
  }
  if (
    typeof input.roomId !== "string" || !/^[a-z0-9-]{1,100}$/.test(input.roomId) ||
    typeof input.requestId !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.requestId)
  ) return reply({ error: "Choose a room and try adding credits again." }, 400);
  try {
    const admin = pilotAdmin();
    const verified = await admin.auth.getUser(authorization.slice(7));
    if (verified.error || !verified.data.user)
      return reply({ error: "Your guest session could not be verified. Please reconnect." }, 401);
    const result = await admin.rpc("pilot_refill_room", {
      p_request_id: input.requestId,
      p_room_id: input.roomId,
      p_actor: verified.data.user.id,
    });
    if (result.error)
      return reply({ error: result.error.code === "P0001" ? result.error.message : "The refill could not be confirmed. Retry to check the same refill." }, 409);
    return reply(result.data);
  } catch {
    return reply({ error: "The refill could not be confirmed. Retry to check the same refill." }, 503);
  }
}
