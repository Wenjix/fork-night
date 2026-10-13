import { loadMppAdapter } from "./adapter.ts";
import {
  EXPIRY_MARGIN_SECONDS,
  MODERATO_RPC,
  TEMPO_MODERATO,
  normalizeHash,
  sameAddress,
} from "./ids.ts";
import type { MppIntent } from "./records.ts";

/** What the chain shows for one intent. Only "paid" credits; only "unpayable" frees a slot of the MPP limit. */
export type ChainVerdict =
  | { status: "paid"; transaction: string; evidence: Record<string, unknown> }
  | { status: "unpayable"; reason: string; evidence: Record<string, unknown> }
  | { status: "pending"; reason: string; handCheck?: boolean };
export interface ChainReader {
  inspect(intent: MppIntent): Promise<ChainVerdict>;
}

export type TempoRpc = <T = unknown>(method: string, params: unknown[]) => Promise<T>;
export class TempoRpcError extends Error {
  code: number | undefined;
  constructor(message: string, code?: number) {
    super(message);
    this.code = code;
  }
}

/** Plain JSON-RPC over fetch to the fixed Moderato RPC, never following a redirect. The reader only ever passes read methods. */
export function tempoRpc(url = MODERATO_RPC, fetchImpl: typeof fetch = (...args) => fetch(...args)): TempoRpc {
  return async <T>(method: string, params: unknown[]) => {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new TempoRpcError(`Moderato ${method} returned HTTP ${response.status}.`);
    const body = (await response.json()) as { result?: T; error?: { code?: number; message?: string } };
    if (body.error) throw new TempoRpcError(`Moderato ${method}: ${String(body.error.message ?? "error")}`, body.error.code);
    return body.result as T;
  };
}

type Log = { address: string; topics: string[]; data: string; transactionHash: string; blockNumber: string; logIndex?: string };
type Receipt = { status: string; blockNumber: string; transactionHash: string; logs: Log[] };
type Block = { number: string; timestamp: string };

/** MPP attribution memo (mppx Attribution.ts): tag | version | keccak(realm)[0..9] | client | keccak(challengeId)[0..6]. */
export const MPP_MEMO_TAG = "ef1ed712";
/** keccak256("TransferWithMemo(address,address,uint256,bytes32)"): from, to and memo are indexed (checked against the adapter in tests). */
export const TRANSFER_WITH_MEMO_TOPIC = "0x57bc7354aa85aed339e000bccffabbc529466af35f0772c8f8ee1145927de7f0";
/** keccak256 of a UTF-8 string, from the isolated adapter (never the app's own viem). */
export type KeccakUtf8 = (value: string) => string;

export function memoMatcher(realm: string, challengeId: string, keccak: KeccakUtf8) {
  const server = keccak(realm).slice(2, 22).toLowerCase();
  const challenge = keccak(challengeId).slice(2, 16).toLowerCase();
  return (memo: unknown) => {
    if (typeof memo !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(memo)) return false;
    const hex = memo.slice(2).toLowerCase();
    return hex.slice(0, 8) === MPP_MEMO_TAG && hex.slice(8, 10) === "01" && hex.slice(10, 30) === server && hex.slice(50, 64) === challenge;
  };
}

const topicAddress = (topic: unknown) =>
  typeof topic === "string" && /^0x0{24}[0-9a-fA-F]{40}$/.test(topic) ? `0x${topic.slice(26).toLowerCase()}` : null;
const quantity = (value: bigint | number) => `0x${value.toString(16)}`;
const LAGGING = /beyond current head/i;

export type ModeratoReaderOptions = {
  rpc?: TempoRpc;
  /** Defaults to the isolated adapter's keccak256, loaded on first use. */
  keccak?: KeccakUtf8;
  sleep?: (ms: number) => Promise<void>;
  /** Spaced receipt lookups before declaring a payment expired (a lagging replica can miss a receipt). */
  lookups?: number;
  spacingMs?: number;
  /** eth_getLogs window size; each window names an explicit toBlock. */
  chunkBlocks?: number;
};

/**
 * Receipt by the recorded hash, then a TransferWithMemo scan (payer → payTo on the intent's token,
 * memo bound to this realm and challenge) with explicit block bounds. A replica whose head is
 * below toBlock answers -32602 "block range extends beyond current head block" instead of an
 * empty list, so an empty scan is complete. Expiry needs the head past validBefore + 120 s, every
 * receipt lookup missing and an empty scan covering the whole window the transaction could land in.
 * A reverted receipt is unpayable only when the scan also finds no other transaction paying the challenge.
 */
