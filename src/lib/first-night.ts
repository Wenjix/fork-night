import { isUuid, pilotPanels, type PilotMoment, type PilotRoom } from "./pilot.ts";

export const FIRST_NIGHT_ROOM_ID = "paper-moon";
export const FIRST_NIGHT_MOMENT_ID = "10000000-0000-4000-8000-000000000002";
export const FIRST_NIGHT_STARTERS = [
  { id: "follow-window", label: "Step through a window", prompt: "One window shows a tomorrow where the paper moon has vanished. Someone decides to step through and find it." },
  { id: "unfold-moon", label: "Unfold the paper moon", prompt: "A corner of the paper moon comes loose. Inside its folds, someone discovers a message meant for the whole street." },
  { id: "own", label: "Bring your own idea", prompt: "" },
] as const;

export type FirstNightStep = 1 | 2 | 3;
export type FirstNightResult = { kind: "idea" | "moment"; id: string; parentId?: string };
export type FirstNightStory = {
  title: string;
  description: string;
  moment: PilotMoment;
  panels: ReturnType<typeof pilotPanels>;
};

export function firstNightRoomHref(starterId?: string | null) {
  const params = new URLSearchParams({ room: FIRST_NIGHT_ROOM_ID, moment: FIRST_NIGHT_MOMENT_ID });
  if (FIRST_NIGHT_STARTERS.some(starter => starter.id === starterId)) {
    params.set("firstNight", "1"); params.set("starter", starterId!);
  }
  return `/pilot?${params}`;
}

/** Only public, predefined creative suggestions travel through a share link. */
export function parseFirstNightStarter(search: string) {
  const params = new URLSearchParams(search);
  if (["room", "moment", "firstNight", "starter"].some(key => params.getAll(key).length > 1) ||
    params.get("room") !== FIRST_NIGHT_ROOM_ID || params.get("moment") !== FIRST_NIGHT_MOMENT_ID || params.get("firstNight") !== "1") return null;
  const starterId = params.get("starter");
  const starter = FIRST_NIGHT_STARTERS.find(item => item.id === starterId);
  if (!starter) return null;
  return {
    roomId: FIRST_NIGHT_ROOM_ID,
    momentId: FIRST_NIGHT_MOMENT_ID,
    starterId: starter.id,
    prompt: starter.prompt,
  };
}

export function stripFirstNightParams(search: string) {
  const params = new URLSearchParams(search);
  params.delete("firstNight"); params.delete("starter");
  const remaining = params.toString();
  return remaining ? `?${remaining}` : "";
}

/** The invitation uses the published opening, independently of room templates. */
export function firstNightStoryFromRows(room: PilotRoom | null, moment: PilotMoment | null): FirstNightStory | null {
  if (!room || room.id !== FIRST_NIGHT_ROOM_ID || !room.is_open || typeof room.title !== "string" || !room.title.trim() || typeof room.description !== "string" ||
    !moment || moment.id !== FIRST_NIGHT_MOMENT_ID || moment.room_id !== room.id || moment.parent_id !== null || typeof moment.title !== "string" || !moment.title.trim()) return null;
  try {
    const panels = pilotPanels(moment.panels);
    if (panels.some(panel => !panel.caption.trim())) return null;
    return { title: room.title, description: room.description, moment, panels };
  } catch { return null; }
}

const STORAGE_PREFIX = "fork-night:first-night:v1:";
export const FIRST_NIGHT_PREFERENCES_KEY = `${STORAGE_PREFIX}preferences`;
export const FIRST_NIGHT_CHANGE_EVENT = "fork-night:first-night:change";
type Preferences = { version: 1; hidden: boolean; expanded: boolean };
type Progress = { version: 1; roomId: string; actorId: string | null; entered: true; result?: FirstNightResult };
const defaultPreferences: Preferences = { version: 1, hidden: false, expanded: false };
const fallbackByBrowser = new WeakMap<object, Map<string, string>>();
const validRoom = (roomId: unknown): roomId is string => typeof roomId === "string" && /^[a-z0-9-]{1,60}$/.test(roomId);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

export function firstNightProgressKey(roomId: string, actorId: string | null) {
  return `${STORAGE_PREFIX}progress:${roomId}:${actorId ?? "visitor"}`;
}

function fallback() {
  if (typeof window === "undefined") return undefined;
  let values = fallbackByBrowser.get(window);
  if (!values) { values = new Map(); fallbackByBrowser.set(window, values); }
  return values;
}

