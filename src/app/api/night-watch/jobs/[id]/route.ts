import { bearer, failure, localOnly, reply } from "@/night-watch/http";

export const runtime = "nodejs";

/** One job as its maker sees it: timeline, payment receipt, expense and private candidates. Local only. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = localOnly(request);
  if (blocked) return blocked;
  try {
    const token = bearer(request);
    const { id } = await params;
    const { jobForRequest } = await import("@/night-watch/job");
    return reply(await jobForRequest(token, id));
  } catch (error) {
    return failure(error);
  }
}
