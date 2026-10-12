"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CommandError, commandWorld, createWorld, ensureGuest, joinWorld, readWorld, worldClient, type WorldClient } from "./client.ts";
import { isUuid, parsePending, seatFrom, worldLink, type Command, type PendingCommand, type Seat, type WorldState } from "./model.ts";
import { acknowledgeContributionDraft, contributionDraftKey, preserveSelectionDraft, selectionDraftKey } from "./drafts.ts";
import { completeMakerEntry, enterAsMaker } from "./journey.ts";
import { enterPresenterRole } from "./roles.ts";

export type DemoLocation = { runId: string | null; seat: Seat; invite: string | null; view: string; workId: string | null };
const locationFromBrowser = (): DemoLocation => {
  const p = new URLSearchParams(window.location.search);
  return { runId: isUuid(p.get("run")) ? p.get("run") : null, seat: seatFrom(p.get("seat") ?? (p.has("run") ? "curator" : "maker")), invite: p.get("invite"),
    view: ["story", "contribute", "release", "my-work"].includes(p.get("view") ?? "") ? p.get("view")! : "story", workId: p.get("work") };
};
const pendingKey = (run: string, seat: Seat) => `world-demo:pending:${run}:${seat}`;
const readableError = (e: unknown) => e instanceof Error ? e.message : "The action could not finish. Reconnect and try again.";

