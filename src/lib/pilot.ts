import type { Json, Tables } from "./supabase/database.types.ts";
import { isApprovedArtUrl } from "./art.ts";
import { MAX_PILOT_PANELS } from "./pilot-format.ts";

export type PilotMoment = Tables<"pilot_moments">;
export type PilotOperation = Tables<"pilot_operations">;
export type PilotRoom = Tables<"pilot_rooms">;
export type PilotPanel = {
  caption: string;
  imageUrl?: string;
  imagePath?: string;
  sha256?: string;
};
export const isUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
    value,
  );

export function pilotPanels(raw: Json | null): PilotPanel[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_PILOT_PANELS)
    throw new Error("This moment does not have a complete saved sequence.");
  return raw.map((panel) => {
    if (
      !panel ||
      typeof panel !== "object" ||
      Array.isArray(panel) ||
      typeof panel.caption !== "string"
    )
      throw new Error("A panel is incomplete.");
    if (isApprovedArtUrl(panel.imageUrl))
      return { caption: panel.caption, imageUrl: panel.imageUrl };
    if (
      typeof panel.imagePath === "string" &&
      /^[a-f0-9-]{36}\/[123]\.webp$/.test(panel.imagePath) &&
      typeof panel.sha256 === "string" &&
      /^[a-f0-9]{64}$/.test(panel.sha256)
    )
      return {
        caption: panel.caption,
        imagePath: panel.imagePath,
        sha256: panel.sha256,
      };
    throw new Error("The saved panel image is unavailable.");
  });
}

export function pilotPath(
  moments: PilotMoment[],
  roomId: string,
  selectedId: string,
): PilotMoment[] {
  const path: PilotMoment[] = [],
    seen = new Set<string>();
  let id: string | null = selectedId;
  while (id) {
    if (seen.has(id) || path.length >= 13)
      throw new Error("This story path is invalid or too long.");
    const moment = moments.find(
      (item) => item.id === id && item.room_id === roomId,
    );
    if (!moment)
      throw new Error(
        "Part of this story is unavailable. Reconnect and try again.",
      );
    seen.add(id);
    path.unshift(moment);
    id = moment.parent_id;
  }
  return path;
}

export function pilotContext(path: PilotMoment[]) {
  // Every selected ancestor is included, in order; no siblings or later moments.
  return path
    .map(
      (moment, index) =>
        `${index + 1}. ${moment.title.slice(0, 60)}: ${pilotPanels(
          moment.panels,
        )
          .map((panel) => panel.caption.slice(0, 100))
          .join(" ")}`,
    )
    .join("\n");
}
