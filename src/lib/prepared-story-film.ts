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
  images: ["opening", "greenhouse", story.leadEnding].flatMap(id => {
    const beat = story.beats.find(item => item.id === id)!;
    return beat.frames.map((frame, index) => ({
      frame,
      title: beat.title,
      authorId: beat.authorId,
      caption: beat.captions[index],
      src: `/film-demo/blade-runner-image-${frame}.webp`,
    }));
  }),
} as const;
