import { createHash } from "node:crypto";
import { pilotAdmin } from "../generation/client.ts";
import { FUNDING_REF_PATTERN, loadFundingConfig, type FundingConfig } from "../x402/config.ts";
import { supabaseFundingLedger } from "../x402/ledger.ts";
import { supabaseReceiptStore } from "../x402/store.ts";
import { loadMppAdapter, type MppAdapter } from "./adapter.ts";
import { moderatoReader } from "./chain.ts";
import { createChargePort } from "./charge.ts";
import { loadMppConfig, mppRoomFor, readChallengeKey, type MppDoorConfig } from "./config.ts";
import { handleMppFunding, type ChargePort } from "./funding.ts";

const reply = (body: unknown, status: number) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

// Reused across requests: one mppx seller (and its replay markers) per configuration and adapter.
let cached: { key: string; adapter: MppAdapter; port: ChargePort } | undefined;
function chargesFor(config: MppDoorConfig, challengeKey: string, adapter: MppAdapter) {
  const key = JSON.stringify([config.recipient, config.currency, createHash("sha256").update(challengeKey).digest("hex")]);
  if (cached?.key !== key || cached.adapter !== adapter)
    cached = { key, adapter, port: createChargePort(config, { challengeKey, adapter }) };
  return cached.port;
}

/** Wires the MPP door to this machine's x402 room opt-ins, the MPP settings and the shared pilot ledger. */
export async function handleLocalMppFunding(request: Request, fundingRef: string) {
  if (!FUNDING_REF_PATTERN.test(fundingRef)) return reply({ error: "Not found." }, 404);
  let funding: FundingConfig | null, door: MppDoorConfig | null;
  try {
    [funding, door] = await Promise.all([loadFundingConfig(), loadMppConfig()]);
  } catch (error) {
    console.error((error as Error).message);
    return reply({ error: "Room funding is not configured correctly on this server." }, 503);
  }
  const room = funding && door ? mppRoomFor(funding, door, fundingRef) : null;
  if (!room || !door) return reply({ error: "Not found." }, 404);
  if (!process.env.SUPABASE_SECRET_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL)
    return reply({ error: "Room funding is not configured on this server." }, 503);
  let challengeKey: string | null;
  try { challengeKey = await readChallengeKey(); } catch { challengeKey = null; }
  if (!challengeKey) return reply({ error: "Room funding is not configured on this server." }, 503);
  // mppx and its viem live in the isolated adapter, loaded only here, after the gate and every local check.
  let adapter: MppAdapter;
  try {
    adapter = await loadMppAdapter();
  } catch (error) {
    console.error(`mpp: ${(error as Error).message}`);
    return reply({ error: "Room funding is unavailable right now. Nothing was charged; try again." }, 503);
  }
  const admin = pilotAdmin();
  return handleMppFunding(request, fundingRef, {
    rooms: { [fundingRef]: room },
    charges: chargesFor(door, challengeKey, adapter),
    chain: moderatoReader({ keccak: adapter.keccakUtf8 }),
    store: supabaseReceiptStore(admin),
    ledger: supabaseFundingLedger(admin),
  });
}
