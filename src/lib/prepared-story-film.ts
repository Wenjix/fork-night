import type { BrandId } from "./brands.ts";
import { fandomStory } from "./fandom-stories.ts";

const story = fandomStory("blade-runner-memory")!;
/** Which registered brand draws each model and the provider, so the film page can show them as badges beside the same words. */
const BRANDS_USED = { imageModel: "hunyuan", videoModel: "wan", provider: "gmi" } as const satisfies Record<string, BrandId>;

/** A fixed, previously generated example; independent of browser-local story edits. */
export const BLADE_RUNNER_FILM = {
  projectId: story.id,
  title: story.title,
  ending: "Something living remained",
  provider: "GMI Cloud",
  imageModel: "Hunyuan v3.5",
  videoModel: "Wan 3.0",
  brands: BRANDS_USED,
  preparedOn: "2026-10-07",
  preparedOnLabel: "October 7, 2026",
  duration: 12,
  heading: "Four images. One film.",
  /** Scenes on the path this film follows, and how the room and film page describe them. */
  pathScenes: 4,
  invite: "Four images become a short film. A prepared example, ready to play.",
  sourcesHeading: "The source images",
  intro: "Follow Mara from the memory shop to the greenhouse, then watch these exact images become a 12-second motion clip.",
  videoLabel: "Blade Runner: A Memory of Rain, prepared motion example",
  downloadName: "fork-night-memory-of-rain.mp4",
  disclosure: "Unofficial fan story with original fictional characters. Authored sample collaboration; AI-generated images and motion.",
  video: "/film-demo/blade-runner-wan.mp4",
  poster: "/film-demo/blade-runner-poster.webp",
  captions: "/film-demo/blade-runner-captions.vtt",
  /** The last scene of the fork that lays out these four images; it leads into this film. */
  lastSceneId: `${story.id}-film-scene-4`,
  // The film-scene fork lays out these exact references, so the map and the film share titles.
  images: [1, 2, 3, 4].map((scene, index) => {
    const beat = story.beats.find(item => item.id === `film-scene-${scene}`)!;
    return {
      frame: index,
      title: beat.title,
      authorId: beat.authorId,
      caption: beat.captions[0],
      src: `/film-demo/blade-runner-image-${index}.webp`,
    };
  }),
} as const;

const nightShift = fandomStory("kessler-night-shift")!;
const nightBeat = (id: string) => nightShift.beats.find(beat => beat.id === id)!;

/** The Night Shift's lead path, all six scenes (Sam, Jules, Priya, Wren, Sam, Wren), as one prepared Wan 3.0 clip, made Oct 14, 2026. */
export const NIGHT_SHIFT_FILM = {
  projectId: nightShift.id,
  title: nightShift.title,
  ending: nightBeat("dawn-81").title,
  provider: "GMI Cloud",
  imageModel: "Hy-Image 3.5 preview",
  videoModel: "Wan 3.0",
  brands: BRANDS_USED,
  preparedOn: "2026-10-14",
  preparedOnLabel: "October 14, 2026",
  duration: 18,
  heading: "Six scenes. One night.",
  pathScenes: 6,
  invite: "Six scenes, one 18-second film. A prepared example, ready to play.",
  sourcesHeading: "The six scenes",
  intro: "Follow Mika through all six scenes, from the blackout up eighty-one floors to Mrs. Ito's window, then watch these exact images become an 18-second anime clip, one shot per scene.",
  videoLabel: "Kessler Ward, prepared motion example",
  downloadName: "fork-night-kessler-ward.mp4",
  disclosure: "Original story and characters. Authored sample collaboration between people and Wren, an AI agent; AI-generated images and motion.",
  video: "/film-demo/night-shift-wan6.mp4",
  poster: "/film-demo/night-shift-poster.webp",
  captions: "/film-demo/night-shift-captions.vtt",
  /** The lead ending; selecting it offers the film. */
  lastSceneId: `${nightShift.id}-${nightShift.leadEnding}`,
  images: ([["opening", 0], ["stairs", 0], ["floor-forty", 0], ["every-door", 0], ["chain", 0], ["dawn-81", 0]] as const).map(([id, panel], index) => {
    const beat = nightBeat(id);
    return { frame: index, title: beat.title, authorId: beat.authorId, caption: beat.captions[panel], src: `/film-demo/night-shift-image-${index}.webp` };
  }),
} as const;

export type PreparedFilm = typeof BLADE_RUNNER_FILM | typeof NIGHT_SHIFT_FILM;

/** Prepared films by story; a story listed here offers Images → video. */
export const PREPARED_FILMS: Readonly<Record<string, PreparedFilm>> = {
  [BLADE_RUNNER_FILM.projectId]: BLADE_RUNNER_FILM,
  [NIGHT_SHIFT_FILM.projectId]: NIGHT_SHIFT_FILM,
};
