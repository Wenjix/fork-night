import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../lib/supabase/database.types.ts";
import type { NightWatchStore } from "./store.ts";

/**
 * Room credits for the Night Watch. A job always reads `pilot_room_credits` before it generates.
 * With NIGHT_WATCH_CHARGE_ROOM=1 each candidate also uses one room credit, by the same optimistic
 * `delivery_limit` update as the approved `.local/x402/demo-room.mjs` drain: the intent is
 * recorded first, the update applies only if the limit is unchanged, and a recorded change is
 * never applied twice.
 */

export type RoomCredits = { limit: number; used: number; reserved: number; available: number; enabled: boolean };

/** The service-role reads and the one guarded write the capacity step needs (a fake in tests). */
export type CapacityAdmin = {
  credits(roomId: string): Promise<RoomCredits>;
  /** Sets delivery_limit to `next` only while it still equals `expected`; false when it changed. */
  setDeliveryLimit(roomId: string, expected: number, next: number): Promise<boolean>;
};

export type CreditChange = {
  state: "intent" | "applied" | "abandoned";
  before: number;
  after: number;
  at: string;
  appliedAt?: string;
  note?: string;
};

export type ChargeRecord = {
  version: 1;
  jobId: string;
  roomId: string;
  candidate: number;
  charge: CreditChange | null;
  refund: CreditChange | null;
};

export class CapacityConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapacityConflict";
  }
}

const MAX_ATTEMPTS = 3;
const LIMIT_CEILING = 1000;

export function roomChargeEnabled(env: Record<string, string | undefined> = process.env) {
  return env.NIGHT_WATCH_CHARGE_ROOM === "1";
}

export const chargePath = (jobId: string, candidate: number) => `charges/${jobId}-${candidate}`;

const count = (value: unknown) => (Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : null);

export function parseCredits(raw: unknown): RoomCredits {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const limit = count(record.limit), used = count(record.used), reserved = count(record.reserved), available = count(record.available);
  if (limit === null || used === null || reserved === null || available === null || typeof record.enabled !== "boolean")
    throw new Error("The room's credits could not be read.");
  return { limit, used, reserved, available, enabled: record.enabled };
}

/** The live adapter: the existing read-only credits RPC and a guarded capacity update. */
export function supabaseCapacity(client: SupabaseClient<Database>): CapacityAdmin {
  return {
    async credits(roomId) {
      const result = await client.rpc("pilot_room_credits", { p_room_id: roomId });
      if (result.error) throw new Error("The room's credits could not be read.");
      return parseCredits(result.data);
    },
    async setDeliveryLimit(roomId, expected, next) {
      const result = await client
        .from("pilot_room_capacity")
        .update({ delivery_limit: next })
        .eq("room_id", roomId)
        .eq("delivery_limit", expected)
        .select("delivery_limit");
      if (result.error) throw new Error("The room's credit limit could not be updated.");
      return (result.data ?? []).length === 1;
    },
  };
}

export async function readCredits(admin: CapacityAdmin, roomId: string): Promise<RoomCredits> {
  return admin.credits(roomId);
}

/**
 * An interrupted change (intent saved, outcome unknown) is resolved from the current limit:
 * unchanged means it never applied; anything else counts as applied, so it is never applied twice.
 */
async function settleInterrupted(admin: CapacityAdmin, roomId: string, change: CreditChange, now: Date): Promise<CreditChange> {
  const { limit } = await admin.credits(roomId);
  if (limit === change.before) {
    if (await admin.setDeliveryLimit(roomId, change.before, change.after)) return { ...change, state: "applied", appliedAt: now.toISOString() };
    return { ...change, state: "abandoned", note: "The limit changed before the interrupted change could apply." };
  }
  return {
    ...change,
    state: "applied",
    appliedAt: now.toISOString(),
    note: limit === change.after ? "Confirmed after an interruption." : "Counted as applied after an interruption; never applied twice.",
  };
}

type ChangeResult = { applied: boolean; already: boolean; short?: boolean; record: ChargeRecord };

/** One credit for one candidate. Returns `short` (and changes nothing) when the room has none left. */
export async function chargeCredit(
  admin: CapacityAdmin,
  store: NightWatchStore,
  request: { roomId: string; jobId: string; candidate: number; now: Date },
): Promise<ChangeResult> {
  const name = chargePath(request.jobId, request.candidate);
  let record: ChargeRecord = (await store.read<ChargeRecord>(name)) ?? {
    version: 1,
    jobId: request.jobId,
    roomId: request.roomId,
    candidate: request.candidate,
    charge: null,
    refund: null,
  };
  if (record.charge?.state === "applied") return { applied: false, already: true, record };
  if (record.charge?.state === "intent") {
    record = { ...record, charge: await settleInterrupted(admin, request.roomId, record.charge, request.now) };
    await store.write(name, record);
    if (record.charge?.state === "applied") return { applied: true, already: false, record };
  }
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const credits = await admin.credits(request.roomId);
    if (credits.available < 1 || credits.limit < 1) return { applied: false, already: false, short: true, record };
    const change: CreditChange = { state: "intent", before: credits.limit, after: credits.limit - 1, at: request.now.toISOString() };
    record = { ...record, charge: change };
    // Saved before the update, so an interruption can be resolved without charging twice.
    await store.write(name, record);
    if (await admin.setDeliveryLimit(request.roomId, change.before, change.after)) {
      record = { ...record, charge: { ...change, state: "applied", appliedAt: request.now.toISOString() } };
      await store.write(name, record);
      return { applied: true, already: false, record };
    }
    record = { ...record, charge: { ...change, state: "abandoned", note: "The limit changed concurrently; nothing was charged." } };
    await store.write(name, record);
  }
  throw new CapacityConflict("The room's credit limit kept changing, so no credit was charged. The Night Watch will try again.");
}

/** Gives back the credit of a candidate that failed before delivery. Uncertain candidates keep it. */
export async function refundCredit(
  admin: CapacityAdmin,
  store: NightWatchStore,
  request: { roomId: string; jobId: string; candidate: number; now: Date },
): Promise<ChangeResult> {
  const name = chargePath(request.jobId, request.candidate);
  let record = await store.read<ChargeRecord>(name);
  if (!record || record.charge?.state !== "applied") {
    return {
      applied: false,
      already: false,
      record: record ?? { version: 1, jobId: request.jobId, roomId: request.roomId, candidate: request.candidate, charge: null, refund: null },
    };
  }
  if (record.refund?.state === "applied") return { applied: false, already: true, record };
  if (record.refund?.state === "intent") {
    record = { ...record, refund: await settleInterrupted(admin, request.roomId, record.refund, request.now) };
    await store.write(name, record);
    if (record.refund?.state === "applied") return { applied: true, already: false, record };
  }
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { limit } = await admin.credits(request.roomId);
    if (limit + 1 > LIMIT_CEILING) throw new Error("Refunding would exceed the room's credit ceiling; review it manually.");
    const change: CreditChange = { state: "intent", before: limit, after: limit + 1, at: request.now.toISOString() };
    record = { ...record, refund: change };
    await store.write(name, record);
    if (await admin.setDeliveryLimit(request.roomId, change.before, change.after)) {
      record = { ...record, refund: { ...change, state: "applied", appliedAt: request.now.toISOString() } };
      await store.write(name, record);
      return { applied: true, already: false, record };
    }
    record = { ...record, refund: { ...change, state: "abandoned", note: "The limit changed concurrently; nothing was refunded yet." } };
    await store.write(name, record);
  }
  throw new CapacityConflict("The room's credit limit kept changing, so the credit was not refunded yet. The Night Watch will try again.");
}
