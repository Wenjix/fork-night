import { normalizeWaitlistEmail, WAITLIST_CONSENT_VERSION } from "../lib/waitlist.ts";
import { waitlistSettings } from "./waitlist-settings.ts";

type WaitlistEntry = { email: string; source: "demo" | "signup"; consent_version: string };
type Dependencies = { save: (entry: WaitlistEntry) => Promise<void> };
const headers = { "Cache-Control": "no-store" };

async function readSmallJson(request: Request): Promise<unknown> {
  if (!request.body) throw new Error("empty");
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2048) { await reader.cancel(); throw new Error("large"); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(parts).toString("utf8"));
}

export async function saveWaitlistEntry(entry: WaitlistEntry) {
  const { SUPABASE_URL: origin, SUPABASE_SECRET_KEY: key } = waitlistSettings();
  if (!origin || !key) throw new Error("Waitlist storage is not configured");
  const response = await fetch(new URL("/rest/v1/waitlist_signups?on_conflict=email", origin), {
    method: "POST",
    headers: {
      apikey: key,
      // New Supabase secret keys authenticate through apikey; legacy service JWTs also need Bearer.
      ...(key.startsWith("eyJ") ? { Authorization: `Bearer ${key}` } : {}),
      "Content-Type": "application/json",
      Prefer: "resolution=ignore-duplicates,return=minimal",
    },
    body: JSON.stringify(entry),
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Waitlist storage unavailable");
}

export async function handleWaitlist(request: Request, dependencies: Dependencies = { save: saveWaitlistEntry }) {
  const reply = (status: number, body: object) => Response.json(body, { status, headers });
  if (request.method !== "POST") return reply(405, { error: "Use the signup form to join." });
  if (request.headers.get("sec-fetch-site") === "cross-site") return reply(403, { error: "Please use the signup form on this site." });
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return reply(415, { error: "Please reload the signup form and try again." });
  let data: Record<string, unknown>;
  try {
    const value = await readSmallJson(request);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid");
    data = value as Record<string, unknown>;
  } catch { return reply(400, { error: "Please enter your email address and try again." }); }
  // A bot trap only; this is not email verification or a distributed rate limiter.
  if (data.website) return reply(400, { error: "We couldn’t save your signup. Please try again." });
  const email = normalizeWaitlistEmail(data.email);
  if (!email) return reply(400, { error: "Check your email address—for example, you@example.com." });
  if (data.consent !== true) return reply(400, { error: "Please agree to receive Fork Night updates before joining." });
  try {
    await dependencies.save({ email, source: data.source === "demo" ? "demo" : "signup", consent_version: WAITLIST_CONSENT_VERSION });
    return reply(200, { ok: true });
  } catch {
    // No email, raw upstream error or credentials in logs/responses.
    return reply(503, { error: "We couldn’t save your email just now. Please try again in a moment." });
  }
}
