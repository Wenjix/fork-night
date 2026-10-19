import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Wallet, keccak256, parseEther } from "ethers";
import { advanceMission, authorize, newMissionState, policyDigest, validatePolicy } from "../../agents/wren/resident-mission.mjs";
import { validateSignedRegistration, registrationData } from "../../agents/wren/resident-monad.mjs";
import { WREN } from "../../src/lib/agents/wren.ts";
import { TERMS_HASH } from "../../src/lib/onchain/model.ts";

const now = Date.parse("2026-10-19T02:00:00Z"), wallet = Wallet.createRandom();
function policy() {
  return { version: 1, id: randomUUID(), origin: "https://fork-night.vercel.app", roomId: "kessler-ward", parentId: randomUUID(),
    makerId: WREN.profileId, byline: WREN.displayName, wallet: wallet.address, maxScenes: 3, maxCredits: 3, durationSeconds: 3600,
    brief: "Let Mika use the battery for the radio and discover how neighbors can help. Leave a choice for a human.",
    chainId: 10143, contract: "0x15247565331013132e5563Cd29E99E0baA38690f", curator: "0x744D5A0D982752DBd1414Aa2898d57Da9E30645B", termsHash: TERMS_HASH, maxGasWei: parseEther("0.1").toString() };
}
const approval = p => ({ policyDigest: policyDigest(p), publish: true, termsHash: TERMS_HASH, authorizedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 3599000).toISOString() });

function harness() {
  const p = policy(), consent = approval(p), plans = new Map(), drafts = new Map(), operations = new Map(), published = new Map(), registered = new Set();
  let state = newMissionState(p), disk = structuredClone(state), stopped = false, clock = now, allowed = false;
  const calls = { planned: 0, generated: 0, reviews: 0, published: 0, requests: 0 };
  const ports = {
    guard() { if (stopped) throw new Error("STOP"); },
    async preflight() {}, async capacity() {},
    async plan(turn) {
      if (!plans.has(turn.planId)) { calls.planned++; plans.set(turn.planId, { captions: [`Mika follows the radio's reply, beat ${turn.number}.`], twists: [] }); }
      return plans.get(turn.planId);
    },
    async draft(turn) {
      if (!drafts.has(turn.draftId)) {
        const op = { id: randomUUID(), request_id: turn.draftId, maker_id: p.makerId, room_id: p.roomId, parent_id: turn.parentId, title: turn.plan.title,
          requested_captions: [turn.plan.caption], panels: null, status: "draft" };
        drafts.set(turn.draftId, op); operations.set(op.id, op);
      }
      return drafts.get(turn.draftId);
    },
    async operation(id) { return operations.get(id); },
    async generate(id) {
      const op = operations.get(id);
      if (op.status === "draft") { calls.generated++; op.status = "delivered"; op.panels = [{ caption: op.requested_captions[0], sha256: "a".repeat(64), imagePath: `${op.id}/1.webp` }]; }
    },
    async preview(op) { return { sha256: op.panels[0].sha256, bytes: Buffer.from("preview") }; },
    async review() { calls.reviews++; return { ok: true }; },
    async publish(id) {
      if (!published.has(id)) {
        const op = operations.get(id);
        const moment = { id: randomUUID(), maker_id: p.makerId, maker_label: p.byline, room_id: p.roomId, parent_id: op.parent_id,
          title: op.title, panels: op.panels, created_at: "2026-10-19T02:00:00+00:00" };
        calls.published++; published.set(id, moment); op.status = "published"; op.published_moment_id = moment.id;
      }
      return published.get(id);
    },
    async approved() { return allowed; },
    async requestWallet() { calls.requests++; },
    async register(turn) { registered.add(turn.momentId); return true; },
  };
  const run = () => advanceMission({ policy: p, approval: consent, state, ports, save: async s => { disk = structuredClone(s); }, now: () => clock });
  return { p, consent, ports, calls, operations, drafts, published, registered, run,
    get state() { return state; }, restart() { state = structuredClone(disk); }, stop() { stopped = true; }, expire() { clock += 3600000; }, allow() { allowed = true; },
    async finish() { for (let i = 0; i < 10; i++) { const result = await run(); if (result.status !== "pending") return result; } throw Error("No result"); } };
}

