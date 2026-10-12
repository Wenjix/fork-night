export const CREATOR_REVIEW_KEY = "fork-night:creator-review:v1";
export const CREATOR_BIBLE = "Identity\nNika tells small stories about people keeping a neighborhood together.\n\nVoice\nWarm, observant and specific. Let small gestures carry the feeling.\n\nCreative rules\nA communications outage can leave lamps and buildings lit.\nThe paper ledger connects people; it is not a magic solution.\nInvite the audience to imagine what happens next.";
export const CREATOR_CANDIDATES = [
  { id: "reunion", title: "One Name, One Door", imageUrl: "/creator-demo/reunion.webp", status: "selected", caption: "An address in the ledger brings a brother to his sister’s door. Nika steps back and lets them find each other.", rationale: "A single relationship gives this short episode a clear emotional payoff." },
  { id: "neighborhood", title: "The Street Remembers", imageUrl: "/creator-demo/neighborhood.webp", status: "discarded", caption: "Neighbors bring their old radios to Nika’s stall. The ledger becomes a map of people who can help each other.", rationale: "The larger gathering needs more space. Keep this direction available for a later episode." },
] as const;
export type CandidateId = "reunion" | "neighborhood" | "soup" | "lamplit-room";
export type CreatorAgent = {
  id: "nika" | "sol"; name: string; avatar: string; role: string; description: string;
  bible: string; brief: string; compareTitle: string; selectedLabel: string; discardedLabel: string;
  scene: { title: string; imageUrl: string; caption: string };
  candidates: readonly { id: CandidateId; title: string; imageUrl: string; status: "selected" | "discarded"; caption: string; rationale: string }[];
  exampleFeedback: string; exampleLesson: string; nextDirection: string;
};
export const CREATOR_AGENTS: readonly CreatorAgent[] = [
  { id: "nika", name: "Nika", avatar: "/world-demo/nika.webp", role: "AI neighborhood storyteller", description: "Small gestures. Shared memories. People reconnecting.",
    bible: CREATOR_BIBLE, brief: "A short story about reconnecting during a communications outage.", compareTitle: "Two ways to bring the ledger to life.", selectedLabel: "Reunion selected", discardedLabel: "Gathering set aside",
    scene: { title: "The network goes quiet", imageUrl: "/world-demo/outcome-793decfde65591fd484505487052ac235ab1fd3819f30802ec48890ef0a9e6f0.webp", caption: "A communications outage sends Nika back to her paper ledger. Who can it help her reach?" },
    candidates: CREATOR_CANDIDATES, exampleFeedback: "Keep the reunion, but give the sister a part in making it happen. She should have a choice or an action of her own.", exampleLesson: "Give the people Nika helps a choice or an action of their own.", nextDirection: "Continue the reunion at the sister’s door. Keep the paper ledger and the quiet neighborhood tone." },
  { id: "sol", name: "Sol", avatar: "/world-demo/sol.webp", role: "AI after-hours food creator", description: "Late suppers. Quiet company. A place at the table.",
    bible: "Identity\nSol tells after-hours stories about food, care and places to gather.\n\nVoice\nCalm, generous and concrete. Show the act of cooking, not a grand speech.\n\nCreative rules\nLet food bring people together without solving every problem.\nGive the guest a choice about staying.\nKeep the invitation warm and low-pressure.",
    brief: "A short after-hours story about making space for someone who arrives late.", compareTitle: "Two ways to leave room for someone.", selectedLabel: "Supper selected", discardedLabel: "Empty room set aside",
    scene: { title: "One seat left", imageUrl: "/world-demo/guild.webp", caption: "The night room is quiet. There is still a place for someone to stay." },
    candidates: [
      { id: "soup", title: "Soup After Closing", imageUrl: "/world-demo/sol.webp", status: "selected", caption: "Sol keeps the pot warm after closing. One more supper becomes an invitation to stay.", rationale: "Cooking gives the invitation a visible action and lets the guest decide whether to join." },
      { id: "lamplit-room", title: "A Light Left On", imageUrl: "/world-demo/guild.webp", status: "discarded", caption: "A lamp, a quiet couch and a sleeping cat. The empty room waits for its next visitor.", rationale: "The setting carries the mood, but this episode needs a person doing something. Save the room as an opening for later." },
    ], exampleFeedback: "Keep the supper, but let the guest decide whether to stay. Make the invitation feel welcoming rather than obligatory.", exampleLesson: "Give each guest an easy way to accept or decline the invitation.", nextDirection: "Continue the late supper. Let the guest choose whether to stay, and carry the feeling through a small act of cooking." },
];
export function creatorReviewKey(agent: CreatorAgent): string { return agent.id === "nika" ? CREATOR_REVIEW_KEY : `fork-night:creator-review:${agent.id}:v1`; }
export type CreatorFeedback = { id: string; candidateId: CandidateId; text: string; createdAt: string };
export type BibleVersion = { number: number; text: string; createdAt: string; feedbackIds: string[] };
export type NextBrief = { id: string; bibleVersion: number; bibleText: string; feedbackIds: string[]; text: string; createdAt: string };
export type CreatorReviewState = { schema: 1; feedback: CreatorFeedback[]; versions: BibleVersion[]; briefs: NextBrief[] };
export const initialCreatorReview = (agent = CREATOR_AGENTS[0]): CreatorReviewState => ({ schema: 1, feedback: [], versions: [{ number: 1, text: agent.bible, createdAt: "2026-10-05T23:00:00Z", feedbackIds: [] }], briefs: [] });

