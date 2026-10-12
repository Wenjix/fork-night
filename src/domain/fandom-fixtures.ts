import { ARCHIVED_FANDOM_STORIES, FANDOM_STORIES } from "../lib/fandom-stories.ts";
import { validateDemoState } from "./validation.ts";
import type { DemoState, Moment } from "./types.ts";

/** Add complete examples to fresh/restored saves without rewriting a user's existing story. */
export function extendFandomDemo(state: DemoState): DemoState {
  validateDemoState(state);
  const missing = [...FANDOM_STORIES, ...ARCHIVED_FANDOM_STORIES].filter(story => !state.projects.some(project => project.id === story.id));
  if (!missing.length) return state;
  const next = structuredClone(state);
  const startedAt = Date.UTC(2026, 9, 7, 18);
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
    for (const [index, beat] of story.beats.entries()) {
      const panels = beat.frames.map((frame, panelIndex) => ({ imageUrl: `${story.artwork}#frame=${frame}`, caption: beat.captions[panelIndex] }));
      const moment: Moment = {
        id: `${story.id}-${beat.id}`,
        projectId: story.id,
        parentId: beat.parent === null ? null : `${story.id}-${beat.parent}`,
        title: beat.title,
        authorId: beat.authorId,
        beneficiaryId: beat.authorId,
        panels,
        storyContext: panels.map(panel => panel.caption).join(" "),
        version: 1,
        reuseFee: 30_000,
        termsVersion: "open-finished-work-v1",
        publishedAt: startedAt + index * 60_000,
        source: "fixture",
      };
      next.moments.push(moment);
    }
  }
  validateDemoState(next);
  return next;
}
