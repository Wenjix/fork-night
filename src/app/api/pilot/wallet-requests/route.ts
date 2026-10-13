import { handleWalletRequests } from "@/lib/onchain/wallet-request-server";

export const runtime = "nodejs";
export const GET = handleWalletRequests;
export const POST = handleWalletRequests;
