import { assistFailure } from "@/generation/assist";
import { handleResidentPlan } from "@/generation/resident-plan";

export const runtime = "nodejs";
export const maxDuration = 45;
export async function POST(request: Request) {
  try { return await handleResidentPlan(request); }
  catch (error) { return assistFailure(error); }
}
