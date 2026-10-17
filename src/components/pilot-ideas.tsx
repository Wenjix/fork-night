"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, GripVertical, Lightbulb, Plus } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/supabase/database.types";
import { isUuid, type PilotMoment } from "@/lib/pilot";

import { IDEA_DRAG_TYPE } from "@/lib/pilot-composer";
import { definitelyRejected, ideaDraftKey, visitorActor } from "@/lib/pilot-rooms";
import { whileVisible } from "@/lib/visible-interval";
import { usePilotAccount } from "./pilot-account";
import { SectionPlate } from "./visual-plates";

type Idea = Tables<"pilot_ideas">;
type NoteDraft = { requestId: string; body: string; submitted?: boolean };
const order = (a: Idea, b: Idea) =>
  b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id);
const merge = (a: Idea[], b: Idea[]) =>
  [...new Map([...a, ...b].map((note) => [note.id, note])).values()].sort(
    order,
  );

export function PilotIdeas({
  client,
  moment,
  label,
  profile,
  onJoin,
  onUse,
  onSaved,
}: {
  client: SupabaseClient<Database>;
  moment: PilotMoment;
  label: string;
  profile?: Tables<"pilot_profiles">;
  onJoin: (name: string) => Promise<Tables<"pilot_profiles">>;
  onUse: (idea: Idea) => void;
  onSaved?: (idea: Idea) => void;
}) {
  const fieldId = useId();
  const account = usePilotAccount();
  const [notes, setNotes] = useState<Idea[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [newAvailable, setNewAvailable] = useState(false);
  const [readError, setReadError] = useState("");
  const [retry, setRetry] = useState(0);
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<NoteDraft>();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [rejected, setRejected] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const lock = useRef(false);
  const text = useRef<HTMLTextAreaElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const currentNotes = useRef(notes);
  currentNotes.current = notes;
  // Unsent ideas belong to the signed-in account, or to the visitor while signed out.
  // Nothing is read or saved while the account is still loading.
  const actor = profile?.id ?? account?.user?.id ?? (account && !account.loading ? visitorActor : "");
  const draftKey = actor ? ideaDraftKey(actor, moment.room_id, moment.id) : "";
  const lastActor = useRef(actor);
  const restoredKey = useRef("");
  useEffect(() => {
    const previous = lastActor.current;
    // Another account's idea never carries over; a visitor's carries into the account it joins as.
    if (previous && previous !== visitorActor && previous !== actor) {
      setDraft(undefined);
      setEditing(false);
      setRejected(false);
    }
    // A visitor stays the previous actor while its sign-in or join is loading.
    if (actor || previous !== visitorActor) lastActor.current = actor;
    if (!draftKey) return;
    // A cancelled sign-in returns to the same key; an editor closed with "Keep for later" stays closed.
    const reopen = restoredKey.current !== draftKey;
    restoredKey.current = draftKey;
    try {
      const saved = JSON.parse(localStorage.getItem(draftKey) ?? "null");
      if (
        saved &&
        isUuid(saved.requestId) &&
        typeof saved.body === "string" &&
        saved.body.length <= 1000 &&
        (saved.submitted === undefined || typeof saved.submitted === "boolean")
      ) {
        setDraft(saved);
        if (reopen) setEditing(true);
      }
    } catch {
      setError(
        "This browser could not restore your idea. Published ideas still appear below.",
      );
    }
  }, [actor, draftKey]);
  useEffect(() => {
    let active = true,
      running = false,
      initial = true;
    async function load() {
      if (running) return;
      running = true;
      const result = await client
        .from("pilot_ideas")
        .select("*")
        .eq("room_id", moment.room_id)
        .eq("moment_id", moment.id)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(21);
      running = false;
      if (!active) return;
      setLoading(false);
      if (result.error) {
        setReadError(
          "Ideas could not be refreshed. Your saved notes are still here.",
        );
        return;
      }
      setReadError("");
      if (initial) {
        setNotes(result.data.slice(0, 20));
        setHasMore(result.data.length > 20);
        initial = false;
        setNewAvailable(false);
      } else if (
        currentNotes.current.length &&
        result.data.length > 20 &&
        !result.data.some((note) => note.id === currentNotes.current[0].id)
      )
        setNewAvailable(true);
      else setNotes((old) => merge(old, result.data.slice(0, 20)));
    }
    void load();
    const stop = whileVisible(() => void load(), 5000);
    return () => {
      active = false;
      stop();
    };
  }, [client, moment.id, moment.room_id, retry]);
  async function older() {
    const last = notes.at(-1);
    if (!last || loading) return;
    setLoading(true);
    const result = await client
      .from("pilot_ideas")
      .select("*")
      .eq("room_id", moment.room_id)
      .eq("moment_id", moment.id)
      .or(
        `created_at.lt.${last.created_at},and(created_at.eq.${last.created_at},id.lt.${last.id})`,
      )
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(21);
    setLoading(false);
    if (result.error) {
      setReadError("Older ideas could not be loaded. Try again.");
      return;
    }
    setNotes((old) => merge(old, result.data.slice(0, 20)));
    setHasMore(result.data.length > 20);
    setReadError("");
  }
  function update(body: string) {
    const next = { requestId: draft?.requestId ?? crypto.randomUUID(), body };
    setDraft(next);
    if (!draftKey) return;
    try {
      localStorage.setItem(draftKey, JSON.stringify(next));
    } catch {
      setError(
        "This browser cannot save an unfinished idea. Keep this page open until you post it.",
      );
    }
  }
  async function post() {
    if (lock.current || !draft?.body.trim()) return;
    if ([...draft.body.trim()].length > 500) {
      setError("Keep your idea to 500 characters.");
      return;
    }
    lock.current = true;
    setSaving(true);
    setRejected(false);
    setError("");
    setNotice("");
    const input = { ...draft, body: draft.body.trim(), submitted: true };
    try {
      const maker = profile ?? (await onJoin(name));
      const key = ideaDraftKey(maker.id, moment.room_id, moment.id);
      setDraft(input);
      try {
        localStorage.setItem(key, JSON.stringify(input));
        // An idea written as a visitor now belongs to the account that posts it.
        if (draftKey && draftKey !== key) localStorage.removeItem(draftKey);
      } catch {
        setNotice("Keep this page open while your idea is being saved.");
      }
      const result = await client.rpc("pilot_leave_idea", {
        p_request_id: input.requestId,
        p_room_id: moment.room_id,
        p_moment_id: moment.id,
        p_body: input.body,
      });
      if (result.error) {
        // A refused idea recorded nothing, so it opens again to edit or discard.
        // Only an unknown outcome keeps it locked to retry the same request.
        const refused = definitelyRejected(result);
        if (refused) {
          const editable = { ...input, submitted: false };
          setDraft(editable);
          setRejected(true);
          try {
            localStorage.setItem(key, JSON.stringify(editable));
          } catch {
            /* A restored copy stays locked until a retry is refused again. */
          }
        }
        throw new Error(
          result.error.message.includes("30-idea limit")
            ? "You’ve reached the 30-idea limit for this pilot room."
            : refused
              ? "Your idea could not be saved. Edit it and try again, or discard it."
              : "Your idea could not be confirmed. Retry this same idea when connected.",
        );
      }
      if (!result.data || result.data.room_id !== moment.room_id || result.data.moment_id !== moment.id || result.data.maker_id !== maker.id)
        throw new Error("Your idea could not be confirmed. Retry this same idea when connected.");
      setNotes((old) => merge(old, [result.data]));
      setDraft(undefined);
      setEditing(false);
      setNotice("Idea saved for the next storyteller.");
      onSaved?.(result.data);
      try {
        localStorage.removeItem(key);
      } catch {
        /* A restored request is idempotent. */
      }
      requestAnimationFrame(() => trigger.current?.focus());
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not save your idea. Try again.",
      );
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }
  function discard() {
    try {
      if (draftKey) localStorage.removeItem(draftKey);
    } catch {
      setError("This browser could not clear your idea. Try again before leaving.");
      return;
    }
    setDraft(undefined);
    setRejected(false);
    setEditing(false);
    setError("");
    requestAnimationFrame(() => trigger.current?.focus());
  }
  return (
    <aside
      id="pilot-ideas"
      tabIndex={-1}
      className={`pilot-ideas${notes.length ? " has-ideas" : ""}${expanded ? " is-expanded" : ""}`}
      aria-label="Ideas from the room"
    >
      <SectionPlate
        title="Ideas from the room"
        description="A little spark for whoever comes next."
        icon={Lightbulb}
        variant="inline"
        className="pilot-ideas-sign"
      />
      {readError && (
        <div className="pilot-inline-notice" role="status">
          <p>{readError}</p>
          <button
            className="text-button"
            onClick={() => setRetry((n) => n + 1)}
          >
            Retry loading ideas
          </button>
        </div>
      )}
      {newAvailable && (
        <button className="text-button" onClick={() => setRetry((n) => n + 1)}>
          New ideas available · Refresh
        </button>
      )}
      {loading && !notes.length && <p role="status">Loading ideas…</p>}
      <div className="pilot-note-list">
        {notes.map((note) => (
          <article
            className="pilot-sticky"
            key={note.id}
            id={`idea-${note.id}`}
            tabIndex={-1}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData(IDEA_DRAG_TYPE, note.id);
              event.dataTransfer.effectAllowed = "copy";
            }}
          >
            <GripVertical
              className="pilot-note-grip"
              size={16}
              aria-hidden="true"
            />
            <div className="pilot-note-author">
              <span className="pilot-avatar" aria-hidden="true">
                {note.maker_label.slice(0, 1).toUpperCase()}
              </span>
              <span>
                An idea from <strong>{note.maker_label}</strong>
              </span>
            </div>
            <p>{note.body}</p>
            <footer>
              <time dateTime={note.created_at}>
                {new Date(note.created_at).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
              </time>
              <button className="text-button" onClick={() => onUse(note)}>
                <Lightbulb size={16} aria-hidden="true" /> Use this idea <ArrowRight size={16} aria-hidden="true" />
              </button>
            </footer>
          </article>
        ))}
      </div>
      {notes.length > 1 && (
        <button
          className="text-button pilot-more-ideas"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded
            ? "Show fewer ideas"
            : `Show ${notes.length - 1}${hasMore ? "+" : ""} more ${notes.length === 2 && !hasMore ? "idea" : "ideas"}`}
        </button>
      )}
      {hasMore && (
        <button
          className="text-button pilot-older-ideas"
          disabled={loading}
          onClick={() => void older()}
        >
          {loading ? "Loading…" : "Load older ideas"}
        </button>
      )}
      <button
        ref={trigger}
        className="pilot-leave-idea"
        aria-label="Leave an idea for this moment"
        aria-describedby={`${fieldId}-invite-hint`}
        hidden={editing}
        onClick={() => {
          setEditing(true);
          requestAnimationFrame(() => text.current?.focus());
        }}
      >
        <Plus size={24} aria-hidden="true" />
        <strong>
          Leave an idea{" "}
          <span className="pilot-idea-location">
            <br />
            for this moment
          </span>
        </strong>
        <span id={`${fieldId}-invite-hint`}>
          {notes.length
            ? "A new twist, a question, or anything you’re curious about…"
            : "Be the first to leave a twist, a question, or a possibility."}
        </span>
      </button>
      {editing && (
        <form
          className="pilot-note-form"
          onSubmit={(event) => {
            event.preventDefault();
            void post();
          }}
        >
          <h3>Leave an idea</h3>
          <p>Saved on moment {label}, for anyone in this room.</p>
          {!profile && (
            <label>
              Your storyteller name
              <input
                required
                maxLength={60}
                autoComplete="nickname"
                value={name}
                disabled={saving}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
          )}
          <div className="pilot-field">
            <label htmlFor={fieldId}>Your idea</label>
            <textarea
              id={fieldId}
              ref={text}
              required
              rows={5}
              maxLength={500}
              value={draft?.body ?? ""}
              disabled={saving || draft?.submitted}
              onChange={(event) => update(event.target.value)}
              placeholder="What if…"
            />
          </div>
          <small>
            {[...(draft?.body ?? "")].length}/500 · No generation credits needed
          </small>
          <button
            className="button primary"
            disabled={saving || !draft?.body.trim()}
          >
            {saving
              ? "Saving…"
              : draft?.submitted
                ? "Retry saving idea"
                : "Post idea"}
          </button>
          <button
            type="button"
            className="text-button"
            disabled={saving}
            onClick={() => {
              setEditing(false);
              trigger.current?.focus();
            }}
          >
            Keep for later
          </button>
          {rejected && (
            <button
              type="button"
              className="text-button"
              disabled={saving}
              onClick={discard}
            >
              Discard idea
            </button>
          )}
        </form>
      )}
      {error && (
        <p className="pilot-inline-notice" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="pilot-idea-success" role="status">
          {notice}
        </p>
      )}
    </aside>
  );
}
