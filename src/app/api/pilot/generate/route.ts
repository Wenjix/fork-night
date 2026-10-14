import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { isUuid } from "@/lib/pilot";
import { dispatchGeneration } from "@/generation/dispatch";

export const runtime = "nodejs";
const reply = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", Vary: "Authorization" } });

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer "))
    return reply({ error: "Join as a guest first." }, 401);
  if (Number(request.headers.get("content-length") ?? 0) > 1024)
    return reply({ error: "Request is too large." }, 413);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key || !process.env.PILOT_EXECUTION_ENV)
    return reply(
      { error: "Generation is being set up. Your draft is saved." },
      503,
    );
  const client = createClient<Database>(url, key, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const verified = await client.auth.getUser(authorization.slice(7));
  if (verified.error || !verified.data.user)
    return reply(
      { error: "Your guest session could not be verified. Please reconnect." },
      401,
    );
  let operationId: unknown;
  try {
    const body = await request.text();
    if (body.length > 1024)
      return reply({ error: "Request is too large." }, 413);
    operationId = JSON.parse(body).operationId;
  } catch {
    return reply({ error: "Choose a saved continuation." }, 400);
  }
  if (!isUuid(operationId))
    return reply({ error: "Choose a saved continuation." }, 400);
  const accepted = await client.rpc("pilot_request_generation", {
    p_operation_id: operationId,
  });
  if (accepted.error) {
    let activeWork: unknown;
    try { activeWork = JSON.parse(accepted.error.details); } catch { /* Ordinary admission errors have no active-work projection. */ }
    return reply(
      {
        activeWork,
        error:
          accepted.error.code === "P0001"
            ? accepted.error.message
            : "Your saved continuation could not be queued. Please reconnect.",
      },
      409,
    );
  }
  if (accepted.data.state !== "queued")
    return reply({ operationId, state: accepted.data.state });
  try {
    await dispatchGeneration(operationId, accepted.data.dispatch_version);
    return reply({ operationId, state: "queued" }, 202);
  } catch {
    return reply(
      {
        operationId,
        state: "queued",
        error:
          "Your continuation is saved and waiting to start. You can leave this page while it is checked.",
      },
      202,
    );
  }
}
