import { isUuid, type PilotMoment } from "./pilot.ts";
import type { PilotCredits } from "./pilot-generation.ts";

export type RoomIntent = { requestId: string; templateId: string; templateVersion: number; title: string };
export type CreationStatus = { enabled: boolean; creditsPerRoom: number; remainingRooms: number; ownRoomId: string | null };
export type RoomParticipant = { id: string; name: string; joinedAt: string };
export type RoomSnapshot = { roomId: string; title: string; revision: number; credits: PilotCredits; participants: RoomParticipant[] };
export const roomIntentKey = (actor: string) => `fork-night:create-room:${actor}`;
export const ideaDraftKey = (actor: string, roomId: string, momentId: string) => `fork-night-pilot-idea:${actor}:${roomId}:${momentId}`;
/** Stands in for the account while signed out: kept across a reload, carried into the account it joins as, cleared on sign-out. */
export const visitorActor = "visitor";
export const validRoomId = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9-]{1,60}$/.test(value);

export function parseRoomIntent(value: unknown): RoomIntent | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<RoomIntent>;
  if (!isUuid(v.requestId) || !validRoomId(v.templateId) || !Number.isSafeInteger(v.templateVersion) || v.templateVersion! < 1 ||
    typeof v.title !== "string" || [...v.title.trim()].length < 1 || [...v.title.trim()].length > 80) return null;
  return { requestId: v.requestId, templateId: v.templateId, templateVersion: v.templateVersion!, title: v.title.trim() };
}

export function roomLink(origin: string, roomId: string) {
  if (!validRoomId(roomId)) throw new Error("Room is unavailable.");
  const url = new URL("/pilot", origin);
  url.searchParams.set("room", roomId);
  return url.href;
}

/** A first snapshot establishes a baseline; later siblings count even off the selected path. */
export function newPublications(previous: Set<string> | null, moments: PilotMoment[], actor?: string) {
  return previous ? moments.filter(moment => !previous.has(moment.id) && moment.maker_id !== actor && !!moment.parent_id) : [];
}

/** Sign-out drops a visitor's unsent ideas, so whoever uses this browser next cannot pick them up. */
export function clearVisitorIdeas(storage: Pick<Storage, "length" | "key" | "removeItem">) {
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
  for (const key of keys) if (key?.startsWith(`fork-night-pilot-idea:${visitorActor}:`)) storage.removeItem(key);
}

/** A visitor who joins or signs in keeps its unsent ideas on every moment; an idea the account already has there wins. */
export function moveVisitorIdeas(storage: Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">, actor: string) {
  const prefix = `fork-night-pilot-idea:${visitorActor}:`;
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
  for (const key of keys) {
    if (!key?.startsWith(prefix)) continue;
    const target = `fork-night-pilot-idea:${actor}:${key.slice(prefix.length)}`;
    const idea = storage.getItem(key);
    if (idea !== null && storage.getItem(target) === null) storage.setItem(target, idea);
    storage.removeItem(key);
  }
}

/** A 4xx or a coded PostgREST error means the save was refused and recorded nothing; anything else may have committed. */
export function definitelyRejected(result: { error: { code?: string } | null; status: number }) {
  return !!result.error && (result.status >= 400 && result.status < 500 || !!result.error.code);
}
