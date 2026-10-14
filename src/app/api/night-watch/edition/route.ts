import { failure, localOnly, reply } from "@/night-watch/http";

export const runtime = "nodejs";

/** The morning edition for ?tip=<momentId>: path rows for <TestnetRelease>, the release at Monad's finalized block, saved claims. Local only. */
export async function GET(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;
  try {
    const tip = new URL(request.url).searchParams.get("tip") ?? "";
    const { editionFor, localEditionDeps } = await import("@/night-watch/edition");
    return reply(await editionFor(localEditionDeps(), tip));
  } catch (error) {
    return failure(error);
  }
}
