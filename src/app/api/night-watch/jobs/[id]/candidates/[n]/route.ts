import { bearer, failure, localOnly } from "@/night-watch/http";

export const runtime = "nodejs";

/** A delivered private candidate's PNG, for its maker only, never cached. Local only. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; n: string }> }) {
  const blocked = localOnly(request);
  if (blocked) return blocked;
  try {
    const token = bearer(request);
    const { id, n } = await params;
    const { candidateImageForRequest } = await import("@/night-watch/job");
    const image = await candidateImageForRequest(token, id, n);
    return new Response(new Uint8Array(image), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
        "Content-Length": String(image.length),
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return failure(error);
  }
}
