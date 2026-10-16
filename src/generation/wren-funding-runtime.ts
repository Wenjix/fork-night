import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadMppAdapter } from "../mpp/adapter.ts";
import { moderatoReader } from "../mpp/chain.ts";
import { createChargePort } from "../mpp/charge.ts";
import { CHALLENGE_KEY_PATTERN, type MppRoom } from "../mpp/config.ts";
import { handleMppFunding } from "../mpp/funding.ts";
import { MPP_REALM, PATHUSD, TEMPO_MODERATO, mppRecordPaths } from "../mpp/ids.ts";
import type { MppReceipt } from "../mpp/records.ts";
import { RefillRefusedError, supabaseFundingLedger, type FundingLedger, type RefillResult } from "../x402/ledger.ts";
import { readRecord, supabaseReceiptStore } from "../x402/store.ts";
import { pilotAdmin } from "./client.ts";
import { WREN_FUNDING, type WrenCreditsInput, type WrenFundingDeps, type WrenFundingPolicy, type WrenPayment } from "./wren-funding.ts";

const FUNDING_REF = "wren-hosted-kessler-ward";
// This new module uses the same pinned dependency tree; the reviewed general
// adapter index and lockfile remain byte-identical and are checked by its loader.
export const WREN_SIGNER_SHA256 = "8d7e552b697b0dbcad823e5d909d1c541463d077c30e9bfe22cbebe6f54aa9be";
type WrenSigner = {
  createWrenPayment(input: { key: string; policy: WrenFundingPolicy; challenge: unknown }): Promise<string>;
};

/** Trigger copies root node_modules into its final image; nested vendor deps are excluded. */
async function runtimeAdapter() {
  const packaged = resolve(/*turbopackIgnore: true*/ "node_modules/fork-night-mpp-adapter/index.mjs");
  const installed = await readFile(/*turbopackIgnore: true*/ packaged).then(() => true, (error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    return false;
  });
  const path = installed ? packaged : resolve(/*turbopackIgnore: true*/ "vendor/mpp-adapter/index.mjs");
  return { path, adapter: await loadMppAdapter(path) };
}

async function scopedSigner(): Promise<WrenSigner> {
  const { path: indexPath } = await runtimeAdapter();
  const path = resolve(/*turbopackIgnore: true*/ dirname(indexPath), "wren.mjs");
  const bytes = await readFile(/*turbopackIgnore: true*/ path);
  if (createHash("sha256").update(bytes).digest("hex") !== WREN_SIGNER_SHA256)
    throw new Error("The scoped payment signer is not the reviewed version.");
  return import(/* webpackIgnore: true */ /* turbopackIgnore: true */ pathToFileURL(path).href);
}

/** Server-only runtime. No public funding endpoint or browser-held agent token. */
export function wrenFundingDeps(): WrenFundingDeps {
  const admin = pilotAdmin();
  // Additive service-only RPCs are intentionally isolated from generated public
  // database types until the migration is applied and types are regenerated.
  const service = admin as unknown as {
    rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
  };
  const store = supabaseReceiptStore(admin);
  const legacy = supabaseFundingLedger(admin);
  const ledger: FundingLedger = {
    state: legacy.state,
    async refill(requestId, roomId, actor) {
      const result = await service.rpc("pilot_refill_wren_room", { p_request_id: requestId, p_room_id: roomId, p_actor: actor });
      if (result.error) {
        const error = result.error as { code?: string };
        if (error.code === "P0001") throw new RefillRefusedError("The paid room refill is unavailable.");
        throw new Error("The paid refill could not be confirmed.");
      }
      const data = result.data as RefillResult | null;
      if (!data || data.added !== 5 || typeof data.replayed !== "boolean") throw new Error("The paid refill returned an unexpected result.");
      return data;
    },
  };
  const claimArgs = (input: WrenCreditsInput) => ({ p_request_id: input.requestId, p_claim_token: input.claimToken });
  const rpc = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
    const result = await service.rpc(name, args);
    if (result.error || !result.data) throw new Error("The durable payment record is unavailable.");
    return result.data as T;
  };
  const roomFor = (input: WrenCreditsInput): MppRoom => ({
    roomId: WREN_FUNDING.roomId, stewardProfileId: input.actorId, maxTopUps: 1,
  });
  const chargePort = async () => {
    const key = process.env.WREN_MPP_CHALLENGE_KEY;
    if (!key || !CHALLENGE_KEY_PATTERN.test(key)) throw new Error("The hosted payment door is not configured.");
    const { adapter } = await runtimeAdapter();
    return { adapter, charges: createChargePort({
      network: TEMPO_MODERATO, recipient: WREN_FUNDING.payTo, currency: PATHUSD,
      rooms: { [WREN_FUNDING.roomId]: { maxTopUps: 1 } },
    }, { challengeKey: key, adapter }) };
  };
  const seller = async (input: WrenCreditsInput, payment?: WrenPayment) => {
    const { adapter, charges } = await chargePort();
    return handleMppFunding(new Request("https://wren.internal/fund", {
      method: "POST", ...(payment ? { headers: { authorization: payment.credential } } : {}),
    }), FUNDING_REF, {
      rooms: { [FUNDING_REF]: roomFor(input) }, charges, store, ledger,
      chain: moderatoReader({ keccak: adapter.keccakUtf8 }),
    });
  };
  return {
    preflight: (input) => rpc("pilot_wren_funding_preflight", claimArgs(input)),
    claim: (input) => rpc("pilot_claim_wren_payment", claimArgs(input)),
    save: (input, state, payment, receiptId, message) => rpc("pilot_save_wren_payment", {
      ...claimArgs(input), p_state: state, p_payment: payment, p_receipt_id: receiptId ?? null, p_message: message ?? null,
    }),
    async offer(input) {
      const response = await seller(input);
      if (response.status !== 402) throw new Error("The fixed payment door did not offer a top-up.");
      const { adapter } = await chargePort();
      const challenge = adapter.parseChallengeHeader(response.headers.get("WWW-Authenticate") ?? "");
      if (challenge.realm !== MPP_REALM) throw new Error("The offer is outside this payment door.");
      return challenge;
    },
    async sign(challenge, policy) {
      const key = process.env.WREN_TEMPO_ACCESS_KEY;
      if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("Wren's scoped signer is not configured.");
      const signer = await scopedSigner();
      return signer.createWrenPayment({ key, policy, challenge });
    },
    async inspectSigned(input, credential) {
      const { charges } = await chargePort();
      const presented = await charges.present(credential, roomFor(input));
      if ("invalid" in presented) throw new Error("The signed payment does not match this room's exact offer.");
      return presented;
    },
    async pay(input, payment) {
      // The seller recognizes saved intents before checking a current offer,
      // so expired/unknown payments reconcile from the chain, never re-sign.
      await seller(input, payment);
    },
    receipt: (payment) => readRecord<MppReceipt>(store, mppRecordPaths(payment.intentId, payment.roomId).receipt),
  };
}
