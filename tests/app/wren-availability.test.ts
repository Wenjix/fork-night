import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tsImport } from "tsx/esm/api";
import { kesslerSeedMoments } from "../../src/lib/kessler-room.ts";

const { WrenAssistant } = await tsImport("../../src/components/wren-assistant.tsx", import.meta.url);
const { KesslerRoomGuide } = await tsImport("../../src/components/kessler-room-guide.tsx", import.meta.url);
const parent = kesslerSeedMoments()[0];
const props = { client: {}, parent, moments: [parent], blocked: false, onJoin() {}, onBusyChange() {}, onAccepted() {}, async onReady() {}, onInspect() {} };

test("guests see distinct Wren availability without a false invitation to generate", () => {
  for (const [state, message] of [
    ["loading", "Checking Wren’s availability"],
    ["unavailable", "Wren’s availability is temporarily unavailable"],
    ["paused", "Wren is paused"],
    ["needs-credits", "this room needs credits before it can make a scene"],
    ["enabled", "Choose a fork. Give Wren a direction"],
  ]) {
    const html = renderToStaticMarkup(createElement(WrenAssistant, { ...props, publicState: state }));
    assert.ok(html.includes(message), state);
    assert.ok(html.includes("Join the story"), state);
    if (state !== "enabled") assert.doesNotMatch(html, /Choose a fork\. Give Wren a direction/);
    if (state !== "paused") assert.doesNotMatch(html, /Wren is paused/);
  }
});

test("signed-in availability waits for the private request check", () => {
  const html = renderToStaticMarkup(createElement(WrenAssistant, { ...props, actorId: "20000000-0000-4000-8000-000000000001", publicState: "enabled" }));
  assert.ok(html.includes("Checking Wren’s availability"));
  assert.ok(html.includes("Checking your saved Wren request"));
  assert.doesNotMatch(html, /Choose a fork\. Give Wren a direction/);
});

test("an unknown allowance is not presented as a verified absence", () => {
  for (const unavailable of [false, true]) {
    const html = renderToStaticMarkup(createElement(KesslerRoomGuide, { overview: null, unavailable, blocked: false, onNavigate() {} }));
    assert.ok(html.includes(unavailable ? "Wren’s top-up allowance could not be checked" : "Checking Wren’s top-up allowance"));
    assert.doesNotMatch(html, /No active top-up allowance/);
  }
});
