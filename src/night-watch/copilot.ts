import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseUsd } from "../experiments/money.ts";
import type { Database } from "../lib/supabase/database.types.ts";
import { NIGHT_WATCH_ROOM, type CopilotRequest, type CopilotResponse } from "./api-types.ts";
import { BrainUnavailable, brainSettings, COPILOT_ESTIMATE_USD, openAiModeration, suggestBriefs, type Moderate } from "./brain.ts";
import { EXPENSES, operatorLimits, pathLines, type ExpenseTally, type OperatorLimits } from "./generate.ts";
import { NightWatchError } from "./http.ts";
import { combinedMoments, resolveForkPoint, storeMoments, storyPath, supabaseMoments, type Maker, type MomentSource, type StoryMoment } from "./job.ts";
import { fileNightWatchStore, type NightWatchStore } from "./store.ts";
import { CURRENT_KIT } from "./world-kit.ts";

/**
 * The desk co-pilot: while the maker is at their desk, Kimi K3 reads the story to the chosen fork
 * point and suggests three briefs. Suggestions only: the maker edits or ignores them, and nothing is
 * scheduled, signed or drawn here. Operator-paid, counted in the Night Watch's inference allowance,
 * rate-limited per maker, and every text passes the safety check before the page sees it.
 */

export const COPILOT_ASKS_PER_HOUR = 12;
export const MAX_DRAFT_CHARACTERS = 500;
const HOUR_MS = 3_600_000;
export const COPILOT_NOT_SET_UP = "The room co-pilot isn't set up on this machine.";

type AskLog = { version: 1; asks: string[] };

/** Store-safe name for one maker's ask log; maker ids never become paths directly. */
const makerKey = (makerId: string) => createHash("sha256").update(makerId).digest("hex").slice(0, 32);

/** Records one ask, or refuses when the maker already asked COPILOT_ASKS_PER_HOUR times in the last hour. */
export async function recordAsk(store: NightWatchStore, makerId: string, now: Date): Promise<{ ok: true } | { ok: false; retryAfterSeconds: number }> {
  const outcome = { retryAfterSeconds: 0 };
  await store.update<AskLog>(`copilot/${makerKey(makerId)}`, (current) => {
    const since = now.getTime() - HOUR_MS;
    const asks = (current?.asks ?? []).filter((at) => Date.parse(at) > since);
    if (asks.length >= COPILOT_ASKS_PER_HOUR) {
      const oldest = Math.min(...asks.map((at) => Date.parse(at)));
      outcome.retryAfterSeconds = Math.max(1, Math.ceil((oldest + HOUR_MS - now.getTime()) / 1000));
      return { version: 1, asks };
    }
    return { version: 1, asks: [...asks, now.toISOString()] };
  });
  return outcome.retryAfterSeconds ? { ok: false, retryAfterSeconds: outcome.retryAfterSeconds } : { ok: true };
}

const emptyTally = (): ExpenseTally => ({ version: 1, entries: {} });
const tallyTotal = (tally: ExpenseTally) => Object.values(tally.entries).reduce((sum, entry) => sum + parseUsd(entry.usd), 0n);

/**
 * Books the co-pilot's estimate in the operator tally the image requests use, or refuses when the
 * Night Watch's total operator allowance would pass its limit. Entries carry `jobId: copilot:<maker>`
 * so they count toward the total but never toward an image job's own limit.
 */
export async function reserveCopilotExpense(store: NightWatchStore, key: string, makerId: string, limits: OperatorLimits, now: Date): Promise<boolean> {
  const outcome = { ok: false };
  await store.update<ExpenseTally>(EXPENSES, (current) => {
    const tally = current ?? emptyTally();
    if (tallyTotal(tally) + parseUsd(COPILOT_ESTIMATE_USD) > parseUsd(limits.maxTotalUsd)) return tally;
    outcome.ok = true;
    return {
      ...tally,
      entries: { ...tally.entries, [key]: { jobId: `copilot:${makerKey(makerId)}`, candidate: 0, usd: COPILOT_ESTIMATE_USD, basis: "estimate", at: now.toISOString() } },
    };
  });
  return outcome.ok;
}

/** Replaces the estimate with the call's recorded expense. */
export async function settleCopilotExpense(store: NightWatchStore, key: string, makerId: string, usd: string, now: Date) {
  await store.update<ExpenseTally>(EXPENSES, (current) => {
    const tally = current ?? emptyTally();
    return {
      ...tally,
      entries: { ...tally.entries, [key]: { jobId: `copilot:${makerKey(makerId)}`, candidate: 0, usd, basis: "usage", at: now.toISOString() } },
    };
  });
}

