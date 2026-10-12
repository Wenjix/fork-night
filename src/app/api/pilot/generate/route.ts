import { createClient } from "@supabase/supabase-js";
import { tasks } from "@trigger.dev/sdk";
import type { Database } from "@/lib/supabase/database.types";
import type { generateContinuation } from "@/trigger/generate";
import { isUuid } from "@/lib/pilot";

export const runtime = "nodejs";
const reply = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer "))
    return reply({ error: "Join as a guest first." }, 401);
  if (Number(request.headers.get("content-length") ?? 0) > 1024)
    return reply({ error: "Request is too large." }, 413);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key || !process.env.TRIGGER_SECRET_KEY)
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
  if (accepted.error)
    return reply(
      {
        error:
          accepted.error.code === "P0001"
            ? accepted.error.message
            : "Your saved continuation could not be queued. Please reconnect.",
      },
      409,
    );
  if (accepted.data.state !== "queued")
    return reply({ operationId, state: accepted.data.state });
  try {
    await tasks.trigger<typeof generateContinuation>(
      "fork-night-generate",
      { operationId },
      {
        idempotencyKey: `pilot-${operationId}-${accepted.data.dispatch_version}`,
      },
    );
    return reply({ operationId, state: "queued" }, 202);
  } catch {
    return reply(
      {
        operationId,
        state: "queued",
        error:
          "Your continuation is saved. The worker could not be reached; use Check saved result to reconnect.",
      },
      503,
    );
  }
}
