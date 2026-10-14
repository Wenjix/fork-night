import type { Moment, Panel, Project } from "../domain/types.ts";
import type { ArtAssetUrl } from "./art.ts";

type Frame = 0 | 1 | 2 | 3 | 4 | 5;
type StoryBeat = {
  id: string;
  parent: string | null;
  title: string;
  authorId: string;
  frames: readonly Frame[];
  captions: readonly string[];
  /** Another packaged sheet for this beat; defaults to the story's artwork. */
  artwork?: ArtAssetUrl;
};
export type FandomStory = {
  id: string;
  title: string;
  fandom: string;
  artStyle: string;
  description: string;
  question: string;
  artwork: ArtAssetUrl;
  visualStyles?: readonly { id: "anime" | "film"; label: string; artwork: ArtAssetUrl }[];
  leadEnding: string;
  alternateEnding: string;
  beats: readonly StoryBeat[];
  continuation: { title: string; caption: string };
};

/** Authored examples, not official scenes, live fandom activity or model output at runtime. */
export const FANDOM_STORIES: readonly FandomStory[] = [
  {
    id: "night-city-after-hours",
    title: "Night City After Hours",
    fandom: "Cyberpunk 2077 / Edgerunners",
    artStyle: "Anime cel shading",
    description: "The network goes quiet. Nika's paper ledger can reunite one family—or reconnect a whole neighborhood.",
    question: "One name, one door—or a street that remembers?",
    artwork: "/art/night-city-anime.webp",
    leadEnding: "one-door",
    alternateEnding: "street-remembers",
    beats: [
      { id: "opening", parent: null, title: "The network goes quiet", authorId: "sam", frames: [0, 1], captions: [
        "The network goes quiet, but Night City's lights stay on. At Nika's repair stall, a customer can no longer reach his sister.",
        "Nika opens her paper ledger. The city kept changing; she kept the names people asked her to remember.",
      ] },
      { id: "address", parent: "opening", title: "A name becomes an address", authorId: "priya", frames: [2], captions: [
        "Beside his sister's name is an old address. Nika copies it onto a slip: ‘Try one door before you give up on the whole city.’",
      ] },
      { id: "one-door", parent: "address", title: "One Name, One Door", authorId: "jules", frames: [3], captions: [
        "His sister opens the door. Nika waits on the landing, holding the book that brought one person home.",
      ] },
      { id: "radio", parent: "opening", title: "An older kind of network", authorId: "jules", frames: [4], captions: [
        "Kai brings an old radio to the stall. Nika's ledger becomes their call list: one neighbor answers, then another.",
      ] },
      { id: "street-remembers", parent: "radio", title: "The Street Remembers", authorId: "priya", frames: [5], captions: [
        "Under Nika's awning, neighbors share shelter and news. The ledger stays open so the next person can add a name.",
      ] },
    ],
    continuation: { title: "Another name in the ledger", caption: "Nika makes room for another name. This time, a neighbor writes the next entry herself." },
  },
  {
    id: "malfoy-hogwarts",
    title: "Malfoy, Rewritten",
    fandom: "Harry Potter · Female Draco AU",
    artStyle: "Anime + film style",
    description: "What if Draco were a girl from the start? The same Slytherin pride and rivalry with Harry—with choices that change her place in the story.",
    question: "Let Potter earn her trust—or choose a different kind of courage?",
    artwork: "/art/malfoy-anime.webp",
    visualStyles: [
      { id: "anime", label: "Anime", artwork: "/art/malfoy-anime.webp" },
      { id: "film", label: "Film style", artwork: "/art/malfoy-film.webp" },
    ],
    leadEnding: "unsent-owl",
    alternateEnding: "her-own-name",
    beats: [
      { id: "opening", parent: null, title: "Same name. Different story.", authorId: "priya", frames: [0, 1], captions: [
        "Draco Malfoy has been Harry's Slytherin rival since first year. In this story, she has always been a girl. ‘Still collecting admirers, Potter?’",
        "In fifth year, her father wants the names of Harry's secret student meetings. The green-sealed letter in her hand turns their rivalry into a choice.",
      ] },
      { id: "unopened", parent: "opening", title: "He gives it back unopened", authorId: "sam", frames: [2], captions: [
        "Harry finds her letter and returns it unopened. ‘I'd rather hear your answer than your father's.’ For once, she cannot dismiss him with a clever reply.",
      ] },
      { id: "unsent-owl", parent: "unopened", title: "The owl leaves without a letter", authorId: "jules", frames: [3], captions: [
        "At the owlery, she keeps the letter in her pocket. The owl leaves without it. ‘Don't make me regret this, Potter.’ He stays; she lets him. Trust begins here.",
      ] },
      { id: "stand-beside", parent: "opening", title: "She stands beside Hermione", authorId: "jules", frames: [4], captions: [
        "When Hermione is accused of organizing the meetings, Malfoy steps beside her. ‘Being a Malfoy doesn't make me right.’ Harry has promised her no reward.",
      ] },
      { id: "her-own-name", parent: "stand-beside", title: "Under her own name", authorId: "sam", frames: [5], captions: [
        "She signs a statement clearing Hermione under her own name. ‘I was wrong about you.’ Hermione accepts the truth; forgiveness will take longer.",
      ] },
    ],
    continuation: { title: "Her next choice", caption: "At Hogwarts, Malfoy keeps making choices her father did not write for her. The rivalry remains; what she does with it is finally hers." },
  },
  {
    id: "blade-runner-memory",
    title: "Blade Runner: A Memory of Rain",
    fandom: "Blade Runner",
    artStyle: "Cinematic photographic noir",
    description: "A replicant, an old memory capsule, and a detective who must decide who gets to own a life.",
    question: "Follow a memory's living trace—or free it from its owner?",
    artwork: "/art/blade-runner-cinema.webp",
    leadEnding: "something-living",
    alternateEnding: "no-owner",
    beats: [
      { id: "opening", parent: null, title: "A memory for sale", authorId: "jules", frames: [0, 1], captions: [
        "In a Los Angeles memory shop, Mara finds the sound of rain she remembers from a childhood the records say never happened.",
        "A glass capsule holds the memory. Detective Vale calls it evidence. Mara calls it the only thing she has kept.",
      ] },
      { id: "greenhouse", parent: "opening", title: "Follow the rain", authorId: "priya", frames: [2], captions: [
        "Mara follows the recording to a greenhouse above the city. Vale comes with her, leaving his questions at the door.",
      ] },
      { id: "something-living", parent: "greenhouse", title: "Something living remained", authorId: "sam", frames: [3], captions: [
        "Beside an empty child's chair, a seedling survives. There is no proof the memory was hers—only something living because someone cared.",
      ] },
      { id: "archive", parent: "opening", title: "Erase the owner, not the memory", authorId: "sam", frames: [4], captions: [
        "Mara removes the archive's ownership index. The capsules stay intact. A memory can belong to a person without belonging to a company.",
      ] },
      { id: "no-owner", parent: "archive", title: "No one owns this morning", authorId: "priya", frames: [5], captions: [
        "Vale closes the file. Mara watches the rain without selling it, proving it, or asking permission to remember.",
      ] },
      // The four Hunyuan v3.5 references behind the prepared film, laid out as their own fork.
      { id: "film-scene-1", parent: "opening", title: "Scene 1 · Memory shop", authorId: "jules", artwork: "/art/blade-runner-film.webp", frames: [0], captions: [
        "In a Los Angeles memory shop, Mara finds the sound of rain she remembers from a childhood the records say never happened.",
      ] },
      { id: "film-scene-2", parent: "film-scene-1", title: "Scene 2 · The capsule", authorId: "jules", artwork: "/art/blade-runner-film.webp", frames: [1], captions: [
        "A glass capsule holds the memory. Detective Vale calls it evidence. Mara calls it the only thing she has kept.",
      ] },
      { id: "film-scene-3", parent: "film-scene-2", title: "Scene 3 · Greenhouse", authorId: "priya", artwork: "/art/blade-runner-film.webp", frames: [2], captions: [
        "Mara follows the recording to a greenhouse above the city. Vale comes with her, leaving his questions at the door.",
      ] },
      { id: "film-scene-4", parent: "film-scene-3", title: "Scene 4 · A seedling", authorId: "sam", artwork: "/art/blade-runner-film.webp", frames: [3], captions: [
        "Beside an empty child's chair, a seedling survives. There is no proof the memory was hers—only something living because someone cared.",
      ] },
    ],
    continuation: { title: "The next morning is hers", caption: "Mara carries the memory into another morning. Vale lets her choose which part becomes the beginning of her own story." },
  },
];

