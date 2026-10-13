import { randomBytes } from "node:crypto";
import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from "@x402/core/http";
import { PaymentPayloadV2Schema } from "@x402/core/schemas";
import { HTTPFacilitatorClient, x402ResourceServer, type FacilitatorClient } from "@x402/core/server";
import { SettleError, type PaymentPayload, type PaymentRequirements } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import {
  address,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
} from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { canonicalJson, digest } from "../experiments/storage.ts";
import type { FundingConfig } from "./config.ts";
import type { PaymentPort, PresentedPayment, ResourceInfo, Settlement } from "./funding.ts";
import {
  BASE_SEPOLIA,
  MAX_TIMEOUT_SECONDS,
  MEMO_PATTERN,
  SOLANA_DEVNET,
  TESTNETS,
  TESTNET_USDC,
  TOP_UP,
  isTestnet,
  type Testnet,
} from "./ids.ts";

const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const TRANSFER_CHECKED = 12;
const EVM_TRANSACTION = /^0x[0-9a-fA-F]{64}$/;
const SOLANA_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

type Eip3009Payload = {
  authorization: { from: string; to: string; value: string; validAfter: string; validBefore: string; nonce: string };
  signature: string;
};

/** Exactly the EIP-3009 shape; Permit2 or other transfer methods are refused. */
function isEip3009(value: unknown): value is Eip3009Payload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  if (Object.keys(payload).sort().join(",") !== "authorization,signature") return false;
  const a = payload.authorization as Record<string, unknown> | null;
  return !!a && typeof a === "object" &&
    /^0x[0-9a-fA-F]{40}$/.test(String(a.from)) &&
    /^0x[0-9a-fA-F]{40}$/.test(String(a.to)) &&
    /^\d{1,78}$/.test(String(a.value)) &&
    /^\d{1,20}$/.test(String(a.validAfter)) &&
    /^\d{1,20}$/.test(String(a.validBefore)) &&
    /^0x[0-9a-fA-F]{64}$/.test(String(a.nonce)) &&
    typeof payload.signature === "string" && /^0x[0-9a-fA-F]{130,}$/.test(payload.signature);
}

/** Reads the memo and the single token transfer from a partially signed exact SVM payment. */
export function decodeSolanaPayment(base64: string) {
  const transaction = getTransactionDecoder().decode(getBase64Encoder().encode(base64));
  const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
  const keys = message.staticAccounts.map(String);
  const memos: string[] = [];
  const transfers: { program: string; mint: string; destination: string; authority: string; amount: string }[] = [];
  for (const instruction of message.instructions) {
    const program = keys[instruction.programAddressIndex];
    const data = instruction.data ?? new Uint8Array();
    if (program === MEMO_PROGRAM) memos.push(new TextDecoder("utf-8", { fatal: true }).decode(data));
    // Every token-program instruction counts, so any second movement of tokens is refused.
    if (program === String(TOKEN_PROGRAM_ADDRESS) || program === TOKEN_2022_PROGRAM) {
      const checked = program === String(TOKEN_PROGRAM_ADDRESS) && data[0] === TRANSFER_CHECKED && data.length === 10;
      const account = (index: number) => keys[(instruction.accountIndices ?? [])[index]];
      const amount = checked ? new DataView(data.buffer, data.byteOffset + 1, 8).getBigUint64(0, true).toString() : "";
      transfers.push({ program, mint: account(1), destination: account(2), authority: account(3), amount });
    }
  }
  return { feePayer: keys[0], memos, transfers };
}

const samePayer = (network: Testnet, a: string, b: string) =>
  network === BASE_SEPOLIA ? a.toLowerCase() === b.toLowerCase() : a === b;

/** The facilitator sees the route without the room's funding reference; no scheme signs the resource. */
const forFacilitator = (payload: PaymentPayload): PaymentPayload =>
  payload.resource
    ? { ...payload, resource: { ...payload.resource, url: new URL("/api/x402/fund", payload.resource.url).href } }
    : payload;

