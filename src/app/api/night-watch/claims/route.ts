import type { ClaimRequest, ClaimResponse } from "@/night-watch/api-types";
import { bearer, failure, localOnly, NightWatchError, readJson, reply } from "@/night-watch/http";

export const runtime = "nodejs";

/**
 * Delivers one frozen recipient's share with the claim helper: a Privy server wallet signs
 * claim(releaseId, beneficiary), this server broadcasts it and waits for Monad's finalized block.
 * The contract pays only the frozen beneficiary. Any signed-in maker; local only.
 */
export async function POST(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;
  try {
    const token = bearer(request);
    const body = await readJson<Partial<ClaimRequest>>(request);
    if (typeof body?.releaseId !== "string" || typeof body.beneficiary !== "string") {
      throw new NightWatchError(400, "invalid_claim", "Choose a release and one of its frozen recipients.");
    }
    const { authenticateMaker } = await import("@/night-watch/maker");
    const { claimView, localClaimHelper, runClaim } = await import("@/night-watch/claim-helper");
    const { fileNightWatchStore } = await import("@/night-watch/store");
    await authenticateMaker(token);
    const helper = await localClaimHelper(fileNightWatchStore());
    const response: ClaimResponse = { claim: claimView(await runClaim(helper, body.releaseId, body.beneficiary)) };
    return reply(response);
  } catch (error) {
    return failure(error);
  }
}
