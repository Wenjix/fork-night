import { failure, localOnly, reply } from "@/night-watch/http";

export const runtime = "nodejs";

/** The world: kit, the story's moments (shared room + published here) and room credits. No sign-in needed. Local only. */
export async function GET(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;
  try {
    const { localWorldDeps, readWorld } = await import("@/night-watch/world");
    // A signed-in viewer is optional; it only keeps their own moment out of "a friend's contribution".
    let viewerId: string | null = null;
    const header = request.headers.get("authorization") ?? "";
    if (header.startsWith("Bearer ")) {
      const { authenticateMaker } = await import("@/night-watch/maker");
      viewerId = await authenticateMaker(header.slice(7)).then((maker) => maker.id, () => null);
    }
    return reply(await readWorld(localWorldDeps(), { viewerId }));
  } catch (error) {
    return failure(error);
  }
}