/** The @x402/core seller for this server's configured testnets, using explicit verify and settle. */
export function createPaymentPort(
  config: FundingConfig,
  options: { facilitator?: FacilitatorClient; now?: () => number } = {},
): PaymentPort {
  const networks = TESTNETS.filter((network) => config.payTo[network]);
  const now = options.now ?? Date.now;
  const server = new x402ResourceServer(options.facilitator ?? new HTTPFacilitatorClient({ url: config.facilitatorUrl }));
  if (config.payTo[BASE_SEPOLIA]) server.register(BASE_SEPOLIA, new ExactEvmScheme());
  if (config.payTo[SOLANA_DEVNET]) server.register(SOLANA_DEVNET, new ExactSvmScheme());
  let initialized: Promise<void> | undefined;
  const ready = () => {
    // Reads the facilitator's supported kinds (including the Solana fee payer) once, retrying after a failure.
    initialized ??= server.initialize().catch((error: unknown) => {
      initialized = undefined;
      throw error;
    });
    return initialized;
  };

  async function requirement(network: Testnet, memo?: string): Promise<PaymentRequirements> {
    await ready();
    const payTo = config.payTo[network]!;
    const [built] = await server.buildPaymentRequirements({
      scheme: "exact",
      network,
      price: TOP_UP.price,
      payTo,
      maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
      ...(memo ? { extra: { memo } } : {}),
    });
    // Guards against SDK defaults drifting away from the reviewed testnet asset and price.
    const extra = (built?.extra ?? {}) as Record<string, unknown>;
    if (
      !built || built.scheme !== "exact" || built.network !== network ||
      built.asset !== TESTNET_USDC[network] || built.amount !== TOP_UP.atomic || built.payTo !== payTo ||
      (network === SOLANA_DEVNET && (typeof extra.feePayer !== "string" || extra.memo !== memo))
    ) throw new Error(`Unexpected x402 requirement for ${network}`);
    return built;
  }

  return {
    async offer(resource: ResourceInfo, error?: string) {
      const memo = randomBytes(16).toString("hex");
      const accepts: PaymentRequirements[] = [];
      for (const network of networks)
        accepts.push(await requirement(network, network === SOLANA_DEVNET ? memo : undefined));
      const body = await server.createPaymentRequiredResponse(accepts, resource, error);
      return { header: encodePaymentRequiredHeader(body), body };
    },

    async present(header: string, resource: ResourceInfo) {
      let payload: PaymentPayload;
      try {
        payload = decodePaymentSignatureHeader(header);
      } catch {
        return { invalid: "The payment header could not be decoded." };
      }
      if (!PaymentPayloadV2Schema.safeParse(payload).success || payload.x402Version !== 2)
        return { invalid: "Only x402 version 2 payments are accepted." };
      const network = payload.accepted.network;
      if (!isTestnet(network) || !config.payTo[network] || payload.accepted.scheme !== "exact")
        return { invalid: "This network or scheme is not offered for this room." };
      // The payload echoes the offer's resource, whose path names this room's funding reference.
      let echoedPath: string | undefined;
      try { echoedPath = payload.resource ? new URL(payload.resource.url).pathname : undefined; } catch { echoedPath = undefined; }
      if (echoedPath !== new URL(resource.url).pathname)
        return { invalid: "This payment was made for a different funding link." };

      let found: Omit<PresentedPayment, "payloadDigest" | "payload" | "requirement" | "payTo" | "asset" | "amount">;
      let required: PaymentRequirements;
      if (network === BASE_SEPOLIA) {
        if (!isEip3009(payload.payload)) return { invalid: "Only EIP-3009 USDC authorizations are accepted." };
        const { authorization } = payload.payload;
        required = await requirement(network);
        if (authorization.to.toLowerCase() !== required.payTo.toLowerCase() || authorization.value !== required.amount)
          return { invalid: "The authorization does not pay this offer." };
        // The facilitator sets no upper bound; a far-future validBefore would keep the intent unresolvable.
        // Reported, not refused: a recorded payment re-sent late must still get its stored outcome.
        const seconds = Math.floor(now() / 1000);
        const stale = Number(authorization.validAfter) > seconds || Number(authorization.validBefore) < seconds + 6 ||
          Number(authorization.validBefore) > seconds + MAX_TIMEOUT_SECONDS + 30;
        found = {
          network,
          key: { network, payer: authorization.from.toLowerCase(), nonce: authorization.nonce.toLowerCase() },
          payer: authorization.from,
          validUntil: new Date(Number(authorization.validBefore) * 1000).toISOString(),
          ...(stale ? { stale: "The authorization's validity window does not match this offer." } : {}),
        };
      } else {
        const transaction = (payload.payload as { transaction?: unknown }).transaction;
        const memo = (payload.accepted.extra ?? {}).memo;
        if (typeof transaction !== "string" || transaction.length > 1700 || typeof memo !== "string" || !MEMO_PATTERN.test(memo))
          return { invalid: "The Solana payment is malformed." };
        let decoded: ReturnType<typeof decodeSolanaPayment>;
        try {
          decoded = decodeSolanaPayment(transaction);
        } catch {
          return { invalid: "The Solana transaction could not be decoded." };
        }
        required = await requirement(network, memo);
        const [destination] = await findAssociatedTokenPda({
          owner: address(required.payTo),
          mint: address(required.asset),
          tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });
        const [transfer] = decoded.transfers;
        // The memo keys the intent and the reconciler's chain lookup, so it must be the one in the transaction.
        if (
          decoded.memos.length !== 1 || decoded.memos[0] !== memo || decoded.transfers.length !== 1 ||
          transfer.mint !== required.asset || transfer.destination !== destination || transfer.amount !== required.amount ||
          !transfer.authority
        ) return { invalid: "The Solana transaction does not pay this offer." };
        found = { network, key: { network, memo }, payer: transfer.authority, validUntil: null };
      }
      const matched = server.findMatchingRequirements([required], payload);
      if (!matched) return { invalid: "The payment does not match this room's offer." };
      return {
        ...found,
        payTo: matched.payTo,
        asset: matched.asset,
        amount: matched.amount,
        payloadDigest: digest(canonicalJson(payload)),
        payload,
        requirement: matched,
      };
    },

    async verify(payment: PresentedPayment) {
      const result = await server.verifyPayment(
        forFacilitator(payment.payload as PaymentPayload),
        payment.requirement as PaymentRequirements,
      );
      if (!result.isValid) return { valid: false, reason: result.invalidReason ?? "invalid_payment" };
      if (result.payer && !samePayer(payment.network, result.payer, payment.payer))
        return { valid: false, reason: "payer_mismatch" };
      return { valid: true, payer: payment.payer };
    },

    async settle(payment: PresentedPayment): Promise<Settlement> {
      const payload = forFacilitator(payment.payload as PaymentPayload);
      try {
        const result = await server.settlePayment(payload, payment.requirement as PaymentRequirements);
        const pattern = payment.network === BASE_SEPOLIA ? EVM_TRANSACTION : SOLANA_SIGNATURE;
        if (result.success && result.network === payment.network && pattern.test(result.transaction))
          return { kind: "settled", transaction: result.transaction, response: result, header: encodePaymentResponseHeader(result) };
        // A pending retry inside the SDK can report a landed payment as failed, so only the chain decides.
        return { kind: "pending", transaction: result.transaction || null, reason: result.errorReason ?? "unconfirmed" };
      } catch (error) {
        // Malformed requests are refused before the facilitator acts; everything else is indeterminate.
        if (error instanceof SettleError && error.statusCode === 400 &&
            ["invalid_json", "missing_parameters"].includes(error.errorReason ?? ""))
          return { kind: "failed", reason: error.errorReason! };
        const transaction = error instanceof SettleError && error.transaction ? error.transaction : null;
        return { kind: "pending", transaction, reason: (error as Error).name || "settle_error" };
      }
    },
  };
}