test("one mission makes three linked Wren scenes, pauses for admission, then registers without new generation", async () => {
  const h = harness();
  assert.equal((await h.finish()).status, "awaiting-curator");
  assert.deepEqual(h.calls, { planned: 3, generated: 3, reviews: 3, published: 3, requests: 1 });
  const scenes = [...h.published.values()];
  assert.equal(scenes[0].parent_id, h.p.parentId);
  assert.equal(scenes[1].parent_id, scenes[0].id);
  assert.equal(scenes[2].parent_id, scenes[1].id);
  assert.ok(scenes.every(s => s.maker_id === WREN.profileId && s.maker_label === WREN.displayName));
  assert.equal(h.registered.size, 0);
  h.restart(); h.allow(); assert.equal((await h.run()).status, "complete");
  h.restart(); assert.equal((await h.run()).status, "complete");
  assert.equal(h.registered.size, 3); assert.equal(h.calls.generated, 3); assert.equal(h.calls.published, 3);
});

for (const method of ["plan", "draft", "generate", "publish"]) test(`a lost ${method} acknowledgement resumes the same work without another charge or post`, async () => {
  const h = harness(), original = h.ports[method]; let lost = false;
  h.ports[method] = async (...args) => { const result = await original(...args); if (!lost) { lost = true; throw Error("lost reply"); } return result; };
  await assert.rejects(h.finish(), /lost reply/); h.restart();
  assert.equal((await h.finish()).status, "awaiting-curator");
  assert.equal(h.calls.planned, 3); assert.equal(h.calls.generated, 3); assert.equal(h.calls.reviews, 3); assert.equal(h.calls.published, 3);
  assert.equal(h.drafts.size, 3);
});

test("an uncertain review consumes its slot and leaves the preview private", async () => {
  const h = harness(); h.ports.review = async () => { h.calls.reviews++; throw Error("review timeout"); };
  await assert.rejects(h.finish(), /review timeout/); h.restart();
  const result = await h.run(); assert.equal(result.status, "halted"); assert.match(result.reason, /uncertain/);
  assert.equal(h.calls.reviews, 1); assert.equal(h.calls.generated, 1); assert.equal(h.calls.published, 0);
});

test("a failed quality check never publishes or generates a replacement", async () => {
  const h = harness(); h.ports.review = async () => ({ ok: false });
  assert.equal((await h.finish()).status, "halted"); h.restart(); assert.equal((await h.run()).status, "halted");
  assert.equal(h.calls.generated, 1); assert.equal(h.calls.published, 0);
});

test("an explicitly revised policy can recheck one failed image, preserving its expense and three-scene cap", async () => {
  const h = harness(); let checks = 0;
  h.ports.review = async () => { h.calls.reviews++; return { ok: ++checks > 1 }; };
  assert.equal((await h.finish()).status, "halted");
  h.p.maxVisionReviews = 4; h.p.recheckOperationId = h.state.turns[0].operationId;
  await assert.rejects(h.run(), /different policy/);
  h.state.policyDigest = policyDigest(h.p);
  await assert.rejects(h.run(), /exact mission/);
  h.consent.policyDigest = policyDigest(h.p);
  assert.equal((await h.finish()).status, "awaiting-curator");
  assert.equal(h.calls.reviews, 4); assert.equal(h.calls.generated, 3); assert.equal(h.calls.published, 3);
  assert.equal(h.state.turns[0].reviewHistory[0].review.ok, false);
  assert.equal(h.state.recheckUsed, h.state.turns[0].operationId);
});

test("the one approved recheck cannot repeat itself after a second rejection", async () => {
  const h = harness(); h.ports.review = async () => { h.calls.reviews++; return { ok: false }; };
  await h.finish(); h.p.maxVisionReviews = 4; h.p.recheckOperationId = h.state.turns[0].operationId;
  h.state.policyDigest = h.consent.policyDigest = policyDigest(h.p);
  assert.equal((await h.run()).status, "halted"); h.restart();
  assert.equal((await h.run()).status, "halted");
  assert.equal(h.calls.reviews, 2); assert.equal(h.calls.generated, 1); assert.equal(h.calls.published, 0);
});

test("a review correction cannot silently replace an uncertain review or changed pixels", async () => {
  const h = harness(); h.ports.review = async () => { h.calls.reviews++; throw Error("timeout"); };
  await assert.rejects(h.finish(), /timeout/); h.restart(); await h.run();
  h.p.maxVisionReviews = 4; h.p.recheckOperationId = h.state.turns[0].operationId;
  h.state.policyDigest = h.consent.policyDigest = policyDigest(h.p);
  assert.equal((await h.run()).status, "halted"); assert.equal(h.calls.reviews, 1);
  const changed = harness(); changed.ports.review = async () => ({ ok: false }); await changed.finish();
  changed.p.maxVisionReviews = 4; changed.p.recheckOperationId = changed.state.turns[0].operationId;
  changed.state.policyDigest = changed.consent.policyDigest = policyDigest(changed.p);
  changed.ports.preview = async () => ({ sha256: "b".repeat(64) });
  await assert.rejects(changed.run(), /rechecked preview changed/);
});

