import test from "node:test";
import assert from "node:assert/strict";
import { createDemoState, removeMember } from "../../src/domain/index.ts";
import { publishOriginalProject } from "../../src/domain/original-project.ts";
import {
  addDeskCard,
  commitDeskChange,
  createDeskState,
  DESK_LIMITS,
  DESK_STORAGE_KEY,
  getDeskBoard,
  loadDeskState,
  removeDeskCard,
  updateDeskCard,
  validateDeskState,
  type DeskCard,
  type DeskState,
} from "../../src/social/desk.ts";

const note: DeskCard = {
  id: "first-note",
  kind: "note",
  title: "A floating garden",
  text: "A seed drifts in through the window.",
  x: 80,
  y: 70,
};

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    fail: false,
    writes: 0,
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      if (this.fail) throw new Error("Quota exceeded");
      this.writes += 1;
      values.set(key, value);
    },
  };
}

test("personal canvases start blank, remain owner-scoped and return independent cards", () => {
  const demo = createDemoState();
  const empty = createDeskState();
  assert.deepEqual(getDeskBoard(empty, demo, "sam"), {
    ownerId: "sam",
    cards: [],
  });
  const sam = addDeskCard(empty, demo, { userId: "sam", ...note });
  const both = addDeskCard(sam, demo, {
    userId: "priya",
    ...note,
    title: "Priya's idea",
  });
  assert.equal(getDeskBoard(both, demo, "sam").cards[0].title, note.title);
  assert.equal(
    getDeskBoard(both, demo, "priya").cards[0].title,
    "Priya's idea",
  );
  assert.deepEqual(getDeskBoard(both, demo, "jules").cards, []);
  getDeskBoard(both, demo, "sam").cards[0].text = "Changed outside the model";
  assert.equal(both.boards.sam.cards[0].text, note.text);
  assert.deepEqual(empty.boards, {});
  assert.throws(
    () =>
      updateDeskCard(sam, demo, {
        userId: "priya",
        cardId: note.id,
        changes: { text: "Overwrite" },
      }),
    /not available/,
  );
  assert.throws(() => getDeskBoard(both, demo, "unknown"), /owner/);
});

test("removed membership hides inherited private cards without losing their saved context", () => {
  const demo = createDemoState();
  const context = { projectId: "tidepool", momentId: "tidepool-lantern" };
  let desk = addDeskCard(createDeskState(), demo, {
    userId: "priya",
    ...note,
    context,
  });
  desk = addDeskCard(desk, demo, {
    userId: "priya",
    ...note,
    id: "unlinked-note",
  });
  assert.throws(
    () => addDeskCard(desk, demo, { userId: "jules", ...note, context }),
    /not accessible/,
  );
  const removed = removeMember(demo, {
    actorId: "sam",
    groupId: "tidepool-friends",
    userId: "priya",
  });
  const saved = JSON.parse(JSON.stringify(desk));
  assert.doesNotThrow(() => validateDeskState(saved, removed));
  assert.deepEqual(
    getDeskBoard(saved, removed, "priya").cards.map((card) => card.id),
    ["unlinked-note"],
  );
  assert.deepEqual(saved.boards.priya.cards[0].context, context);
  assert.throws(
    () =>
      updateDeskCard(saved, removed, {
        userId: "priya",
        cardId: note.id,
        changes: { title: "Detached" },
      }),
    /not available/,
  );
  assert.throws(
    () => removeDeskCard(saved, removed, { userId: "priya", cardId: note.id }),
    /not available/,
  );
  assert.throws(
    () =>
      addDeskCard(createDeskState(), demo, {
        userId: "sam",
        ...note,
        context: { projectId: "midnight-signal", momentId: "tidepool-lantern" },
      }),
    /published moment/,
  );
});

