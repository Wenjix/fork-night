import type { CopilotRequest } from "@/night-watch/api-types";
import { bearer, failure, localOnly, readJson, reply } from "@/night-watch/http";

export const runtime = "nodejs";

/** The desk co-pilot: Kimi K3 suggests briefs for a fork point. Operator-paid and rate-limited. Local only. */
export async function POST(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;
  try {
    const token = bearer(request);
    const body = await readJson<Partial<CopilotRequest>>(request);
    const { copilotForRequest } = await import("@/night-watch/copilot");
    return reply(await copilotForRequest(token, body));
  } catch (error) {
    return failure(error);
  }
}