/** The browser remembers a receipt key; the server owns role, revision and credit. */
export function useWorldDemo() {
  const [location, setLocation] = useState<DemoLocation | null>(null);
  const [client, setClient] = useState<WorldClient | null>(null);
  const [state, setState] = useState<WorldState | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<PendingCommand | null>(null);
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [hostedHere, setHostedHere] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const stateRef = useRef(state);
  const activeLocation = useRef(location);
  stateRef.current = state; activeLocation.current = location;
  useEffect(() => {
    mounted.current = true;
    const read = () => {
      const next = locationFromBrowser();
      setLocation(next);
      try {
        setClient(worldClient(next.seat));
        const last = localStorage.getItem(`world-demo:last:${next.seat}`);
        setLastRun(isUuid(last) ? last : null);
      } catch (e) { setError(readableError(e)); }
    };
    read(); window.addEventListener("popstate", read);
    return () => { mounted.current = false; window.removeEventListener("popstate", read); };
  }, []);

  useEffect(() => {
    if (!client || !location?.runId || location.invite) return;
    let active = true;
    const runId = location.runId;
    setState(current => current?.id === runId && current.me.role === location.seat ? current : null);
    setPending(null);
    setLoading(true); setError("");
    (async () => {
      await ensureGuest(client);
      const next = await readWorld(client, runId);
      if (!active) return;
      setState(next);
      setHostedHere(localStorage.getItem("world-demo:last:curator") === runId);
      const saved = localStorage.getItem(pendingKey(runId, location.seat));
      setPending(saved ? parsePending(saved, runId) : null);
      localStorage.setItem(`world-demo:last:${location.seat}`, runId);
    })().catch(e => { if (active) setError(readableError(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, location?.runId, location?.invite, location?.seat]);

  const refresh = useCallback(async (silent = false) => {
    if (!client || !location?.runId || location.invite) return;
    try {
      const next = await readWorld(client, location.runId);
      if (mounted.current && activeLocation.current?.runId === location.runId && activeLocation.current.seat === location.seat) {
        setState(current => !current || next.revision >= current.revision ? next : current);
        if (!silent) { setError(""); setNotice("You’re reading the latest shared work."); }
      }
    } catch (e) { if (!silent && mounted.current) setError(readableError(e)); }
  }, [client, location?.runId, location?.invite, location?.seat]);
  useEffect(() => {
    if (!state) return;
    const timer = window.setInterval(() => { if (!document.hidden && !inFlight.current) void refresh(true); }, 10000);
    const onFocus = () => { if (!inFlight.current) void refresh(true); };
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [!!state, refresh]);

  function navigate(view: string, workId?: string) {
    if (!location?.runId) return;
    history.pushState(null, "", worldLink(location.runId, location.seat, view, workId));
    setLocation(locationFromBrowser()); setNotice("");
    window.scrollTo({ top: 0, behavior: "instant" });
    requestAnimationFrame(() => document.querySelector<HTMLElement>(".world-demo main h1")?.focus());
  }
  function enter(next: WorldState) {
    if (!location) return;
    const view = "story";
    history.replaceState(null, "", worldLink(next.id, location.seat, view));
    setState(next); setLocation(locationFromBrowser());
    localStorage.setItem(`world-demo:last:${location.seat}`, next.id);
    setLastRun(next.id);
    setHostedHere(localStorage.getItem("world-demo:last:curator") === next.id);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(".world-demo main h1")?.focus());
  }
  async function start() {
    if (!client || !location || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      if (location.invite && location.runId) {
        enter(await joinWorld(client, location.runId, location.invite));
      } else if (location.seat === "maker") {
        const next = await enterAsMaker(localStorage, {
          newId: () => crypto.randomUUID(),
          create: id => createWorld(worldClient("curator"), id),
          join: (id, token) => joinWorld(client, id, token),
          read: async id => { await ensureGuest(client); return readWorld(client, id); },
        });
        enter(next);
        completeMakerEntry(localStorage, next.id);
      } else if (location.seat === "continuing") {
        throw new Error("Kai needs a room invitation. Ask the room host for Kai’s link.");
      } else {
        const key = `world-demo:creating:${location.seat}`;
        const previous = localStorage.getItem(key);
        const id = isUuid(previous) ? previous : crypto.randomUUID();
        // Refuse to send an action whose retry key cannot survive a refresh.
        localStorage.setItem(key, id);
        const next = await createWorld(client, id);
        localStorage.setItem("world-demo:last:curator", next.id);
        enter(next); localStorage.removeItem(key);
      }
    } catch (e) { setError(readableError(e)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function switchRole(seat: Seat, view = "my-work") {
    if (!state || !hostedHere || inFlight.current || pending || seat === state.me.role) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const hostClient = worldClient("curator");
      await ensureGuest(hostClient);
      const host = await readWorld(hostClient, state.id);
      if (host.id !== state.id) throw new Error("The room host could not be confirmed. Refresh this room before switching roles.");
      const next = await enterPresenterRole(host, seat, {
        read: async (target, run) => { const targetClient = worldClient(target); await ensureGuest(targetClient); return readWorld(targetClient, run); },
        join: (target, run, token) => joinWorld(worldClient(target), run, token),
      });
      const destination = seat === "curator" ? "story" : view;
      localStorage.setItem(`world-demo:last:${seat}`, next.id);
      history.pushState(null, "", worldLink(state.id, seat, destination));
      setClient(worldClient(seat)); setState(next); stateRef.current = next;
      const nextLocation = locationFromBrowser(); activeLocation.current = nextLocation; setLocation(nextLocation);
      setPending(null); setNotice("");
      window.scrollTo({ top: 0, behavior: "instant" });
      requestAnimationFrame(() => document.querySelector<HTMLElement>(".world-demo main h1")?.focus());
    } catch (e) { setError(readableError(e)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function send(command?: Command): Promise<boolean> {
    const current = stateRef.current;
    if (!client || !current || !location || current.me.role !== location.seat || inFlight.current || (!command && !pending)) return false;
    inFlight.current = true; setBusy(true); setError(""); setNotice("");
    const request: PendingCommand = pending ?? { ...command!, requestId: crypto.randomUUID(), runId: current.id, revision: current.revision };
    try {
      if (request.kind === "select") preserveSelectionDraft(localStorage, selectionDraftKey(current.id, current.me.id), request.payload.reason);
      localStorage.setItem(pendingKey(current.id, location.seat), JSON.stringify(request));
      setPending(request);
      const result = await commandWorld(client, request);
      try {
        const acknowledged = request.kind === "save_draft" ? request.payload
          : request.kind === "publish_work" ? result.state.works.find(work => work.maker_id === current.me.id) : null;
        if (acknowledged) acknowledgeContributionDraft(localStorage, contributionDraftKey(current.id, current.me.id), acknowledged);
      } catch { /* The receipt is durable; keep the browser copy if cleanup fails. */ }
      setState(current => !current || result.state.revision >= current.revision ? result.state : current);
      stateRef.current = result.state;
      localStorage.removeItem(pendingKey(current.id, location.seat)); setPending(null);
      const messages = { save_draft: "Private draft saved.", publish_work: "Your contribution is published with your credit.", select: "Selected for Chapter 2. Inclusion follows when the chapter is published.", withdraw: "Selection withdrawn. The published work and its credit remain.", publish_release: "Chapter 2 is published with the full contribution path." };
      setNotice(messages[request.kind]);
      return true;
    } catch (e) {
      if (e instanceof CommandError && e.rejected) {
        localStorage.removeItem(pendingKey(current.id, location.seat)); setPending(null);
        await refresh(true);
      }
      setError(readableError(e)); return false;
    } finally { inFlight.current = false; setBusy(false); }
  }
  async function publishChapter(reason: string) {
    const current = stateRef.current;
    if (!current || current.me.role !== "curator" || pending) return false;
    const source = current.works.find(work => work.role === "maker");
    const tip = current.works.find(work => work.role === "continuing" && work.parent_id === source?.id);
    if (!source || !tip || current.releases.length) return false;
    if (!current.selections.some(selection => selection.source_id === source.id && !selection.withdrawn_at)) {
      if (!await send({ kind: "select", payload: { sourceId: source.id, reason: reason.trim() } })) return false;
    }
    return send({ kind: "publish_release", payload: { tipId: tip.id } });
  }
  return { location, state, busy, loading, error, notice, pending, lastRun, hostedHere, ready: !!client, start, send, refresh, navigate, switchRole, publishChapter };
}
