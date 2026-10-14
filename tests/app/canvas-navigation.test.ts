import assert from "node:assert/strict";
import test from "node:test";
import { canvasCenterPosition, canvasKeyboardPosition } from "../../src/lib/canvas-navigation.ts";

const viewport = {
  scrollLeft: 120, scrollTop: 200,
  clientWidth: 400, clientHeight: 500,
  scrollWidth: 1200, scrollHeight: 1800,
};

test("canvas keyboard navigation moves both axes and exposes the full vertical story", () => {
  assert.deepEqual(canvasKeyboardPosition(viewport, "ArrowLeft"), { left: 72, top: 200 });
  assert.deepEqual(canvasKeyboardPosition(viewport, "ArrowDown"), { left: 120, top: 248 });
  assert.deepEqual(canvasKeyboardPosition(viewport, "PageDown"), { left: 120, top: 600 });
  assert.deepEqual(canvasKeyboardPosition(viewport, "PageUp"), { left: 120, top: 0 });
  assert.deepEqual(canvasKeyboardPosition(viewport, "Home"), { left: 120, top: 0 });
  assert.deepEqual(canvasKeyboardPosition(viewport, "End"), { left: 120, top: 1300 });
  for (const key of ["Enter", " ", "Tab", "Escape", "+", "-"]) {
    assert.equal(canvasKeyboardPosition(viewport, key), null, key);
  }
});

test("centering stays within native scroll bounds for central and edge cards", () => {
  assert.deepEqual(canvasCenterPosition(viewport, { left: 500, top: 800, width: 180, height: 145 }), { left: 390, top: 622.5 });
  assert.deepEqual(canvasCenterPosition(viewport, { left: 0, top: 0, width: 180, height: 145 }), { left: 0, top: 0 });
  assert.deepEqual(canvasCenterPosition(viewport, { left: 1100, top: 1700, width: 180, height: 145 }), { left: 800, top: 1300 });
  const small = { ...viewport, scrollWidth: 280, scrollHeight: 300 };
  assert.deepEqual(canvasCenterPosition(small, { left: 100, top: 100, width: 180, height: 145 }), { left: 0, top: 0 });
  assert.deepEqual(canvasKeyboardPosition(small, "End"), { left: 0, top: 0 });
});
