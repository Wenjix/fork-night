import { failure, localOnly, reply } from "@/night-watch/http";

export const runtime = "nodejs";

/** The Night Watch's ERC-8004 calling card: the saved registration, re-checked on the registry when minted. Local only. */
export async function GET(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;
  try {
    const { localIdentity } = await import("@/night-watch/identity");
    return reply(await localIdentity());
  } catch (error) {
    return failure(error);
  }
}
