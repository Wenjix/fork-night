import test from "node:test";
import assert from "node:assert/strict";
import { createDemoState } from "../../src/domain/fixtures.ts";
import {
  addIdea,
  createSocialState,
  extendSocialDemo,
  replyToIdea,
  toggleIdeaPin,
  validateSocialState,
} from "../../src/social/model.ts";
import {
  commitSocialChange,
  SOCIAL_STORAGE_KEY,
} from "../../src/social/storage.ts";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    fail: false,
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      if (this.fail) throw new Error("Quota exceeded");
      values.set(key, value);
    },
  };
}
const newIdea = {
  userId: "sam",
  spaceId: "tidepool-board",
  title: "A new door",
  body: "What if the moon had a front door?",
  now: Date.UTC(2026, 9, 2),
};

test("accepted social changes are durable before returning, without a later React effect", () => {
  const demo = extendSocialDemo(createDemoState());
  const storage = memoryStorage();
  let social = createSocialState();
  social = commitSocialChange(storage, social, demo, (current) =>
    addIdea(current, demo, newIdea),
  );
  const idea = social.ideas.find((item) => item.title === newIdea.title)!;
  // Simulate immediate unmount/remount: only the stored snapshot survives.
  let restored = JSON.parse(storage.getItem(SOCIAL_STORAGE_KEY)!);
  validateSocialState(restored, demo);
  assert.deepEqual(restored, social);
  social = commitSocialChange(storage, restored, demo, (current) =>
    replyToIdea(current, demo, {
      userId: "priya",
      ideaId: idea.id,
      body: "And a tiny brass key.",
      now: newIdea.now + 1,
    }),
  );
  social = commitSocialChange(storage, social, demo, (current) =>
    toggleIdeaPin(current, demo, {
      userId: "priya",
      ideaId: idea.id,
      now: newIdea.now + 2,
    }),
  );
  restored = JSON.parse(storage.getItem(SOCIAL_STORAGE_KEY)!);
  validateSocialState(restored, demo);
  assert.deepEqual(restored, social);
  assert.equal(
    restored.ideas.find((item) => item.id === idea.id)!.pinned,
    true,
  );
  assert.equal(
    restored.ideas.find((item) => item.id === idea.id)!.replies.length,
    1,
  );
});

test("a failed save cannot accept a social edit or destroy the previous snapshot; retry commits once", () => {
  const demo = extendSocialDemo(createDemoState());
  const storage = memoryStorage();
  const social = createSocialState();
  const previous = JSON.stringify(social);
  storage.setItem(SOCIAL_STORAGE_KEY, previous);
  storage.fail = true;
  assert.throws(
    () =>
      commitSocialChange(storage, social, demo, (current) =>
        addIdea(current, demo, newIdea),
      ),
    /not been applied/,
  );
  assert.equal(JSON.stringify(social), previous);
  assert.equal(storage.getItem(SOCIAL_STORAGE_KEY), previous);
  storage.fail = false;
  const accepted = commitSocialChange(storage, social, demo, (current) =>
    addIdea(current, demo, newIdea),
  );
  assert.equal(
    accepted.ideas.filter((item) => item.title === newIdea.title).length,
    1,
  );
  assert.deepEqual(JSON.parse(storage.getItem(SOCIAL_STORAGE_KEY)!), accepted);
});
