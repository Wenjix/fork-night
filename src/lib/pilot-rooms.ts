import { isUuid, type PilotMoment } from "./pilot.ts";
import type { PilotCredits } from "./pilot-generation.ts";

export type RoomIntent = { requestId: string; templateId: string; templateVersion: number; title: string };
export type CreationStatus = { enabled: boolean; creditsPerRoom: number; remainingRooms: number; ownRoomId: string | null };
export type RoomParticipant = { id: string; name: string; joinedAt: string };
export type RoomSnapshot = { roomId: string; title: string; revision: number; credits: PilotCredits; participants: RoomParticipant[] };
export const roomIntentKey = (actor: string) => `fork-night:create-room:${actor}`;
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
