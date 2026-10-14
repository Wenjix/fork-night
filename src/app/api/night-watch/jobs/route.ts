import type { CreateJobRequest } from "@/night-watch/api-types";
import { bearer, failure, localOnly, readJson, reply } from "@/night-watch/http";

export const runtime = "nodejs";

/** Schedules a Night Watch job for the signed-in maker's active session. Local only. */
export async function POST(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;
  try {
    const token = bearer(request);
    const body = await readJson<Partial<CreateJobRequest>>(request);
    const { createJobForRequest } = await import("@/night-watch/job");
    return reply(await createJobForRequest(token, body), 201);
  } catch (error) {
    return failure(error);
  }
}
