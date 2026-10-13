import { pilotAdmin } from "../generation/client.ts";
import { FUNDING_REF_PATTERN, loadFundingConfig, type FundingConfig } from "./config.ts";
import { handleFunding, type PaymentPort } from "./funding.ts";
import { supabaseFundingLedger } from "./ledger.ts";
import { createPaymentPort } from "./payment.ts";
import { supabaseReceiptStore } from "./store.ts";

const reply = (body: unknown, status: number) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

// Reused across requests so the facilitator's supported kinds are fetched once.
let cached: { key: string; port: PaymentPort } | undefined;
function paymentsFor(config: FundingConfig) {
  const key = JSON.stringify([config.facilitatorUrl, config.payTo]);
  if (cached?.key !== key) cached = { key, port: createPaymentPort(config) };
  return cached.port;
}

/** Wires the funding handler to the operator's local configuration and the shared pilot ledger. */
export async function handleLocalFunding(request: Request, fundingRef: string) {
  if (!FUNDING_REF_PATTERN.test(fundingRef)) return reply({ error: "Not found." }, 404);
  let config: FundingConfig | null;
  try {
    config = await loadFundingConfig();
  } catch (error) {
    console.error((error as Error).message);
    return reply({ error: "Room funding is not configured correctly on this server." }, 503);
  }
  if (!config || !Object.hasOwn(config.rooms, fundingRef)) return reply({ error: "Not found." }, 404);
  if (!process.env.SUPABASE_SECRET_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL)
    return reply({ error: "Room funding is not configured on this server." }, 503);
  const admin = pilotAdmin();
  return handleFunding(request, fundingRef, {
    config,
    payments: paymentsFor(config),
    store: supabaseReceiptStore(admin),
    ledger: supabaseFundingLedger(admin),
  });
}
