import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatUsd } from "../src/experiments/money.ts";
import { pilotAdmin } from "../src/generation/client.ts";
import type { Database } from "../src/lib/supabase/database.types.ts";
import { loadFundingConfig, type FundingConfig, type FundingRoom } from "../src/x402/config.ts";
import {
  BASE_SEPOLIA,
  INTENT_ID_PATTERN,
  SOLANA_DEVNET,
  explorerUrl,
  isTestnet,
  normalizeTransaction,
  recordPaths,
  type Testnet,
} from "../src/x402/ids.ts";
import { supabaseFundingLedger, type RoomFundingState } from "../src/x402/ledger.ts";
import { activeTopUps, TESTNET_LABEL, type FundingIntent, type FundingReceipt } from "../src/x402/records.ts";
import { readRecord, supabaseReceiptStore, type ReceiptStore } from "../src/x402/store.ts";

// READ-ONLY demo evidence: selects, one credits read and storage reads. Nothing is written.
// npm run x402:status [-- --json]

export const NETWORK_NAME: Record<Testnet, string> = { [BASE_SEPOLIA]: "Base Sepolia", [SOLANA_DEVNET]: "Solana devnet" };
export const supabaseConfigured = () => !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SECRET_KEY;
const PANEL_MICRO = 1_000_000; // pilot_request_generation reserves $1 per requested panel
const usd = (micro: number) => `${micro < 0 ? "-" : ""}$${formatUsd(BigInt(Math.abs(micro)))}`;
const usdc = (atomic: string) => (/^\d{1,30}$/.test(atomic) ? formatUsd(BigInt(atomic)) : atomic);

export type RoomCredits = { limit: number; used: number; reserved: number; available: number; enabled: boolean };
export type RoomEvidence = { state: RoomFundingState; activeTopUps: number; credits: RoomCredits | null };
export type RoomReader = (room: FundingRoom) => Promise<RoomEvidence>;

/** What the route would check before offering a top-up, plus the room's credits. Selects only. */
export function supabaseRoomReader(client: SupabaseClient<Database>, store = supabaseReceiptStore(client)): RoomReader {
  const ledger = supabaseFundingLedger(client);
  return async (room) => {
    const [state, active] = await Promise.all([
      ledger.state(room.roomId, room.stewardProfileId),
      activeTopUps(store, room.roomId),
    ]);
    // pilot_room_credits refuses closed rooms; the open state already says why.
    if (!state.open) return { state, activeTopUps: active, credits: null };
    const credits = await client.rpc("pilot_room_credits", { p_room_id: room.roomId });
    if (credits.error) throw new Error(`Could not read the credits of room ${room.roomId}.`);
    return { state, activeTopUps: active, credits: credits.data as RoomCredits };
  };
}

export function describeRoom(evidence: RoomEvidence, room: FundingRoom) {
  const { state, credits } = evidence;
  const capacity = credits
    ? `credits ${credits.available} available of ${credits.limit} (used ${credits.used}, reserved ${credits.reserved})`
    : state.deliveryLimit === null ? "no capacity row" : `delivery limit ${state.deliveryLimit}`;
  return `${state.open ? "open" : "closed"}; ${capacity}; x402 top-ups ${evidence.activeTopUps} of ${room.maxTopUps}`;
}

export type BudgetRows = {
  budget: { enabled: boolean; cap_micro: number; imported_expense_micro: number; imported_requests: number; max_requests: number };
  attempts: { expense_micro: number | null }[];
  jobs: { held_micro: number; panel_count: number }[];
};

/** The admission arithmetic of pilot_request_generation, for one two-panel job. */
export function summarizeBudget({ budget, attempts, jobs }: BudgetRows) {
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  const capMicro = Number(budget.cap_micro);
  const importedExpenseMicro = Number(budget.imported_expense_micro);
  const measuredExpenseMicro = sum(attempts.map((attempt) => Number(attempt.expense_micro ?? 0)));
  const heldMicro = sum(jobs.map((job) => Number(job.held_micro)));
  const committedMicro = importedExpenseMicro + measuredExpenseMicro + heldMicro;
  const maxRequests = Number(budget.max_requests);
  const admittedRequests = Number(budget.imported_requests) + sum(jobs.map((job) => Number(job.panel_count)));
  const unresolvedExpenses = attempts.filter((attempt) => attempt.expense_micro === null).length;
  const expensesOverOneDollar = attempts.filter((attempt) => Number(attempt.expense_micro ?? 0) > PANEL_MICRO).length;
  const blockedBy = [
    !budget.enabled && "generation is disabled",
    unresolvedExpenses > 0 && "an expense is unresolved",
    expensesOverOneDollar > 0 && "an expense over $1 awaits review",
    committedMicro + 2 * PANEL_MICRO > capMicro && "the dollar headroom is below $2.000000",
    admittedRequests + 2 > maxRequests && "the request headroom is below 2",
  ].filter((reason): reason is string => typeof reason === "string");
  return {
    enabled: budget.enabled,
    capMicro,
    importedExpenseMicro,
    measuredExpenseMicro,
    heldMicro,
    committedMicro,
    headroomMicro: capMicro - committedMicro,
    maxRequests,
    admittedRequests,
    requestHeadroom: maxRequests - admittedRequests,
    unresolvedExpenses,
    expensesOverOneDollar,
    twoPanelJobFits: blockedBy.length === 0,
    blockedBy,
  };
}

