"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Lightbulb,
  Plus,
  Shuffle,
  Sparkles,
  Undo2,
  X,
} from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { pilotPanels, type PilotMoment } from "@/lib/pilot";
import {
  MAX_PILOT_PANELS,
  panelsFromThought,
  pilotCreditCost,
  validPilotCaptions,
} from "@/lib/pilot-format";
import {
  IDEA_DRAG_TYPE,
  composerVersion,
  parseShapeResult,
  previewSignature,
  shapeSignature,
  type ComposerDraft,
  type ShapeResult,
} from "@/lib/pilot-composer";
import { PilotImage } from "./pilot-panels";
import { PilotVoice } from "./pilot-voice";

const angles = [
  {
    label: "Follow a detail",
    question:
      "Pick one small thing in this moment. What if it mattered more than anyone realized?",
  },
  {
    label: "Turn it around",
    question:
      "What if the thing everyone wants is the very thing they should avoid?",
  },
  {
    label: "Let it breathe",
    question:
      "Stay here for a moment. What would someone notice if nothing hurried them along?",
  },
];

export function PilotComposer({
  client,
  draft,
  parent,
  busy,
  credits,
  onChange,
  onGenerate,
  onCancel,
  onIdea,
  onInspect,
  inspecting,
}: {
  client: SupabaseClient<Database>;
  draft: ComposerDraft;
  parent: PilotMoment;
  busy: boolean;
  credits?: { enabled: boolean; available: number };
  onChange: (next: ComposerDraft) => boolean;
  onGenerate: () => void;
  onCancel: () => void;
  onIdea: (id: string) => void;
  onInspect: () => void;
  inspecting: boolean;
}) {
  const [helpers, setHelpers] = useState({ voice: false, shape: false });
  const [checking, setChecking] = useState(true);
  const [shaping, setShaping] = useState<"shape" | "twists" | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [twists, setTwists] = useState<ShapeResult["twists"]>([]);
  const [angle, setAngle] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const current = useRef(draft);
  const mounted = useRef(false);
  const flight = useRef<AbortController | null>(null);
  const lock = useRef(false);
  const thoughtField = useRef<HTMLTextAreaElement>(null);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const panelFields = useRef<(HTMLTextAreaElement | null)[]>([]);
  current.current = draft;
  const frozen = busy || !!draft.submitted || !!shaping || speaking;
  const preview =
    draft.stage === "preview" ||
    (draft.stage === undefined && draft.captions.some(Boolean));
  const hasWords = !!(draft.thought?.trim() || draft.idea?.body.trim());
  const count = draft.captions.length;
  const cost = count > 0 ? pilotCreditCost(count) : 1;
  const sourcePanels = pilotPanels(parent.panels);
  const panel = sourcePanels[0];
  async function headers() {
    const session = await client.auth.getSession();
    if (session.error || !session.data.session)
      throw new Error(
        "Reconnect your guest session. Your draft is still here.",
      );
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.data.session.access_token}`,
    };
  }
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void (async () => {
      const response = await fetch(
        `/api/pilot/assist?room=${encodeURIComponent(draft.roomId)}`,
        { headers: await headers(), signal: controller.signal },
      );
      const result = await response.json();
      if (mounted.current && response.ok)
        setHelpers({
          voice: result.voice === true,
          shape: result.shape === true,
        });
    })()
      .catch(() => {})
      .finally(() => {
        if (mounted.current) setChecking(false);
      });
    return () => {
      mounted.current = false;
      controller.abort();
      flight.current?.abort();
    };
  }, [client, draft.roomId]);
  useEffect(() => {
    for (const field of [thoughtField.current, ...panelFields.current]) {
      if (field) {
        field.style.height = "auto";
        field.style.height = `${field.scrollHeight}px`;
      }
    }
  }, [draft.thought, draft.captions, preview]);
  function update(patch: Partial<ComposerDraft>) {
    const next = { ...current.current, ...patch };
    current.current = next;
    return onChange(next);
  }
  function focusPreview() {
    requestAnimationFrame(() => previewHeading.current?.focus());
  }
  function receiveWords(words: string) {
    const thought = [current.current.thought?.trim(), words]
      .filter(Boolean)
      .join(" ");
    if (thought.length > 2000) {
      update({ pendingSpeech: { text: words, reason: "overflow" } });
      setError(
        "That recording needs a little trimming. Shorten it below, then add it to your idea.",
      );
      return;
    }
    update({ thought, pendingSpeech: undefined, stage: "idea" });
    setError("");
    setNotice(
      "Your words are here. Keep playing, or see how they look as panels.",
    );
    requestAnimationFrame(() => thoughtField.current?.focus());
  }
  async function token() {
    const d = current.current;
    const response = await fetch("/api/pilot/voice-token", {
      method: "POST",
      headers: await headers(),
      body: JSON.stringify({
        requestId: crypto.randomUUID(),
        roomId: d.roomId,
        parentId: d.parentId,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(
        result.error ?? "Voice could not start. You can write your idea.",
      );
    return result;
  }
  function previewOwnWords() {
    if (frozen || draft.pendingSpeech) return;
    setError("");
    setNotice("");
    const d = current.current;
    const signature = previewSignature(d);
    if (d.captions.some(Boolean) && d.previewInput === signature) {
      update({ stage: "preview" });
      focusPreview();
      return;
    }
    try {
      const captions = panelsFromThought(
        d.thought?.trim() || d.idea?.body || "",
      );
      update({
        captions,
        previewInput: signature,
        stage: "preview",
        undo: composerVersion(d),
        assist: undefined,
      });
      focusPreview();
    } catch (reason) {
      setError((reason as Error).message);
    }
  }
  async function shape(mode: "shape" | "twists") {
    if (lock.current || frozen || draft.pendingSpeech) return;
    lock.current = true;
    setShaping(mode);
    setError("");
    setNotice("");
    const d = current.current;
    const signature = shapeSignature(
      d.thought ?? "",
      d.captions,
      mode,
      d.idea?.id,
    );
    const requestId =
      d.assist?.signature === signature
        ? d.assist.requestId
        : crypto.randomUUID();
    const controller = new AbortController();
    flight.current = controller;
    try {
      if (!update({ assist: { requestId, signature } }))
        throw new Error(
          "This browser could not save your helper request. Keep the page open and try again.",
        );
      const response = await fetch("/api/pilot/assist", {
        method: "POST",
        headers: await headers(),
        body: JSON.stringify({
          requestId,
          roomId: d.roomId,
          parentId: d.parentId,
          thought: d.thought ?? "",
          captions: d.captions,
          ideaId: d.idea?.id,
          mode,
        }),
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(40000),
        ]),
      });
      const result = await response.json();
      if (!mounted.current) return;
      if (!response.ok) {
        if (result.newRequest) update({ assist: undefined });
        throw new Error(
          result.error ??
            "The helper could not finish. Your words are still here.",
        );
      }
      if (
        shapeSignature(
          current.current.thought ?? "",
          current.current.captions,
          mode,
          current.current.idea?.id,
        ) !== signature
      )
        throw new Error(
          "Your idea changed while the helper was working. Your newer draft is kept; try again when ready.",
        );
      const shaped = parseShapeResult(result.draft);
      if (mode === "twists") {
        setTwists(shaped.twists);
        setNotice(
          "A couple of possible directions. Keep only what feels like yours.",
        );
      } else {
        update({
          captions: shaped.captions,
          previewInput: previewSignature(d),
          stage: "preview",
          undo: composerVersion(d),
          assist: undefined,
        });
        setTwists([]);
        setNotice(
          "A suggested layout. Edit it, let it grow, or keep just one scene.",
        );
        focusPreview();
      }
    } catch (reason) {
      if (mounted.current)
        setError(
          reason instanceof Error &&
            reason.name !== "TimeoutError" &&
            !(reason instanceof TypeError)
            ? reason.message
            : "The helper took too long. Try again to check the same request.",
        );
    } finally {
      lock.current = false;
      if (mounted.current) setShaping(null);
    }
  }
  function drop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (!frozen) onIdea(event.dataTransfer.getData(IDEA_DRAG_TYPE));
  }
  function changeSequence(captions: string[], focus: number) {
    update({
      captions,
      undo: composerVersion(current.current),
      assist: undefined,
    });
    setNotice("");
    requestAnimationFrame(() => panelFields.current[focus]?.focus());
  }
  return (
    <section className="pilot-composer" aria-label="Develop your continuation">
      <div className="pilot-composer-source">
        <span className="pilot-source-thumb">
          <PilotImage client={client} panel={panel} allowRetry={false} />
        </span>
        <p>
          Continuing from <strong>{parent.title}</strong>
          <span>by {parent.maker_label}</span>
        </p>
        <button
          type="button"
          className="text-button"
          aria-expanded={inspecting}
          onClick={onInspect}
        >
          {inspecting ? "Tuck panels away" : "Look at the panels"}
        </button>
      </div>
      <div
        className={`pilot-idea-pocket ${dragging ? "is-dragging" : ""} ${draft.idea ? "has-idea" : ""}`}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes(IDEA_DRAG_TYPE) && !frozen) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            setDragging(true);
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node))
            setDragging(false);
        }}
        onDrop={drop}
      >
        {draft.idea ? (
          <div className="pilot-carried-idea" key={draft.idea.id}>
            <div>
              <Lightbulb size={17} />
              <strong>Starting with {draft.idea.label}’s idea</strong>
              <button
                type="button"
                className="text-button"
                aria-label="Remove source idea"
                disabled={frozen}
                onClick={() => update({ idea: undefined })}
              >
                <X size={17} />
              </button>
            </div>
            <p>{draft.idea.body}</p>
            <small>Your published moment will be credited to you.</small>
          </div>
        ) : (
          <p>
            <Lightbulb size={18} />
            <span>
              Borrow a spark from the room.
              <br />
              <small>Drag a note here, or choose “Use this idea.”</small>
            </span>
          </p>
        )}
      </div>

      {!preview ? (
        <div className="pilot-idea-space">
          <div className="pilot-idea-title">
            <label htmlFor="pilot-thought">Where could this go?</label>
            <span>One little scene is enough.</span>
          </div>
          <div className="pilot-writing-surface">
            <textarea
              ref={thoughtField}
              id="pilot-thought"
              rows={3}
              maxLength={2000}
              value={draft.thought ?? ""}
              disabled={frozen}
              onChange={(event) => {
                update({ thought: event.target.value });
                setTwists([]);
              }}
              placeholder={
                draft.idea
                  ? "Yes, and what if…"
                  : "A wild turn. A tiny detail. Something you can almost picture…"
              }
            />
            <PilotVoice
              enabled={helpers.voice}
              disabled={
                busy || !!draft.submitted || !!shaping || !!draft.pendingSpeech
              }
              token={token}
              onText={receiveWords}
              onRecovered={(text) =>
                update({ pendingSpeech: { text, reason: "interrupted" } })
              }
              onBusy={setSpeaking}
            />
          </div>
          <div
            className="pilot-play-angles"
            aria-label="Optional writing prompts"
          >
            <span>Try another angle</span>
            {angles.map((item, index) => (
              <button
                type="button"
                key={item.label}
                className="text-button"
                aria-pressed={angle === index}
                disabled={frozen}
                onClick={() => setAngle(angle === index ? null : index)}
              >
                {item.label}
              </button>
            ))}
          </div>
          {angle !== null && (
            <div className="pilot-play-prompt" role="status">
              <p>{angles[angle].question}</p>
              <blockquote>
                {draft.idea?.body || sourcePanels.at(-1)!.caption}
              </blockquote>
              <small>
                {draft.idea
                  ? `A thought to try with ${draft.idea.label}’s idea.`
                  : "A thought to try with the moment you’re continuing."}
              </small>
            </div>
          )}
          <div className="pilot-shape-actions">
            <button
              type="button"
              className="button primary"
              disabled={frozen || !!draft.pendingSpeech || !hasWords}
              onClick={previewOwnWords}
            >
              Preview my idea <ArrowRight size={17} />
            </button>
            {helpers.shape && (
              <button
                type="button"
                className="text-button"
                disabled={frozen || !!draft.pendingSpeech || !hasWords}
                onClick={() => void shape("twists")}
              >
                <Shuffle size={16} />
                {shaping === "twists"
                  ? "Exploring possibilities…"
                  : "Explore possibilities"}
              </button>
            )}
            {count > 0 && draft.captions.some(Boolean) && (
              <button
                type="button"
                className="text-button"
                disabled={frozen}
                onClick={() => {
                  update({ stage: "preview" });
                  focusPreview();
                }}
              >
                Return to saved preview
              </button>
            )}
          </div>
          <p className="pilot-helper-copy">
            Previewing uses your words. Images come later, when you choose.
          </p>
          {checking && (
            <p className="pilot-helper-copy" role="status">
              Checking voice and story helpers…
            </p>
          )}
          {twists.length > 0 && (
            <div
              className="pilot-possibilities"
              aria-label="Possible directions"
            >
              {twists.map((twist, index) => (
                <div key={index}>
                  <h4>{twist.label}</h4>
                  <p>{twist.thought}</p>
                  <button
                    type="button"
                    className="text-button"
                    disabled={frozen}
                    onClick={() => {
                      update({
                        thought: twist.thought,
                        stage: "idea",
                        undo: composerVersion(current.current),
                        assist: undefined,
                      });
                      setTwists([]);
                      setNotice(
                        "Try it on. Your earlier idea is one Undo away.",
                      );
                      requestAnimationFrame(() =>
                        thoughtField.current?.focus(),
                      );
                    }}
                  >
                    Play with this <ArrowRight size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <section
          className="pilot-sequence-preview"
          aria-label="Your panel preview"
        >
          <button
            type="button"
            className="text-button"
            disabled={frozen}
            onClick={() => {
              update({ stage: "idea" });
              setNotice("");
              requestAnimationFrame(() => thoughtField.current?.focus());
            }}
          >
            <ArrowLeft size={15} />
            Back to the idea
          </button>
          <div className="pilot-sequence-heading">
            <h3 ref={previewHeading} tabIndex={-1}>
              {count === 1 ? "A moment of its own" : "Let it unfold"}
            </h3>
            <span>
              {count} {count === 1 ? "panel" : "panels"}
            </span>
          </div>
          <p className="pilot-helper-copy">
            Words for now. Edit directly; add a panel only if there’s more to
            tell.
          </p>
          <div className="pilot-panel-drafts">
            {draft.captions.map((caption, index) => (
              <div className="pilot-panel-draft" key={index}>
                <div className="pilot-panel-draft-bar">
                  <label htmlFor={`pilot-panel-${index}`}>
                    Panel {index + 1}
                  </label>
                  <div className="pilot-panel-tools">
                    {count > 1 && (
                      <>
                        <button
                          type="button"
                          className="text-button"
                          aria-label={`Move panel ${index + 1} earlier`}
                          disabled={frozen || index === 0}
                          onClick={() => {
                            const captions = [...draft.captions];
                            [captions[index - 1], captions[index]] = [
                              captions[index],
                              captions[index - 1],
                            ];
                            changeSequence(captions, index - 1);
                          }}
                        >
                          <ArrowUp size={15} />
                        </button>
                        <button
                          type="button"
                          className="text-button"
                          aria-label={`Move panel ${index + 1} later`}
                          disabled={frozen || index === count - 1}
                          onClick={() => {
                            const captions = [...draft.captions];
                            [captions[index + 1], captions[index]] = [
                              captions[index],
                              captions[index + 1],
                            ];
                            changeSequence(captions, index + 1);
                          }}
                        >
                          <ArrowDown size={15} />
                        </button>
                        <button
                          type="button"
                          className="text-button"
                          aria-label={`Remove panel ${index + 1}`}
                          disabled={frozen}
                          onClick={() =>
                            changeSequence(
                              draft.captions.filter((_, n) => n !== index),
                              Math.max(0, index - 1),
                            )
                          }
                        >
                          <X size={16} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <textarea
                  ref={(node) => {
                    panelFields.current[index] = node;
                  }}
                  id={`pilot-panel-${index}`}
                  maxLength={500}
                  rows={2}
                  value={caption}
                  disabled={frozen}
                  placeholder="What do you picture here?"
                  onChange={(event) => {
                    const captions = [...draft.captions];
                    captions[index] = event.target.value;
                    update({ captions });
                  }}
                />
              </div>
            ))}
          </div>
          <div className="pilot-sequence-options">
            {count < MAX_PILOT_PANELS && (
              <button
                type="button"
                className="text-button"
                disabled={frozen}
                onClick={() => changeSequence([...draft.captions, ""], count)}
              >
                <Plus size={17} />
                Let it continue
              </button>
            )}
            {helpers.shape && (
              <button
                type="button"
                className="text-button"
                disabled={frozen || !!draft.pendingSpeech}
                onClick={() => void shape("shape")}
              >
                <Sparkles size={16} />
                {shaping === "shape"
                  ? "Finding the shape…"
                  : "Suggest a layout"}
              </button>
            )}
          </div>
          <div className="pilot-generate-action">
            <button
              type="button"
              className="button primary"
              disabled={
                busy ||
                !!draft.pendingSpeech ||
                speaking ||
                !!shaping ||
                !validPilotCaptions(draft.captions) ||
                !credits?.enabled ||
                credits.available < cost
              }
              onClick={onGenerate}
            >
              <Sparkles size={18} />
              {busy
                ? "Saving your idea…"
                : draft.submitted
                  ? "Retry saving this preview"
                  : `Generate ${count} ${count === 1 ? "panel" : "panels"}`}
            </button>
            <p>
              <strong>
                {cost} room {cost === 1 ? "credit" : "credits"}
              </strong>{" "}
              · Review before publishing.
            </p>
            <small>
              {!credits?.enabled
                ? "Image generation is paused. Your draft is saved here."
                : credits.available < cost
                  ? "This room needs more credits. Your draft is saved here."
                  : "Used only when every panel arrives. One or two panels: 1 credit. Three: 2 credits."}
            </small>
          </div>
        </section>
      )}
      {draft.pendingSpeech && (
        <div className="pilot-field">
          <label htmlFor="pilot-overflow">Your saved recording</label>
          <p className="pilot-helper-copy">
            {draft.pendingSpeech.reason === "overflow"
              ? "Your thought and recording need to fit within 2,000 characters together. Shorten either one, then add the words."
              : "The connection stopped. These confirmed words are saved here for you to review."}{" "}
            Keep or discard them before previewing or generating.
          </p>
          <textarea
            id="pilot-overflow"
            maxLength={4000}
            value={draft.pendingSpeech.text}
            onChange={(event) =>
              update({
                pendingSpeech: {
                  ...draft.pendingSpeech!,
                  text: event.target.value,
                },
              })
            }
          />
          <button
            type="button"
            className="text-button"
            onClick={() => receiveWords(draft.pendingSpeech!.text)}
          >
            Add these words
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              update({ pendingSpeech: undefined });
              setError("");
            }}
          >
            Discard recorded words
          </button>
        </div>
      )}
      {notice && (
        <p className="pilot-composer-notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="pilot-inline-notice" role="alert">
          {error}
        </p>
      )}
      <div className="pilot-composer-footer">
        {draft.undo && (
          <button
            type="button"
            className="text-button"
            disabled={frozen || !!draft.pendingSpeech}
            onClick={() => {
              update({ ...draft.undo, undo: undefined, assist: undefined });
              setTwists([]);
              setNotice("Your earlier version is back.");
              setError("");
            }}
          >
            <Undo2 size={15} />
            Undo last change
          </button>
        )}
        {!draft.submitted && (
          <button
            type="button"
            className="text-button pilot-cancel-draft"
            disabled={busy || !!shaping || speaking}
            onClick={onCancel}
          >
            Cancel draft
          </button>
        )}
      </div>
    </section>
  );
}