function read(key: string): unknown {
  if (typeof window === "undefined") return null;
  try {
    const raw = fallback()?.get(key) ?? window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function write(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  const raw = JSON.stringify(value);
  try { window.localStorage.setItem(key, raw); fallback()?.delete(key); }
  catch { fallback()?.set(key, raw); }
  window.dispatchEvent(new Event(FIRST_NIGHT_CHANGE_EVENT));
}

function preferences(): Preferences {
  const value = read(FIRST_NIGHT_PREFERENCES_KEY);
  return object(value) && value.version === 1 && typeof value.hidden === "boolean" && typeof value.expanded === "boolean"
    ? { version: 1, hidden: value.hidden, expanded: value.expanded } : defaultPreferences;
}

function progress(roomId: string, actorId: string | null): Progress | null {
  if (!validRoom(roomId) || actorId !== null && !isUuid(actorId)) return null;
  const value = read(firstNightProgressKey(roomId, actorId));
  if (!object(value) || value.version !== 1 || value.roomId !== roomId || value.actorId !== actorId || value.entered !== true) return null;
  if (value.result !== undefined && (!actorId || !validResult(value.result))) return null;
  const result = value.result as FirstNightResult | undefined;
  return { version: 1, roomId, actorId, entered: true, ...(result ? { result: { kind: result.kind, id: result.id, ...(result.parentId ? { parentId: result.parentId } : {}) } } : {}) };
}

function validResult(value: unknown): value is FirstNightResult {
  return object(value) && (value.kind === "idea" || value.kind === "moment") && isUuid(value.id) &&
    (value.parentId === undefined || isUuid(value.parentId));
}

export function readFirstNightJourney(roomId = FIRST_NIGHT_ROOM_ID, actorId: string | null = null) {
  const saved = progress(roomId, actorId);
  const prefs = preferences();
  return { step: (saved?.result ? 3 : saved ? 2 : 1) as FirstNightStep, result: saved?.result ?? null, hidden: prefs.hidden, expanded: prefs.expanded };
}

export function setFirstNightPreferences(patch: Partial<Pick<Preferences, "hidden" | "expanded">>) {
  const current = preferences();
  const next: Preferences = {
    version: 1,
    hidden: typeof patch.hidden === "boolean" ? patch.hidden : current.hidden,
    expanded: typeof patch.expanded === "boolean" ? patch.expanded : current.expanded,
  };
  if (next.hidden !== current.hidden || next.expanded !== current.expanded) write(FIRST_NIGHT_PREFERENCES_KEY, next);
}

export function recordFirstNightEntry(roomId: string, actorId: string | null) {
  if (!validRoom(roomId) || actorId !== null && !isUuid(actorId) || progress(roomId, actorId)) return;
  write(firstNightProgressKey(roomId, actorId), { version: 1, roomId, actorId, entered: true } satisfies Progress);
}

/** Call only after the server confirms a public idea or deliberate publication. */
export function recordFirstNightResult(input: { roomId: string; actorId: string } & FirstNightResult) {
  if (!validRoom(input.roomId) || !isUuid(input.actorId) || !validResult(input)) return;
  const result: FirstNightResult = { kind: input.kind, id: input.id, ...(input.parentId ? { parentId: input.parentId } : {}) };
  const current = progress(input.roomId, input.actorId);
  if (current?.result?.kind === result.kind && current.result.id === result.id && current.result.parentId === result.parentId) return;
  write(firstNightProgressKey(input.roomId, input.actorId), { version: 1, roomId: input.roomId, actorId: input.actorId, entered: true, result } satisfies Progress);
}

export function subscribeFirstNightJourney(listener: () => void) {
  if (typeof window === "undefined") return () => {};
  const browser = window;
  const changed = (event: Event) => {
    if (event.type === "storage") {
      const key = (event as StorageEvent).key;
      if (key !== null && !key.startsWith(STORAGE_PREFIX)) return;
      if (key) fallback()?.delete(key); else fallback()?.clear();
    }
    listener();
  };
  browser.addEventListener(FIRST_NIGHT_CHANGE_EVENT, changed);
  browser.addEventListener("storage", changed);
  return () => {
    browser.removeEventListener(FIRST_NIGHT_CHANGE_EVENT, changed);
    browser.removeEventListener("storage", changed);
  };
}
