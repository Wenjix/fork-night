import { isUuid } from "./pilot.ts";
import { validPilotCaptions } from "./pilot-format.ts";

export type ComposerVersion = {
  captions: string[];
  thought?: string;
  stage?: "idea" | "preview";
  previewInput?: string;
};

export type IdeaSource = {
  id: string;
  momentId: string;
  label: string;
  body: string;
};
export type ComposerDraft = {
  requestId: string;
  parentId: string;
  roomId: string;
  captions: string[];
  thought?: string;
  stage?: "idea" | "preview";
  previewInput?: string;
  undo?: ComposerVersion;
  pendingSpeech?: { text: string; reason: "overflow" | "interrupted" };
  idea?: IdeaSource;
  suggestedSecond?: boolean;
  assist?: { requestId: string; signature: string };
  submitted?: boolean;
};
export type ShapeResult = {
  captions: string[];
  twists: { label: string; thought: string }[];
};
export const IDEA_DRAG_TYPE = "application/x-fork-night-idea";
export const VOICE_SECONDS = 30;

export function parseComposerDraft(
  raw: unknown,
  roomId: string,
): ComposerDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as ComposerDraft;
  if (
    d.roomId !== roomId ||
    !isUuid(d.requestId) ||
    !isUuid(d.parentId) ||
    !validVersion(d) ||
    (d.submitted === true && !validPilotCaptions(d.captions)) ||
    (d.undo !== undefined && !validVersion(d.undo)) ||
    (d.thought !== undefined &&
      (typeof d.thought !== "string" || d.thought.length > 2000)) ||
    (d.submitted !== undefined && typeof d.submitted !== "boolean") ||
    (d.suggestedSecond !== undefined && typeof d.suggestedSecond !== "boolean")
  )
    return null;
  if (
    d.idea &&
    (!isUuid(d.idea.id) ||
      d.idea.momentId !== d.parentId ||
      typeof d.idea.label !== "string" ||
      d.idea.label.length > 60 ||
      typeof d.idea.body !== "string" ||
      d.idea.body.length > 500)
  )
    return null;
  if (
    d.assist &&
    (!isUuid(d.assist.requestId) ||
      typeof d.assist.signature !== "string" ||
      d.assist.signature.length > 8000)
  )
    return null;
  if (
    d.pendingSpeech &&
    (typeof d.pendingSpeech.text !== "string" ||
      d.pendingSpeech.text.length > 4000 ||
      !["overflow", "interrupted"].includes(d.pendingSpeech.reason))
  )
    return null;
  return d;
}

function validVersion(value: unknown): value is ComposerVersion {
  const v = value as ComposerVersion;
  return (
    !!v &&
    validPilotCaptions(v.captions, true) &&
    (v.thought === undefined ||
      (typeof v.thought === "string" && v.thought.length <= 2000)) &&
    (v.stage === undefined || v.stage === "idea" || v.stage === "preview") &&
    (v.previewInput === undefined ||
      (typeof v.previewInput === "string" && v.previewInput.length <= 4000))
  );
}

export function composerVersion(draft: ComposerDraft): ComposerVersion {
  return {
    captions: [...draft.captions],
    thought: draft.thought,
    stage: draft.stage,
    previewInput: draft.previewInput,
  };
}

export function previewSignature(draft: ComposerDraft): string {
  return JSON.stringify({
    thought: draft.thought ?? "",
    idea: draft.idea?.id ?? null,
  });
}

export function parseShapeResult(raw: unknown): ShapeResult {
  let r = raw as ShapeResult;
  const beat = (s: unknown) =>
    typeof s === "string" && s.trim().length > 0 && s.length <= 500;
  // Older completed helper turns remain readable after the schema change.
  const legacy = raw as {
    first?: string;
    then?: string;
    suggestedSecond?: boolean;
    twists?: { label: string; first: string; then: string }[];
  };
  if (
    legacy &&
    beat(legacy.first) &&
    beat(legacy.then) &&
    typeof legacy.suggestedSecond === "boolean" &&
    Array.isArray(legacy.twists)
  ) {
    r = {
      captions: [legacy.first!, legacy.then!],
      twists: legacy.twists.map((t) => ({
        label: t.label,
        thought: beat(t.first) && beat(t.then) ? `${t.first} ${t.then}` : "",
      })),
    };
  }
  if (
    !r ||
    !validPilotCaptions(r.captions) ||
    !Array.isArray(r.twists) ||
    r.twists.length > 3 ||
    !r.twists.every(
      (t) =>
        t &&
        typeof t.label === "string" &&
        t.label.trim() &&
        t.label.length <= 80 &&
        typeof t.thought === "string" &&
        t.thought.trim().length > 0 &&
        t.thought.length <= 1500,
    )
  ) {
    throw new Error(
      "The story helper returned an incomplete draft. Your words are still here.",
    );
  }
  return r;
}

/** Final Ink-2 messages are deltas, including their own spaces. Interim
 * messages replace the current interim fragment and never enter final text. */
export function inkTranscript(
  current: { final: string; interim: string },
  event: unknown,
) {
  const e = event as { type?: string; text?: string; is_final?: boolean };
  if (e?.type !== "transcript" || typeof e.text !== "string") return current;
  const next = e.is_final
    ? { final: current.final + e.text, interim: "" }
    : { ...current, interim: e.text };
  if (next.final.length + next.interim.length > 4000)
    throw new Error("That thought is too long. Try a shorter recording.");
  return next;
}

export function shapeSignature(
  thought: string,
  captions: string[],
  mode: "shape" | "twists",
  ideaId?: string,
) {
  return JSON.stringify({ format: 2, thought, captions, mode, ideaId });
}
