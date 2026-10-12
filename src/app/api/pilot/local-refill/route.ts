import { handleLocalRefill } from "@/generation/local-refill";

export const runtime = "nodejs";
export const GET = handleLocalRefill;
export const POST = handleLocalRefill;
