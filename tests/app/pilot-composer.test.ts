import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inkTranscript,
  parseComposerDraft,
  parseShapeResult,
  shapeSignature,
} from "../../src/lib/pilot-composer.ts";

const id = "10000000-0000-4000-8000-000000000001";
const parentId = "10000000-0000-4000-8000-000000000002";
test("unfinished thoughts, idea credit and request identity survive draft recovery", () => {
  const draft = {
    requestId: id,
    roomId: "room",
    parentId,
    captions: ["", ""],
    thought: "What if it remembers?",
    idea: { id, momentId: parentId, label: "Maya", body: "The whale returns." },
    assist: { requestId: id, signature: "saved input" },
  };
  assert.deepEqual(
    parseComposerDraft(JSON.parse(JSON.stringify(draft)), "room"),
    draft,
  );
  assert.equal(parseComposerDraft(draft, "other-room"), null);
  assert.equal(
    parseComposerDraft(
      { ...draft, idea: { ...draft.idea, momentId: id } },
      "room",
    ),
    null,
  );
  assert.equal(
    parseComposerDraft(
      { ...draft, assist: { requestId: "invalid", signature: "" } },
      "room",
    ),
    null,
  );
});
test("older two-beat drafts still recover, malformed thoughts and beats do not", () => {
  const draft = {
    requestId: id,
    roomId: "room",
    parentId,
    captions: ["First", "Then"],
    submitted: true,
  };
  assert.deepEqual(parseComposerDraft(draft, "room"), draft);
  for (const patch of [
    { thought: false },
    { thought: "x".repeat(2001) },
    { captions: ["one", "two", "three", "four"] },
    { suggestedSecond: "yes" },
  ])
    assert.equal(parseComposerDraft({ ...draft, ...patch }, "room"), null);
});
test("Ink interim text is replaced; final deltas preserve model spacing exactly", () => {
  let state = { final: "", interim: "" };
  state = inkTranscript(state, {
    type: "transcript",
    text: "The wh",
    is_final: false,
  });
  state = inkTranscript(state, {
    type: "transcript",
    text: "The whale",
    is_final: false,
  });
  state = inkTranscript(state, {
    type: "transcript",
    text: "The whale",
    is_final: true,
  });
  state = inkTranscript(state, {
    type: "transcript",
    text: " remembers.",
    is_final: true,
  });
  assert.deepEqual(state, { final: "The whale remembers.", interim: "" });
  assert.deepEqual(inkTranscript(state, { type: "flush_done" }), state);
  assert.throws(() =>
    inkTranscript(state, {
      type: "transcript",
      text: "x".repeat(4001),
      is_final: true,
    }),
  );
});
test("incomplete model output is rejected before replacing the author's beats", () => {
  const result = {
    first: "A whale listens.",
    then: "It remembers.",
    suggestedSecond: true,
    twists: [],
  };
  assert.deepEqual(parseShapeResult(result), {
    captions: [result.first, result.then],
    twists: [],
  });
  for (const patch of [
    { first: " " },
    { then: "x".repeat(501) },
    { suggestedSecond: null },
    { twists: [{ label: "Bad", first: "", then: "" }] },
  ])
    assert.throws(() => parseShapeResult({ ...result, ...patch }));
});
test("changing words, beat edits, mode or idea starts a distinct helper intent", () => {
  const signature = shapeSignature("thought", ["first", "then"], "shape", id);
  assert.notEqual(
    signature,
    shapeSignature("thought edit", ["first", "then"], "shape", id),
  );
  assert.notEqual(
    signature,
    shapeSignature("thought", ["first edit", "then"], "shape", id),
  );
  assert.notEqual(
    signature,
    shapeSignature("thought", ["first", "then"], "twists", id),
  );
  assert.notEqual(
    signature,
    shapeSignature("thought", ["first", "then"], "shape"),
  );
});

test("pending overflow and interrupted speech recover until explicitly accepted or discarded", () => {
  for (const reason of ["overflow", "interrupted"] as const) {
    const draft = {
      requestId: id,
      roomId: "room",
      parentId,
      captions: ["", ""],
      thought: "x".repeat(1990),
      pendingSpeech: { text: "The keeper is still waiting.", reason },
    };
    assert.deepEqual(
      parseComposerDraft(JSON.parse(JSON.stringify(draft)), "room"),
      draft,
    );
    assert.equal(
      parseComposerDraft(
        { ...draft, pendingSpeech: { text: "x".repeat(4001), reason } },
        "room",
      ),
      null,
    );
  }
});
