import { agentAuthorized, allowsLocalX402 } from "@/x402/gate";

export const runtime = "nodejs";

const notFound = () => Response.json({ error: "Not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });

/** Local, testnet-only MPP (Tempo Moderato) room top-up. Disabled unless this server opted in and the local agent sent its token. */
export async function POST(request: Request, { params }: { params: Promise<{ fundingRef: string }> }) {
  if (!allowsLocalX402(request) || !(await agentAuthorized(request))) return notFound();
  const { fundingRef } = await params;
  // The MPP code (and mppx, at run time) loads only for a request that passed the local gate.
  const { handleLocalMppFunding } = await import("@/mpp/local");
  return handleLocalMppFunding(request, fundingRef);
}

// Every other method gets the same 404 as a refused POST, so Next's default 405 and OPTIONS answers never reveal the route.
export const GET = notFound;
export const HEAD = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
export const OPTIONS = notFound;
