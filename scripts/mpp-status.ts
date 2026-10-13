import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { formatUsd } from "../src/experiments/money.ts";
import { pilotAdmin } from "../src/generation/client.ts";
import { loadMppConfig, mppRoomFor, type MppDoorConfig, type MppRoom } from "../src/mpp/config.ts";
import { INTENT_ID_PATTERN, MPP_COMMANDS, mppExplorerUrl, mppRecordPaths } from "../src/mpp/ids.ts";
import { TESTNET_LABEL, type MppIntent, type MppReceipt, type MppSettlement } from "../src/mpp/records.ts";
import { loadFundingConfig, type FundingConfig } from "../src/x402/config.ts";
import { readRecord, supabaseReceiptStore, type ReceiptStore } from "../src/x402/store.ts";
import { supabaseMppRoomReader, type MppRoomEvidence, type MppRoomReader } from "./mpp-setup.ts";
import { readBudgetRows, summarizeBudget, supabaseConfigured, type BudgetRows } from "./x402-status.ts";

// READ-ONLY demo evidence for the MPP door: selects, storage reads and the shared budget. Nothing is written.
// node --env-file-if-exists=.env.local scripts/mpp-status.ts [--json]

export type MppIntentSummary = Omit<MppIntent, "signedTransaction">;
export type MppRecordGroup = {
  intentId: string;
  state: "credited" | "expired" | "credit-pending" | "pending";
  at: string;
  intent: MppIntentSummary | null;
  receipt: MppReceipt | null;
  /** The transaction bound before the refill: with no receipt, the payment landed and awaits its credit. */
  settlement: MppSettlement | null;
  expired: Record<string, unknown> | null;
  /** Whether mpp/rooms/<room>/ holds this intent, so it counts against the MPP limit (null without a known room). */
  holdsSlot: boolean | null;
  events: Record<string, unknown>[];
  links: string[];
};

/** Every MPP intent, receipt, settlement, expired marker and event in the bucket, grouped by intent, newest first. */
export async function collectMppRecords(store: ReceiptStore): Promise<MppRecordGroup[]> {
  const ids = async (prefix: string) => new Set((await store.list(prefix))
    .map((name) => name.replace(/\.json$/, "")).filter((id) => INTENT_ID_PATTERN.test(id)));
  const [intents, receipts, settlements, expired] = await Promise.all([ids("mpp/intents"), ids("mpp/receipts"), ids("mpp/settlements"), ids("mpp/expired")]);
  const groups: MppRecordGroup[] = [];
  for (const id of new Set([...intents, ...receipts, ...settlements, ...expired])) {
    const paths = mppRecordPaths(id, "");
    const [intent, receipt, settlement, expiry, eventNames] = await Promise.all([
      intents.has(id) ? readRecord<MppIntent>(store, paths.intent) : null,
      receipts.has(id) ? readRecord<MppReceipt>(store, paths.receipt) : null,
      settlements.has(id) ? readRecord<MppSettlement>(store, paths.settlement) : null,
      expired.has(id) ? readRecord<Record<string, unknown>>(store, paths.expired) : null,
      store.list(paths.events),
    ]);
    const roomId = intent?.roomId ?? receipt?.roomId ?? (typeof expiry?.roomId === "string" ? expiry.roomId : null);
    const holdsSlot = roomId ? !!(await store.read(mppRecordPaths(id, roomId).roomIndex)) : null;
    const events: Record<string, unknown>[] = [];
    for (const name of eventNames.filter((item) => item.endsWith(".json")).sort()) {
      const event = await readRecord<Record<string, unknown>>(store, `${paths.events}/${name}`);
      if (event) events.push(event);
    }
    // The signed transaction is evidence in the bucket; the hash identifies it without repeating it.
    let summary: MppIntentSummary | null = null;
    if (intent) {
      const { signedTransaction: _signed, ...rest } = intent;
      summary = rest;
    }
    const transactions = [receipt?.transaction, settlement?.transaction, intent?.transaction, ...events.map((event) => event.transaction)]
      .filter((transaction): transaction is string => typeof transaction === "string" && /^0x[0-9a-fA-F]{64}$/.test(transaction));
    groups.push({
      intentId: id,
      state: receipt ? "credited" : expiry ? "expired"
        : settlement || events.some((event) => event.kind === "credit-pending") ? "credit-pending" : "pending",
      at: intent?.createdAt ?? receipt?.recordedAt ?? String(events[0]?.at ?? expiry?.recordedAt ?? ""),
      intent: summary,
      receipt,
      settlement,
      expired: expiry,
      holdsSlot,
      events,
      links: [...new Set(transactions.map((transaction) => mppExplorerUrl(transaction)))],
    });
  }
  return groups.sort((a, b) => b.at.localeCompare(a.at) || a.intentId.localeCompare(b.intentId));
}

export type MppStatusRoom = MppRoom & { ref: string; evidence: MppRoomEvidence | null; error?: string };
export type MppStatusReport = {
  kind: "fork-night/mpp-status/v1";
  checkedAt: string;
  label: string;
  budget: ReturnType<typeof summarizeBudget>;
  configError?: string;
  rooms: MppStatusRoom[];
  records: MppRecordGroup[];
};