async function allRows<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error || !data) throw new Error("Could not read the generation ledger.");
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

export async function readBudgetRows(client: SupabaseClient<Database>): Promise<BudgetRows> {
  const budget = await client
    .from("pilot_generation_budget")
    .select("enabled,cap_micro,imported_expense_micro,imported_requests,max_requests")
    .eq("id", true)
    .single();
  if (budget.error) throw new Error("Could not read the shared generation budget.");
  const [attempts, jobs] = await Promise.all([
    allRows((from, to) => client.from("pilot_panel_attempts").select("operation_id,panel_number,expense_micro")
      .order("operation_id").order("panel_number").range(from, to)),
    allRows((from, to) => client.from("pilot_jobs").select("operation_id,held_micro,panel_count")
      .order("operation_id").range(from, to)),
  ]);
  return { budget: budget.data, attempts, jobs };
}

export type IntentSummary = Omit<FundingIntent, "payload" | "requirement">;
export type RecordGroup = {
  intentId: string;
  state: "credited" | "expired" | "credit-pending" | "pending";
  at: string;
  intent: IntentSummary | null;
  receipt: FundingReceipt | null;
  expired: Record<string, unknown> | null;
  events: Record<string, unknown>[];
  links: string[];
};

/** Every intent, receipt, expired marker and event in the bucket, grouped by intent, newest first. */
export async function collectRecords(store: ReceiptStore): Promise<RecordGroup[]> {
  const ids = async (prefix: string) => new Set((await store.list(prefix))
    .map((name) => name.replace(/\.json$/, "")).filter((id) => INTENT_ID_PATTERN.test(id)));
  const [intents, receipts, expired] = await Promise.all([ids("x402/intents"), ids("x402/receipts"), ids("x402/expired")]);
  const groups: RecordGroup[] = [];
  for (const id of new Set([...intents, ...receipts, ...expired])) {
    const paths = recordPaths(id, "");
    const [intent, receipt, expiry, eventNames] = await Promise.all([
      intents.has(id) ? readRecord<FundingIntent>(store, paths.intent) : null,
      receipts.has(id) ? readRecord<FundingReceipt>(store, paths.receipt) : null,
      expired.has(id) ? readRecord<Record<string, unknown>>(store, paths.expired) : null,
      store.list(paths.events),
    ]);
    const events: Record<string, unknown>[] = [];
    for (const name of eventNames.filter((item) => item.endsWith(".json")).sort()) {
      const event = await readRecord<Record<string, unknown>>(store, `${paths.events}/${name}`);
      if (event) events.push(event);
    }
    // The stored payload is a signed authorization; the digest identifies it without repeating it.
    let summary: IntentSummary | null = null;
    if (intent) {
      const { payload: _payload, requirement: _requirement, ...rest } = intent;
      summary = rest;
    }
    const network = receipt?.network ?? intent?.key?.network;
    const transactions = [receipt?.transaction, ...events.map((event) => event.transaction)]
      .filter((transaction): transaction is string => typeof transaction === "string" && transaction.length > 0);
    groups.push({
      intentId: id,
      state: receipt ? "credited" : expiry ? "expired"
        : events.some((event) => event.kind === "credit-pending") ? "credit-pending" : "pending",
      at: intent?.createdAt ?? receipt?.recordedAt ?? String(events[0]?.at ?? expiry?.recordedAt ?? ""),
      intent: summary,
      receipt,
      expired: expiry,
      events,
      links: isTestnet(network)
        ? [...new Set(transactions.map((transaction) => explorerUrl(network, normalizeTransaction(network, transaction))))]
        : [],
    });
  }
  return groups.sort((a, b) => b.at.localeCompare(a.at) || a.intentId.localeCompare(b.intentId));
}

export type StatusRoom = FundingRoom & { ref: string; evidence: RoomEvidence | null; error?: string };
export type StatusReport = {
  kind: "fork-night/x402-status/v1";
  checkedAt: string;
  label: string;
  budget: ReturnType<typeof summarizeBudget>;
  configError?: string;
  rooms: StatusRoom[];
  records: RecordGroup[];
};

