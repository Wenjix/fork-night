import { agentAuthorized, allowsLocalX402 } from "@/x402/gate";

export const runtime = "nodejs";

/** Local, testnet-only x402 room top-up. Disabled unless this server opted in and the local agent sent its token. */
export async function POST(request: Request, { params }: { params: Promise<{ fundingRef: string }> }) {
  if (!allowsLocalX402(request) || !(await agentAuthorized(request)))
    return Response.json({ error: "Not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  const { fundingRef } = await params;
  // The x402 and Solana code loads only for a request that passed the local gate.
  const { handleLocalFunding } = await import("@/x402/local");
  return handleLocalFunding(request, fundingRef);
}
