import { failure, localOnly, notFound } from "@/night-watch/http";

export const runtime = "nodejs";

/** One frame (0–5) of the packaged Midnight Signal art sheet as PNG, for the world kit's references. Local only. */
export async function GET(request: Request, { params }: { params: Promise<{ frame: string }> }) {
  const blocked = localOnly(request);
  if (blocked) return blocked;
  try {
    const { frame } = await params;
    if (!/^[0-5]$/.test(frame)) return notFound();
    const { storyFrame } = await import("@/night-watch/world");
    const png = await storyFrame(Number(frame));
    return new Response(new Uint8Array(png), {
      headers: { "Content-Type": "image/png", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch (error) {
    return failure(error);
  }
}
