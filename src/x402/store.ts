import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../lib/supabase/database.types.ts";
import { digest } from "../experiments/storage.ts";
import { readStored } from "../generation/storage.ts";

/** Write-once JSON records in the private pilot-receipts bucket. */
export interface ReceiptStore {
  read(path: string): Promise<Buffer | null>;
  /** "existing" means identical bytes were already stored, e.g. after a lost acknowledgement. */
  create(path: string, bytes: Buffer): Promise<"created" | "existing">;
  /** Object names directly under a prefix. */
  list(prefix: string): Promise<string[]>;
}

/** Another writer already stored different bytes at this path. */
export class StoredConflictError extends Error {}

export function supabaseReceiptStore(client: SupabaseClient<Database>): ReceiptStore {
  const bucket = () => client.storage.from("pilot-receipts");
  return {
    read: (path) => readStored(client, "pilot-receipts", path),
    async create(path, bytes) {
      const result = await bucket().upload(path, bytes, {
        upsert: false,
        contentType: "application/json",
        cacheControl: "0",
      });
      let outcome: "created" | "existing" = "created";
      if (result.error) {
        const existing = await readStored(client, "pilot-receipts", path);
        if (!existing) throw new Error("Could not save the x402 record.");
        if (digest(existing) !== digest(bytes)) throw new StoredConflictError(path);
        outcome = "existing";
      }
      // A record counts only once exactly these bytes read back.
      const saved = await readStored(client, "pilot-receipts", path);
      if (!saved || digest(saved) !== digest(bytes))
        throw new Error("x402 record verification failed.");
      return outcome;
    },
    async list(prefix) {
      const names: string[] = [];
      for (let offset = 0; ; offset += 1000) {
        const result = await bucket().list(prefix, {
          limit: 1000,
          offset,
          sortBy: { column: "name", order: "asc" },
        });
        if (result.error) throw new Error("Could not list x402 records.");
        names.push(...result.data.filter((item) => item.id && item.name.endsWith(".json")).map((item) => item.name));
        if (result.data.length < 1000) return names;
      }
    },
  };
}

export const recordBytes = (value: unknown) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

export async function readRecord<T>(store: ReceiptStore, path: string): Promise<T | null> {
  const bytes = await store.read(path);
  return bytes ? (JSON.parse(bytes.toString("utf8")) as T) : null;
}

/** Writes a record unless one already exists; returns whichever record is stored. */
export async function keepFirst<T>(store: ReceiptStore, path: string, value: T): Promise<T> {
  const existing = await readRecord<T>(store, path);
  if (existing) return existing;
  try {
    await store.create(path, recordBytes(value));
    return value;
  } catch (error) {
    if (!(error instanceof StoredConflictError)) throw error;
    const winner = await readRecord<T>(store, path);
    if (!winner) throw error;
    return winner;
  }
}
