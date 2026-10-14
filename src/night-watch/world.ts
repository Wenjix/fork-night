import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pilotAdmin } from "../generation/client.ts";
import { pilotPath, type PilotMoment } from "../lib/pilot.ts";
import type { Database, Json } from "../lib/supabase/database.types.ts";
import { NIGHT_WATCH_ROOM, type WorldKitView, type WorldMoment, type WorldPanel, type WorldResponse } from "./api-types.ts";
import { NightWatchError } from "./http.ts";
import { listPublishedMoments, nightWatchWorldMoment } from "./publish.ts";
import { fileNightWatchStore, type NightWatchStore } from "./store.ts";
import { CURRENT_KIT, kitDigest, type WorldKit } from "./world-kit.ts";

/**
 * The world view behind GET /api/night-watch/world: the room, the pinned world kit, the story's
 * moments (the shared room's plus moments published here) and the room's test credits. Server only.
 */

/** The newest moment of the path already registered on Monad testnet; every ancestor is registered too. */
export const RELEASE_PATH_TIP = "a386d392-f289-4b4e-a901-d6cfd827edd5";
const MEDIA_BUCKET = "pilot-media";
const SIGNED_URL_SECONDS = 3_600;
const STORAGE_PATH = /^[a-f0-9-]{36}\/[123]\.webp$/;
const STORY_FRAME = /^\/art\/midnight-story\.webp#(?:frame|scene)=([0-5])$/;

export type RoomRow = { id: string; title: string; description: string };
export type RoomCredits = NonNullable<WorldResponse["credits"]>;

export type WorldSource = {
  room(): Promise<RoomRow | null>;
  moments(): Promise<PilotMoment[]>;
  credits(): Promise<RoomCredits | null>;
  /** Short-lived signed URLs for private storage paths; a path without one is left out. */
  signedUrls(paths: string[]): Promise<Map<string, string>>;
};

export type WorldDeps = { source: WorldSource; store: NightWatchStore };

/** The packaged story sheet's frames are served as PNG crops; other art is not served here. */
export function artFrameUrl(imageUrl: unknown): string | null {
  const match = typeof imageUrl === "string" ? STORY_FRAME.exec(imageUrl) : null;
  return match ? `/api/night-watch/art/${match[1]}` : null;
}

export function kitView(kit: WorldKit = CURRENT_KIT): WorldKitView {
  return {
    id: kit.id,
    version: kit.version,
    digest: kitDigest(kit),
    title: kit.title,
    creator: kit.creator,
    disclosure: kit.disclosure,
    lore: [...kit.lore],
    style: [...kit.style],
    rules: [...kit.rules],
    starters: [...kit.starters],
    participation: [...kit.participation],
    references: kit.references.map((reference) => ({ label: reference.label, imageUrl: artFrameUrl(reference.imageUrl) ?? reference.imageUrl })),
  };
}

function rawPanels(raw: Json | null): Record<string, unknown>[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[]).filter((panel): panel is Record<string, unknown> => !!panel && typeof panel === "object" && !Array.isArray(panel));
}

/** Private storage paths the moments' panels need signed URLs for. */
export function storagePaths(moments: PilotMoment[]): string[] {
  const paths = moments.flatMap((moment) =>
    rawPanels(moment.panels).flatMap((panel) => (typeof panel.imagePath === "string" && STORAGE_PATH.test(panel.imagePath) ? [panel.imagePath] : [])),
  );
  return [...new Set(paths)];
}

/** Panels as the page shows them. A panel whose image cannot be shown keeps its caption with no image. */
export function worldPanels(raw: Json | null, signed: Map<string, string>): WorldPanel[] {
  return rawPanels(raw).map((panel) => {
    const imageUrl =
      typeof panel.imageUrl === "string"
        ? artFrameUrl(panel.imageUrl)
        : typeof panel.imagePath === "string" && STORAGE_PATH.test(panel.imagePath)
          ? signed.get(panel.imagePath) ?? null
          : null;
    return {
      caption: typeof panel.caption === "string" ? panel.caption : "",
      imageUrl,
      sha256: typeof panel.sha256 === "string" && /^[a-f0-9]{64}$/.test(panel.sha256) ? panel.sha256 : null,
    };
  });
}

export function pilotWorldMoment(moment: PilotMoment, signed: Map<string, string>): WorldMoment {
  return {
    id: moment.id,
    parentId: moment.parent_id,
    makerId: moment.maker_id,
    makerLabel: moment.maker_label,
    title: moment.title,
    panels: worldPanels(moment.panels, signed),
    createdAt: moment.created_at,
    source: "pilot",
    nightWatch: null,
  };
}

