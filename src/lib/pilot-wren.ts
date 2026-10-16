import { isUuid } from "./pilot.ts";

export const WREN_ROOM = "kessler-ward";
export type WrenIntent = { requestId: string; roomId: typeof WREN_ROOM; parentId: string; brief: string };
export type WrenState = "pending" | "planning" | "funding" | "generating" | "ready" | "published" | "discarded" | "blocked" | "failed";
export type WrenView = {
  id: string; state: WrenState; roomId: string; parentId: string;
  operationId: string | null; message: string; createdAt: string; updatedAt: string;
};
export type WrenAssistance = { moment_id: string; agent_label: "Wren" };

export function parseWrenIntent(value: unknown): WrenIntent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !["requestId", "roomId", "parentId", "brief"].includes(key)) ||
    !isUuid(input.requestId) || !isUuid(input.parentId) || input.roomId !== WREN_ROOM ||
    typeof input.brief !== "string" || !input.brief.trim() || input.brief.trim().length > 500) return null;
  return { requestId: input.requestId, roomId: WREN_ROOM, parentId: input.parentId, brief: input.brief.trim() };
}
