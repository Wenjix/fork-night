import {
  Contract,
  FetchRequest,
  Interface,
  JsonRpcProvider,
  zeroPadValue,
  type FetchGetUrlFunc,
  type Log,
} from "ethers";
import {
  address,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
} from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import {
  BASE_SEPOLIA,
  INTENT_ID_PATTERN,
  SOLANA_DEVNET,
  TESTNET_USDC,
  TOP_UP,
  explorerUrl,
  intentId,
  isTestnet,
  normalizeTransaction,
  recordPaths,
  type Testnet,
} from "./ids.ts";
import type { FundingLedger } from "./ledger.ts";
import {
  creditSettledPayment,
  readIntent,
  type FundingIntent,
  type FundingReceipt,
  type FundingSettlement,
} from "./records.ts";
import { keepFirst, readRecord, type ReceiptStore } from "./store.ts";

/** What the chain shows for one intent. Only "paid" credits; only "unpayable" frees a ceiling slot. */
export type ChainVerdict =
  | { status: "paid"; transaction: string; evidence: Record<string, unknown> }
  | { status: "unpayable"; reason: string; evidence: Record<string, unknown> }
  | { status: "pending"; reason: string };
export interface ChainReader {
  inspect(intent: FundingIntent): Promise<ChainVerdict>;
}

/** Written once the chain shows a payment can never settle. */
export type ExpiredRecord = {
  kind: "fork-night/x402-expired/v1";
  intentId: string;
  roomId: string;
  network: Testnet;
  reason: string;
  evidence: Record<string, unknown>;
  recordedAt: string;
};

export type ReconcileOutcome = "skipped" | "paid" | "credited" | "unpayable" | "expired" | "pending" | "error";
export type ReconcileEntry = {
  id: string;
  room: string | null;
  network: Testnet | null;
  outcome: ReconcileOutcome;
  transaction: string | null;
  explorerUrl: string | null;
  reason: string;
};
export type ReconcileReport = {
  apply: boolean;
  checkedAt: string;
  errors: number;
  counts: Partial<Record<ReconcileOutcome, number>>;
  intents: ReconcileEntry[];
};
type ReconcileDeps = {
  store: ReceiptStore;
  ledger: FundingLedger;
  chains: Partial<Record<Testnet, ChainReader>>;
  now: () => Date;
  apply: boolean;
};

const TRANSACTION_PATTERN: Record<Testnet, RegExp> = {
  [BASE_SEPOLIA]: /^0x[0-9a-fA-F]{64}$/,
  [SOLANA_DEVNET]: /^[1-9A-HJ-NP-Za-km-z]{64,90}$/,
};

/**
 * Resolves intents that have neither a receipt nor an expired marker, from chain evidence only.
 * Without apply nothing is written. With apply, a paid intent goes through the route's own
 * idempotent credit (same refill request ID), and a provably unpayable one gets its expired marker.
 */
export async function reconcileIntents(deps: ReconcileDeps): Promise<ReconcileReport> {
  const intents: ReconcileEntry[] = [];
  for (const name of (await deps.store.list("x402/intents")).sort()) {
    const id = name.replace(/\.json$/, "");
    if (`${id}.json` === name && INTENT_ID_PATTERN.test(id)) intents.push(await reconcileIntent(deps, id));
  }
  const counts: ReconcileReport["counts"] = {};
  for (const { outcome } of intents) counts[outcome] = (counts[outcome] ?? 0) + 1;
  return { apply: deps.apply, checkedAt: deps.now().toISOString(), errors: counts.error ?? 0, counts, intents };
}

