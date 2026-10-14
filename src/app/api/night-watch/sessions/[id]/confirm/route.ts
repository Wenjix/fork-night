import { bearer, failure, localOnly, reply } from "@/night-watch/http";

export const runtime = "nodejs";

/** Activates a session once Privy shows the Night Watch signer on the maker's wallet with this session's policy. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = localOnly(request);
  if (blocked) return blocked;
  try {
    const token = bearer(request);
    const { id } = await params;
    const { authenticateMaker } = await import("@/night-watch/maker");
    const { confirmSession, localDelegationDeps } = await import("@/night-watch/delegation");
    const maker = await authenticateMaker(token);
    return reply(await confirmSession(localDelegationDeps(), maker, id));
  } catch (error) {
    return failure(error);
  }
}
