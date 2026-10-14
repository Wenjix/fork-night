import { bearer, failure, localOnly, readJson, reply } from "@/night-watch/http";

export const runtime = "nodejs";

/** Starts a Night Watch session: its own Privy policy, saved awaiting the maker's signer. Nothing is signed. */
export async function POST(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;
  try {
    const token = bearer(request);
    const body = await readJson<unknown>(request);
    const { authenticateMaker } = await import("@/night-watch/maker");
    const { beginSession, localDelegationDeps, parseCreateSessionRequest } = await import("@/night-watch/delegation");
    const maker = await authenticateMaker(token);
    const input = parseCreateSessionRequest(body);
    return reply(await beginSession(localDelegationDeps(), { maker, ...input }));
  } catch (error) {
    return failure(error);
  }
}
