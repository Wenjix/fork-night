import { test } from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tsImport } from "tsx/esm/api";

// The Wren maker: a look is plain, validated data, and every option renders.
const look = await tsImport("../../src/lib/wren-look.ts", import.meta.url);
const { WrenFigure } = await tsImport("../../src/components/wren-studio/wren-figure.tsx", import.meta.url);
const { WrenStudio } = await tsImport("../../src/components/wren-studio/wren-studio.tsx", import.meta.url);

test("a saved look keeps valid fields and replaces anything unknown with the default", () => {
  assert.deepEqual(look.parseLook(null), look.DEFAULT_LOOK);
  const parsed = look.parseLook({ name: "  Pip   the  bird ", yarn: "clay", accent: "neon", pattern: "stripes", face: "x", accessory: "<script>" });
  assert.deepEqual(parsed, { ...look.DEFAULT_LOOK, name: "Pip the bird", yarn: "clay", pattern: "stripes" });
  assert.equal(look.cleanName("x".repeat(40)).length, look.NAME_LIMIT);
  assert.equal(look.cleanName("   "), "Wren");
});

test("a random look keeps the name and never matches trim to the main yarn", () => {
  for (let seed = 0; seed < 50; seed++) {
    let n = seed;
    const random = () => ((n = (n * 9301 + 49297) % 233280) / 233280);
    const next = look.randomLook("Pip", random);
    assert.equal(next.name, "Pip");
    assert.notEqual(next.accent, next.yarn);
    assert.deepEqual(look.parseLook(next), next);
  }
});

test("every option renders an SVG described in words", () => {
  for (const pattern of look.PATTERNS) for (const face of look.FACES) for (const accessory of look.ACCESSORIES) {
    const value = { ...look.DEFAULT_LOOK, pattern: pattern.id, face: face.id, accessory: accessory.id };
    const html = renderToStaticMarkup(React.createElement(WrenFigure, { look: value, idPrefix: "t" }));
    assert.match(html, /^<svg class="wren-figure /);
    assert.ok(html.includes(`aria-label="${look.describeLook(value).replace(/’/g, "’")}"`));
  }
});

test("the studio renders its tabs, presets and the default Wren before any saved look loads", () => {
  const html = renderToStaticMarkup(React.createElement(WrenStudio));
  assert.equal(html.match(/role="tab"/g)?.length, 4);
  for (const preset of look.PRESETS) assert.ok(html.includes(preset.label), preset.label);
  assert.ok(html.includes('aria-selected="true"'));
  assert.ok(html.includes("<h1>Make your Wren</h1>"));
});
