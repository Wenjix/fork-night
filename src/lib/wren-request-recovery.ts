import { isUuid } from "./pilot.ts";
import { parseWrenIntent, WREN_ROOM, type WrenIntent, type WrenView } from "./pilot-wren.ts";

export const wrenIntentKey = (actor: string) => `fork-night:wren:v1:${actor}:${WREN_ROOM}`;
export const wrenFinished = (request?: WrenView) => !!request && ["published", "discarded", "blocked", "failed"].includes(request.state);

export function readWrenIntent(storage: Pick<Storage, "getItem">, actor: string): WrenIntent | null {
  if (!isUuid(actor)) return null;
  try {
    const value = JSON.parse(storage.getItem(wrenIntentKey(actor)) ?? "null");
    return parseWrenIntent(value?.version === 1 ? value.intent : value);
  }
  catch { return null; }
}

export function readWrenOrigin(storage: Pick<Storage, "getItem">, actor: string): string | undefined {
  if (!isUuid(actor)) return;
  try {
    const value = JSON.parse(storage.getItem(wrenIntentKey(actor)) ?? "null");
    if (value?.version === 1 && parseWrenIntent(value.intent) && isUuid(value.originDraftId)) return value.originDraftId;
  } catch { /* An origin can never authorize a different saved draft. */ }
}

export function parseWrenView(value: unknown): WrenView | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (!isUuid(item.id) || !isUuid(item.parentId) || item.roomId !== WREN_ROOM ||
    item.operationId !== null && !isUuid(item.operationId) ||
    !["pending", "planning", "funding", "generating", "ready", "published", "discarded", "blocked", "failed"].includes(String(item.state)) ||
    typeof item.message !== "string" || typeof item.createdAt !== "string" || typeof item.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(item.createdAt)) || !Number.isFinite(Date.parse(item.updatedAt))) return null;
  return { id: item.id, state: item.state as WrenView["state"], roomId: WREN_ROOM, parentId: item.parentId,
    operationId: item.operationId as string | null, message: item.message, createdAt: item.createdAt, updatedAt: item.updatedAt };
}
