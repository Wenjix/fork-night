import { failure, localOnly, notFound } from "@/night-watch/http";

export const runtime = "nodejs";

/** A published Night Watch moment's image (only published moments, only bytes matching their fingerprint). Local only. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = localOnly(request);
  if (blocked) return blocked;
  try {
    const { id } = await params;
    const { readMomentImage } = await import("@/night-watch/publish");
    const { fileNightWatchStore } = await import("@/night-watch/store");
    const image = await readMomentImage(fileNightWatchStore(), id);
    if (!image) return notFound();
    return new Response(new Uint8Array(image.bytes), {
      headers: { "Content-Type": image.contentType, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch (error) {
    return failure(error);
  }
}