export function addCreatorFeedback(state: CreatorReviewState, candidateId: CandidateId, text: string, id: string, createdAt: string, agent = CREATOR_AGENTS[0]): CreatorReviewState {
  if (!agent.candidates.some(candidate => candidate.id === candidateId) || !text.trim() || text.trim().length > 1000) throw new Error("Choose an ending and write feedback of up to 1,000 characters.");
  if (state.feedback.length >= 50) throw new Error("This example has 50 notes. Download your record before starting another example.");
  return { ...state, feedback: [...state.feedback, { id, candidateId, text: text.trim(), createdAt }] };
}
export function reviseCreatorBible(state: CreatorReviewState, text: string, createdAt: string): CreatorReviewState {
  const previous = state.versions.at(-1)!;
  if (!text.trim() || text.trim().length > 6000) throw new Error("Keep the bible between 1 and 6,000 characters.");
  if (text.trim() === previous.text) throw new Error("Make a change before saving a new bible version.");
  if (state.versions.length >= 20) throw new Error("This example has 20 bible versions. Download your record before starting another example.");
  return { ...state, versions: [...state.versions, { number: previous.number + 1, text: text.trim(), createdAt, feedbackIds: state.feedback.map(note => note.id) }] };
}
export function prepareCreatorBrief(state: CreatorReviewState, id: string, createdAt: string, agent = CREATOR_AGENTS[0]): CreatorReviewState {
  const bible = state.versions.at(-1)!;
  if (state.briefs.length >= 20) throw new Error("This example has 20 briefs. Download your record before preparing another.");
  const text = `${bible.text}\n\nNext story brief\n${agent.nextDirection}\n\nHuman feedback\n${state.feedback.map(note => `${agent.candidates.find(candidate => candidate.id === note.candidateId)!.title}: ${note.text}`).join("\n") || "No human feedback recorded."}`;
  return { ...state, briefs: [...state.briefs, { id, bibleVersion: bible.number, bibleText: bible.text, feedbackIds: state.feedback.map(note => note.id), text, createdAt }] };
}

/** Restored browser data must preserve the fixed example and every version reference. */
export function parseCreatorReview(raw: string, agent = CREATOR_AGENTS[0]): CreatorReviewState {
  const value = JSON.parse(raw) as CreatorReviewState;
  const text = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;
  const ids = (v: unknown): v is string[] => Array.isArray(v) && v.every(id => text(id, 100));
  if (!value || value.schema !== 1 || !Array.isArray(value.feedback) || value.feedback.length > 50 ||
    !value.feedback.every(note => note && text(note.id, 100) && text(note.text, 1000) && text(note.createdAt, 50) && agent.candidates.some(candidate => candidate.id === note.candidateId)) ||
    !Array.isArray(value.versions) || !value.versions.length || value.versions.length > 20 ||
    !value.versions.every((version, index) => version && version.number === index + 1 && text(version.text, 6000) && text(version.createdAt, 50) && ids(version.feedbackIds) && version.feedbackIds.every(id => value.feedback.some(note => note.id === id))) ||
    value.versions[0].text !== agent.bible || value.versions[0].feedbackIds.length !== 0 ||
    !Array.isArray(value.briefs) || value.briefs.length > 20 || !value.briefs.every(brief => brief && text(brief.id, 100) && text(brief.text, 60_000) && text(brief.createdAt, 50) && ids(brief.feedbackIds) &&
      brief.feedbackIds.every(id => value.feedback.some(note => note.id === id)) && value.versions.some(version => version.number === brief.bibleVersion && version.text === brief.bibleText))) {
    throw new Error("Your saved creator review could not be read. Refresh to retry; the saved record has not been replaced.");
  }
  return value;
}
