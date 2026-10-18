"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Sparkles } from "lucide-react";
import type { Database } from "../lib/supabase/database.types.ts";
import type { PilotMoment } from "../lib/pilot.ts";
import { WREN_ROOM, type WrenIntent, type WrenView } from "../lib/pilot-wren.ts";
import { parseWrenView, readWrenIntent, readWrenOrigin, wrenFinished, wrenIntentKey } from "../lib/wren-request-recovery.ts";
import { pollWhileVisible } from "../lib/visible-interval.ts";

const defaultBrief = "Continue this fork with one new scene, keeping its characters and visual style.";

export function WrenAssistant({ client, actorId, parent, moments, initialBrief = "", originDraftId, blocked, onJoin, onBusyChange, onAccepted, onReady, onInspect }: {
  client: SupabaseClient<Database>; actorId?: string; parent: PilotMoment; moments: PilotMoment[]; initialBrief?: string; originDraftId?: string; blocked: boolean;
  onJoin: () => void; onBusyChange: (busy: boolean) => void;
  onAccepted: (parentId: string, originDraftId?: string) => void; onReady: (operationId: string) => Promise<void>; onInspect: (parentId: string) => void;
}) {
  const id = useId();
  const [brief, setBrief] = useState(initialBrief);
  const [intent, setIntent] = useState<WrenIntent | null>(null);
  const intentRef = useRef<WrenIntent | null>(null);
  const originRef = useRef<string | undefined>(undefined);
  const [request, setRequest] = useState<WrenView>();
  const [enabled, setEnabled] = useState<boolean>();
  const [checking, setChecking] = useState(!!actorId);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const ignored = useRef("");
  const callbacks = useRef({ onAccepted, onReady });
  const sending = useRef(false);
  const restored = useRef("");
  useEffect(() => { callbacks.current = { onAccepted, onReady }; }, [onAccepted, onReady]);
  useEffect(() => { if (!intentRef.current && !request) setBrief(initialBrief); }, [initialBrief, request]);
  const active = !!request && !wrenFinished(request);
  useEffect(() => { onBusyChange(working || active && request?.state !== "ready" || !!intent && !request); }, [working, active, intent, request, onBusyChange]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);

  useEffect(() => {
    if (!actorId) { setChecking(false); return; }
    let live = true;
    let stored: WrenIntent | null = null;
    try { stored = readWrenIntent(localStorage, actorId); originRef.current = readWrenOrigin(localStorage, actorId); }
    catch { setError("This browser cannot save Wren requests. Enable browser storage before asking for a scene."); }
    intentRef.current = stored;
    setIntent(stored);
    if (stored) setBrief(stored.brief);
    async function sync() {
      const session = await client.auth.getSession();
      if (session.error || !session.data.session || session.data.session.user.id !== actorId) throw new Error("Reconnect to this storyteller account to check Wren’s private preview.");
      const query = intentRef.current ? `requestId=${intentRef.current.requestId}` : `room=${WREN_ROOM}`;
      const response = await fetch(`/api/pilot/wren?${query}`, { cache: "no-store", headers: { Authorization: `Bearer ${session.data.session.access_token}` }, signal: AbortSignal.timeout(10_000) });
      const body = await response.json();
      if (!live) return;
      if (response.status === 404 && intentRef.current) { setChecking(false); return; }
      if (!response.ok) throw new Error(body.error || "Wren’s saved request could not be checked. Your request stays saved.");
      if (typeof body.enabled === "boolean") setEnabled(body.enabled);
      const next = body.request === null ? null : parseWrenView(body.request);
      if (body.request && !next) throw new Error("Wren’s saved response could not be read. Check again.");
      if (next && next.id !== ignored.current && (!intentRef.current || next.id === intentRef.current.requestId)) {
        setRequest(next);
        if (intentRef.current?.requestId === next.id && !wrenFinished(next)) callbacks.current.onAccepted(next.parentId, originRef.current);
        if (next.state === "ready" && next.operationId && restored.current !== next.operationId) {
          await callbacks.current.onReady(next.operationId);
          if (live) restored.current = next.operationId;
        }
        if (wrenFinished(next)) { localStorage.removeItem(wrenIntentKey(actorId!)); intentRef.current = null; setIntent(null); }
      }
      if (live) { setError(""); setChecking(false); }
    }
    const stop = pollWhileVisible(async () => { try { await sync(); } catch (reason) { if (live) { setError(reason instanceof Error ? reason.message : "Wren could not reconnect."); setChecking(false); } } }, 4000);
    return () => { live = false; stop(); };
  }, [client, actorId, refresh]);

  async function ask() {
    if (sending.current || !actorId || blocked || checking || enabled === false) return;
    sending.current = true; setWorking(true); setError("");
    try {
      const saved = intentRef.current ?? { requestId: crypto.randomUUID(), roomId: WREN_ROOM, parentId: parent.id, brief: brief.trim() || defaultBrief };
      if (!intentRef.current) originRef.current = originDraftId;
      // A lost response is retried with this exact request and fork, including after reload.
      localStorage.setItem(wrenIntentKey(actorId), JSON.stringify({ version: 1, intent: saved, ...(originRef.current ? { originDraftId: originRef.current } : {}) }));
      intentRef.current = saved; setIntent(saved);
      const session = await client.auth.getSession();
      if (session.error || !session.data.session || session.data.session.user.id !== actorId) throw new Error("Reconnect to this storyteller account before asking Wren.");
      const response = await fetch("/api/pilot/wren", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.data.session.access_token}` }, body: JSON.stringify(saved), signal: AbortSignal.timeout(30_000) });
      const body = await response.json();
      if (!response.ok) {
        if (body.rejected === true) { localStorage.removeItem(wrenIntentKey(actorId)); intentRef.current = null; setIntent(null); }
        throw new Error(body.error || "Your request is saved. Check it before starting another.");
      }
      const next = parseWrenView(body.request);
      if (!next || next.id !== saved.requestId || next.parentId !== saved.parentId) throw new Error("Your request is saved. Check it to recover the private preview.");
      setRequest(next); callbacks.current.onAccepted(next.parentId, originRef.current); setRefresh(value => value + 1);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Your request stays saved. Check it to reconnect."); }
    finally { sending.current = false; setWorking(false); }
  }

  function another() {
    if (!wrenFinished(request) || !actorId) return;
    ignored.current = request!.id;
    localStorage.removeItem(wrenIntentKey(actorId)); intentRef.current = null; setIntent(null); setRequest(undefined); setBrief(""); setError(""); restored.current = "";
  }
  const sourceId = request?.parentId ?? intent?.parentId ?? parent.id;
  const source = moments.find(moment => moment.id === sourceId);
  const unavailable = !actorId || enabled === false && !request && !intent;
  return <section className="pilot-wren" aria-labelledby={id}>
    <div className="pilot-wren-heading"><Sparkles size={20} aria-hidden="true" /><div><h2 id={id}>{unavailable ? "Wren, your scene assistant" : "Make the next scene with Wren"}</h2><p>{unavailable ? "When the host enables Wren, it can prepare a private scene for your review. You choose what to publish." : "Choose a fork. Give Wren a direction. The preview stays private until you publish."}</p></div></div>
    {!unavailable && <p className="pilot-wren-source">Continuing <button type="button" className="text-button" onClick={() => onInspect(sourceId)}>{source?.title ?? "your saved fork"}</button></p>}
    {!actorId ? <button type="button" className="button secondary" disabled={blocked} onClick={onJoin}>Join the story</button> : <>
      {request ? <div className="pilot-wren-progress"><p role="status">{request.message}</p>{request.state === "ready" && <p>Review your scene above, then choose Publish or Discard.</p>}{wrenFinished(request) && <button type="button" className="button secondary" disabled={blocked || working} onClick={another}>Ask for another scene</button>}</div>
        : !unavailable && <form onSubmit={event => { event.preventDefault(); void ask(); }}>
          <label htmlFor={`${id}-brief`}>What should happen next? <span>(optional)</span></label>
          <textarea id={`${id}-brief`} rows={3} maxLength={500} placeholder="A new obstacle, a small act of help, a different ending…" value={intent?.brief ?? brief} disabled={working || !!intent} onChange={event => setBrief(event.target.value)} />
          <button type="submit" className="button primary" disabled={blocked || checking || working || enabled === false}>{working ? "Sending your request…" : intent ? "Retry this saved request" : "Ask Wren for a private scene"}</button>
        </form>}
      {checking && <p role="status">Checking your saved Wren request…</p>}
      {enabled === false && !active && <p role="status">Wren is not active in this room yet. Read either branch and leave an idea for what comes next.</p>}
      {blocked && !active && <p>Finish your current continuation or wallet action before starting another scene.</p>}
      {error && <p role="alert">{error}</p>}
      {(error || intent && !request) && <button type="button" className="text-button" disabled={working || checking} onClick={() => { setChecking(true); setRefresh(value => value + 1); }}>Check saved request</button>}
    </>}
    {!unavailable && <p className="pilot-wren-note">Wren uses the room’s test credits and the host’s inference allowance. If credits run low, Wren can top up within its testnet allowance. No payment is taken from your wallet.</p>}
  </section>;
}