export type CopilotDeps = {
  store?: NightWatchStore;
  maker?: (token: string) => Promise<Maker>;
  moments?: MomentSource;
  now?: () => Date;
  fetch?: typeof fetch;
  env?: Record<string, string | undefined>;
  /** Replaces OpenAI's moderation (tests). */
  moderate?: Moderate;
};

/** One read of each room's moments per request, shared by the fork point check and the path. */
function readOnce(source: MomentSource): MomentSource {
  const reads = new Map<string, Promise<StoryMoment[]>>();
  return (roomId) => {
    if (!reads.has(roomId)) reads.set(roomId, source(roomId));
    return reads.get(roomId)!;
  };
}

/** POST /api/night-watch/copilot */
export async function copilotForRequest(token: string, body: Partial<CopilotRequest>, deps: CopilotDeps = {}): Promise<CopilotResponse> {
  const store = deps.store ?? fileNightWatchStore();
  const now = deps.now ?? (() => new Date());
  const env = deps.env ?? process.env;
  const authenticate = deps.maker ?? (async (value: string) => (await import("./maker.ts")).authenticateMaker(value));
  const maker = await authenticate(token);

  const settings = brainSettings(env);
  if (!settings.apiKey || !settings.moderationKey) throw new NightWatchError(503, "copilot_unavailable", COPILOT_NOT_SET_UP);

  const draft = body?.draft ?? "";
  if (typeof draft !== "string") throw new NightWatchError(400, "invalid_draft", "The draft must be text.");
  if (draft.trim().length > MAX_DRAFT_CHARACTERS) throw new NightWatchError(400, "invalid_draft", `Keep the draft within ${MAX_DRAFT_CHARACTERS} characters.`);

  let admin: SupabaseClient<Database> | undefined;
  const moments = readOnce(
    deps.moments ??
      (async (roomId: string) => {
        admin ??= (await import("../generation/client.ts")).pilotAdmin();
        return combinedMoments(supabaseMoments(admin), storeMoments(store))(roomId);
      }),
  );
  // The same fork point checks as scheduling a job.
  const forkPoint = await resolveForkPoint(moments, NIGHT_WATCH_ROOM, body?.forkPointId);
  const path = storyPath(await moments(NIGHT_WATCH_ROOM), NIGHT_WATCH_ROOM, forkPoint.id);

  const at = now();
  const ask = await recordAsk(store, maker.id, at);
  if (!ask.ok) {
    const minutes = Math.max(1, Math.ceil(ask.retryAfterSeconds / 60));
    throw new NightWatchError(429, "copilot_busy", `You've asked the room co-pilot ${COPILOT_ASKS_PER_HOUR} times this hour. Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}, or write your own brief.`);
  }

  const key = `copilot/${makerKey(maker.id)}/${at.toISOString()}/${randomUUID().slice(0, 8)}`;
  if (!(await reserveCopilotExpense(store, key, maker.id, operatorLimits(env), at))) {
    throw new NightWatchError(503, "allowance_used", "The operator's inference allowance is used up.");
  }

  const fetchImpl = deps.fetch ?? fetch;
  let result: Awaited<ReturnType<typeof suggestBriefs>>;
  try {
    result = await suggestBriefs({ fetch: fetchImpl, apiKey: settings.apiKey }, { kit: CURRENT_KIT, pathLines: pathLines(path), forkPointTitle: forkPoint.title, draft: draft.trim() || null });
  } catch (error) {
    // A reply that arrived still costs money; without one, the estimate stays booked, because a
    // call that timed out may still have been billed.
    if (error instanceof BrainUnavailable && error.call?.usage) await settleCopilotExpense(store, key, maker.id, error.call.expenseUsd, now());
    throw new NightWatchError(503, "copilot_unavailable", "The room co-pilot didn't answer this time. Try again in a moment, or write your own brief.");
  }
  await settleCopilotExpense(store, key, maker.id, result.call.expenseUsd, now());

  const moderate = deps.moderate ?? openAiModeration(fetchImpl, settings.moderationKey);
  const { read, suggestions } = result.value;
  let flags: boolean[];
  try {
    flags = await moderate([read, ...suggestions.flatMap((suggestion) => [suggestion.brief, suggestion.why])]);
  } catch {
    throw new NightWatchError(503, "copilot_unavailable", "The safety check didn't answer, so no suggestions were shown. Try again in a moment.");
  }
  const kept = suggestions.filter((_, index) => !flags[1 + index * 2] && !flags[2 + index * 2]);
  if (!kept.length) {
    throw new NightWatchError(422, "copilot_flagged", "None of the co-pilot's ideas passed the safety check. Try again, or write your own brief.");
  }
  return {
    copilot: { model: result.call.model, label: result.call.label, latencyMs: result.call.latencyMs },
    read: flags[0] ? "" : read,
    suggestions: kept,
    expenseUsd: result.call.expenseUsd,
  };
}
