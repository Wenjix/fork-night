import { bearer, failure, localOnly, reply } from "@/night-watch/http";

export const runtime = "nodejs";

/** Revokes a session here at once, then asks Privy to refuse everything under its policy. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = localOnly(request);
  if (blocked) return blocked;
  try {
    const token = bearer(request);
    const { id } = await params;
    const { authenticateMaker } = await import("@/night-watch/maker");
    const { localDelegationDeps, revokeSession } = await import("@/night-watch/delegation");
    const maker = await authenticateMaker(token);
    return reply(await revokeSession(localDelegationDeps(), maker, id));
  } catch (error) {
    return failure(error);
  }
}
