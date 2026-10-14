import { createHash, type KeyObject } from "node:crypto";
import { getAddress, Transaction, type AbstractProvider, type TransactionReceipt } from "ethers";
import { canonicalJson, type PrivyRest, type UnsignedEvmTransaction } from "../privy/rest.ts";

/**
 * Monad testnet transactions signed by a Privy server wallet and broadcast by this app.
 *
 * The app builds the exact transaction (nonce, fees, and a gas limit from a fresh estimate), Privy
 * signs it under the wallet's policy with `eth_signTransaction`, and the app refuses signed bytes
 * that differ from the request. Callers save the signed bytes before the first broadcast, so a retry
 * re-sends those bytes instead of signing again. A new signature is only made after the saved one
 * provably cannot land (it reverted, or another transaction used its nonce).
 */

export const MONAD_TESTNET_CHAIN_ID = 10143;
export const MONAD_EXPLORER = "https://testnet.monadscan.com";
export const explorerTx = (hash: string) => `${MONAD_EXPLORER}/tx/${hash}`;
export const explorerAddress = (address: string) => `${MONAD_EXPLORER}/address/${address}`;

/** A developer-owned Privy wallet that signs with the app's authorization key. */
export type MonadSigner = {
  walletId: string;
  address: string;
  authorizationKey: KeyObject;
  privy: Pick<PrivyRest, "signTransaction">;
};

export type MonadCall = { to: string; data: string; value?: bigint };

export type TxState = "signed" | "broadcast" | "confirmed" | "finalized" | "failed";

/** The fields of a saved transaction record that `advance` reads and moves forward. */
export type TxProgress = {
  rawTransaction: string;
  hash: string;
  nonce: number;
  state: TxState;
  updatedAt: string;
  block?: number;
  finalizedBlock?: number;
  error?: string;
};

export class MonadTxRefused extends Error {
  readonly code: string;
  /** Revert data from the estimate, when the call would revert. */
  readonly revertData: string | null;
  constructor(code: string, message: string, revertData: string | null = null) {
    super(message);
    this.name = "MonadTxRefused";
    this.code = code;
    this.revertData = revertData;
  }
}

export type PreparedCall = {
  request: UnsignedEvmTransaction;
  nonce: number;
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  /** Value plus the most gas the transaction can be charged; Monad charges the whole gas limit. */
  maxCostWei: bigint;
  balanceWei: bigint;
};

const FALLBACK_PRIORITY_FEE = 2_000_000_000n;
const FALLBACK_GAS_PRICE = 100_000_000_000n;
const hex = (value: bigint) => `0x${value.toString(16)}`;
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

export const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * The store lock that serializes new transactions from one sending wallet until they are mined, so
 * two signatures never take the same nonce. Resuming a saved transaction does not need it.
 */
export const walletLockName = (address: string) => `wallet-${getAddress(address).slice(2).toLowerCase()}`;

/** Revert data carried by an ethers call or estimate error, if any. */
export function revertData(error: unknown): string | null {
  let current = error as Record<string, unknown> | undefined;
  for (let depth = 0; current && typeof current === "object" && depth < 6; depth += 1) {
    if (typeof current.data === "string" && /^0x[0-9a-fA-F]{8,}$/.test(current.data)) return current.data;
    const info = current.info as Record<string, unknown> | undefined;
    current = (current.error ?? info?.error ?? current.cause) as Record<string, unknown> | undefined;
  }
  return null;
}

/** The fees a transaction offers, from the node's suggestion. */
export async function feesOf(provider: AbstractProvider) {
  const fees = await provider.getFeeData();
  const maxPriorityFeePerGas = fees.maxPriorityFeePerGas ?? FALLBACK_PRIORITY_FEE;
  const maxFeePerGas = fees.maxFeePerGas ?? (fees.gasPrice ?? FALLBACK_GAS_PRICE) * 2n;
  return { maxFeePerGas: maxFeePerGas < maxPriorityFeePerGas ? maxPriorityFeePerGas : maxFeePerGas, maxPriorityFeePerGas };
}

/**
 * Builds the exact transaction for one call. Refuses before any signature when the call would revert
 * now, when the connection is on another network, or when the sender cannot pay for the full gas limit.
 */