/** Preserve the earlier prepared reunion and any saved work at its direct route. */
export const ARCHIVED_FANDOM_STORIES: readonly FandomStory[] = [
  {
    id: "malfoid-unsent-owl",
    title: "Malfoid: The Unsent Owl",
    fandom: "Harry Potter · Female Draco AU",
    artStyle: "Watercolor scene studies",
    description: "An adult Hogwarts reunion. Female Draco's old rivalry with Harry meets a family demand she must answer for herself.",
    question: "Let Potter earn her trust—or choose a different kind of courage?",
    artwork: "/art/malfoid-watercolor.webp",
    leadEnding: "unsent-owl",
    alternateEnding: "her-own-name",
    beats: [
      { id: "opening", parent: null, title: "Still rescuing everyone, Potter?", authorId: "priya", frames: [0, 1], captions: [
        "Years after Hogwarts, Malfoy greets Harry with the same sharp smile: ‘Still rescuing everyone, Potter?’ Behind her book is a letter from her father.",
        "The sealed letter slips from her book. Harry catches it before the other guests notice. For once, she has no clever reply.",
      ] },
      { id: "unopened", parent: "opening", title: "He gives it back unopened", authorId: "sam", frames: [2], captions: [
        "Harry returns the letter unopened. ‘You get to choose what you do with it.’ Her father's demand for names stays hers to answer.",
      ] },
      { id: "unsent-owl", parent: "unopened", title: "The owl leaves without a letter", authorId: "jules", frames: [3], captions: [
        "At the owlery, Malfoy tears up the accusation list. ‘If this goes wrong, Potter, I'm blaming you.’ He stays beside her, and she lets him.",
      ] },
      { id: "stand-beside", parent: "opening", title: "She stands beside Hermione", authorId: "jules", frames: [4], captions: [
        "When her family's accusation reaches Hermione, Malfoy steps beside her. Harry has promised no forgiveness; she chooses to speak anyway.",
      ] },
      { id: "her-own-name", parent: "stand-beside", title: "Under her own name", authorId: "sam", frames: [5], captions: [
        "‘I was wrong about you,’ Malfoy tells Hermione. She signs the truth under her own name. Hermione accepts the statement; trust will take longer.",
      ] },
    ],
    continuation: { title: "An answer of her own", caption: "At their next meeting, Malfoy speaks for herself instead of borrowing her family's answer. A difficult choice becomes the beginning of another." },
  },
];

