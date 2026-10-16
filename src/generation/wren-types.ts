import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../lib/supabase/database.types.ts";
import type { WrenState, WrenView } from "../lib/pilot-wren.ts";
export { WREN_ROOM, parseWrenIntent } from "../lib/pilot-wren.ts";
export type { WrenIntent, WrenState, WrenView } from "../lib/pilot-wren.ts";

export type WrenPlan = { title: string; caption: string };
export type WrenRequest = {
  id: string; maker_id: string; room_id: string; parent_id: string; brief: string;
  input_digest: string; environment: string; state: WrenState; plan: WrenPlan | null;
  operation_id: string | null; claim_token: string | null; lease_until: string | null;
  run_id: string | null; dispatch_version: number; dispatch_token: string | null;
  dispatch_until: string | null; next_check_at: string; message: string; error_code: string | null;
  created_at: string; updated_at: string;
};
type Fn<Args, Returns> = { Args: Args; Returns: Returns };
export type WrenDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables" | "Functions"> & {
    Tables: Database["public"]["Tables"] & {
      pilot_wren_requests: { Row: WrenRequest; Insert: never; Update: never; Relationships: [] };
      pilot_wren_limits: { Row: { id: boolean; enabled: boolean; room_id: string; request_limit: number; maker_limit: number }; Insert: never; Update: never; Relationships: [] };
    };
    Functions: Database["public"]["Functions"] & {
      pilot_request_wren: Fn<{ p_request_id: string; p_room_id: string; p_parent_id: string; p_brief: string }, WrenRequest>;
      pilot_claim_wren_request: Fn<{ p_request_id: string; p_claim_token: string; p_environment: string; p_run_id: string; p_version: number }, WrenRequest | null>;
      pilot_save_wren_plan: Fn<{ p_request_id: string; p_claim_token: string; p_plan: Json }, WrenRequest>;
      pilot_admit_wren: Fn<{ p_request_id: string; p_claim_token: string }, { operation_id: string; dispatch_version: number }>;
      pilot_finish_wren_request: Fn<{ p_request_id: string; p_claim_token: string; p_state: "blocked" | "failed" | "funding"; p_message: string }, WrenRequest>;
      pilot_observe_wren_request: Fn<{ p_request_id: string }, WrenRequest>;
      pilot_refresh_wren_request: Fn<{ p_request_id: string }, WrenRequest>;
      pilot_lease_wren_dispatch: Fn<{ p_request_id: string; p_version: number; p_environment: string; p_token: string }, boolean>;
      pilot_ack_wren_dispatch: Fn<{ p_request_id: string; p_version: number; p_token: string; p_run_id: string }, boolean>;
      pilot_retry_wren_request: Fn<{ p_request_id: string; p_version: number; p_run_id: string; p_status: string }, WrenRequest>;
      pilot_wren_assistance: Fn<{ p_room_id: string }, { moment_id: string; agent_label: string }[]>;
    };
  };
};
export const asWrenClient = (client: SupabaseClient<Database>) => client as unknown as SupabaseClient<WrenDatabase>;

export const wrenView = (request: WrenRequest): WrenView => ({
  id: request.id, state: request.state, roomId: request.room_id, parentId: request.parent_id,
  operationId: request.operation_id, message: request.message, createdAt: request.created_at, updatedAt: request.updated_at,
});
