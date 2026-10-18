import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/supabase/database.types.ts";
import { supabaseFundingLedger } from "../../src/x402/ledger.ts";

test("Kessler purchases use the refill that preserves inference and maker limits", async () => {
  const calls: { name: string; args: unknown }[] = [];
  const client = { rpc: async (name: string, args: unknown) => { calls.push({ name, args }); return { data: { added: 5, replayed: false, credits: {} }, error: null }; } } as unknown as SupabaseClient<Database>;
  const ledger = supabaseFundingLedger(client);
  await ledger.refill("receipt-one", "kessler-ward", "maker");
  await ledger.refill("receipt-two", "paper-moon", "maker");
  assert.deepEqual(calls, [
    { name: "pilot_refill_wren_room", args: { p_request_id: "receipt-one", p_room_id: "kessler-ward", p_actor: "maker" } },
    { name: "pilot_refill_room", args: { p_request_id: "receipt-two", p_room_id: "paper-moon", p_actor: "maker" } },
  ]);
});
