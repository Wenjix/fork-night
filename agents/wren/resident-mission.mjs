import { createHash, randomUUID } from "node:crypto";
import { getAddress, parseEther } from "ethers";
import { WREN } from "../../src/lib/agents/wren.ts";
import { TERMS_HASH } from "../../src/lib/onchain/model.ts";
import { parseProgressionPlan, parseProgressionReview } from "../../src/lib/wren-progression.ts";

export const RESIDENT_ROOM = "kessler-ward";
export const RESIDENT_ORIGIN = "https://fork-night.vercel.app";
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const ensure = (ok, message) => { if (!ok) throw new Error(message); };
export const policyDigest = policy => createHash("sha256").update(JSON.stringify(policy)).digest("hex");

export function validatePolicy(policy) {
  ensure([1, 2].includes(policy?.version) && uuid.test(policy.id), "Invalid resident mission.");
  ensure(policy.roomId === RESIDENT_ROOM && policy.origin === RESIDENT_ORIGIN, "This mission is confined to Kessler Ward.");
  ensure(uuid.test(policy.parentId) && policy.makerId === WREN.profileId, "Use Wren's existing identity and a published parent.");
  ensure(policy.byline === WREN.displayName && getAddress(policy.wallet) === policy.wallet, "The resident byline or wallet changed.");
  ensure(policy.maxScenes === 3 && policy.maxCredits === 3 && policy.durationSeconds === 3600, "This mission permits three one-panel scenes in one hour.");
  ensure((policy.maxVisionReviews ?? 3) === 3 && policy.recheckOperationId === undefined || policy.maxVisionReviews === 4 && uuid.test(policy.recheckOperationId),
    "An extra review needs a revised policy naming the exact failed operation.");
  ensure(typeof policy.brief === "string" && policy.brief.trim().length > 0 && policy.brief.length <= 500, "Use a brief of 1–500 characters.");
  ensure(policy.chainId === 10143 && getAddress(policy.contract) === policy.contract && getAddress(policy.curator) === policy.curator, "Use the configured Monad testnet release.");
  ensure(policy.termsHash === TERMS_HASH, "Review the current release terms.");
  ensure(/^\d+$/.test(policy.maxGasWei) && BigInt(policy.maxGasWei) > 0n && BigInt(policy.maxGasWei) <= parseEther("0.1"), "The whole mission may commit at most 0.1 test MON in gas.");
  if (policy.version === 2) {
    ensure(uuid.test(policy.previousMissionId) && /^[a-f0-9]{64}$/.test(policy.previousPolicyDigest), "Continue a recorded completed mission.");
    ensure(Number.isSafeInteger(policy.initialNonce) && policy.initialNonce > 0 && policy.initialNonce <= 9 && policy.priorOperations?.length === policy.initialNonce,
      "The continuation must preserve the prior operations and wallet nonce.");
    ensure(policy.priorOperations.every(op => [op.id, op.requestId, op.momentId].every(id => uuid.test(id))) && policy.priorOperations.at(-1).momentId === policy.parentId,
      "Continue the completed branch without replacing its published history.");
    const ids = [...policy.priorOperations.map(op => op.requestId), ...(policy.draftRequestIds ?? []), ...(policy.planningRequestIds ?? [])];
    ensure(policy.draftRequestIds?.length === 3 && policy.planningRequestIds?.length === 2 && ids.every(id => uuid.test(id)) && new Set(ids).size === ids.length,
      "The continuation permits exactly three new drafts and two planning calls.");
  } else ensure(policy.initialNonce === undefined && policy.priorOperations === undefined, "The first mission requires a fresh wallet.");
  return policy;
}

export function authorize(policy, approval, now = Date.now()) {
  validatePolicy(policy);
  const start = Date.parse(approval?.authorizedAt), end = Date.parse(approval?.expiresAt);
  ensure(approval?.policyDigest === policyDigest(policy) && approval?.publish === true && approval?.termsHash === TERMS_HASH,
    "This exact mission needs the operator's activation approval and release terms acceptance.");
  ensure(Number.isFinite(start) && Number.isFinite(end) && start <= now && now < end && end > start && end - start <= policy.durationSeconds * 1000,
    "The resident mission has not started or its one-hour authorization has expired.");
}

export function newMissionState(policy) {
  validatePolicy(policy);
  return { version: 1, policyDigest: policyDigest(policy), turns: [], walletRequestId: randomUUID() };
}

