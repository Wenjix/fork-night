import assert from "node:assert/strict";
import test from "node:test";
import { whileVisible, type VisiblePage } from "../../src/lib/visible-interval.ts";

function page(state: DocumentVisibilityState) {
  const target = new EventTarget() as EventTarget & { visibilityState: DocumentVisibilityState };
  target.visibilityState = state;
  const show = (next: DocumentVisibilityState) => {
    target.visibilityState = next;
    target.dispatchEvent(new Event("visibilitychange"));
  };
  return { target: target as VisiblePage, show };
}

test("polling runs only while the page is visible and catches up when it returns", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { target, show } = page("visible");
  let runs = 0;
  const stop = whileVisible(() => runs++, 3000, target);
  t.mock.timers.tick(9000);
  assert.equal(runs, 3, "visible: every interval");
  show("hidden");
  t.mock.timers.tick(60_000);
  assert.equal(runs, 3, "hidden: nothing runs");
  show("visible");
  assert.equal(runs, 4, "returning: one immediate refresh");
  t.mock.timers.tick(3000);
  assert.equal(runs, 5, "then the interval resumes");
  show("visible");
  assert.equal(runs, 5, "a repeated visible event does not double the timer");
  t.mock.timers.tick(3000);
  assert.equal(runs, 6);
  stop();
  show("hidden");
  show("visible");
  t.mock.timers.tick(30_000);
  assert.equal(runs, 6, "stopped: no timer and no listener");
});

test("a page opened in the background waits until it is shown", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { target, show } = page("hidden");
  let runs = 0;
  const stop = whileVisible(() => runs++, 5000, target);
  t.mock.timers.tick(20_000);
  assert.equal(runs, 0);
  show("visible");
  assert.equal(runs, 1);
  t.mock.timers.tick(5000);
  assert.equal(runs, 2);
  stop();
});

test("room checks serialize requests, back off 6/12/30 seconds and refresh on reconnect", async t => {
  const { pollWhileVisible } = await import("../../src/lib/visible-interval.ts");
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { target, show } = page("visible");
  const events = new EventTarget();
  let calls = 0, fail = true;
  const drain = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
  const stop = pollWhileVisible(async () => { calls++; if (fail) throw new Error("offline"); }, 3000, target, events);
  await drain(); assert.equal(calls, 1);
  t.mock.timers.tick(5999); assert.equal(calls, 1);
  t.mock.timers.tick(1); await drain(); assert.equal(calls, 2);
  t.mock.timers.tick(12000); await drain(); assert.equal(calls, 3);
  t.mock.timers.tick(29999); assert.equal(calls, 3);
  show("hidden"); t.mock.timers.tick(60000); await drain(); assert.equal(calls, 3);
  fail = false; show("visible"); await drain(); assert.equal(calls, 4);
  events.dispatchEvent(new Event("online")); await drain(); assert.equal(calls, 5);
  t.mock.timers.tick(3000); await drain(); assert.equal(calls, 6);
  stop(); events.dispatchEvent(new Event("focus")); t.mock.timers.tick(30000); assert.equal(calls, 6);
});