export function moderatoReader(options: ModeratoReaderOptions = {}): ChainReader {
  const rpc = options.rpc ?? tempoRpc();
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const lookups = Math.max(1, options.lookups ?? 3);
  const spacingMs = options.spacingMs ?? 1500;
  const chunkBlocks = BigInt(options.chunkBlocks ?? 20_000);
  const keccak = async () => options.keccak ?? (await loadMppAdapter()).keccakUtf8;

  const block = async (tag: bigint | "latest") => {
    const found = await rpc<Block | null>("eth_getBlockByNumber", [tag === "latest" ? tag : quantity(tag), false]);
    if (!found || !/^0x[0-9a-f]+$/i.test(found.number) || !/^0x[0-9a-f]+$/i.test(found.timestamp))
      throw new Error(`Moderato returned no block ${tag === "latest" ? "latest" : tag.toString()}.`);
    return { number: BigInt(found.number), timestamp: Number(BigInt(found.timestamp)) };
  };

  /** The first block number whose timestamp is at most `seconds`, proven by reading that block. */
  async function blockBefore(seconds: number, head: { number: bigint; timestamp: number }) {
    if (head.timestamp <= seconds) return head.number;
    const sample = head.number > 1000n ? head.number - 1000n : 0n;
    const older = await block(sample);
    const perBlock = Math.max(0.05, (head.timestamp - older.timestamp) / Math.max(1, Number(head.number - sample)));
    let back = BigInt(Math.ceil((head.timestamp - seconds) / perBlock)) + 200n;
    for (let attempt = 0; attempt < 6; attempt += 1, back *= 2n) {
      const from = head.number > back ? head.number - back : 0n;
      if (from === 0n || (await block(from)).timestamp <= seconds) return from;
    }
    throw new Error("Could not find a block old enough to cover the payment window.");
  }

  async function logsBetween(intent: MppIntent, topic: string, from: bigint, to: bigint) {
    const logs: Log[] = [];
    for (let start = from; start <= to; start += chunkBlocks) {
      const end = start + chunkBlocks - 1n < to ? start + chunkBlocks - 1n : to;
      for (let attempt = 0; ; attempt += 1) {
        try {
          logs.push(...await rpc<Log[]>("eth_getLogs", [{
            address: intent.currency,
            topics: [topic, `0x${intent.payer.slice(2).toLowerCase().padStart(64, "0")}`, `0x${intent.payTo.slice(2).toLowerCase().padStart(64, "0")}`],
            fromBlock: quantity(start),
            toBlock: quantity(end),
          }]));
          break;
        } catch (error) {
          if (!LAGGING.test((error as Error).message) || attempt >= 5) throw error;
          await sleep(1000);
        }
      }
    }
    return logs;
  }

  return {
    async inspect(intent) {
      if (intent.network !== TEMPO_MODERATO) throw new Error("Not a Tempo Moderato intent.");
      const hash = normalizeHash(intent.transaction);
      const memoOk = memoMatcher(intent.realm, intent.challengeId, await keccak());
      const topic = TRANSFER_WITH_MEMO_TOPIC;
      const pays = (log: Log) =>
        sameAddress(log.address, intent.currency) && log.topics?.[0]?.toLowerCase() === topic &&
        topicAddress(log.topics[1]) === intent.payer.toLowerCase() && topicAddress(log.topics[2]) === intent.payTo.toLowerCase() &&
        /^0x[0-9a-fA-F]{1,64}$/.test(log.data) && BigInt(log.data) === BigInt(intent.amount) && memoOk(log.topics[3]);
      const checked = { network: TEMPO_MODERATO, rpc: MODERATO_RPC, transaction: hash, validBefore: intent.validBefore };

      const judge = (receipt: Receipt): ChainVerdict => {
        const evidence = { ...checked, source: "receipt", blockNumber: Number(BigInt(receipt.blockNumber)) };
        if (receipt.status !== "0x1")
          return { status: "unpayable", reason: "The transaction reverted on chain; the test dollar never moved (only its network fee was spent).", evidence };
        const log = (receipt.logs ?? []).find(pays);
        if (!log) return { status: "pending", handCheck: true, reason: "The transaction landed without the challenge-bound transfer this intent expects; check by hand." };
        return { status: "paid", transaction: hash, evidence: { ...evidence, memo: log.topics[3], amount: intent.amount, payTo: intent.payTo.toLowerCase() } };
      };
      const receipt = async () => {
        const found = await rpc<Receipt | null>("eth_getTransactionReceipt", [hash]);
        return found && normalizeHash(String(found.transactionHash)) === hash ? found : null;
      };

      const first = await receipt();
      // A landed transaction decides alone; a reverted one only once the scan shows nothing else paid this challenge.
      if (first && first.status === "0x1") return judge(first);
      const head = await block("latest");
      // The memo binds the challenge, which is issued at most 300 s before its expiry, and validBefore <= expiry.
      const from = await blockBefore(intent.validBefore - 600, head);
      const paid = (await logsBetween(intent, topic, from, head.number)).filter(pays);
      const scanned = { ...checked, fromBlock: Number(from), toBlock: Number(head.number), headTimestamp: head.timestamp };
      const ours = paid.find((log) => normalizeHash(log.transactionHash) === hash);
      if (ours)
        return { status: "paid", transaction: hash, evidence: { ...scanned, source: "memo-scan", blockNumber: Number(BigInt(ours.blockNumber)), memo: ours.topics[3] } };
      if (paid.length)
        return { status: "pending", handCheck: true, reason: `A different transaction (${paid.map((log) => normalizeHash(log.transactionHash)).join(", ")}) paid this challenge; check by hand.` };
      if (first) return judge(first);
      const deadline = intent.validBefore + EXPIRY_MARGIN_SECONDS;
      if (head.timestamp < deadline)
        return { status: "pending", reason: `The payment is not on chain yet; it can be declared expired after ${new Date(deadline * 1000).toISOString()}.` };
      for (let attempt = 1; attempt < lookups; attempt += 1) {
        await sleep(spacingMs);
        const late = await receipt();
        if (late) return judge(late);
      }
      return {
        status: "unpayable",
        reason: "The signed transaction's deadline passed and no transfer carrying its challenge reached the payTo address.",
        evidence: { ...scanned, receiptLookups: lookups, deadline },
      };
    },
  };
}