export async function prepareCall(
  provider: AbstractProvider,
  from: string,
  call: MonadCall,
  options: { chainId: number; gasMarginPercent?: number },
): Promise<PreparedCall> {
  const network = await provider.getNetwork();
  if (network.chainId !== BigInt(options.chainId)) {
    throw new MonadTxRefused("wrong_network", "The Monad connection is on a different network. No transaction was sent.");
  }
  const sender = getAddress(from);
  const to = getAddress(call.to);
  const value = call.value ?? 0n;
  let estimate: bigint;
  try {
    estimate = await provider.estimateGas({ from: sender, to, data: call.data, value });
  } catch (error) {
    throw new MonadTxRefused("would_revert", "The transaction would revert, so it was not signed.", revertData(error));
  }
  const [nonce, fees, balanceWei] = await Promise.all([
    provider.getTransactionCount(sender, "pending"),
    feesOf(provider),
    provider.getBalance(sender),
  ]);
  // Monad charges the whole gas limit, so the margin stays small.
  const gasLimit = (estimate * BigInt(100 + (options.gasMarginPercent ?? 10))) / 100n;
  const maxCostWei = gasLimit * fees.maxFeePerGas + value;
  if (balanceWei < maxCostWei) {
    throw new MonadTxRefused("unfunded", "The sending wallet does not hold enough test MON for this transaction and its gas. No transaction was sent.");
  }
  return {
    request: {
      to,
      data: call.data,
      value: hex(value),
      chain_id: options.chainId,
      nonce,
      gas_limit: hex(gasLimit),
      max_fee_per_gas: hex(fees.maxFeePerGas),
      max_priority_fee_per_gas: hex(fees.maxPriorityFeePerGas),
      type: 2,
    },
    nonce,
    gasLimit,
    ...fees,
    maxCostWei,
    balanceWei,
  };
}

/** True only when the signed bytes are exactly the requested transaction, signed by `from`. */
export function matchesRequest(signed: Transaction, request: UnsignedEvmTransaction, from: string): boolean {
  return (
    signed.type === 2 &&
    !!signed.to &&
    getAddress(signed.to) === getAddress(request.to) &&
    signed.data.toLowerCase() === (request.data ?? "0x").toLowerCase() &&
    signed.value === BigInt(request.value ?? "0x0") &&
    signed.chainId === BigInt(request.chain_id) &&
    signed.nonce === request.nonce &&
    signed.gasLimit === BigInt(request.gas_limit ?? "0x0") &&
    signed.maxFeePerGas === BigInt(request.max_fee_per_gas ?? "0x0") &&
    signed.maxPriorityFeePerGas === BigInt(request.max_priority_fee_per_gas ?? "0x0") &&
    (signed.accessList ?? []).length === 0 &&
    !!signed.from &&
    getAddress(signed.from) === getAddress(from)
  );
}

/**
 * Asks Privy to sign the prepared transaction and checks the answer. The idempotency key is derived
 * from the exact request, so a retried call gets Privy's first answer rather than a second signature.
 */
export async function signPrepared(signer: MonadSigner, prepared: PreparedCall, purpose: string): Promise<{ rawTransaction: string; hash: string }> {
  const digest = createHash("sha256").update(canonicalJson(prepared.request)).digest("hex").slice(0, 32);
  const raw = await signer.privy.signTransaction(signer.walletId, prepared.request, [signer.authorizationKey], `nw-${purpose}-${digest}`);
  let signed: Transaction;
  try {
    signed = Transaction.from(raw);
  } catch {
    throw new MonadTxRefused("signature_mismatch", "Privy returned a transaction that could not be read. Nothing was sent.");
  }
  if (!signed.hash || !matchesRequest(signed, prepared.request, signer.address)) {
    throw new MonadTxRefused("signature_mismatch", "Privy signed a different transaction than the one requested. Nothing was sent.");
  }
  return { rawTransaction: raw, hash: signed.hash };
}

export async function waitForReceipt(provider: AbstractProvider, hash: string, timeoutMs: number, pollMs = 1_000) {
  const started = Date.now();
  for (;;) {
    const receipt = await provider.getTransactionReceipt(hash);
    if (receipt) return receipt;
    if (Date.now() - started >= timeoutMs) return null;
    await sleep(pollMs);
  }
}

export async function finalizedBlockNumber(provider: AbstractProvider): Promise<number | null> {
  const block = await provider.getBlock("finalized");
  return block ? block.number : null;
}

