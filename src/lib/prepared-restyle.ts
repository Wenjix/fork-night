import type { Panel } from "../domain/types.ts";
import { fandomStory } from "./fandom-stories.ts";

const story = fandomStory("blade-runner-memory")!;
const SOURCE = story.artwork;
const RESTYLED = "/art/blade-runner-anime.webp";

/**
 * A prepared restyle of the archive fork. The three anime frames were generated on Oct 13, 2026 with
 * Hy-Image 3.5 preview through GMI Cloud, using the original frames as reference images. Replaying them
 * makes no provider request; captions, credits and the story tree never change.
 */
export const BLADE_RUNNER_RESTYLE = {
  projectId: story.id,
  style: "Anime",
  model: "Hy-Image 3.5 preview",
  provider: "GMI Cloud",
  preparedOn: "2026-10-13",
  /** Selecting either moment of the archive fork offers the restyle. */
  momentIds: [`${story.id}-archive`, `${story.id}-no-owner`],
  /** The path's three illustrated scenes: the opening's first frame, then each fork moment. */
  frames: [
    { frame: 0, momentId: `${story.id}-opening` },
    { frame: 4, momentId: `${story.id}-archive` },
    { frame: 5, momentId: `${story.id}-no-owner` },
  ],
  source: SOURCE,
  restyled: RESTYLED,
} as const;

const restyledFrames = new Set<number>(BLADE_RUNNER_RESTYLE.frames.map(item => item.frame));

export function restyledImage(imageUrl: string): string {
  const match = /^(.+)#frame=([0-5])$/.exec(imageUrl);
  if (!match || match[1] !== SOURCE || !restyledFrames.has(Number(match[2]))) return imageUrl;
  return `${RESTYLED}#frame=${match[2]}`;
}

export function restyledMoment<T extends { projectId: string; panels: Panel[] }>(moment: T): T {
  if (moment.projectId !== BLADE_RUNNER_RESTYLE.projectId) return moment;
  const panels = moment.panels.map(panel => ({ ...panel, imageUrl: restyledImage(panel.imageUrl) }));
  return panels.some((panel, index) => panel.imageUrl !== moment.panels[index].imageUrl) ? { ...moment, panels } : moment;
}
