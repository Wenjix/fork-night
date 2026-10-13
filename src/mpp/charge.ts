import { createHash, createHmac } from "node:crypto";
import type { Eip1193Request, MppAdapter, MppChallenge, MppCredential } from "./adapter.ts";
import { memoMatcher } from "./chain.ts";
import type { MppDoorConfig, MppRoom } from "./config.ts";
import type { ChargePort, ChargeSettlement, PresentedCharge } from "./funding.ts";
import {
  MAX_VALIDITY_SECONDS,
  MIN_VALIDITY_SECONDS,
  MODERATO_CHAIN_ID,
  MPP_REALM,
  MPP_TOP_UP,
  TEMPO_MODERATO,
  TRANSACTION_PATTERN,
  TRANSFER_WITH_MEMO_SELECTOR,
  normalizeHash,
  sameAddress,
} from "./ids.ts";

/** Binds a challenge to the room it was offered for: an HMAC tag, never the room ID or funding reference. */
export const roomTagFor = (challengeKey: string, roomId: string) =>
  createHmac("sha256", challengeKey).update(`mpp-door-room|${roomId}`).digest("hex").slice(0, 16);

/** One signed payment's identity: the same signed transaction always has the same digest. */
const payloadDigestOf = (signature: string) => createHash("sha256").update(`transaction|${signature.toLowerCase()}`).digest("hex");
const SIGNATURE = /^0x[0-9a-fA-F]{2,4000}$/;

/**
 * When the adapter reports that the offer expired before the send, the signed transaction is reported failed
 * only once its own deadline is this far past, so a node clock a few seconds behind ours cannot still admit it.
 */
export const EXPIRED_SEND_MARGIN_SECONDS = 3;

