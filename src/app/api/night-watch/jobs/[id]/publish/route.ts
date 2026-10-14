import type { PublishRequest, PublishResponse } from "@/night-watch/api-types";
import { bearer, failure, localOnly, readJson, reply } from "@/night-watch/http";

export const runtime = "nodejs";

/** The maker's separate approval: one delivered candidate becomes a public moment. Idempotent per job. Local only. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = localOnly(request);
  if (blocked) return blocked;
  try {
    const token = bearer(request);
    const { id } = await params;
    const body = await readJson<Partial<PublishRequest>>(request);
    const { authenticateMaker } = await import("@/night-watch/maker");
    const { nightWatchWorldMoment, publishCandidate } = await import("@/night-watch/publish");
    const { fileNightWatchStore } = await import("@/night-watch/store");
    const maker = await authenticateMaker(token);
    const moment = await publishCandidate({ store: fileNightWatchStore() }, maker, id, body?.candidate);
    const response: PublishResponse = { moment: nightWatchWorldMoment(moment) };
    return reply(response);
  } catch (error) {
    return failure(error);
  }
}
