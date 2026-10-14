import { fandomStory } from "./fandom-stories.ts";

const story = fandomStory("blade-runner-memory")!;

/** A fixed, previously generated example; independent of browser-local story edits. */
export const BLADE_RUNNER_FILM = {
  projectId: story.id,
  title: story.title,
  ending: "Something living remained",
  provider: "GMI Cloud",
  imageModel: "Hunyuan v3.5",
  videoModel: "Wan 3.0",
  preparedOn: "2026-10-07",
  duration: 12,
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