for (const interruption of ["stop", "expire"]) test(`${interruption} during review prevents publication`, async () => {
  const h = harness(); h.ports.review = async () => { h[interruption](); return { ok: true }; };
  await assert.rejects(h.finish(), interruption === "stop" ? /STOP/ : /expired/);
  assert.equal(h.calls.published, 0);
});

test("changing the image after review stops publication", async () => {
  const h = harness(); let read = 0;
  h.ports.preview = async () => ({ sha256: (++read === 1 ? "a" : "b").repeat(64), bytes: Buffer.from("image") });
  await assert.rejects(h.finish(), /reviewed image changed/); assert.equal(h.calls.published, 0);
});

test("foreign operations and expanded panel counts stop before generation", async () => {
  const h = harness(), draft = h.ports.draft;
  h.ports.draft = async turn => ({ ...await draft(turn), maker_id: randomUUID() });
  await assert.rejects(h.run(), /does not belong/); assert.equal(h.calls.generated, 0);
  const more = harness(); more.ports.plan = async () => ({ captions: ["one", "two"], twists: [] });
  await assert.rejects(more.run(), /exactly one/); assert.equal(more.calls.generated, 0);
});

test("authorization is exact, finite and cannot be expanded by changing the policy", async () => {
  const p = policy(); assert.equal(validatePolicy(p), p); authorize(p, approval(p), now);
  for (const patch of [{ maxScenes: 4 }, { maxCredits: 4 }, { maxVisionReviews: 4 }, { maxVisionReviews: 5, recheckOperationId: randomUUID() }, { roomId: "night-shift" }, { origin: "https://evil.example" }, { chainId: 1 }, { makerId: randomUUID() }, { maxGasWei: parseEther("1").toString() }])
    assert.throws(() => validatePolicy({ ...p, ...patch }));
  assert.throws(() => authorize(p, null, now), /activation/);
  assert.throws(() => authorize({ ...p, parentId: randomUUID() }, approval(p), now), /exact mission/);
  assert.throws(() => authorize(p, { ...approval(p), expiresAt: new Date(now + 7200000).toISOString() }, now), /one-hour/);
});

test("a generation failure preserves the consumed attempt instead of replacing its ID", async () => {
  const h = harness(); await h.run(); h.operations.values().next().value.status = "failed";
  assert.equal((await h.run()).status, "halted"); assert.equal(h.state.turns.length, 1); assert.equal(h.calls.generated, 1);
});

async function signedFixture(patch = {}) {
  const h = harness(); await h.finish();
  const first = h.state.turns[0];
  const parent = { id: h.p.parentId, room_id: h.p.roomId, parent_id: null, maker_id: null, maker_label: "Prepared story", title: "Root",
    panels: [{ caption: "Mika waits.", imageUrl: "/art/night-shift-neon.webp#frame=0" }], created_at: "2026-10-18T00:00:00+00:00" };
  const all = [parent, ...h.published.values()];
  const { data } = registrationData(h.p, first, all);
  const raw = await wallet.signTransaction({ type: 0, chainId: 10143, to: h.p.contract, value: 0n, data, nonce: 0, gasLimit: 200000n, gasPrice: 100000000000n, ...patch });
  first.registration = { raw, hash: keccak256(raw) };
  return { h, first, data, all };
}

test("the signer accepts only its exact scene registration and cumulative gas budget", async () => {
  const { h, first, data, all } = await signedFixture();
  assert.equal(validateSignedRegistration(h.p, first, h.state, data).from, wallet.address);
  const changed = structuredClone(all); changed[1].created_at = "2026-10-19T02:00:00.000Z";
  const different = registrationData(h.p, first, changed).data;
  assert.notEqual(different, data); assert.throws(() => validateSignedRegistration(h.p, first, h.state, different), /only this/);
  h.p.maxGasWei = "1"; assert.throws(() => validateSignedRegistration(h.p, first, h.state, data), /cumulative/);
});

for (const [name, patch] of Object.entries({ transfer: { value: 1n }, calldata: { data: "0x" }, network: { chainId: 1 }, destination: { to: Wallet.createRandom().address }, gas: { gasLimit: 300001n }, nonce: { nonce: 1 } }))
  test(`the signer rejects a changed ${name}`, async () => {
    const { h, first, data } = await signedFixture(patch);
    assert.throws(() => validateSignedRegistration(h.p, first, h.state, data));
  });
