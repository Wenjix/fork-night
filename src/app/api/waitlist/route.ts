import { handleWaitlist } from "@/server/waitlist";

export const runtime = "nodejs";
export const maxDuration = 15;
export const POST = (request: Request) => handleWaitlist(request);