test("story resets preserve every maker's originals and hide orphan context until its work returns", () => {
  const reset = createDemoState();
  const demo = publishOriginalProject(reset, {
    userId: "sam",
    projectId: "personal-garden",
    title: "A personal garden",
    description: "The garden grows into a story.",
    panels: [
      {
        imageUrl: "/art/social-worlds.webp#scene=0",
        caption: "An open window.",
      },
      {
        imageUrl: "/art/social-worlds.webp#scene=5",
        caption: "A garden grows.",
      },
    ],
    now: 1_000,
  });
  const context = {
    projectId: "personal-garden",
    momentId: "personal-garden-seed",
  };
  const storage = memoryStorage();
  let desk = commitDeskChange(
    storage,
    createDeskState(),
    demo,
    "sam",
    (current) => addDeskCard(current, demo, { userId: "sam", ...note }),
  );
  desk = commitDeskChange(storage, desk, demo, "priya", (current) =>
    addDeskCard(current, demo, { userId: "priya", ...note, context }),
  );
  desk = commitDeskChange(storage, desk, demo, "priya", (current) =>
    addDeskCard(current, demo, {
      userId: "priya",
      ...note,
      id: "priya-original",
    }),
  );
  const restored = loadDeskState(storage, reset);
  assert.deepEqual(restored, desk);
  assert.deepEqual(getDeskBoard(restored, reset, "sam").cards, [note]);
  assert.deepEqual(
    getDeskBoard(restored, reset, "priya").cards.map((card) => card.id),
    ["priya-original"],
  );
  assert.deepEqual(restored.boards.priya.cards[0].context, context);
  assert.throws(
    () =>
      addDeskCard(restored, reset, {
        userId: "sam",
        ...note,
        id: "reuse-orphan",
        context,
      }),
    /not accessible/,
  );
  assert.throws(
    () =>
      updateDeskCard(restored, reset, {
        userId: "priya",
        cardId: note.id,
        changes: { title: "Orphan reused" },
      }),
    /not available/,
  );
  const edited = commitDeskChange(storage, restored, reset, "sam", (current) =>
    updateDeskCard(current, reset, {
      userId: "sam",
      cardId: note.id,
      changes: { text: "Originals remain editable." },
    }),
  );
  assert.deepEqual(edited.boards.priya, desk.boards.priya);
  assert.equal(
    getDeskBoard(loadDeskState(storage, demo), demo, "priya").cards.length,
    2,
  );

  // A missing moment is hidden even while its project is still available.
  const missingMoment = structuredClone(edited);
  missingMoment.boards.priya.cards[0].context = {
    projectId: "midnight-signal",
    momentId: "missing-moment",
  };
  assert.doesNotThrow(() => validateDeskState(missingMoment, reset));
  assert.deepEqual(
    getDeskBoard(missingMoment, reset, "priya").cards.map((card) => card.id),
    ["priya-original"],
  );
});

test("card context cannot be removed or changed during edits or a direct commit", () => {
  const demo = createDemoState();
  const desk = addDeskCard(createDeskState(), demo, {
    userId: "sam",
    ...note,
    context: { projectId: "midnight-signal", momentId: "sea" },
  });
  assert.throws(
    () =>
      updateDeskCard(desk, demo, {
        userId: "sam",
        cardId: note.id,
        changes: { context: undefined } as never,
      }),
    /card changes/,
  );
  assert.throws(
    () =>
      updateDeskCard(desk, demo, {
        userId: "sam",
        cardId: note.id,
        changes: { id: "new-id" } as never,
      }),
    /card changes/,
  );
  const storage = memoryStorage();
  assert.throws(
    () =>
      commitDeskChange(storage, desk, demo, "sam", (next) => {
        delete next.boards.sam.cards[0].context;
        return next;
      }),
    /context cannot be changed/,
  );
  assert.equal(storage.writes, 0);
  assert.equal(desk.boards.sam.cards[0].context?.momentId, "sea");
});

test("canvas validation enforces media, shape, positions and bounded content", () => {
  const demo = createDemoState();
  for (const card of [
    { ...note, x: -1 },
    { ...note, y: Infinity },
    { ...note, x: DESK_LIMITS.maxX + 1 },
    { ...note, title: " " },
    { ...note, title: "x".repeat(DESK_LIMITS.maxTitle + 1) },
    { ...note, text: "x".repeat(DESK_LIMITS.maxText + 1) },
    { ...note, secret: "not a card field" },
    { ...note, imageUrl: "/art/midnight-story.webp#frame=0" },
    { ...note, kind: "image", imageUrl: "https://example.com/image.png" },
    { ...note, kind: "image", imageUrl: "data:image/svg+xml;base64,PHN2Zy8+" },
    { ...note, kind: "image", imageUrl: "data:image/png;base64,PHN2Zy8+" },
    {
      ...note,
      kind: "image",
      imageUrl: `data:image/png;base64,${"A".repeat(DESK_LIMITS.maxImageLength)}`,
    },
  ])
    assert.throws(() =>
      addDeskCard(createDeskState(), demo, {
        userId: "sam",
        ...card,
      } as DeskCard & { userId: string }),
    );
  let desk = createDeskState();
  for (let index = 0; index < DESK_LIMITS.maxCards; index += 1)
    desk = addDeskCard(desk, demo, {
      userId: "sam",
      ...note,
      id: `note-${index}`,
    });
  assert.throws(
    () => addDeskCard(desk, demo, { userId: "sam", ...note }),
    /at most/,
  );
  const sparse = addDeskCard(createDeskState(), demo, {
    userId: "sam",
    ...note,
  });
  delete sparse.boards.sam.cards[0];
  assert.throws(() => validateDeskState(sparse, demo));
});

