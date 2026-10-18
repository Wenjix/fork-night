import assert from "node:assert/strict";
import test from "node:test";
import { parseKesslerOverview, kesslerWrenState } from "../../src/lib/kessler-overview.ts";

const overview = () => ({
  roomId: "kessler-ward", checkedAt: "2026-10-18T12:00:00Z",
  credits: { enabled: true, available: 0 },
  story: { moments: 13, prepared: 11, contributors: 1, published: 2 },
  wren: { enabled: true, published: 1, fundingEnabled: false, payer: "0x" + "1".repeat(40), accessKey: "0x" + "2".repeat(40),
    authorizationTx: "0x" + "3".repeat(64), expiresAt: "2026-10-18T13:00:00Z", allowanceAtomic: "2000000",
    payments: [{ transaction: "0x" + "4".repeat(64), amount: "1000000", credits: 5, recordedAt: "2026-10-18T11:00:00Z" }] },
});

test("public overview retains only the declared public fields", () => {
  const value = overview();
  const parsed = parseKesslerOverview({ ...value, privateBrief: "secret", wren: { ...value.wren, credential: "secret", payments: [{ ...value.wren.payments[0], credential: "secret", actorId: "private" }] } });
  assert.deepEqual(parsed, value);
  assert.doesNotMatch(JSON.stringify(parsed), /secret|credential|actorId|privateBrief/);
});

test("unverified, inconsistent and duplicate payment records fail closed", () => {
  for (const mutate of [
    (v: ReturnType<typeof overview>) => { v.roomId = "paper-moon"; },
    (v: ReturnType<typeof overview>) => { v.story.published = 3; },
    (v: ReturnType<typeof overview>) => { v.story.contributors = 3; },
    (v: ReturnType<typeof overview>) => { v.wren.published = 3; },
    (v: ReturnType<typeof overview>) => { v.credits.available = -1; },
    (v: ReturnType<typeof overview>) => { v.wren.payments[0].transaction = "https://other.example"; },
    (v: ReturnType<typeof overview>) => { v.wren.payments[0].amount = "2000000"; },
    (v: ReturnType<typeof overview>) => { v.wren.payments[0].credits = 10; },
    (v: ReturnType<typeof overview>) => { v.wren.payments.push(v.wren.payments[0]); },
  ]) { const value = overview(); mutate(value); assert.equal(parseKesslerOverview(value), null); }
  assert.equal(parseKesslerOverview(null), null);
});

test("Wren status respects pause, shared credits and expiry independently", () => {
  const value = parseKesslerOverview(overview())!;
  const now = Date.parse("2026-10-18T12:00:00Z");
  assert.equal(kesslerWrenState(value, now), "needs-credits");
  value.wren.fundingEnabled = true;
  assert.equal(kesslerWrenState(value, now), "enabled");
  assert.equal(kesslerWrenState(value, Date.parse(value.wren.expiresAt)), "needs-credits");
  value.credits.available = 5;
  assert.equal(kesslerWrenState(value, Date.parse(value.wren.expiresAt)), "enabled");
  value.wren.enabled = false;
  assert.equal(kesslerWrenState(value, now), "paused");
  value.wren.enabled = true; value.credits.enabled = false;
  assert.equal(kesslerWrenState(value, now), "paused");
});
