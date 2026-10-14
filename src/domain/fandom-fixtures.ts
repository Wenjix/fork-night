import { ARCHIVED_FANDOM_STORIES, FANDOM_STORIES } from "../lib/fandom-stories.ts";
import { validateDemoState } from "./validation.ts";
import { DEMO_UNIT } from "./money.ts";
import type { FandomStory } from "../lib/fandom-stories.ts";
import type { DemoState, Moment } from "./types.ts";

type Beat = FandomStory["beats"][number];

function fixtureMoment(story: FandomStory, beat: Beat, publishedAt: number): Moment {
  const artwork = beat.artwork ?? story.artwork;
  const panels = beat.frames.map((frame, panelIndex) => ({ imageUrl: `${artwork}#frame=${frame}`, caption: beat.captions[panelIndex] }));
  return {
    id: `${story.id}-${beat.id}`,
    projectId: story.id,
    parentId: beat.parent === null ? null : `${story.id}-${beat.parent}`,
    title: beat.title,
    authorId: beat.authorId,
    beneficiaryId: beat.authorId,
    panels,
    storyContext: panels.map(panel => panel.caption).join(" "),
    version: 1,
    reuseFee: DEMO_UNIT,
    termsVersion: "open-finished-work-v1",
    publishedAt,
    source: "fixture",
  };
}

/** Beats a saved story lacks, in order, whose parent is saved or added before them. */
function newBeats(state: DemoState, story: FandomStory) {
  const known = new Set(state.moments.filter(moment => moment.projectId === story.id).map(moment => moment.id));
  const added: { story: FandomStory; beat: Beat; index: number }[] = [];
  for (const [index, beat] of story.beats.entries()) {
    const id = `${story.id}-${beat.id}`;
    if (known.has(id) || beat.parent === null || !known.has(`${story.id}-${beat.parent}`)) continue;
    if (state.moments.some(moment => moment.id === id)) continue;
    known.add(id);
    added.push({ story, beat, index });
  }
  return added;
}

/** Add complete examples to fresh/restored saves without rewriting a user's existing story. */
export function extendFandomDemo(state: DemoState): DemoState {
  validateDemoState(state);
  const stories = [...FANDOM_STORIES, ...ARCHIVED_FANDOM_STORIES];
  const missing = stories.filter(story => !state.projects.some(project => project.id === story.id));
  const added = stories.filter(story => !missing.includes(story)).flatMap(story => newBeats(state, story));
  if (!missing.length && !added.length) return state;
  const next = structuredClone(state);
  const startedAt = Date.UTC(2026, 9, 7, 18);
  // Beats authored after a browser saved this story join it at their parent; saved moments stay untouched.
  for (const { story, beat, index } of added) next.moments.push(fixtureMoment(story, beat, startedAt + index * 60_000));
  for (const story of missing) {
    if (story.beats.some(beat => next.moments.some(moment => moment.id === `${story.id}-${beat.id}`))) {
      throw new Error("A prepared story conflicts with a saved moment. Your saved work has not been overwritten.");
    }
    next.projects.push({
      id: story.id,
      title: story.title,
      description: story.description,
      creatorId: story.beats[0].authorId,
      visibility: "open",
      groupId: null,
      seedId: `${story.id}-opening`,
      termsVersion: "open-finished-work-v1",
      coverUrl: `${story.artwork}#frame=0`,
    });
    for (const [index, beat] of story.beats.entries()) next.moments.push(fixtureMoment(story, beat, startedAt + index * 60_000));
  }
  validateDemoState(next);
  return next;
}
