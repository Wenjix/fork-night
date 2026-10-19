import { pilotPanels, pilotPath, type PilotMoment } from "./pilot.ts";
import { parsePilotVisit, readingPath, visitKey, type PilotVisit } from "./pilot-social.ts";
import type { Tables } from "./supabase/database.types.ts";

export type HomeRoom = { room: Tables<"pilot_rooms">; visit: PilotVisit | null };
export const HOME_HISTORY_LIMIT = 500;

/** Visits belong to this browser; joined rooms belong to the current account. */
export function returningRooms(rooms: Tables<"pilot_rooms">[], joined: Tables<"pilot_rooms">[], read: (key: string) => string | null): HomeRoom[] {
  const joinedIds = new Set(joined.map(room => room.id));
  const unique = new Map([...joined, ...rooms].map(room => [room.id, room]));
  return [...unique.values()].map(room => {
    let visit: PilotVisit | null = null;
    try { visit = parsePilotVisit(read(visitKey(room.id))); } catch { /* Public discovery still works without storage. */ }
    return { room, visit };
  }).filter(item => item.visit || joinedIds.has(item.room.id))
    .sort((a, b) => Number(!!b.visit) - Number(!!a.visit)).slice(0, 6);
}

export function roomHomeSummary({ room, visit }: HomeRoom, moments: PilotMoment[]) {
  const story = moments.filter(moment => moment.room_id === room.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id));
  const unseen = visit ? story.filter(moment => !visit.knownIds.includes(moment.id)) : [];
  const latest = unseen[0] ?? story[0];
  const selected = story.find(moment => moment.id === visit?.lastMomentId);
  const href = `/pilot?room=${encodeURIComponent(room.id)}`;
  let resumeHref = href;
  if (selected) {
    try {
      let tip = pilotPath(story, room.id, selected.id).at(-1);
      try { tip = readingPath(story, room.id, visit?.lastTipId ?? selected.id, selected.id).at(-1); } catch { /* Keep the valid saved scene when the old tip is unavailable. */ }
      if (tip) resumeHref += `&moment=${selected.id}&tip=${tip.id}`;
    } catch { /* An incomplete saved path opens the room instead of guessing a branch. */ }
  }
  return {
    latest, panel: latest ? pilotPanels(latest.panels)[0] : undefined,
    hasNew: unseen.length > 0,
    // A bounded response must not pretend to count the entire room.
    newCount: visit && story.length <= HOME_HISTORY_LIMIT ? unseen.length : undefined,
    latestHref: latest ? `${href}&moment=${latest.id}` : href,
    resumeHref,
  };
}
