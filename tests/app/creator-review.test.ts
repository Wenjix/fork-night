import assert from "node:assert/strict";
import test from "node:test";
import { addCreatorFeedback, CREATOR_AGENTS, CREATOR_BIBLE, CREATOR_REVIEW_KEY, creatorReviewKey, initialCreatorReview, parseCreatorReview, prepareCreatorBrief, reviseCreatorBible } from "../../src/lib/creator-review.ts";
import { creativeAncestry, creatorHistory, layoutCreatorHistory } from "../../src/lib/creator-history.ts";
const date = "2026-10-06T20:00:00Z";

test("human critique targets an alternative and leaves the used bible unchanged", () => {
  const initial = initialCreatorReview();
  const reviewed = addCreatorFeedback(initial, "neighborhood", "Keep the gathering for another episode.", "note-1", date);
  assert.equal(reviewed.feedback[0].candidateId, "neighborhood");
  assert.equal(reviewed.versions.length, 1);
  assert.equal(reviewed.versions[0].text, CREATOR_BIBLE);
  assert.equal(initial.feedback.length, 0);
  assert.throws(() => addCreatorFeedback(initial, "reunion", " ", "note-2", date), /write feedback/);
});

test("a bible revision preserves old instructions and future briefs retain their exact input version", () => {
  const reviewed = addCreatorFeedback(initialCreatorReview(), "reunion", "Give the sister an action.", "note-1", date);
  const v2 = reviseCreatorBible(reviewed, `${CREATOR_BIBLE}\nThe sister should make a choice.`, date);
  const brief = prepareCreatorBrief(v2, "brief-1", date);
  const v3 = reviseCreatorBible(brief, `${v2.versions[1].text}\nLet gestures carry emotion.`, date);
  assert.equal(v3.versions[0].text, CREATOR_BIBLE);
  assert.equal(v3.briefs[0].bibleVersion, 2);
  assert.equal(v3.briefs[0].bibleText, v2.versions[1].text);
  assert.deepEqual(v3.briefs[0].feedbackIds, ["note-1"]);
  assert(!v3.briefs[0].text.includes("Let gestures carry emotion."));
  assert.deepEqual(parseCreatorReview(JSON.stringify(v3)), v3);
  assert.throws(() => reviseCreatorBible(v3, v3.versions[2].text, date), /Make a change/);
});

test("restoration rejects a rewritten source bible or a brief claiming the wrong version", () => {
  const state = prepareCreatorBrief(initialCreatorReview(), "brief-1", date);
  const changed = structuredClone(state); changed.versions[0].text = "Rewritten history";
  assert.throws(() => parseCreatorReview(JSON.stringify(changed)), /has not been replaced/);
  const wrong = structuredClone(state); wrong.briefs[0].bibleVersion = 2;
  assert.throws(() => parseCreatorReview(JSON.stringify(wrong)), /has not been replaced/);
  const orphan = structuredClone(state); orphan.briefs[0].feedbackIds = ["missing-note"];
  assert.throws(() => parseCreatorReview(JSON.stringify(orphan)), /has not been replaced/);
});

test("creator personas keep separate saved records and reject another agent’s instructions or outputs", () => {
  const [nika, sol] = CREATOR_AGENTS;
  assert.equal(creatorReviewKey(nika), CREATOR_REVIEW_KEY, "existing Nika reviews keep their original storage key");
  assert.notEqual(creatorReviewKey(nika), creatorReviewKey(sol));
  const solReview = addCreatorFeedback(initialCreatorReview(sol), "soup", "Let the guest choose.", "sol-note", date, sol);
  const solBrief = prepareCreatorBrief(solReview, "sol-brief", date, sol);
  assert(solBrief.briefs[0].text.includes("Continue the late supper"));
  assert(!solBrief.briefs[0].text.includes("sister’s door"));
  assert.deepEqual(parseCreatorReview(JSON.stringify(solBrief), sol), solBrief);
  assert.throws(() => parseCreatorReview(JSON.stringify(solBrief), nika), /has not been replaced/);
  assert.throws(() => addCreatorFeedback(initialCreatorReview(sol), "reunion", "Wrong agent.", "note", date, sol), /Choose an ending/);
  assert.equal(initialCreatorReview(nika).feedback.length, 0);
});

test("visual history preserves discarded branches, human attribution and exact brief ancestry", () => {
  const nika = CREATOR_AGENTS[0];
  const reviewed = addCreatorFeedback(initialCreatorReview(nika), "neighborhood", "Keep it for later.", "note-1", date);
  const revised = reviseCreatorBible(reviewed, `${CREATOR_BIBLE}\nKeep discarded directions available.`, "2026-10-06T20:01:00Z");
  const withBrief = prepareCreatorBrief(revised, "next-1", "2026-10-06T20:02:00Z");
  const later = reviseCreatorBible(withBrief, `${revised.versions[1].text}\nA later lesson.`, "2026-10-06T20:03:00Z");
  const events = creatorHistory(nika, later);
  assert.equal(events.find(event => event.id === "candidate-neighborhood")!.status, "Discarded");
  assert(events.filter(event => !event.prepared).every(event => event.actor === "human"));
  const brief = events.find(event => event.id === "brief-next-1")!;
  assert.deepEqual(brief.parentIds, ["bible-2", "feedback-note-1"]);
  const ancestry = creativeAncestry(events, brief.id);
  assert(ancestry.has("bible-2") && ancestry.has("feedback-note-1") && ancestry.has("candidate-neighborhood"));
  assert(!ancestry.has("bible-3"));
  assert.deepEqual(events.filter(event => !event.prepared).map(event => event.id), ["feedback-note-1", "bible-2", "brief-next-1", "bible-3"]);
  const layout = layoutCreatorHistory(events);
  assert(layout.nodes.find(node => node.event.id === "brief-next-1")!.y < layout.nodes.find(node => node.event.id === "bible-2")!.y);
  assert(layout.nodes.every(node => Number.isFinite(node.x) && Number.isFinite(node.y)));
});

test("the prepared creator tree fits both branches at phone width", () => {
  const events = creatorHistory(CREATOR_AGENTS[0], initialCreatorReview());
  const layout = layoutCreatorHistory(events, { nodeWidth: 150, columnGap: 20, minimumWidth: 346 });
  assert.equal(layout.width, 346);
  assert(layout.nodes.every(node => node.x - 75 >= 0 && node.x + 75 <= 346));
});
