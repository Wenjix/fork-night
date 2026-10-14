import { bearer, failure, localOnly, reply } from "@/night-watch/http";

export const runtime = "nodejs";

/** The signed-in maker's Night Watch: Privy wallet, sessions, jobs and whether the local runner is alive. */
export async function GET(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;
  try {
    const token = bearer(request);
    const { authenticateMaker } = await import("@/night-watch/maker");
    const { describeMaker, localDelegationDeps } = await import("@/night-watch/delegation");
    const maker = await authenticateMaker(token);
    return reply(await describeMaker(localDelegationDeps(), maker));
  } catch (error) {
    return failure(error);
  }
}
