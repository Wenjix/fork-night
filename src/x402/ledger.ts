import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../lib/supabase/database.types.ts";

/** Everything pilot_refill_room would refuse, read before any payment settles. */
export type RoomFundingState = {
  open: boolean;
  deliveryLimit: number | null;
  stewardExists: boolean;
};
export type RefillResult = { added: number; replayed: boolean; credits: Json };

export interface FundingLedger {
  state(roomId: string, stewardProfileId: string): Promise<RoomFundingState>;
  /** The existing operator refill: five test credits, idempotent on requestId. */
  refill(requestId: string, roomId: string, actor: string): Promise<RefillResult>;
}

/** pilot_refill_room refused with an authored message (for example, the room closed). */
export class RefillRefusedError extends Error {}

export function supabaseFundingLedger(client: SupabaseClient<Database>): FundingLedger {
  return {
    async state(roomId, stewardProfileId) {
      const [room, capacity, steward] = await Promise.all([
        client.from("pilot_rooms").select("is_open").eq("id", roomId).maybeSingle(),
        client.from("pilot_room_capacity").select("delivery_limit").eq("room_id", roomId).maybeSingle(),
        client.from("pilot_profiles").select("id").eq("id", stewardProfileId).maybeSingle(),
      ]);
      if (room.error || capacity.error || steward.error)
        throw new Error("Could not read the room's funding state.");
      return {
        open: room.data?.is_open === true,
        deliveryLimit: capacity.data?.delivery_limit ?? null,
        stewardExists: !!steward.data,
      };
    },
    async refill(requestId, roomId, actor) {
      const result = await client.rpc("pilot_refill_room", {
        p_request_id: requestId,
        p_room_id: roomId,
        p_actor: actor,
      });
      if (result.error) {
        if (result.error.code === "P0001") throw new RefillRefusedError(result.error.message);
        throw new Error("The refill could not be confirmed.");
      }
      const data = result.data as { added?: unknown; replayed?: unknown; credits?: Json } | null;
      if (!data || data.added !== 5 || typeof data.replayed !== "boolean")
        throw new Error("The refill returned an unexpected result.");
      return { added: 5, replayed: data.replayed, credits: data.credits ?? null };
    },
  };
}

/** Refusals that must happen before settlement, because `exact` has no refund. */
export function fundingRefusal(state: RoomFundingState, activeTopUps: number, maxTopUps: number) {
  if (!state.open) return "This room is not open.";
  if (!state.stewardExists) return "This room's funding steward is unavailable.";
  if (state.deliveryLimit === null) return "This room has no generation allowance.";
  if (state.deliveryLimit > 995) return "This room has reached its local test-credit limit.";
  if (activeTopUps >= maxTopUps) return "This room has reached its steward's top-up limit.";
  return null;
}
