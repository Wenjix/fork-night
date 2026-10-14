import type { KeyObject } from "node:crypto";
import { getAddress } from "viem";
import { toPrivyTransferTypedData } from "./policy.ts";
import type { EthereumTypedData, PrivyRest } from "./rest.ts";

/** What the application allows one delegated signature to contain, checked before Privy is asked. */
export type DelegatedTransferBounds = {
  walletAddress: string;
  chainId: number;
  token: string;
  payTo: string;
  maxAmount: bigint;
  /** Unix seconds; no new signature at or after it. */
  deadline: number;
  /** Longest authorization lifetime, in seconds from now. */
  maxLifetimeSeconds: number;
};

export class DelegationRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DelegationRefused";
  }
}

/** Throws `DelegationRefused` unless the typed data is a transfer the bounds allow. */
export function checkDelegatedTransfer(typedData: EthereumTypedData, bounds: DelegatedTransferBounds, nowSeconds: number): void {
  const { domain, message } = typedData;
  if (nowSeconds >= bounds.deadline) throw new DelegationRefused("The Night Watch allowance has expired.");
  if (domain.chainId !== bounds.chainId) throw new DelegationRefused(`Chain ${String(domain.chainId)} is not the allowed chain ${bounds.chainId}.`);
  if (getAddress(String(domain.verifyingContract)) !== getAddress(bounds.token)) throw new DelegationRefused("That token is not the allowed token.");
  if (domain.name !== "USDC" || domain.version !== "2") throw new DelegationRefused("The token domain is not USDC version 2.");
  if (getAddress(String(message.from)) !== getAddress(bounds.walletAddress)) throw new DelegationRefused("The payment is not from the delegated wallet.");
  if (getAddress(String(message.to)) !== getAddress(bounds.payTo)) throw new DelegationRefused("The recipient is not this room's door.");
  const value = BigInt(String(message.value));
  if (value <= 0n || value > bounds.maxAmount) throw new DelegationRefused("The amount exceeds the allowed single payment.");
  const validBefore = Number(message.validBefore);
  if (!Number.isSafeInteger(validBefore) || validBefore > nowSeconds + bounds.maxLifetimeSeconds) {
    throw new DelegationRefused("The authorization would outlive the allowed lifetime.");
  }
  if (BigInt(String(message.validAfter)) > BigInt(nowSeconds)) throw new DelegationRefused("The authorization must be valid now.");
}

/**
 * An x402 `ClientEvmSigner` backed by a Privy additional signer on a user-owned wallet.
 * Every request passes the application's own bounds before Privy's policy evaluates it again.
 */
export function privyX402Signer(options: {
  privy: Pick<PrivyRest, "signTypedData">;
  walletId: string;
  bounds: DelegatedTransferBounds;
  authorizationKey: KeyObject;
  /** Called with the exact typed data before signing, e.g. to record or reserve. Throw to refuse. */
  beforeSign?: (typedData: EthereumTypedData) => Promise<void> | void;
  now?: () => number;
}) {
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  return {
    address: getAddress(options.bounds.walletAddress) as `0x${string}`,
    async signTypedData(request: {
      domain: Record<string, unknown>;
      types: Record<string, unknown>;
      primaryType: string;
      message: Record<string, unknown>;
    }): Promise<`0x${string}`> {
      let typedData: EthereumTypedData;
      try {
        typedData = toPrivyTransferTypedData(request);
      } catch (error) {
        throw new DelegationRefused(error instanceof Error ? error.message : String(error));
      }
      checkDelegatedTransfer(typedData, options.bounds, now());
      await options.beforeSign?.(typedData);
      const signature = await options.privy.signTypedData(options.walletId, typedData, [options.authorizationKey], `nw-sign-${String(typedData.message.nonce).slice(2, 34)}`);
      return signature as `0x${string}`;
    },
  };
}