test("save-before-success survives reload for add, move, edit and removal", () => {
  const demo = createDemoState();
  const beforeMoney = JSON.stringify([demo.accounts, demo.ledger, demo.claims]);
  const storage = memoryStorage();
  let desk = loadDeskState(storage, demo);
  assert.equal(storage.writes, 0);
  desk = commitDeskChange(storage, desk, demo, "sam", (current) =>
    addDeskCard(current, demo, { userId: "sam", ...note }),
  );
  assert.deepEqual(loadDeskState(storage, demo), desk);
  desk = commitDeskChange(storage, desk, demo, "sam", (current) =>
    updateDeskCard(current, demo, {
      userId: "sam",
      cardId: note.id,
      changes: { x: 150, y: 240, text: "A revised spark" },
    }),
  );
  assert.deepEqual(loadDeskState(storage, demo).boards.sam.cards[0], {
    ...note,
    x: 150,
    y: 240,
    text: "A revised spark",
  });
  desk = commitDeskChange(storage, desk, demo, "sam", (current) =>
    removeDeskCard(current, demo, { userId: "sam", cardId: note.id }),
  );
  assert.deepEqual(loadDeskState(storage, demo).boards.sam.cards, []);
  assert.equal(
    JSON.stringify([demo.accounts, demo.ledger, demo.claims]),
    beforeMoney,
  );
});

test("quota failures never report success or mutate current state, even for an in-place action", () => {
  const demo = createDemoState();
  const storage = memoryStorage();
  const desk = commitDeskChange(
    storage,
    createDeskState(),
    demo,
    "sam",
    (current) => addDeskCard(current, demo, { userId: "sam", ...note }),
  );
  const saved = storage.getItem(DESK_STORAGE_KEY);
  storage.fail = true;
  assert.throws(
    () =>
      commitDeskChange(storage, desk, demo, "sam", (current) => {
        current.boards.sam.cards[0].text = "An unsaved edit";
        return current;
      }),
    /not been applied/,
  );
  assert.equal(storage.getItem(DESK_STORAGE_KEY), saved);
  assert.equal(JSON.stringify(desk), saved);
  storage.fail = false;
  const retried = commitDeskChange(storage, desk, demo, "sam", (current) =>
    updateDeskCard(current, demo, {
      userId: "sam",
      cardId: note.id,
      changes: { text: "An unsaved edit" },
    }),
  );
  assert.equal(
    loadDeskState(storage, demo).boards.sam.cards[0].text,
    retried.boards.sam.cards[0].text,
  );
});

test("corrupt, incompatible and changed saved canvases cannot be overwritten", () => {
  const demo = createDemoState();
  for (const malformed of [
    "{",
    JSON.stringify({ version: 2, boards: {} }),
    JSON.stringify({
      version: 1,
      boards: { sam: { ownerId: "priya", cards: [] } },
    }),
    "x".repeat(DESK_LIMITS.maxSavedLength + 1),
  ]) {
    const storage = memoryStorage();
    storage.setItem(DESK_STORAGE_KEY, malformed);
    assert.throws(() => loadDeskState(storage, demo), /not been overwritten/);
    assert.throws(
      () =>
        commitDeskChange(storage, createDeskState(), demo, "sam", (current) =>
          addDeskCard(current, demo, { userId: "sam", ...note }),
        ),
      /not been overwritten/,
    );
    assert.equal(storage.getItem(DESK_STORAGE_KEY), malformed);
    assert.equal(storage.writes, 1);
  }
  const storage = memoryStorage();
  commitDeskChange(storage, createDeskState(), demo, "sam", (current) =>
    addDeskCard(current, demo, { userId: "sam", ...note }),
  );
  assert.throws(
    () =>
      commitDeskChange(
        storage,
        createDeskState(),
        demo,
        "sam",
        (current) => current,
      ),
    /another window/,
  );
  assert.throws(
    () =>
      loadDeskState(
        {
          getItem() {
            throw new Error("Blocked");
          },
        },
        demo,
      ),
    /could not read/,
  );
});

test("owner commits cannot change another maker's canvas", () => {
  const demo = createDemoState();
  const storage = memoryStorage();
  const desk: DeskState = addDeskCard(createDeskState(), demo, {
    userId: "priya",
    ...note,
  });
  assert.throws(
    () =>
      commitDeskChange(storage, desk, demo, "sam", (current) => {
        current.boards.priya.cards[0].text = "Overwritten";
        return current;
      }),
    /another maker/,
  );
  assert.equal(storage.writes, 0);
  assert.equal(desk.boards.priya.cards[0].text, note.text);
});
