import { test } from "node:test";
import assert from "node:assert/strict";
import {
  panelsFromThought,
  pilotCreditCost,
  validPilotCaptions,
} from "../../src/lib/pilot-format.ts";
import {
  parseComposerDraft,
  parseShapeResult,
} from "../../src/lib/pilot-composer.ts";
import { pilotPanels } from "../../src/lib/pilot.ts";

test("one scene stays one scene; long thoughts preserve every word without inventing events", () => {
  assert.deepEqual(
    panelsFromThought("  The lighthouse is afraid of the dark.  "),
    ["The lighthouse is afraid of the dark."],
  );
  const words = "The whale has been listening all along. ".repeat(29).trim();
  const panels = panelsFromThought(words);
  assert.equal(panels.length, 3);
  assert(panels.every((p) => p.length <= 500));
  assert.equal(panels.join(" "), words);
  assert.throws(() => panelsFromThought("word ".repeat(400)), /trimming/);
  assert.throws(() => panelsFromThought("x".repeat(501)), /shorter/);
  assert.throws(() => panelsFromThought(" "));
});
test("quotes retain pair pricing and reject invalid lengths", () => {
  assert.deepEqual([1, 2, 3].map(pilotCreditCost), [1, 1, 2]);
  for (const n of [0, 4, 1.5, NaN]) assert.throws(() => pilotCreditCost(n));
  assert.equal(validPilotCaptions([]), false);
  assert.equal(validPilotCaptions([], true), true);
  assert.equal(validPilotCaptions(["A", "", "C"]), false);
  assert.equal(validPilotCaptions(["A", "B", "C"]), true);
});
test("flexible previews and undo recover while submitted empty panels are refused", () => {
  for (const captions of [["A"], ["A", "B", "C"]]) {
    const draft = {
      roomId: "room",
      requestId: "10000000-0000-4000-8000-000000000001",
      parentId: "10000000-0000-4000-8000-000000000002",
      thought: "My own words",
      stage: "preview",
      captions,
      undo: { captions: ["Before"], thought: "Earlier", stage: "idea" },
    };
    assert.deepEqual(
      parseComposerDraft(JSON.parse(JSON.stringify(draft)), "room"),
      draft,
    );
    assert.equal(
      parseComposerDraft({ ...draft, undo: { captions: [false] } }, "room"),
      null,
    );
    assert.equal(
      parseComposerDraft({ ...draft, captions: [], submitted: true }, "room"),
      null,
    );
    assert.equal(
      parseComposerDraft({ ...draft, stage: "unexpected" }, "room"),
      null,
    );
  }
});
test("shaping accepts a single scene and bounded sequences; options are freeform thoughts", () => {
  const result = {
    captions: ["The lighthouse waits."],
    twists: [
      {
        label: "It remembers",
        thought: "What if the lighthouse remembers the missing keeper?",
      },
    ],
  };
  assert.deepEqual(parseShapeResult(result), result);
  assert.throws(() => parseShapeResult({ ...result, captions: [] }));
  assert.throws(() =>
    parseShapeResult({ ...result, captions: ["A", "B", "C", "D"] }),
  );
  assert.throws(() =>
    parseShapeResult({ ...result, twists: [{ label: "Try", thought: "" }] }),
  );
});
test("stored single and three-panel moments load including protected third image", () => {
  const panel = {
    imagePath: "10000000-0000-4000-8000-000000000001/3.webp",
    sha256: "a".repeat(64),
    caption: "Together.",
  };
  assert.deepEqual(pilotPanels([panel]), [panel]);
  assert.equal(pilotPanels([panel, panel, panel]).length, 3);
  assert.throws(() => pilotPanels([]));
  assert.throws(() =>
    pilotPanels([
      { ...panel, imagePath: panel.imagePath.replace("3.webp", "4.webp") },
    ]),
  );
});