export function validateState(policy, state) {
  ensure(state?.version === 1 && state.policyDigest === policyDigest(policy), "The saved mission belongs to a different policy.");
  ensure(Array.isArray(state.turns) && state.turns.length <= policy.maxScenes && uuid.test(state.walletRequestId), "Invalid saved mission state.");
  const ids = new Set();
  if (state.progression?.plan) parseProgressionPlan(state.progression.plan);
  if (state.progression?.review) ensure(parseProgressionReview(state.progression.review).ok === state.progression.review.ok, "The saved progression verdict changed.");
  for (const [index, turn] of state.turns.entries()) {
    ensure(turn.number === index + 1 && turn.parentId === (index ? state.turns[index - 1].momentId : policy.parentId), "The mission's saved branch changed.");
    ensure(uuid.test(turn.planId) && uuid.test(turn.draftId) && !ids.has(turn.planId) && !ids.has(turn.draftId) && turn.planId !== turn.draftId, "Request IDs must remain unique.");
    ids.add(turn.planId); ids.add(turn.draftId);
    if (turn.operationId) ensure(uuid.test(turn.operationId), "Invalid saved operation.");
    if (turn.momentId) ensure(uuid.test(turn.momentId) && turn.review?.ok === true, "A published scene requires a passing review.");
    if (policy.version === 2) {
      ensure(turn.draftId === policy.draftRequestIds[index], "This draft is outside the continuation's exact attempt grant.");
      if (turn.plan) ensure(state.progression?.review?.ok === true && ["title", "caption", "change", "resultingState"].every(key => turn.plan[key] === state.progression.plan.scenes[index][key]),
        "The scene differs from the reviewed three-scene plan.");
    }
  }
}

export function checkOperation(policy, turn, operation) {
  ensure(operation?.id === turn.operationId && operation.maker_id === policy.makerId && operation.room_id === policy.roomId && operation.parent_id === turn.parentId,
    "The operation does not belong to this Wren turn.");
  ensure(operation.title === turn.plan.title && operation.requested_captions?.length === 1 && operation.requested_captions[0] === turn.plan.caption,
    "The saved one-panel draft changed.");
  if (["delivered", "published"].includes(operation.status)) ensure(operation.panels?.length === 1 && operation.panels[0].caption === turn.plan.caption,
    "The delivered one-panel scene changed.");
}

export function checkMoment(policy, turn, moment) {
  ensure(moment?.id === turn.momentId && moment.maker_id === policy.makerId && moment.maker_label === policy.byline && moment.room_id === policy.roomId && moment.parent_id === turn.parentId,
    "The published scene does not belong to this Wren branch.");
  ensure(moment.title === turn.plan.title && moment.panels?.length === 1 && moment.panels[0].caption === turn.plan.caption && moment.panels[0].sha256 === turn.previewHash,
    "The published scene differs from Wren's reviewed preview.");
}

