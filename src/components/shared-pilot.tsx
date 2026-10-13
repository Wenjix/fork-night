"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { type SupabaseClient } from "@supabase/supabase-js";
import {
  ArrowUp,
  BookOpen,
  GitBranch,
  RefreshCw,
  Sparkles,
  Map as MapIcon,
  Share2,
  ArrowRight,
  ArrowLeft,
} from "lucide-react";
import type { Database, Tables } from "@/lib/supabase/database.types";
import { joinPilotAsGuest } from "@/lib/supabase/guest";
import { pilotBrowserClient } from "@/lib/supabase/pilot-client";
import { usePilotAccount } from "./pilot-account";
import { isSavedAccount } from "../lib/supabase/onboarding";
import {
  isUuid,
  pilotPanels,
  pilotPath,
  type PilotMoment,
  type PilotOperation,
  type PilotRoom,
} from "@/lib/pilot";
import { layoutMoments } from "@/lib/map-layout";
import { pilotCreditCost, validPilotCaptions } from "@/lib/pilot-format";
import { PilotImage } from "./pilot-panels";
import { PilotRecap } from "./pilot-recap";
import { PilotArtwork } from "./pilot-artwork";
import { PilotIdeas } from "./pilot-ideas";
import { PilotContinuation } from "./pilot-continuation";
import { PilotIdentity } from "./pilot-identity";
import { PilotCreditRefill } from "./pilot-credit-refill";
import { PilotRoomActivity } from "./pilot-generation-status";
import { SectionPlate } from "./visual-plates";
import { RoomNetworkPlate } from "./room-network-plate";
import type { GenerationOperation, PilotCredits as Credits } from "@/lib/pilot-generation";
import { TestnetRelease } from "./testnet-release";
import {
  IDEA_DRAG_TYPE,
  parseComposerDraft,
  type ComposerDraft as Draft,
} from "@/lib/pilot-composer";
import {
  momentLetter,
  parsePilotVisit,
  pathUpdates,
  pilotMomentLink,
  readingPath,
  visitKey,
  visitSnapshot,
  type PilotVisit,
} from "@/lib/pilot-social";

type Client = SupabaseClient<Database>;
const finalStates = new Set(["published", "discarded", "failed"]);
const pendingKey = (user: string, room: string) =>
  `fork-night-pilot-draft:${user}:${room}`;
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Could not connect. Your saved work is still here; please try again.";