function opaqueOf(challenge: MppChallenge): Record<string, unknown> | null {
  try {
    const value = JSON.parse(Buffer.from(String(challenge.opaque ?? ""), "base64url").toString("utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * The mppx 0.13.4 Tempo charge seller for this door, through the isolated adapter: pull mode only (the
 * door broadcasts), one currency, no fee sponsor, an explicit neutral realm and no route scope. mppx's stock
 * request handler is never used on the paid path: it re-offers after a broadcast failure.
 */
export function createChargePort(
  config: MppDoorConfig,
  options: { challengeKey: string; adapter: MppAdapter; rpc?: Eip1193Request; now?: () => number },
): ChargePort {
  const { adapter, challengeKey } = options;
  const now = options.now ?? Date.now;
  const server = adapter.createChargeServer({
    secretKey: challengeKey,
    realm: MPP_REALM,
    currency: config.currency,
    recipient: config.recipient,
    chainId: MODERATO_CHAIN_ID,
    ...(options.rpc ? { request: options.rpc } : {}),
  });
  const routeOptions = (roomTag: string) => ({ request: { amount: MPP_TOP_UP.amount }, realm: MPP_REALM, meta: { r: roomTag } });
  const tagFor = (room: MppRoom) => roomTagFor(challengeKey, room.roomId);

  return {
    identify(authorization) {
      let credential: MppCredential | null;
      try { credential = adapter.readCredential(authorization); } catch { return null; }
      const id = credential?.challenge?.id;
      if (typeof id !== "string" || !id) return null;
      const payload = credential!.payload as { type?: unknown; signature?: unknown } | null;
      const signature = payload?.type === "transaction" && typeof payload.signature === "string" && SIGNATURE.test(payload.signature)
        ? payload.signature : null;
      return { challengeId: id, payloadDigest: signature ? payloadDigestOf(signature) : null };
    },

    async offer(room, error) {
      const challenge = await server.challenge({ amount: MPP_TOP_UP.amount, meta: { r: tagFor(room) } });
      return {
        header: challenge.header,
        body: {
          type: "https://paymentauth.org/problems/payment-required",
          title: "Payment Required",
          status: 402,
          detail: `Fork Night room top-up: ${MPP_TOP_UP.credits} test credits for ${MPP_TOP_UP.price} on Tempo Moderato (testnet).`,
          challengeId: challenge.id,
          ...(error ? { error } : {}),
        },
      };
    },

    async present(authorization, room) {
      let credential: MppCredential | null;
      try {
        credential = adapter.readCredential(authorization);
      } catch {
        return { invalid: "The payment credential could not be decoded." };
      }
      if (!credential) return { invalid: "Only Payment credentials are accepted." };
      const challenge = credential.challenge;
      if (!challenge || typeof challenge.id !== "string" || !server.verifyChallenge(challenge))
        return { invalid: "This payment answers an offer this server did not make." };
      if (challenge.realm !== MPP_REALM || challenge.method !== "tempo" || challenge.intent !== "charge")
        return { invalid: "Only a Tempo charge for this door is accepted." };
      const roomTag = tagFor(room);
      if (opaqueOf(challenge)?.r !== roomTag) return { invalid: "This payment was made for a different funding link." };
      const request = challenge.request ?? {};
      const details = (request.methodDetails ?? {}) as Record<string, unknown>;
      // The HMAC covers the request; these checks catch a config change since the offer.
      if (details.chainId !== MODERATO_CHAIN_ID) return { invalid: "This network is not offered for this room." };
      if (!sameAddress(request.currency, config.currency)) return { invalid: "This token is not offered for this room." };
      if (request.amount !== MPP_TOP_UP.atomic) return { invalid: "The payment amount does not match this offer." };
      if (!sameAddress(request.recipient, config.recipient)) return { invalid: "The payment does not pay this room's address." };
      if (JSON.stringify(details.supportedModes) !== JSON.stringify(["pull"]) || details.feePayer || details.splits)
        return { invalid: "The offer's terms do not match this room's offer." };

      const payload = credential.payload as { type?: unknown; signature?: unknown } | null;
      if (payload?.type === "hash")
        return { invalid: "This door broadcasts the signed transaction itself; hash (push) credentials are not accepted." };
      if (payload?.type !== "transaction" || typeof payload.signature !== "string" || !SIGNATURE.test(payload.signature))
        return { invalid: "Only a signed Tempo transaction is accepted." };
      const signature = payload.signature.toLowerCase();
      let decoded: Awaited<ReturnType<MppAdapter["decodeTransaction"]>>;
      try {
        decoded = await adapter.decodeTransaction(signature);
      } catch {
        return { invalid: "The signed transaction could not be decoded." };
      }
      if (decoded.type !== "tempo" || decoded.sponsored) return { invalid: "Only an unsponsored Tempo transaction is accepted." };
      if (decoded.chainId !== MODERATO_CHAIN_ID) return { invalid: "The transaction is not for Tempo Moderato." };
      const from = String(decoded.from ?? "");
      if (!/^0x[0-9a-fA-F]{40}$/.test(from)) return { invalid: "The transaction has no recoverable sender." };
      if (typeof credential.source === "string" && credential.source.toLowerCase() !== `did:pkh:${TEMPO_MODERATO}:${from}`.toLowerCase())
        return { invalid: "The credential's source does not match the transaction's sender." };
      const validBefore = decoded.validBefore;
      if (validBefore === null || !Number.isInteger(validBefore))
        return { invalid: "The transaction has no expiry; only expiring-nonce payments are accepted." };
      // The signed deadline may not outlive the offer (stock mppx signs min(now + 25 s, expiry)), so a payment
      // whose offer expired before the send can no longer land either.
      const expires = typeof challenge.expires === "string" ? Date.parse(challenge.expires) : Number.NaN;
      if (Number.isFinite(expires) && validBefore > Math.floor(expires / 1000))
        return { invalid: "The signed payment outlives this offer; sign it again with a deadline no later than the offer's expiry." };
      // Exactly this offer's transfer and nothing else: one transferWithMemo of the offered token, to this
      // room's address, for the offered amount, with a memo bound to this realm and challenge. mppx itself
      // checks the call count only for fee-sponsored transactions.
      const calls = decoded.calls ?? [];
      if (calls.length !== 1)
        return { invalid: "The signed transaction must make exactly one transfer: this payment and nothing else." };
      const data = String(calls[0].data ?? "").toLowerCase();
      if (!sameAddress(calls[0].to, config.currency) || !data.startsWith(TRANSFER_WITH_MEMO_SELECTOR) || !/^0x[0-9a-f]{200}$/.test(data))
        return { invalid: "The signed transaction must be one transferWithMemo of this offer's token." };
      if (!/^0{24}$/.test(data.slice(10, 34)) || !sameAddress(`0x${data.slice(34, 74)}`, config.recipient))
        return { invalid: "The transfer does not pay this room's address." };
      if (BigInt(`0x${data.slice(74, 138)}`) !== BigInt(MPP_TOP_UP.atomic)) return { invalid: "The transfer amount does not match this offer." };
      if (!memoMatcher(MPP_REALM, challenge.id, adapter.keccakUtf8)(`0x${data.slice(138, 202)}`))
        return { invalid: "The transfer's memo is not bound to this offer." };
      const transaction = normalizeHash(decoded.hash);
      if (!TRANSACTION_PATTERN.test(transaction)) return { invalid: "The signed transaction could not be decoded." };

      // A recorded payment never reaches present() (funding.ts answers it from its records first), so these
      // window checks only ever turn a new payment into a fresh offer.
      const seconds = Math.floor(now() / 1000);
      const stale = Number.isFinite(expires) && expires <= now() ? "This offer expired; ask for a new one."
        : validBefore < seconds + MIN_VALIDITY_SECONDS ? "The signed payment expires too soon to be broadcast."
        : validBefore > seconds + MAX_VALIDITY_SECONDS ? "The signed payment's validity window does not match this offer."
        : undefined;
      return {
        challengeId: challenge.id,
        challengeExpires: typeof challenge.expires === "string" ? challenge.expires : null,
        realm: challenge.realm,
        roomTag,
        payer: from.toLowerCase(),
        payTo: config.recipient,
        currency: config.currency,
        amount: MPP_TOP_UP.atomic,
        transaction,
        validBefore,
        payloadDigest: payloadDigestOf(signature),
        signedTransaction: signature,
        credential,
        ...(stale ? { stale } : {}),
      };
    },

    async verify(charge) {
      const result = await server.validate(charge.credential as MppCredential, routeOptions(charge.roomTag));
      if (result.ok) return { valid: true };
      // A payment error or a deterministic simulation revert (for example TIP20 InsufficientBalance): nothing was sent.
      if (result.error.kind !== "other") return { valid: false, reason: result.error.message };
      throw new Error(`Could not validate the payment: ${result.error.message}`);
    },

    async settle(charge): Promise<ChargeSettlement> {
      const result = await server.broadcast(charge.credential as MppCredential, routeOptions(charge.roomTag));
      if (result.ok) {
        const reference = normalizeHash(result.reference);
        if (result.status !== "success" || !TRANSACTION_PATTERN.test(reference))
          return { kind: "pending", transaction: result.sentHash, reason: "The broadcast returned no confirmed transaction." };
        return { kind: "settled", transaction: reference, receipt: result.receipt, receiptHeader: result.receiptHeader };
      }
      // Sent: it may have landed, so only the chain decides. Never a fresh offer.
      if (result.attempted) return { kind: "pending", transaction: result.sentHash, reason: result.error.message };
      // Not sent and the offer is past its expiry. validBefore is no later than the expiry (present), so the
      // signed transaction cannot land once its own deadline is past, with a margin for clock skew.
      if (result.error.kind === "expired" && Math.floor(now() / 1000) > charge.validBefore + EXPIRED_SEND_MARGIN_SECONDS)
        return { kind: "failed", reason: result.error.message };
      // Not sent by this process, but the signed bytes exist until validBefore: leave it to the reconciler.
      return { kind: "pending", transaction: null, reason: result.error.message };
    },
  };
}
