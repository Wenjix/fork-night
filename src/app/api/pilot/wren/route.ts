import { handleWrenRequest } from "@/generation/wren-api";

export const runtime = "nodejs";
export const GET = (request: Request) => handleWrenRequest(request);
export const POST = (request: Request) => handleWrenRequest(request);
