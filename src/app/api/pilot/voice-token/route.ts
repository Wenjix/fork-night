import { assistFailure, handleAssist } from "@/generation/assist";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    return await handleAssist(request, "voice");
  } catch (error) {
    return assistFailure(error);
  }
}