/** One saved state machine; retries reuse the same plan, draft, publication and signed transaction. */
export async function advanceMission({ policy, approval, state, ports, save, now = Date.now }) {
  validateState(policy, state);
  const gate = () => { authorize(policy, approval, now()); ports.guard(); };
  gate();
  // Recheck identity, the original registered ancestry and existing published turns on every resume.
  await ports.preflight(state);
  if (state.halted) {
    const recheck = state.turns.find(t => t.operationId === policy.recheckOperationId);
    if (policy.maxVisionReviews === 4 && recheck?.review?.ok === false && !state.recheckUsed && !recheck.momentId) {
      // Only an explicitly revised, separately authorized policy can revisit a known failed verdict.
      // Its original expense and verdict remain recorded; an uncertain result cannot use this path.
      gate();
      recheck.reviewHistory = [...(recheck.reviewHistory ?? []), { sha256: recheck.previewHash, review: recheck.review }];
      delete recheck.review;
      recheck.reviewStarted = false;
      state.recheckUsed = policy.recheckOperationId;
      delete state.halted;
      await save(state);
    } else return { status: "halted", reason: state.halted };
  }
  const halt = async reason => { state.halted = reason; await save(state); return { status: "halted", reason }; };

  if (policy.version === 2) {
    state.progression ??= {};
    if (!state.progression.plan) {
      gate(); state.progression.plan = parseProgressionPlan(await ports.planArc()); await save(state);
    }
    if (!state.progression.review) {
      gate(); state.progression.review = parseProgressionReview(await ports.reviewArc()); await save(state);
    }
    if (!state.progression.review.ok) return halt("The three-scene plan did not pass the progression review. No images are authorized.");
  }

  while (state.turns.length < policy.maxScenes || !state.turns.at(-1)?.momentId) {
    gate();
    let turn = state.turns.at(-1);
    if (!turn || turn.momentId) {
      await ports.capacity(policy.maxScenes - state.turns.length);
      turn = { number: state.turns.length + 1, parentId: turn?.momentId ?? policy.parentId, planId: randomUUID(), draftId: policy.draftRequestIds?.[state.turns.length] ?? randomUUID() };
      state.turns.push(turn);
      await save(state);
    }
    if (!turn.plan) {
      gate();
      if (policy.version === 2) {
        turn.plan = { ...state.progression.plan.scenes[turn.number - 1] };
      } else {
        const draft = await ports.plan(turn);
        ensure(draft?.captions?.length === 1 && draft.twists?.length === 0 && typeof draft.captions[0] === "string" && draft.captions[0].trim().length > 0 && draft.captions[0].length <= 500,
          "Wren did not return exactly one next scene; the same planning request is retained.");
        const caption = draft.captions[0].trim();
        turn.plan = { caption, title: Array.from(caption).slice(0, 70).join("").trimEnd() };
      }
      await save(state);
    }
    if (!turn.operationId) {
      gate();
      const operation = await ports.draft(turn);
      turn.operationId = operation.id;
      checkOperation(policy, turn, operation);
      await save(state);
    }
    let operation = await ports.operation(turn.operationId);
    checkOperation(policy, turn, operation);
    if (["failed", "discarded"].includes(operation.status)) return halt(`Scene ${turn.number} ${operation.status}; no replacement is authorized.`);
    if (operation.status === "draft") {
      gate();
      // Save before sending. A lost acknowledgement is checked using this operation, never a fresh job.
      turn.requested = true; await save(state);
      await ports.generate(turn.operationId);
      return { status: "pending", scene: turn.number };
    }
    if (!["delivered", "published"].includes(operation.status)) return { status: "pending", scene: turn.number, operation: operation.status };
    if (!turn.review) {
      if (operation.status === "published") return halt("A scene was published outside this mission's review; check it before resuming.");
      const preview = await ports.preview(operation);
      if (turn.reviewStarted) return halt(`Scene ${turn.number}'s vision review has an uncertain result. It will not be purchased again.`);
      if (turn.reviewHistory?.length) ensure(preview.sha256 === turn.previewHash, "The explicitly rechecked preview changed.");
      const reviews = state.turns.reduce((count, t) => count + (t.reviewHistory?.length ?? 0) + (t.reviewStarted ? 1 : 0), 0);
      ensure(reviews < (policy.maxVisionReviews ?? 3), "The mission's vision-review allowance is consumed.");
      gate();
      turn.previewHash = preview.sha256; turn.reviewStarted = true; await save(state);
      turn.review = await ports.review(turn, preview);
      ensure(typeof turn.review?.ok === "boolean", "The vision review did not return a verdict.");
      await save(state);
    }
    if (!turn.review.ok) return halt(`Scene ${turn.number} did not pass review; it remains private and consumes its attempt.`);
    if (!turn.momentId) {
      // Re-download and verify even on resume; a saved verdict cannot authorize different pixels.
      const preview = await ports.preview(operation);
      ensure(preview.sha256 === turn.previewHash, "The reviewed image changed before publication.");
      gate();
      const moment = await ports.publish(turn.operationId);
      turn.momentId = moment.id;
      checkMoment(policy, turn, moment);
      await save(state);
    }
  }

  gate();
  if (!await ports.approved()) {
    await ports.requestWallet(state);
    return { status: "awaiting-curator", wallet: policy.wallet, scenes: state.turns.length };
  }
  for (const turn of state.turns) {
    gate();
    if (!await ports.register(turn, state, save, gate)) return { status: "pending-registration", scene: turn.number };
  }
  state.completedAt ??= new Date(now()).toISOString();
  await save(state);
  return { status: "complete", scenes: state.turns.map(turn => ({ number: turn.number, momentId: turn.momentId, transaction: turn.registration?.hash })) };
}