const time = (value: string) => {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

function newest<T extends { created_at: string }>(items: T[]): T | null {
  return items.reduce<T | null>((best, item) => (!best || time(item.created_at) >= time(best.created_at) ? item : best), null);
}

/** The default fork point: the registered release path's tip when the room has it, else the newest moment. */
export function defaultForkPoint(moments: PilotMoment[]): string {
  if (moments.some((moment) => moment.id === RELEASE_PATH_TIP)) return RELEASE_PATH_TIP;
  return newest(moments)?.id ?? "";
}

/** The newest moment on the path to `tipId` by a maker other than the room starter and the viewer. */
export function friendContribution(moments: PilotMoment[], tipId: string, viewerId: string | null): WorldResponse["friendContribution"] {
  let path: PilotMoment[];
  try {
    path = tipId ? pilotPath(moments, NIGHT_WATCH_ROOM, tipId) : [];
  } catch {
    return null;
  }
  const friend = newest(path.filter((moment) => moment.maker_id !== null && moment.maker_id !== viewerId));
  return friend ? { momentId: friend.id, makerLabel: friend.maker_label } : null;
}

export async function readWorld(deps: WorldDeps, options: { viewerId?: string | null } = {}): Promise<WorldResponse> {
  const [room, pilot, credits, published] = await Promise.all([
    deps.source.room(),
    deps.source.moments(),
    deps.source.credits().catch(() => null),
    listPublishedMoments(deps.store),
  ]);
  if (!room) throw new NightWatchError(503, "room_unavailable", "The Midnight Signal room could not be read right now.");
  const roomMoments = pilot.filter((moment) => moment.room_id === NIGHT_WATCH_ROOM);
  const signed = await deps.source.signedUrls(storagePaths(roomMoments)).catch(() => new Map<string, string>());
  const moments = [...roomMoments.map((moment) => pilotWorldMoment(moment, signed)), ...published.map(nightWatchWorldMoment)].sort(
    (a, b) => time(a.createdAt) - time(b.createdAt),
  );
  const defaultForkPointId = defaultForkPoint(roomMoments);
  return {
    room: { id: room.id, title: room.title, description: room.description },
    kit: kitView(),
    moments,
    friendContribution: friendContribution(roomMoments, defaultForkPointId, options.viewerId ?? null),
    defaultForkPointId,
    credits,
  };
}

function parseCredits(value: unknown): RoomCredits | null {
  const record = value as Record<string, unknown> | null;
  if (!record || typeof record !== "object") return null;
  const numbers = ["limit", "used", "reserved", "available"].map((key) => record[key]);
  if (!numbers.every((item) => typeof item === "number" && Number.isFinite(item)) || typeof record.enabled !== "boolean") return null;
  const [limit, used, reserved, available] = numbers as number[];
  return { limit, used, reserved, available, enabled: record.enabled };
}

/** The room's moments, read with the service role (the room is public; this skips the browser client). */
export async function readPilotMoments(admin: SupabaseClient<Database> = pilotAdmin()): Promise<PilotMoment[]> {
  const { data, error } = await admin.from("pilot_moments").select("*").eq("room_id", NIGHT_WATCH_ROOM).order("created_at", { ascending: true }).limit(500);
  if (error || !data) throw new NightWatchError(503, "moments_unavailable", "The Midnight Signal story could not be read right now.");
  return data;
}

export function supabaseWorldSource(admin: SupabaseClient<Database> = pilotAdmin()): WorldSource {
  return {
    async room() {
      const { data, error } = await admin.from("pilot_rooms").select("id,title,description").eq("id", NIGHT_WATCH_ROOM).maybeSingle();
      if (error) throw new NightWatchError(503, "room_unavailable", "The Midnight Signal room could not be read right now.");
      return data;
    },
    moments: () => readPilotMoments(admin),
    async credits() {
      const { data, error } = await admin.rpc("pilot_room_credits", { p_room_id: NIGHT_WATCH_ROOM });
      return error ? null : parseCredits(data);
    },
    async signedUrls(paths) {
      const urls = new Map<string, string>();
      if (!paths.length) return urls;
      const { data, error } = await admin.storage.from(MEDIA_BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS);
      if (error || !data) return urls;
      for (const item of data) if (item.path && item.signedUrl && !item.error) urls.set(item.path, item.signedUrl);
      return urls;
    },
  };
}

export function localWorldDeps(): WorldDeps {
  return { source: supabaseWorldSource(), store: fileNightWatchStore() };
}

const frames = new Map<string, Promise<Buffer>>();

async function cropFrame(frame: number, root: string): Promise<Buffer> {
  const { default: sharp } = await import("sharp");
  const sheet = await readFile(resolve(root, "public/art/midnight-story.webp"));
  const metadata = await sharp(sheet).metadata();
  const width = Math.floor(metadata.width! / 3);
  const height = Math.floor(metadata.height! / 2);
  // The same 3×2 crop the generation pipeline uses for a seed panel's reference image.
  return sharp(sheet)
    .extract({ left: (frame % 3) * width, top: Math.floor(frame / 3) * height, width, height })
    .png()
    .toBuffer();
}

/** One frame (0–5, row-major) of the packaged Midnight Signal sheet as PNG bytes. */
export function storyFrame(frame: number, root = process.cwd()): Promise<Buffer> {
  if (!Number.isInteger(frame) || frame < 0 || frame > 5) return Promise.reject(new NightWatchError(404, "not_found", "Not found."));
  const key = `${root}#${frame}`;
  let cached = frames.get(key);
  if (!cached) {
    cached = cropFrame(frame, root);
    frames.set(key, cached);
    cached.catch(() => frames.delete(key));
  }
  return cached;
}