const retiredExamples = new Set(["midnight-signal", "paper-moon", "paper-forest", "cloud-garden", "midnight-bakery", "malfoid-unsent-owl"]);
const featuredOrder = [...FANDOM_STORIES.map(story => story.id), "moon-bus"];

export function fandomStory(projectId: string): FandomStory | undefined {
  return FANDOM_STORIES.find(story => story.id === projectId)
    ?? ARCHIVED_FANDOM_STORIES.find(story => story.id === projectId);
}

/** Curate examples without deleting old work or suppressing newly authored public projects. */
export function showcaseProjects(projects: readonly Project[]): Project[] {
  const rank = (id: string) => { const index = featuredOrder.indexOf(id); return index < 0 ? featuredOrder.length : index; };
  return projects.filter(project => !retiredExamples.has(project.id)).sort((a, b) => rank(a.id) - rank(b.id));
}

export function storyStyleLabel(projectId: string): string | undefined {
  return fandomStory(projectId)?.artStyle ?? (projectId === "moon-bus" ? "Gouache illustration" : undefined);
}

/** Reuse the selected illustration honestly; no live generation or arbitrary new world. */
export function preparedFandomContinuation(projectId: string, parent: Moment): { title: string; panels: Panel[] } | undefined {
  const story = fandomStory(projectId);
  if (!story) return undefined;
  return { title: story.continuation.title, panels: [{ imageUrl: parent.panels.at(-1)!.imageUrl, caption: story.continuation.caption }] };
}