export async function readMppStatus(deps: {
  funding: FundingConfig | null;
  door: MppDoorConfig | null;
  configError?: string;
  store: ReceiptStore;
  budget: () => Promise<BudgetRows>;
  rooms: MppRoomReader;
  now?: () => Date;
}): Promise<MppStatusReport> {
  const rooms: MppStatusRoom[] = [];
  for (const ref of Object.keys(deps.funding?.rooms ?? {})) {
    const room = deps.funding && deps.door ? mppRoomFor(deps.funding, deps.door, ref) : null;
    if (!room) continue;
    const entry = { ...room, ref: `${ref.slice(0, 6)}…` };
    try {
      rooms.push({ ...entry, evidence: await deps.rooms(room) });
    } catch (error) {
      rooms.push({ ...entry, evidence: null, error: (error as Error).message });
    }
  }
  return {
    kind: "fork-night/mpp-status/v1",
    checkedAt: (deps.now ?? (() => new Date()))().toISOString(),
    label: TESTNET_LABEL,
    budget: summarizeBudget(await deps.budget()),
    ...(deps.configError ? { configError: deps.configError } : {}),
    rooms,
    records: await collectMppRecords(deps.store),
  };
}

const usd = (micro: number) => `${micro < 0 ? "-" : ""}$${formatUsd(BigInt(Math.abs(micro)))}`;

export function renderMppStatus(report: MppStatusReport) {
  const b = report.budget;
  const out = [
    `Fork Night MPP status (read-only, Tempo Moderato testnet only) at ${report.checkedAt}`,
    report.label,
    "",
    "Generation budget (the operator's approved allowance)",
    `  ${b.enabled ? "enabled" : "disabled"}; cap ${usd(b.capMicro)}; committed ${usd(b.committedMicro)}; headroom ${usd(b.headroomMicro)}; requests ${b.admittedRequests} of ${b.maxRequests}`,
    `  a two-panel job ${b.twoPanelJobFits ? "fits" : `does not fit: ${b.blockedBy.join("; ")}`}`,
    "",
    "Rooms opted in to MPP top-ups (the limit is per rail; x402 top-ups are counted by npm run x402:status)",
  ];
  if (report.configError) out.push(`  ${report.configError}`);
  else if (!report.rooms.length) out.push(`  none (${MPP_COMMANDS.setup} init --room <roomId>)`);
  for (const room of report.rooms)
    out.push(`  ${room.roomId} (ref ${room.ref}): ${room.evidence
      ? `${room.evidence.state.open ? "open" : "closed"}; delivery limit ${room.evidence.state.deliveryLimit ?? "none"}; MPP top-ups ${room.evidence.activeTopUps} of ${room.maxTopUps}`
      : room.error}`);
  out.push("", `MPP records: ${report.records.length} intent(s), newest first`);
  for (const group of report.records) {
    const { intent, receipt, expired } = group;
    out.push(`  ${group.at || "unknown time"}  ${group.state}  Tempo Moderato  room ${intent?.roomId ?? receipt?.roomId ?? "?"}  intent ${group.intentId.slice(0, 12)}…`);
    if (intent) out.push(`    ${formatUsd(BigInt(intent.amount))} test USD from ${intent.payer} to ${intent.payTo}; transaction ${intent.transaction}; valid before ${new Date(intent.validBefore * 1000).toISOString()}`);
    if (receipt)
      out.push(`    receipt (${receipt.source}) ${receipt.recordedAt}: +${receipt.refill.added} test credits${receipt.refill.replayed ? " (refill replayed)" : ""}; refill ${receipt.refillRequestId}`);
    else if (group.settlement)
      out.push(`    settlement (${group.settlement.via}) ${group.settlement.recordedAt}: ${group.settlement.transaction} landed, not credited yet; refill ${group.settlement.refillRequestId}`);
    if (group.holdsSlot === false && group.state !== "expired")
      out.push(`    WARN no room pointer: this intent holds no slot of the MPP limit until the route or the reconciler rewrites it`);
    if (expired) out.push(`    expired ${String(expired.recordedAt ?? "")}${typeof expired.reason === "string" ? `: ${expired.reason}` : ""}`);
    for (const event of group.events) out.push(`    event ${String(event.at ?? "")} ${String(event.kind ?? "")}${typeof event.reason === "string" ? `: ${event.reason}` : ""}`);
    for (const link of group.links) out.push(`    ${link}`);
  }
  return out.join("\n");
}

async function main(argv: string[]) {
  const args = argv[0] === "--" ? argv.slice(1) : argv; // pnpm forwards the "--" separator; npm drops it.
  const { values } = parseArgs({ args, strict: true, options: { json: { type: "boolean", default: false } } });
  if (!supabaseConfigured())
    throw new Error(`Status reads the shared pilot: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (for example in .env.local, which ${MPP_COMMANDS.status} reads).`);
  let funding: FundingConfig | null = null, door: MppDoorConfig | null = null;
  let configError: string | undefined;
  try { [funding, door] = await Promise.all([loadFundingConfig(), loadMppConfig()]); } catch (error) { configError = (error as Error).message; }
  const client = pilotAdmin();
  const report = await readMppStatus({
    funding, door, configError,
    store: supabaseReceiptStore(client),
    budget: () => readBudgetRows(client),
    rooms: supabaseMppRoomReader(client),
  });
  console.log(values.json ? JSON.stringify(report, null, 2) : renderMppStatus(report));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(`mpp status: ${(error as Error).message} Nothing was changed.`);
    process.exitCode = 1;
  }
}