async function reconcileIntent(deps: ReconcileDeps, id: string): Promise<ReconcileEntry> {
  let room: string | null = null;
  let network: Testnet | null = null;
  const entry = (outcome: ReconcileOutcome, reason: string, transaction: string | null = null): ReconcileEntry => ({
    id: id.slice(0, 12),
    room,
    network,
    outcome,
    transaction,
    explorerUrl: transaction && network ? explorerUrl(network, transaction) : null,
    reason,
  });
  try {
    const intent = await readIntent(deps.store, id);
    if (!intent || intent.kind !== "fork-night/x402-intent/v1" || intent.intentId !== id ||
        !isTestnet(intent.key?.network) || intentId(intent.key) !== id)
      return entry("error", "The intent record is unreadable or does not match its key.");
    room = intent.roomId;
    network = intent.key.network;
    if (intent.asset !== TESTNET_USDC[network] || intent.amount !== TOP_UP.atomic ||
        !Number.isFinite(Date.parse(intent.createdAt)))
      return entry("error", "The intent is not a 1.00 test USDC top-up.");
    const paths = recordPaths(id, intent.roomId);
    const receipt = await readRecord<FundingReceipt>(deps.store, paths.receipt);
    if (receipt) return entry("skipped", `Already credited by the ${receipt.source}.`, receipt.transaction);
    if (await deps.store.read(paths.expired))
      return entry("skipped", "Already marked expired: nothing was charged; signing a new payment is safe.");
    const chain = deps.chains[network];
    if (!chain) return entry("error", `No chain reader is configured for ${network}.`);

    const verdict = await chain.inspect(intent);
    if (verdict.status === "pending") return entry("pending", verdict.reason);
    if (verdict.status === "paid") {
      if (!TRANSACTION_PATTERN[network].test(verdict.transaction))
        return entry("error", "The chain reader returned a malformed transaction.");
      // The route may already have refilled under the hash the facilitator reported; another hash must not credit again.
      const settled = await readRecord<FundingSettlement>(deps.store, paths.settlement);
      const onChain = normalizeTransaction(network, verdict.transaction);
      const reported = settled && normalizeTransaction(network, String(settled.transaction));
      if (settled && reported !== onChain)
        return entry("error", `The route recorded ${reported} as settled, but the chain shows ${onChain} paying this intent; check by hand.`,
          verdict.transaction);
      if (!deps.apply) return entry("paid", "Paid on chain; --apply credits the room.", verdict.transaction);
      const credited = await creditSettledPayment(deps, intent, {
        transaction: verdict.transaction,
        settlement: verdict.evidence,
        paymentResponse: null,
        source: "reconciler",
        refillRequestId: settled?.refillRequestId,
      });
      const done = credited.refill.replayed ? "The earlier refill was replayed" : "The room was credited";
      return entry("credited", `${done}; the receipt is recorded.`, credited.transaction);
    }
    if (!deps.apply) return entry("unpayable", `${verdict.reason} --apply marks it expired.`);
    await keepFirst<ExpiredRecord>(deps.store, paths.expired, {
      kind: "fork-night/x402-expired/v1",
      intentId: id,
      roomId: intent.roomId,
      network,
      reason: verdict.reason,
      evidence: verdict.evidence,
      recordedAt: deps.now().toISOString(),
    });
    return entry("expired", `${verdict.reason} Nothing was charged; signing a new payment is safe.`);
  } catch (error) {
    return entry("error", (error as Error).message);
  }
}

// ---- Base Sepolia (EIP-3009 on Circle test USDC) ----

