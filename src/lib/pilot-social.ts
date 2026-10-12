import { isUuid, pilotPath, type PilotMoment } from "./pilot.ts";

export type PilotVisit = {
  version: 1;
  knownIds: string[];
  lastMomentId: string | null;
};
export const visitKey = (roomId: string) => `fork-night-pilot-visit:${roomId}`;

export function parsePilotVisit(raw: string | null): PilotVisit | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (
      value.version !== 1 ||
      !Array.isArray(value.knownIds) ||
      value.knownIds.length > 500 ||
      !value.knownIds.every(isUuid) ||
      (value.lastMomentId !== null && !isUuid(value.lastMomentId))
    )
      return null;
    return {
      version: 1,
      knownIds: [...new Set<string>(value.knownIds)],
      lastMomentId: value.lastMomentId,
    };
  } catch {
    return null;
  }
}

export function visitSnapshot(
  moments: PilotMoment[],
  selectedId: string,
): PilotVisit {
  return {
    version: 1,
    knownIds: moments.map((m) => m.id).slice(0, 500),
    lastMomentId: moments.some((m) => m.id === selectedId) ? selectedId : null,
  };
}

export function pathUpdates(path: PilotMoment[], baseline: PilotVisit | null) {
  const known = new Set(baseline?.knownIds ?? path.map((m) => m.id));
  return {
    newIds: new Set(path.filter((m) => !known.has(m.id)).map((m) => m.id)),
    lastMomentId: path.some((m) => m.id === baseline?.lastMomentId)
      ? baseline!.lastMomentId
      : null,
  };
}

/** Looking back does not turn a path into a shorter path. Changing branches does. */
export function readingPath(
  moments: PilotMoment[],
  roomId: string,
  tipId: string,
  selectedId: string,
) {
  const tip = moments.find((m) => m.id === tipId && m.room_id === roomId);
  const path = tip ? pilotPath(moments, roomId, tipId) : [];
  return path.some((m) => m.id === selectedId)
    ? path
    : pilotPath(moments, roomId, selectedId);
}

export function recapWindow(
  path: PilotMoment[],
  selectedId: string,
  expanded = false,
) {
  const selected = path.findIndex((m) => m.id === selectedId);
  const start = expanded ? 0 : Math.max(0, Math.min(path.length - 6, selected));
  return {
    moments: expanded ? path : path.slice(start, start + 6),
    start,
    earlier: start,
    later: expanded ? 0 : Math.max(0, path.length - start - 6),
  };
}

export const momentLetter = (index: number) => String.fromCharCode(65 + index);
export function pilotMomentLink(
  origin: string,
  roomId: string,
  momentId: string,
) {
  const url = new URL("/pilot", origin);
  url.searchParams.set("room", roomId);
  url.searchParams.set("moment", momentId);
  return url.toString();
}
