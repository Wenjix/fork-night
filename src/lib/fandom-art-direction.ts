import type { Panel } from "../domain/types.ts";
import { artAssetUrl, isApprovedArtUrl } from "./art.ts";
import { FANDOM_STORIES, fandomStory } from "./fandom-stories.ts";

export const ART_DIRECTIONS_STORAGE_KEY = "fork-night.art-directions.v1";
export type ArtDirections = Record<string, "anime" | "film">;

export function fandomVisualStyle(projectId: string, styleId?: string) {
  const styles = fandomStory(projectId)?.visualStyles;
  return styles?.find(style => style.id === styleId) ?? styles?.[0];
}

/** Only known styles survive restoration; this preference contains no story or account data. */
export function restoreArtDirections(saved: unknown): ArtDirections {
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
  const result: ArtDirections = {};
  for (const story of FANDOM_STORIES) {
    const value = (saved as Record<string, unknown>)[story.id];
    if (story.visualStyles?.some(style => style.id === value))
      result[story.id] = value as "anime" | "film";
  }
  return result;
}

/** A prepared visual take changes the exact sheet, never the frame, caption or authored work. */
export function fandomImageInStyle(projectId: string, imageUrl: string, styleId?: string): string {
  const story = fandomStory(projectId);
  const style = fandomVisualStyle(projectId, styleId);
  if (!style || !isApprovedArtUrl(imageUrl)) return imageUrl;
  if (!story?.visualStyles?.some(item => item.artwork === artAssetUrl(imageUrl))) return imageUrl;
  return style.artwork + imageUrl.slice(imageUrl.indexOf("#"));
}

export function fandomMomentInStyle<T extends { panels: Panel[] }>(
  projectId: string, moment: T, styleId?: string,
): T {
  let changed = false;
  const panels = moment.panels.map(panel => {
    const imageUrl = fandomImageInStyle(projectId, panel.imageUrl, styleId);
    if (imageUrl === panel.imageUrl) return panel;
    changed = true;
    return { ...panel, imageUrl };
  });
  return changed ? { ...moment, panels } : moment;
}