export function SharedPilot() {
  const account = usePilotAccount();
  const [client, setClient] = useState<Client>();
  const [rooms, setRooms] = useState<PilotRoom[]>([]);
  // Resolve the shared link before fetching any story. A slow room list must
  // not briefly offer actions on the default room underneath that link.
  const [roomId, setRoomId] = useState("");
  const [moments, setMoments] = useState<PilotMoment[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [tipId, setTipId] = useState("");
  const [baseline, setBaseline] = useState<PilotVisit | null>(null);
  const visit = useRef<{ roomId: string; baseline: PilotVisit } | null>(null);
  const selectionRoom = useRef("");
  const sharedTarget = useRef<{ room: string; moment: string } | null>(null);
  const [notice, setNotice] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [profile, setProfile] = useState<Tables<"pilot_profiles">>();
  const [credits, setCredits] = useState<Credits>();
  const [activity, setActivity] = useState<Pick<Credits, "queued_requests" | "generating_requests" | "checking_requests">>();
  const [operation, setOperation] = useState<GenerationOperation>();
  const [draft, setDraft] = useState<Draft>();

  const [releaseBusy, setReleaseBusy] = useState(false);
  const [view, setView] = useState<"map" | "read">("read");
  const [composing, setComposing] = useState(false);
  const [inspectingSource, setInspectingSource] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [syncError, setSyncError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [loadedRoom, setLoadedRoom] = useState("");
  const mutation = useRef(false);
  const taskHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
      key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) {
      setError(
        "Shared rooms are not configured yet. The local preview is available below.",
      );
      return;
    }
    const connected = pilotBrowserClient()!;
    let active = true;
    setClient(connected);
    void (async () => {
      const result = await connected
        .from("pilot_rooms")
        .select("*")
        .order("id");
      if (result.error)
        throw new Error(
          "Rooms could not be loaded. Reconnect and refresh this page.",
        );
      if (!active) return;
      setRooms(result.data);
      const query = new URLSearchParams(window.location.search);
      const requestedRoom = query.get("room");
      const initialRoom =
        result.data.find((item) => item.id === requestedRoom) ??
        result.data.find((item) => item.id === "midnight-signal") ??
        result.data[0];
      setRoomId(initialRoom?.id ?? "");
      const requestedMoment = query.get("moment");
      if (requestedRoom && initialRoom?.id !== requestedRoom)
        setError(
          "That shared room is unavailable. You can read an open room below.",
        );
      else if (requestedMoment && isUuid(requestedMoment))
        sharedTarget.current = {
          room: initialRoom?.id ?? "",
          moment: requestedMoment,
        };
      else if (requestedMoment)
        setError(
          "That shared moment link is incomplete. Choose a moment below.",
        );
    })().catch((reason) => {
      if (active) setError(message(reason));
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!client || !account) return;
    let active = true;
    if (account.loading || !account.user) {
      if (!account.user) {
        if (profile) { setDraft(undefined); setComposing(false); }
        setProfile(undefined); setOperation(undefined); setCredits(undefined);
      }
      return;
    }
    const userId = account.user.id;
    setProfile(previous => previous?.id === userId ? previous : undefined);
    void client.from("pilot_profiles").select("*").eq("id", userId).maybeSingle().then(result => {
      if (!active) return;
      if (result.error) setError("Your saved storyteller name could not be loaded. Refresh to reconnect.");
      else if (result.data) {
        setProfile(result.data);
        const url = new URL(window.location.href);
        if (url.searchParams.has("onboarding")) {
          setComposing(true);
          url.searchParams.delete("onboarding");
          window.history.replaceState(null, "", url.href);
        }
      }
    });
    return () => { active = false; };
  }, [client, account?.user?.id, account?.loading]);

  useEffect(() => {
    if (!client || !roomId) return;
    let active = true,
      fetching = false,
      first = true;
    setOperation(undefined);
    setDraft(undefined);

    if (selectionRoom.current !== roomId) {
      selectionRoom.current = roomId;
      try {
        const saved = sessionStorage.getItem(`pilot-selected:${roomId}`);
        if (isUuid(saved)) setSelectedId(saved);
        const savedTip = sessionStorage.getItem(`pilot-tip:${roomId}`);
        if (isUuid(savedTip)) setTipId(savedTip);
      } catch {
        /* Reading does not require selection storage. */
      }
    }
    if (profile) {
      try {
        const saved = parseComposerDraft(
          JSON.parse(
            localStorage.getItem(pendingKey(profile.id, roomId)) ?? "null",
          ),
          roomId,
        );
        if (saved) {
          setDraft(saved);

          setComposing(true);
        }
      } catch {
        setError(
          "This browser could not restore an unsaved draft. Saved contributions will still load.",
        );
      }
    }
    async function sync() {
      if (fetching) return;
      fetching = true;
      try {
        const [story, capacity, own] = await Promise.all([
          client!
            .from("pilot_moments")
            .select("*")
            .eq("room_id", roomId)
            .order("created_at")
            .limit(500),
          client!.rpc("pilot_room_credits", { p_room_id: roomId }),
          profile
            ? client!
                .from("pilot_operations")
                .select("*,pilot_jobs(operation_id,state,panel_count,updated_at)")
                .eq("room_id", roomId)
                .order("created_at", { ascending: false })
                .limit(50)
            : Promise.resolve({ data: [], error: null }),
        ]);
        if (story.error || capacity.error || own.error)
          throw new Error(
            "Connection interrupted. Showing the last saved story; reconnect to check for updates.",
          );
        if (!active) return;
        setMoments(story.data);
        setCredits(capacity.data as Credits);
        setLoadedRoom(roomId);
        setSyncError("");
        if (visit.current?.roomId !== roomId) {
          let prior: PilotVisit | null = null;
          try {
            prior = parsePilotVisit(localStorage.getItem(visitKey(roomId)));
          } catch {
            /* Catch-up is optional. */
          }
          const initialVisit = prior ?? visitSnapshot(story.data, "");
          visit.current = { roomId, baseline: initialVisit };
          setBaseline(initialVisit);
        }
        const target =
          sharedTarget.current?.room === roomId
            ? sharedTarget.current.moment
            : null;
        if (target && !story.data.some((item) => item.id === target))
          setError(
            "That shared moment is unavailable. Showing a saved moment from this room.",
          );
        setSelectedId((current) =>
          story.data.some((item) => item.id === (target ?? current))
            ? (target ?? current)
            : (story.data.at(-1)?.id ?? ""),
        );
        setTipId((current) =>
          target && story.data.some((item) => item.id === target)
            ? target
            : story.data.some((item) => item.id === current)
              ? current
              : (story.data.at(-1)?.id ?? ""),
        );
        if (target) sharedTarget.current = null;
        const initial = first;
        first = false;
        setOperation((current) =>
          current
            ? (own.data?.find((item) => item.id === current.id) ?? current)
            : initial
              ? own.data?.find((item) => !finalStates.has(item.status))
              : undefined,
        );
      } catch (reason) {
        if (active) setSyncError(message(reason));
      } finally {
        fetching = false;
      }
    }
    void sync();
    const interval = setInterval(() => void sync(), 3000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [client, roomId, profile]);

  useEffect(() => {
    if (!roomId) return;
    let active = true, fetching = false;
    setActivity(undefined);
    async function syncActivity() {
      if (fetching) return;
      fetching = true;
      try {
        const response = await fetch(`/api/pilot/activity?room=${encodeURIComponent(roomId)}`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new Error("Room activity is unavailable.");
        const result = await response.json();
        if (active) setActivity({ queued_requests: result.queued_requests, generating_requests: result.generating_requests, checking_requests: result.checking_requests });
      } catch { if (active) setActivity(undefined); }
      finally { fetching = false; }
    }
    void syncActivity();
    const interval = setInterval(() => void syncActivity(), 3000);
    return () => { active = false; clearInterval(interval); };
  }, [roomId]);

  // A user-requested refresh does not clear the selected draft or operation.
  useEffect(() => {
    if (!client || !operation || !refresh) return;
    let active = true;
    void client
      .from("pilot_operations")
      .select("*,pilot_jobs(operation_id,state,panel_count,updated_at)")
      .eq("id", operation.id)
      .single()
      .then((result) => {
        if (active && result.data) setOperation(result.data);
      });
    return () => {
      active = false;
    };
  }, [client, operation?.id, refresh]);

  const room = rooms.find((item) => item.id === roomId);
  const selected = moments.find((item) => item.id === selectedId);
  const { path, pathError } = useMemo(() => {
    if (!selected || loadedRoom !== roomId)
      return { path: [] as PilotMoment[], pathError: "" };
    try {
      return {
        path: readingPath(moments, roomId, tipId, selected.id),
        pathError: "",
      };
    } catch {
      return {
        path: [] as PilotMoment[],
        pathError:
          "This story path could not be loaded completely. Reconnect and reload the saved story.",
      };
    }
  }, [moments, roomId, tipId, selected, loadedRoom]);
  const hasActive = !!operation && !finalStates.has(operation.status);
  const parent =
    selected && moments.find((item) => item.id === selected.parent_id);
  const selectedIndex = path.findIndex((item) => item.id === selectedId);
  const selectedLabel = momentLetter(Math.max(0, selectedIndex));
  const updates = pathUpdates(path, baseline);
  const reviewing = operation?.status === "delivered";

  useEffect(() => {
    if (!selected || loadedRoom !== roomId || visit.current?.roomId !== roomId)
      return;
    try {
      localStorage.setItem(
        visitKey(roomId),
        JSON.stringify(visitSnapshot(moments, selected.id)),
      );
    } catch {
      /* Reading works without visit storage. */
    }
  }, [moments, selectedId, roomId, loadedRoom]);

  useEffect(() => {
    setShareUrl("");
  }, [selectedId, roomId]);

  useEffect(() => {
    if (
      !operation ||
      !draft ||
      operation.request_id !== draft.requestId ||
      !profile
    )
      return;
    try {
      localStorage.removeItem(pendingKey(profile.id, roomId));
    } catch {
      /* Recovered server operation wins over its idempotent local intent. */
    }
    setDraft(undefined);
  }, [operation, draft, profile, roomId]);

  async function join(name: string) {
    const joined = await joinPilotAsGuest(client!, name);
    if (draft) {
      try {
        localStorage.setItem(
          pendingKey(joined.id, roomId),
          JSON.stringify(draft),
        );
      } catch {
        throw new Error(
          "Your guest name is saved, but this browser could not save the draft. Keep this page open and try again.",
        );
      }
    }
    setProfile(joined);
    return joined;
  }

  async function share() {
    if (!selected) return;
    const url = pilotMomentLink(window.location.origin, roomId, selected.id);
    setShareUrl(url);
    try {
      if (navigator.share)
        await navigator.share({
          title: selected.title,
          text: `A story moment by ${selected.maker_label}`,
          url,
        });
      else {
        await navigator.clipboard.writeText(url);
        setNotice("Moment link copied. Send it to the next storyteller.");
      }
    } catch (reason) {
      if (reason instanceof Error && reason.name === "AbortError") return;
      setShareUrl(url);
      setNotice("Copy this link to share the published moment.");
    }
  }

  async function act(action: () => Promise<void>) {
    if (mutation.current) return;
    if (account?.loading || account?.error && !account.user) {
      setError(account.error || "Your storyteller account is reconnecting. Try again in a moment.");
      return;
    }
    mutation.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (reason) {
      setError(message(reason));
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  }

  async function enqueue(saved: PilotOperation) {
    const session = await client!.auth.getSession();
    if (session.error || !session.data.session)
      throw new Error(
        "Your guest session needs reconnecting. Your draft is saved.",
      );
    const response = await fetch("/api/pilot/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.data.session.access_token}`,
      },
      body: JSON.stringify({ operationId: saved.id }),
      signal: AbortSignal.timeout(30_000),
    });
    const result = await response.json();
    setRefresh((value) => value + 1);
    if (!response.ok)
      throw new Error(
        result.error ??
          "Your draft is saved. Check the saved result to reconnect.",
      );
  }

  async function generate() {
    if (!client || !profile || !selected) return;
    if (operation && !finalStates.has(operation.status)) {
      await enqueue(operation);
      return;
    }
    const input: Draft = {
      ...(draft ?? {
        requestId: crypto.randomUUID(),
        parentId: selected.id,
        roomId,
      }),
      captions: (draft?.captions ?? []).map((caption) => caption.trim()),
      submitted: true,
    };
    if (!validPilotCaptions(input.captions))
      throw new Error("Finish your preview of one to three panels first.");
    // Persist before the first network mutation, including a lost save acknowledgement.
    localStorage.setItem(pendingKey(profile.id, roomId), JSON.stringify(input));
    setDraft(input);
    const saved = await client.rpc("pilot_save_continuation", {
      p_request_id: input.requestId,
      p_room_id: input.roomId,
      p_parent_id: input.parentId,
      p_title: input.captions[0].slice(0, 80),
      p_prompt: input.captions.join("\n"),
      p_captions: input.captions,
      p_idea_id: input.idea?.id,
    });
    if (saved.error)
      throw new Error(
        "Your draft is kept in this browser. Reconnect and try saving it again.",
      );
    setOperation(saved.data);
    localStorage.removeItem(pendingKey(profile.id, roomId));
    setDraft(undefined);
    await enqueue(saved.data);
  }

  function select(id: string, changePath = false) {
    if (changePath) setTipId(id);
    setSelectedId(id);
    setShareUrl("");
    setInspectingSource(true);
    setView("read");
    try {
      sessionStorage.setItem(`pilot-selected:${roomId}`, id);
      sessionStorage.setItem(
        `pilot-tip:${roomId}`,
        changePath ? id : tipId || id,
      );
    } catch {
      /* Reading does not require local storage. */
    }
    if (!hasActive && !draft) setComposing(false);
  }
  function start(idea?: Tables<"pilot_ideas">) {
    if (!selected) return;
    if (releaseBusy) {
      setNotice("Finish the current wallet action before starting a new continuation.");
      return;
    }
    setInspectingSource(false);
    if (
      draft &&
      !draft.submitted &&
      idea &&
      idea.moment_id === draft.parentId &&
      !draft.idea
    ) {
      changeDraft({
        ...draft,
        idea: {
          id: idea.id,
          momentId: idea.moment_id,
          label: idea.maker_label,
          body: idea.body,
        },
      });
      setNotice(
        `Picked up ${idea.maker_label}’s idea. Your words are still here.`,
      );
      setComposing(true);
      setView("read");
      requestAnimationFrame(() => taskHeading.current?.focus());
      return;
    }
    if (hasActive || draft) {
      setNotice(
        "Your earlier continuation is still here. Finish or cancel it before starting another.",
      );
      setComposing(true);
      setView("read");
      requestAnimationFrame(() => taskHeading.current?.focus());
      return;
    }
    const parentId = idea?.moment_id ?? selected.id;
    if (pilotPath(moments, roomId, parentId).length >= 13) {
      setNotice(
        "This path has reached the pilot’s length limit. You can build from an earlier moment or leave an idea.",
      );
      return;
    }
    const next: Draft = {
      requestId: crypto.randomUUID(),
      parentId,
      roomId,
      captions: [],
      stage: "idea",
      thought: "",
      idea: idea
        ? {
            id: idea.id,
            momentId: idea.moment_id,
            label: idea.maker_label,
            body: idea.body,
          }
        : undefined,
    };
    setOperation(undefined);
    setDraft(next);

    setComposing(true);
    setView("read");
    setError("");
    setNotice(
      idea
        ? `Starting with ${idea.maker_label}’s idea. See where it takes you.`
        : "",
    );
    if (profile)
      try {
        localStorage.setItem(
          pendingKey(profile.id, roomId),
          JSON.stringify(next),
        );
      } catch {
        setError(
          "This browser could not save the unfinished draft. Keep this page open until it is saved.",
        );
      }
    requestAnimationFrame(() => taskHeading.current?.focus());
  }
  function changeDraft(next: Draft) {
    setDraft(next);
    if (!profile) return true;
    try {
      localStorage.setItem(
        pendingKey(profile.id, roomId),
        JSON.stringify(next),
      );
      return true;
    } catch {
      setError(
        "This browser could not save your draft. Keep this page open until your idea is saved to the room.",
      );
      return false;
    }
  }
  async function pickUpIdea(id: string) {
    if (!client || !isUuid(id)) return;
    const result = await client
      .from("pilot_ideas")
      .select("*")
      .eq("id", id)
      .eq("room_id", roomId)
      .eq("moment_id", draft?.parentId ?? selectedId)
      .maybeSingle();
    if (result.error || !result.data) {
      setError(
        "That note belongs to another moment. Pick an idea from your source moment.",
      );
      return;
    }
    start(result.data);
  }
  function cancelDraft() {
    if (profile) {
      try {
        localStorage.removeItem(pendingKey(profile.id, roomId));
      } catch {
        setError(
          "This browser could not clear the saved draft. Try again before leaving.",
        );
        return;
      }
    }
    setDraft(undefined);
    setComposing(false);
  }

  async function publishMoment() {
    if (!client || !operation || operation.status !== "delivered") return;
    const result = await client.rpc("pilot_publish", { p_operation_id: operation.id });
    if (result.error) throw new Error("Publication could not be confirmed. Try again to check the same saved moment.");
    setOperation({ ...operation, status: "published", published_moment_id: result.data.id });
    setMoments(items => items.some(item => item.id === result.data.id) ? items : [...items, result.data]);
    select(result.data.id, true);
    setDraft(undefined);
    setComposing(false);
  }
  async function discardMoment() {
    if (!client || !operation || operation.status !== "delivered") return;
    const result = await client.rpc("pilot_discard", { p_operation_id: operation.id });
    if (result.error) throw new Error("Discard could not be confirmed. Your saved result remains available.");
    setOperation({ ...operation, status: "discarded" });
  }

  const ideaSection =
    client && selected ? (
      <PilotIdeas
        key={selected.id}
        client={client}
        moment={selected}
        label={selectedLabel}
        profile={profile}
        onJoin={join}
        onUse={(idea) => start(idea)}
      />
    ) : null;

  return (
    <main className="pilot-shell">
      <header className="pilot-header">
        <a className="pilot-brand" href="/pilot">
          fork night<span>.</span>
        </a>
        <label className="pilot-room-choice">
          <span>Story room</span>
          <select
            aria-label="Story room"
            value={roomId}
            disabled={busy || releaseBusy || hasActive || !!draft}
            onChange={(event) => {
              setRoomId(event.target.value);
              setSelectedId("");
              setTipId("");
              setComposing(false);
              setNotice("");
              setShareUrl("");
              setView("read");
              window.history.replaceState(
                null,
                "",
                `/pilot?room=${encodeURIComponent(event.target.value)}`,
              );
            }}
          >
            {rooms.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        <div className="pilot-header-actions">
          <PilotIdentity profile={profile} disabled={!selected || busy || releaseBusy || hasActive || !!draft || !!account?.loading} signOutBlockedReason={hasActive ? "Finish generation or publish or discard your preview before signing out." : draft ? "Finish or cancel your continuation before signing out." : ""} onJoin={() => start()} />
          <button
            className="button secondary pilot-map-toggle"
            onClick={() => setView(view === "map" ? "read" : "map")}
            disabled={!selected}
          >
            <MapIcon size={19} />
            {view === "map" ? "Back to story" : "Map"}
          </button>
        </div>
      </header>
      <div className="pilot-intro">
        <h1>Pick up where someone left off.</h1>
        <p>Stories and ideas stay here for the next person.</p>
      </div>
      {loadedRoom === roomId && <RoomNetworkPlate roomId={roomId} />}
      {loadedRoom === roomId && credits && <PilotRoomActivity credits={{ ...credits, ...activity }} interrupted={!!syncError} />}
      {(error || syncError || pathError || account?.error) && (
        <div className="pilot-notice" role="alert">
          <p>{error || syncError || pathError || account?.error}</p>
          <button
            className="text-button"
            onClick={() => window.location.reload()}
          >
            Reload saved story
          </button>
        </div>
      )}
      {notice && (
        <div className="pilot-notice pilot-feedback" role="status">
          <p>{notice}</p>
          {(draft || hasActive) && (
            <button
              className="text-button"
              onClick={() => {
                setView("read");
                setComposing(true);
                select(draft?.parentId ?? operation!.parent_id);
                requestAnimationFrame(() => taskHeading.current?.focus());
              }}
            >
              Return to your continuation
            </button>
          )}
          <button className="text-button" onClick={() => setNotice("")}>
            Dismiss
          </button>
        </div>
      )}
      {client && selected && loadedRoom === roomId && path.length ? (
        <>
          {view === "map" && (
            <section
              className="pilot-map"
              aria-label="Story map, growing upward"
            >
              <div className="pilot-map-title">
                <SectionPlate
                  title="The whole story"
                  icon={MapIcon}
                  tone="lavender"
                  description={<>
                    <ArrowUp size={16} /> Every moment opens a possibility ·{" "}
                    {moments.length}{" "}
                    {moments.length === 1 ? "moment" : "moments"}
                  </>}
                  action={<button className="text-button" onClick={() => setView("read")}>
                    <ArrowLeft size={17} /> Back to your moment
                  </button>}
                  className="pilot-map-sign"
                />
              </div>
              <PilotMap
                client={client}
                moments={moments}
                selectedId={selectedId}
                selectedPath={path.map((item) => item.id)}
                onSelect={(id) => select(id, true)}
                visible
              />
              <p className="pilot-map-foot">
                Read any branch. Violet marks your selected path.
              </p>
            </section>
          )}
          <div className="pilot-table" hidden={view === "map"}>
            <PilotRecap
              key={roomId}
              client={client}
              path={path}
              selectedId={selectedId}
              baseline={baseline}
              onSelect={(id) => select(id)}
              onMap={() => setView("map")}
            />
            <div
              className={`pilot-reading-table${composing && draft ? " is-composing" : ""}${inspectingSource ? " is-inspecting" : ""}`}
            >
              <section
                className="pilot-reader"
                aria-label="Read and continue the story"
              >
                <header className="pilot-scene-plate">
                  <div className="pilot-moment-context">
                    <span className="pilot-letter">
                      {reviewing ? <Sparkles size={20} /> : selectedLabel}
                    </span>
                    <div>
                      <p>
                        {reviewing
                          ? "Private preview · only you can see this"
                          : `Moment ${selectedIndex + 1} on this path`}
                        {!reviewing && updates.newIds.has(selected.id) && (
                          <small className="pilot-new">New</small>
                        )}
                      </p>
                      <p className="pilot-byline">
                        <strong>
                          {reviewing
                            ? profile?.display_name
                            : selected.maker_label}
                        </strong>
                        {reviewing ? (
                          " · ready for your review"
                        ) : parent ? (
                          <>
                            {" "}
                            built on{" "}
                            <button
                              className="text-button"
                              onClick={() => select(parent.id)}
                            >
                              {parent.maker_label}
                            </button>
                          </>
                        ) : (
                          " started this story"
                        )}
                      </p>
                    </div>
                  </div>
                  <h2>{reviewing ? operation.title : selected.title}</h2>
                </header>
                <PilotArtwork
                  key={reviewing ? operation.id : selected.id}
                  client={client}
                  panels={pilotPanels(
                    reviewing ? operation.panels : selected.panels,
                  )}
                  title={reviewing ? operation.title : selected.title}
                  maker={
                    reviewing
                      ? (profile?.display_name ?? "You")
                      : selected.maker_label
                  }
                />
              </section>
              {!reviewing && ideaSection}
              <div className="pilot-reader-actions">
                <PilotContinuation
                  key={profile?.id ?? account?.user?.id ?? "visitor"}
                  client={client} selected={selected} moments={moments} profile={profile} authenticated={isSavedAccount(account?.user)}
                  operation={operation} draft={draft} composing={composing} composerVisible={view === "read"} busy={busy || releaseBusy || !!account?.loading || !!account?.error && !account.user}
                  interrupted={!!syncError} credits={credits} inspecting={inspectingSource}
                  heading={taskHeading}
                  actions={{
                    join: (name) => void act(async () => { await join(name); setComposing(true); }),
                    google: account?.enabled ? (name) => void act(async () => { await join(name); await account.signIn("link"); }) : undefined,
                    returning: account?.enabled ? () => void act(async () => { await account.signIn("return"); }) : undefined,
                    publish: () => void act(publishMoment),
                    discard: () => void act(discardMoment),
                    check: () => operation && void act(() => enqueue(operation)),
                    continue: () => start(), share: () => void share(),
                    change: changeDraft, generate: () => void act(generate), cancel: cancelDraft,
                    useIdea: (id) => void pickUpIdea(id),
                    inspect: () => {
                      if (inspectingSource && selectedId === draft?.parentId) setInspectingSource(false);
                      else if (draft) select(draft.parentId);
                    },
                  }}
                />
                {!reviewing && !(operation?.status === "published" && operation.published_moment_id === selected.id) && (
                  <div
                    className="pilot-story-actions"
                    onDragOver={(event) => {
                      if (event.dataTransfer.types.includes(IDEA_DRAG_TYPE)) {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "copy";
                      }
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      void pickUpIdea(
                        event.dataTransfer.getData(IDEA_DRAG_TYPE),
                      );
                    }}
                  >
                    <button
                      className="button primary"
                      hidden={composing && !!draft}
                      disabled={busy || releaseBusy}
                      onClick={() => start()}
                    >
                      <GitBranch size={18} />
                      {draft || hasActive
                        ? "Return to your continuation"
                        : "Add the next part"}
                    </button>
                    <button
                      className="button secondary"
                      disabled={busy || releaseBusy}
                      onClick={() => void share()}
                    >
                      <Share2 size={18} /> Share this moment
                    </button>
                  </div>
                )}
                {shareUrl && (
                  <label className="pilot-share-link">
                    Link to this moment
                    <input
                      readOnly
                      value={shareUrl}
                      onFocus={(event) => event.target.select()}
                    />
                  </label>
                )}
                <div hidden={composing || hasActive || reviewing}>
                  <TestnetRelease
                    roomId={roomId} moments={moments} tipId={path.at(-1)!.id}
                    makerId={profile?.id} makerName={profile?.display_name} client={client}
                    onBusyChange={setReleaseBusy}
                    onChoosePath={(id) => select(id, true)}
                    onInspect={(id) => {
                      select(id);
                      requestAnimationFrame(() => document.querySelector(".pilot-reader")?.scrollIntoView({ block: "start" }));
                    }}
                  />
                </div>
                {credits && (
                  <p className="pilot-credit-line">
                    <Sparkles size={15} />
                    {credits.enabled
                      ? `${credits.available} room ${credits.available === 1 ? "credit" : "credits"} available`
                      : "Generation is paused"}
                    {credits.reserved > 0 && ` · ${credits.reserved} reserved for unfinished requests`}
                    <span>Reading and ideas are free.</span>
                  </p>
                )}
                {credits && profile && (
                  <PilotCreditRefill
                    key={`${roomId}:${profile.id}`}
                    client={client}
                    roomId={roomId}
                    userId={profile.id}
                    onRefill={() => setRefresh((current) => current + 1)}
                  />
                )}
                <details className="pilot-credits">
                  <summary>
                    Made together by{" "}
                    {
                      new Set(
                        path.map((item) => item.maker_id ?? item.maker_label),
                      ).size
                    }{" "}
                    {new Set(
                      path.map((item) => item.maker_id ?? item.maker_label),
                    ).size === 1
                      ? "storyteller"
                      : "storytellers"}
                  </summary>
                  <ol>
                    {path.map((item) => (
                      <li key={item.id}>
                        <button
                          className="text-button"
                          onClick={() => select(item.id)}
                        >
                          {item.title}
                        </button>
                        <span> — {item.maker_label}</span>
                      </li>
                    ))}
                  </ol>
                </details>
                {!reviewing &&
                  moments.some((item) => item.parent_id === selected.id) && (
                    <nav
                      className="pilot-continuations"
                      aria-label="What others made next"
                    >
                      <SectionPlate title="Where others took it" icon={GitBranch} tone="lavender" level={3} className="pilot-branch-sign" />
                      {moments
                        .filter((item) => item.parent_id === selected.id)
                        .map((item) => (
                          <button
                            key={item.id}
                            onClick={() => select(item.id, true)}
                          >
                            <span>
                              <strong>{item.title}</strong>
                              <small>by {item.maker_label}</small>
                            </span>
                            <ArrowRight size={18} />
                          </button>
                        ))}
                    </nav>
                  )}
              </div>
              {reviewing && ideaSection}
            </div>
          </div>
        </>
      ) : (
        <div className="pilot-loading" role="status">
          {pathError
            ? "Reconnect to read the complete path."
            : "Opening the shared story…"}
        </div>
      )}
      <footer className="pilot-footer">
        <span>{room?.description}</span>
        <a href="/">Explore the local preview</a>
      </footer>
    </main>
  );
}

function PilotMap({
  client,
  moments,
  selectedId,
  selectedPath,
  onSelect,
  visible,
}: {
  client: Client;
  moments: PilotMoment[];
  selectedId: string;
  selectedPath: string[];
  onSelect: (id: string) => void;
  visible: boolean;
}) {
  const seed = moments.find((moment) => !moment.parent_id)!;
  const { nodes, height } = layoutMoments(
    moments.map((moment) => ({ ...moment, parentId: moment.parent_id })),
    seed.id,
  );
  const left = Math.min(...nodes.map((node) => node.x)),
    right = Math.max(...nodes.map((node) => node.x));
  const width = Math.max(280, right - left + 240),
    center = (left + right) / 2;
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current
      ?.querySelector(`[data-moment="${selectedId}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [selectedId, visible]);
  return (
    <div className="pilot-map-scroll" ref={scroller}>
      <div className="pilot-map-world" style={{ width, height }}>
        <svg
          width={width}
          height={height}
          className="pilot-map-lines"
          aria-hidden="true"
        >
          {nodes
            .filter((node) => node.moment.parentId)
            .map((node) => {
              const parent = nodes.find(
                (item) => item.moment.id === node.moment.parentId,
              )!;
              const from = parent.x - center + width / 2,
                to = node.x - center + width / 2;
              return (
                <path
                  key={node.moment.id}
                  d={`M${from},${parent.y} C${from},${parent.y - 20} ${to},${node.y + 160} ${to},${node.y + 140}`}
                  fill="none"
                  stroke={
                    selectedPath.includes(node.moment.id)
                      ? "var(--violet)"
                      : "var(--line-strong)"
                  }
                  strokeWidth={2}
                />
              );
            })}
        </svg>
        {nodes.map(({ moment, x, y }) => (
          <button
            key={moment.id}
            type="button"
            className={`pilot-node ${selectedId === moment.id ? "selected" : ""}`}
            style={{ left: `calc(50% + ${x - center - 90}px)`, top: y }}
            data-moment={moment.id}
            aria-pressed={selectedId === moment.id}
            onClick={() => onSelect(moment.id)}
          >
            <span aria-hidden="true" style={{ display: "block" }}>
              <PilotImage
                client={client}
                panel={pilotPanels(moment.panels)[0]}
                allowRetry={false}
              />
            </span>
            <strong>{moment.title}</strong>
            <span>{moment.maker_label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