const BASE_SEPOLIA_RPC = "https://sepolia.base.org";
const LOG_WINDOW_BLOCKS = 200; // sepolia.base.org refuses eth_getLogs when toBlock - fromBlock > 200
const MAX_LOG_WINDOWS = 4;
const BLOCK_SECONDS = 2;
const usdc = new Interface([
  "function authorizationState(address authorizer, bytes32 nonce) view returns (bool)",
  "event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)",
  "event AuthorizationCanceled(address indexed authorizer, bytes32 indexed nonce)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);
const AUTHORIZATION_USED = usdc.getEvent("AuthorizationUsed")!.topicHash;
const AUTHORIZATION_CANCELED = usdc.getEvent("AuthorizationCanceled")!.topicHash;
const lower = (value: unknown) => String(value).toLowerCase();

// ethers' Node transport bypasses fetch; routing through it keeps every RPC read on one path.
const viaFetch: FetchGetUrlFunc = async (request) => {
  const response = await fetch(request.url, {
    method: request.method,
    headers: Object.fromEntries(Object.entries(request.headers).filter(([name]) => name !== "content-length")),
    body: request.body ? Buffer.from(request.body).toString("utf8") : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  return {
    statusCode: response.status,
    statusMessage: response.statusText,
    headers: Object.fromEntries(response.headers),
    body: new Uint8Array(await response.arrayBuffer()),
  };
};

/**
 * authorizationState at the head block, then the AuthorizationUsed/Canceled event for (payer, nonce)
 * in ≤200-block windows around validBefore, then the adjacent USDC Transfer in a successful receipt.
 */
export function baseSepoliaReader(): ChainReader {
  return {
    async inspect(intent) {
      if (intent.key.network !== BASE_SEPOLIA) throw new Error("Not a Base Sepolia intent.");
      const { payer, nonce } = intent.key;
      const validBefore = Date.parse(intent.validUntil ?? "") / 1000;
      if (!Number.isInteger(validBefore)) throw new Error("The intent has no authorization deadline.");
      const connection = new FetchRequest(BASE_SEPOLIA_RPC);
      connection.getUrlFunc = viaFetch;
      const provider = new JsonRpcProvider(connection, 84532, { staticNetwork: true, batchMaxCount: 1, cacheTimeout: -1 });
      try {
        const head = await provider.getBlock("latest");
        if (!head) throw new Error("Base Sepolia returned no latest block.");
        const token = new Contract(TESTNET_USDC[BASE_SEPOLIA], usdc, provider);
        const used: boolean = await token.authorizationState(payer, nonce, { blockTag: head.number });
        const checked = {
          network: BASE_SEPOLIA, rpc: BASE_SEPOLIA_RPC, authorizer: payer, nonce, validBefore,
          headBlock: head.number, headTimestamp: head.timestamp,
        };
        // A transfer needs block.timestamp < validBefore, and later blocks only get later.
        if (!used) return head.timestamp > validBefore + 30
          ? { status: "unpayable", reason: "The authorization expired unused.", evidence: { ...checked, authorizationState: false } }
          : { status: "pending", reason: `The authorization is unused; it can be declared expired 30 s after ${intent.validUntil}.` };

        // The route accepts validBefore at most 150 s ahead, so the transfer lands in [validBefore - 160, validBefore).
        let from = Math.max(0, head.number - Math.max(0, Math.ceil((head.timestamp - (validBefore - 160)) / BLOCK_SECONDS)));
        for (let window = 1; ; window += 1) {
          const to = Math.min(from + LOG_WINDOW_BLOCKS, head.number);
          const [event] = await provider.getLogs({
            address: TESTNET_USDC[BASE_SEPOLIA],
            topics: [[AUTHORIZATION_USED, AUTHORIZATION_CANCELED], zeroPadValue(payer, 32), nonce],
            fromBlock: from,
            toBlock: to,
          });
          // Awaited here so the finally block cannot destroy the provider mid-read.
          if (event) return await judgeAuthorization(provider, intent, payer, event, checked);
          if (window === MAX_LOG_WINDOWS || to >= head.number) break;
          const end = await provider.getBlock(to);
          if (end && end.timestamp > validBefore + 10) break;
          from = to + 1;
        }
        return { status: "pending", reason: "The nonce is used, but no authorization event was found near its deadline; check it by hand." };
      } finally {
        provider.destroy();
      }
    },
  };
}

async function judgeAuthorization(
  provider: JsonRpcProvider,
  intent: FundingIntent,
  payer: string,
  event: Log,
  checked: Record<string, unknown>,
): Promise<ChainVerdict> {
  const transaction = lower(event.transactionHash);
  const evidence = { ...checked, transaction, blockNumber: event.blockNumber, logIndex: event.index };
  if (event.topics[0] === AUTHORIZATION_CANCELED)
    return { status: "unpayable", reason: "The payer canceled the authorization.", evidence: { ...evidence, event: "AuthorizationCanceled" } };
  const receipt = await provider.getTransactionReceipt(event.transactionHash);
  const logs = receipt?.status === 1 ? receipt.logs : [];
  const same = logs.find((log) => log.index === event.index);
  if (!same || same.topics.join() !== event.topics.join())
    return { status: "pending", reason: "The authorization's transaction receipt is not available yet." };
  // FiatToken emits AuthorizationUsed, then the authorized Transfer, in the same call.
  const next = logs.find((log) => log.index === event.index + 1);
  const transfer = next && lower(next.address) === lower(TESTNET_USDC[BASE_SEPOLIA]) ? usdc.parseLog(next) : null;
  if (transfer?.name === "Transfer" && lower(transfer.args.from) === lower(payer) &&
      lower(transfer.args.to) === lower(intent.payTo) && transfer.args.value === BigInt(intent.amount))
    return { status: "paid", transaction, evidence: { ...evidence, event: "AuthorizationUsed", to: lower(intent.payTo), value: intent.amount } };
  return { status: "unpayable", reason: "A different authorization used this nonce.", evidence: { ...evidence, event: "AuthorizationUsed" } };
}

// ---- Solana devnet (memo-tagged TransferChecked of Circle test USDC) ----

const SOLANA_DEVNET_RPC = "https://api.devnet.solana.com";
const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const SIGNATURE_PAGE = 100;
const SIGNATURE_PAGES = 5;
const HISTORY_MARGIN_SECONDS = 600; // a payment lands only after its intent was written
const EXPIRY_PROOF_SECONDS = 180; // a blockhash lives about 60-90 s, so a bank this far past the intent has seen it expire

type SolanaCall = <T>(method: string, params: unknown[]) => Promise<T>;
type SignatureEntry = { signature: string; err: unknown; memo: string | null; blockTime: number | null };
type ParsedInstruction = { program?: string; programId?: string; parsed?: unknown };
type TransferInfo = { authority?: string; destination?: string; mint?: string; tokenAmount?: { amount?: string } };
type ParsedTransaction = {
  slot: number;
  blockTime: number | null;
  meta: { err: unknown } | null;
  transaction: { message: { instructions: ParsedInstruction[] } };
};
export type DevnetOptions = { minIntervalMs?: number; sleep?: (ms: number) => Promise<void>; clock?: () => number };

function retryDelay(header: string | null, now: number) {
  if (header && /^\d+$/.test(header.trim())) return Math.min(Number(header) * 1000, 60_000);
  const at = Date.parse(header ?? "");
  return Number.isFinite(at) ? Math.min(Math.max(at - now, 0), 60_000) : 2_000;
}

/** Plain JSON-RPC, spaced at least minIntervalMs apart, retrying once on 429 after Retry-After. */
function devnetRpc({
  minIntervalMs = 1000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  clock = Date.now,
}: DevnetOptions): SolanaCall {
  let next = 0;
  return async <T>(method: string, params: unknown[]) => {
    for (let attempt = 0; ; attempt += 1) {
      const wait = next - clock();
      if (wait > 0) await sleep(wait);
      next = clock() + minIntervalMs;
      const response = await fetch(SOLANA_DEVNET_RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(30_000),
      });
      if (response.status === 429 && attempt === 0) {
        await sleep(retryDelay(response.headers.get("retry-after"), clock()));
        continue;
      }
      if (!response.ok) throw new Error(`Solana devnet ${method} returned HTTP ${response.status}.`);
      const body = (await response.json()) as { result?: T; error?: { code?: number; message?: string } };
      if (body.error)
        throw Object.assign(new Error(`Solana devnet ${method}: ${body.error.message ?? "error"}`), { code: body.error.code });
      return body.result as T;
    }
  };
}

/** The stored payment's recent blockhash; a durable-nonce transaction never expires by blockhash. */
function paymentLifetime(payload: unknown) {
  const encoded = (payload as { payload?: { transaction?: unknown } } | null)?.payload?.transaction;
  if (typeof encoded !== "string") throw new Error("The intent has no Solana transaction.");
  const { messageBytes } = getTransactionDecoder().decode(getBase64Encoder().encode(encoded));
  const message = getCompiledTransactionMessageDecoder().decode(messageBytes);
  const [first] = message.instructions;
  const durableNonce = !!first && String(message.staticAccounts[first.programAddressIndex]) === SYSTEM_PROGRAM &&
    Buffer.from(first.data ?? []).equals(Buffer.from([4, 0, 0, 0]));
  return { blockhash: message.lifetimeToken, durableNonce };
}

/**
 * A paid verdict, or why the transaction does not prove payment. Null when an entry listed without memos
 * turns out to carry none of ours, so it cannot be this payment.
 */
async function memoPayment(call: SolanaCall, signature: string, intent: FundingIntent, account: string, memo: string, listed: boolean) {
  const found = await call<ParsedTransaction | null>("getTransaction", [
    signature,
    { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" },
  ]);
  if (!found?.meta || found.meta.err !== null) return "it failed or is not visible yet";
  const instructions = found.transaction.message.instructions;
  const memos = instructions.filter((ix) => ix.program === "spl-memo");
  if (!listed && !memos.some((ix) => typeof ix.parsed === "string" && ix.parsed.includes(memo))) return null;
  if (memos.length !== 1 || memos[0].programId !== MEMO_PROGRAM || memos[0].parsed !== memo)
    return "its memo instructions differ";
  const transfers = instructions.filter((ix) =>
    ix.program === "spl-token" && (ix.parsed as { type?: unknown } | undefined)?.type === "transferChecked");
  const pays = ({ programId, parsed }: ParsedInstruction) => {
    const info = (parsed as { info?: TransferInfo } | undefined)?.info;
    return programId === TOKEN_PROGRAM_ADDRESS && info?.destination === account && info.mint === TESTNET_USDC[SOLANA_DEVNET] &&
      info.tokenAmount?.amount === intent.amount && info.authority === intent.payer;
  };
  // Exactly one transfer, wherever it sits, and it pays this intent.
  if (transfers.length !== 1 || !transfers.find(pays)) return "its transfer does not pay this intent";
  return {
    status: "paid" as const,
    transaction: signature,
    evidence: {
      network: SOLANA_DEVNET, rpc: SOLANA_DEVNET_RPC, transaction: signature, slot: found.slot, blockTime: found.blockTime,
      payToTokenAccount: account, mint: TESTNET_USDC[SOLANA_DEVNET], amount: intent.amount, authority: intent.payer, memo,
    },
  };
}

/**
 * Checks the blockhash first, then reads the payTo USDC account's history at or after that slot,
 * so an expired blockhash plus no memo payment in that history proves the payment can never land.
 * A bank that never saw the blockhash also calls it invalid, so expiry further needs that slot's
 * block time to be EXPIRY_PROOF_SECONDS past the intent.
 */
export function solanaDevnetReader(options: DevnetOptions = {}): ChainReader {
  const call = devnetRpc(options);
  return {
    async inspect(intent) {
      if (intent.key.network !== SOLANA_DEVNET) throw new Error("Not a Solana devnet intent.");
      const { memo } = intent.key;
      const lifetime = paymentLifetime(intent.payload);
      const [ata] = await findAssociatedTokenPda({
        owner: address(intent.payTo),
        mint: address(TESTNET_USDC[SOLANA_DEVNET]),
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      });
      const account = String(ata);
      const validity = lifetime.durableNonce ? null : await call<{ context: { slot: number }; value: boolean }>(
        "isBlockhashValid", [lifetime.blockhash, { commitment: "confirmed" }]);

      // The RPC lists memos as "[<utf-8 bytes>] <text>", joined by "; ", or null when it has none to show.
      // Only entries listing other memos are skipped unread; unlisted ones are read when recent enough to be the payment.
      const since = Date.parse(intent.createdAt) / 1000 - HISTORY_MARGIN_SECONDS;
      const unverified: string[] = [];
      let before: string | undefined;
      let covered = false;
      let scanned = 0;
      for (let page = 0; page < SIGNATURE_PAGES && !covered; page += 1) {
        let entries: SignatureEntry[];
        try {
          entries = await call<SignatureEntry[]>("getSignaturesForAddress", [account, {
            limit: SIGNATURE_PAGE,
            commitment: "confirmed",
            ...(validity ? { minContextSlot: validity.context.slot } : {}),
            ...(before ? { before } : {}),
          }]);
        } catch (error) {
          if ((error as { code?: unknown }).code !== -32016) throw error;
          return { status: "pending", reason: "The devnet RPC has not confirmed the checked slot yet; run again." };
        }
        scanned += entries.length;
        for (const { signature, err, memo: listed, blockTime } of entries) {
          const unlisted = typeof listed !== "string";
          if (err !== null || (unlisted ? typeof blockTime === "number" && blockTime < since : !listed.includes(memo))) continue;
          const paid = await memoPayment(call, signature, intent, account, memo, !unlisted).catch((error: Error) => error.message);
          if (paid === null) continue;
          if (typeof paid !== "string") return paid;
          unverified.push(`${signature.slice(0, 12)}…${unlisted ? " (no memo listed)" : ""}: ${paid}`);
        }
        const last = entries.at(-1);
        covered = entries.length < SIGNATURE_PAGE || (typeof last?.blockTime === "number" && last.blockTime < since);
        before = last?.signature;
      }
      if (unverified.length)
        return { status: "pending", reason: `A transaction that may pay this intent could not be verified (${unverified.join("; ")}); check it by hand.` };
      if (!covered) return { status: "pending", reason: "The payTo account has more history than the reconciler reads; check it by hand." };
      if (!validity) return { status: "pending", reason: "The payment uses a durable nonce, so its expiry cannot be proven." };
      if (validity.value) return { status: "pending", reason: "The payment's blockhash is still valid, so it can still settle." };
      const slot = validity.context.slot;
      const slotTime = await call<number | null>("getBlockTime", [slot]).catch(() => null);
      if (typeof slotTime !== "number" || !(slotTime >= Date.parse(intent.createdAt) / 1000 + EXPIRY_PROOF_SECONDS))
        return {
          status: "pending",
          reason: `The devnet RPC called the blockhash invalid at slot ${slot}, but that slot cannot prove expiry yet: ` +
            `its block time must be ${EXPIRY_PROOF_SECONDS} s past the intent. Run again later.`,
        };
      return {
        status: "unpayable",
        reason: "The payment's blockhash expired and no transaction carrying its memo reached the payTo account.",
        evidence: {
          network: SOLANA_DEVNET, rpc: SOLANA_DEVNET_RPC, blockhash: lifetime.blockhash, blockhashValid: false,
          checkedSlot: slot, checkedSlotTime: slotTime, payToTokenAccount: account, memo, signaturesRead: scanned,
        },
      };
    },
  };
}