export async function waitForFinalized(provider: AbstractProvider, block: number, timeoutMs: number, pollMs = 1_000) {
  const started = Date.now();
  for (;;) {
    const finalized = await finalizedBlockNumber(provider);
    if (finalized !== null && finalized >= block) return finalized;
    if (Date.now() - started >= timeoutMs) return null;
    await sleep(pollMs);
  }
}

/**
 * Sends saved signed bytes. "sent" covers a node that already has them; "consumed" means another
 * transaction used the nonce, so these bytes can never be mined. Anything else is left for a retry.
 */
async function send(provider: AbstractProvider, record: TxProgress, from: string, pollMs: number): Promise<"sent" | "consumed"> {
  if (await provider.getTransaction(record.hash).catch(() => null)) return "sent";
  try {
    await provider.broadcastTransaction(record.rawTransaction);
    return "sent";
  } catch (error) {
    const message = errorText(error);
    if (/already known|known transaction|already imported|already exists/i.test(message)) return "sent";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (await provider.getTransactionReceipt(record.hash).catch(() => null)) return "sent";
      if (attempt < 2) await sleep(pollMs);
    }
    const used = await provider.getTransactionCount(getAddress(from), "latest").catch(() => null);
    if (used !== null && used > record.nonce) return "consumed";
    throw new MonadTxRefused(
      "broadcast_failed",
      `The signed transaction could not be sent yet (${message.slice(0, 160)}). Trying again re-sends the same signed transaction.`,
    );
  }
}

export type AdvanceOptions<T extends TxProgress> = {
  /** The signer's address, to tell a used nonce from a lost broadcast. */
  from: string;
  save: (record: T) => Promise<void>;
  now?: () => Date;
  /** Fields read from the mined receipt (for example a parsed event), saved with it. */
  fromReceipt?: (receipt: TransactionReceipt) => Partial<T>;
  /** Fields read once the transaction's block is finalized. */
  atFinalized?: (finalizedBlock: number) => Promise<Partial<T>>;
  receiptTimeoutMs?: number;
  finalizedTimeoutMs?: number;
  pollMs?: number;
};

/**
 * Moves a saved signed transaction as far as it can go now: re-sends the saved bytes when no receipt
 * exists, waits for the receipt, then for the finalized block, saving after every step. It never
 * signs. A record that is still waiting comes back as "broadcast" or "confirmed"; call it again later.
 */
export async function advance<T extends TxProgress>(provider: AbstractProvider, start: T, options: AdvanceOptions<T>): Promise<T> {
  const now = options.now ?? (() => new Date());
  const pollMs = options.pollMs ?? 1_000;
  let record = start;
  const step = async (patch: Partial<TxProgress>) => {
    record = { ...record, ...(patch as Partial<T>), updatedAt: now().toISOString() };
    await options.save(record);
    return record;
  };
  if (record.state === "failed" || record.state === "finalized") return record;

  let receipt = await provider.getTransactionReceipt(record.hash);
  if (!receipt) {
    if ((await send(provider, record, options.from, pollMs)) === "consumed") {
      return step({ state: "failed", error: "Another transaction used this nonce, so this signed transaction can never be mined." });
    }
    if (record.state !== "broadcast") await step({ state: "broadcast", block: undefined });
    receipt = await waitForReceipt(provider, record.hash, options.receiptTimeoutMs ?? 30_000, pollMs);
    if (!receipt) return record;
  }
  if (receipt.status !== 1) return step({ state: "failed", block: receipt.blockNumber, error: "The transaction reverted." });
  if (record.state !== "confirmed" || record.block !== receipt.blockNumber) {
    await step({ state: "confirmed", block: receipt.blockNumber, ...options.fromReceipt?.(receipt) });
  }

  const finalizedBlock = await waitForFinalized(provider, receipt.blockNumber, options.finalizedTimeoutMs ?? 20_000, pollMs);
  if (finalizedBlock === null) return record;
  // A proposed block can still be replaced before finality, so the receipt is read again.
  const final = await provider.getTransactionReceipt(record.hash);
  if (!final) return step({ state: "broadcast", block: undefined });
  if (final.status !== 1) return step({ state: "failed", block: final.blockNumber, error: "The transaction reverted." });
  if (final.blockNumber > finalizedBlock) return step({ state: "confirmed", block: final.blockNumber, ...options.fromReceipt?.(final) });
  return step({
    state: "finalized",
    block: final.blockNumber,
    finalizedBlock,
    ...options.fromReceipt?.(final),
    ...(await options.atFinalized?.(finalizedBlock)),
  });
}