export async function readStatus(deps: {
  config: FundingConfig | null;
  configError?: string;
  store: ReceiptStore;
  budget: () => Promise<BudgetRows>;
  rooms: RoomReader;
  now?: () => Date;
}): Promise<StatusReport> {
  const rooms: StatusRoom[] = [];
  for (const [ref, room] of Object.entries(deps.config?.rooms ?? {})) {
    const entry = { ...room, ref: `${ref.slice(0, 6)}…` };
    try {
      rooms.push({ ...entry, evidence: await deps.rooms(room) });
    } catch (error) {
      rooms.push({ ...entry, evidence: null, error: (error as Error).message });
    }
  }
  return {
    kind: "fork-night/x402-status/v1",
    checkedAt: (deps.now ?? (() => new Date()))().toISOString(),
    label: TESTNET_LABEL,
    budget: summarizeBudget(await deps.budget()),
    ...(deps.configError ? { configError: deps.configError } : {}),
    rooms,
    records: await collectRecords(deps.store),
  };
}

const details = (record: Record<string, unknown>, skip: string[]) => Object.entries(record)
  .filter(([key, value]) => !skip.includes(key) && value !== null && value !== undefined)
  .map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`)
  .join(" ");

export function renderStatus(report: StatusReport) {
  const b = report.budget;
  const out = [
    `Fork Night x402 status (read-only, testnets only) at ${report.checkedAt}`,
    report.label,
    "",
    "Generation budget (the operator's approved allowance)",
    `  ${b.enabled ? "enabled" : "disabled"}; cap ${usd(b.capMicro)}; committed ${usd(b.committedMicro)} = imported ${usd(b.importedExpenseMicro)} + measured ${usd(b.measuredExpenseMicro)} + held ${usd(b.heldMicro)}`,
    `  headroom ${usd(b.headroomMicro)}; requests ${b.admittedRequests} of ${b.maxRequests} admitted (headroom ${b.requestHeadroom}); unresolved expenses ${b.unresolvedExpenses}`,
    `  a two-panel job ${b.twoPanelJobFits ? "fits" : `does not fit: ${b.blockedBy.join("; ")}`}`,
    "",
    "Rooms opted in to x402 top-ups",
  ];
  if (report.configError) out.push(`  ${report.configError}`);
  else if (!report.rooms.length) out.push("  none (npm run x402:setup -- init --room <roomId> --steward <profileUuid>)");
  for (const room of report.rooms)
    out.push(`  ${room.roomId} (ref ${room.ref}): ${room.evidence ? describeRoom(room.evidence, room) : room.error}`);
  out.push("", `x402 records: ${report.records.length} intent(s), newest first`);
  for (const group of report.records) {
    const { intent, receipt, expired } = group;
    const network = receipt?.network ?? intent?.key?.network;
    out.push(`  ${group.at || "unknown time"}  ${group.state}  ${isTestnet(network) ? NETWORK_NAME[network] : "unknown network"}  room ${intent?.roomId ?? receipt?.roomId ?? "?"}  intent ${group.intentId.slice(0, 12)}…`);
    if (intent) {
      const key = intent.key.network === SOLANA_DEVNET ? `memo ${intent.key.memo}` : `nonce ${intent.key.nonce.slice(0, 18)}…`;
      out.push(`    ${usdc(intent.amount)} test USDC from ${intent.payer} to ${intent.payTo}; ${key}${intent.validUntil ? `; valid until ${intent.validUntil}` : ""}`);
    }
    if (receipt)
      out.push(`    receipt (${receipt.source}) ${receipt.recordedAt}: +${receipt.refill.added} test credits${receipt.refill.replayed ? " (refill replayed)" : ""}; transaction ${receipt.transaction}`);
    if (expired)
      out.push(`    expired ${String(expired.recordedAt ?? "")}${typeof expired.reason === "string" ? `: ${expired.reason}` : ""}`);
    for (const event of group.events)
      out.push(`    event ${String(event.at ?? "")} ${String(event.kind ?? "")}${details(event, ["kind", "at"]) ? ` ${details(event, ["kind", "at"])}` : ""}`);
    for (const link of group.links) out.push(`    ${link}`);
  }
  return out.join("\n");
}

async function main(argv: string[]) {
  // pnpm forwards the "--" separator; npm drops it.
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  const { values } = parseArgs({ args, strict: true, options: { json: { type: "boolean", default: false } } });
  if (!supabaseConfigured())
    throw new Error("Status reads the shared pilot: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (for example in .env.local, which npm run x402:status reads).");
  let config: FundingConfig | null = null;
  let configError: string | undefined;
  try { config = await loadFundingConfig(); } catch (error) { configError = (error as Error).message; }
  const client = pilotAdmin();
  const report = await readStatus({
    config,
    configError,
    store: supabaseReceiptStore(client),
    budget: () => readBudgetRows(client),
    rooms: supabaseRoomReader(client),
  });
  console.log(values.json ? JSON.stringify(report, null, 2) : renderStatus(report));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(`x402 status: ${(error as Error).message} Nothing was changed.`);
    process.exitCode = 1;
  }
}
