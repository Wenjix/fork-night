import { assistFailure, assistStatus, handleAssist } from "@/generation/assist";
export const runtime = "nodejs";
export const maxDuration = 45;
export async function GET(request: Request) {
  try {
    return await assistStatus(request);
  } catch (error) {
    return assistFailure(error);
  }
}
export async function POST(request: Request) {
  try {
    return await handleAssist(request, "shape");
  } catch (error) {
    return assistFailure(error);
  }
}
