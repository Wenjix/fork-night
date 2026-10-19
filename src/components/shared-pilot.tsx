"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { type SupabaseClient } from "@supabase/supabase-js";
import {
  ArrowUp,
  GitBranch,
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
import { AppHeader } from "./app-header";
import { FirstNightGuide } from "./first-night-guide";
import { useFirstNightJourney } from "./use-first-night";
import { parseFirstNightStarter, stripFirstNightParams, recordFirstNightEntry, recordFirstNightResult } from "../lib/first-night";
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
import { whileVisible, pollWhileVisible } from "@/lib/visible-interval";
import { pilotCreditCost, validPilotCaptions } from "@/lib/pilot-format";
import { PilotImage } from "./pilot-panels";
import { PilotRecap } from "./pilot-recap";
import { useCanvasNavigation } from "./use-canvas-navigation";
import { PilotArtwork } from "./pilot-artwork";
import { PilotIdeas } from "./pilot-ideas";
import { PilotContinuation } from "./pilot-continuation";
import { PilotIdentity, roomSignOutBlock } from "./pilot-identity";
import { PilotDialog } from "./pilot-dialog";
import { roomLink, validRoomId, newPublications, definitelyRejected, type RoomSnapshot } from "../lib/pilot-rooms";
import { PilotCreditRefill } from "./pilot-credit-refill";
import { PilotRoomActivity } from "./pilot-generation-status";
import { SectionPlate } from "./visual-plates";
import { Disclosure } from "./disclosure";
import { PilotRoomFunding } from "./guild-funding";
import type { GenerationOperation, PilotCredits as Credits } from "@/lib/pilot-generation";
import { TestnetRelease } from "./testnet-release";
import { WrenAssistant } from "./wren-assistant";
import { KesslerRoomGuide } from "./kessler-room-guide";
import { RoomFilmStudio } from "./room-film-studio";
import { KesslerRoomOverview } from "./kessler-room-overview";
import { kesslerEntryView, sharedReadingTip } from "../lib/room-overview";
import { useKesslerOverview } from "./use-kessler-overview";
import { kesslerWrenState } from "../lib/kessler-overview";
import { featuredStoryLinks, proofRoomIds } from "@/lib/featured-stories";
import { KESSLER_OPENING_ID, KESSLER_ROOM_ID } from "../lib/kessler-room";
import { roomTheme } from "../lib/room-theme";
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

function KesslerTurnCard() {
  return <aside className="pilot-kessler-turn" aria-label="Try Kessler Ward">
    <div><strong>Your turn.</strong> Read Kessler Ward and leave an idea for what comes next.</div>
    <a className="button secondary" href={featuredStoryLinks.kessler}>Continue in Kessler <ArrowRight size={16} aria-hidden="true" /></a>
  </aside>;
}

export function SharedPilot() {
  const account = usePilotAccount();
  const [filmOpenRequest, setFilmOpenRequest] = useState(0);
  const [requestedFilmId, setRequestedFilmId] = useState<string>();
  const [filmBusy, setFilmBusy] = useState(false);
  const [client, setClient] = useState<Client>();
  const [unavailable, setUnavailable] = useState(false);
  const [snapshot, setSnapshot] = useState<RoomSnapshot>();
  const [joinedRoom, setJoinedRoom] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinName, setJoinName] = useState("");
  const [invitation, setInvitation] = useState("");
  const [publications, setPublications] = useState<PilotMoment[]>([]);
  const [truncated, setTruncated] = useState(false);
  const seenMoments = useRef<Set<string> | null>(null);
  const [otherWork, setOtherWork] = useState<{ room_id: string; parent_id: string }>();
  const [rooms, setRooms] = useState<PilotRoom[]>([]);
  // Resolve the shared link before fetching any story. A slow room list must
  // not briefly offer actions on the default room underneath that link.
  const [roomId, setRoomId] = useState("");
  const kessler = useKesslerOverview(roomId === KESSLER_ROOM_ID);
  // The link names the room, so its skin is known on the very first render, before any room data arrives.
  const [linkedRoom] = useState(() => typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("room"));
  const theme = roomTheme(roomId || linkedRoom);
  const [moments, setMoments] = useState<PilotMoment[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [tipId, setTipId] = useState("");
  const [resume, setResume] = useState<{ momentId: string; tipId?: string }>();
  const [baseline, setBaseline] = useState<PilotVisit | null>(null);
  const visit = useRef<{ roomId: string; baseline: PilotVisit } | null>(null);
  const selectionRoom = useRef("");
  const sharedTarget = useRef<{ room: string; moment: string; tip?: string } | null>(null);
  const [notice, setNotice] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [profile, setProfile] = useState<Tables<"pilot_profiles">>();
  const [profileLoadedFor, setProfileLoadedFor] = useState<string | null>();
  const [credits, setCredits] = useState<Credits>();
  const [activity, setActivity] = useState<Pick<Credits, "queued_requests" | "generating_requests" | "checking_requests">>();
  const [operation, setOperation] = useState<GenerationOperation>();
  const [draft, setDraft] = useState<Draft>();
  const [draftRecovery, setDraftRecovery] = useState(false);
  const draftRef = useRef<Draft | undefined>(undefined);
  draftRef.current = draft;

  const [releaseBusy, setReleaseBusy] = useState(false);
  const [wrenBusy, setWrenBusy] = useState(false);
  const [wrenPreviewId, setWrenPreviewId] = useState<string>();
  const [wrenOperationId, setWrenOperationId] = useState<string>();
  const [wrenMoments, setWrenMoments] = useState<Set<string>>(new Set());
  const wrenScope = useRef<{ roomId: string; actorId: string | undefined } | null>(null);
  const currentDraft = useRef(draft);
  const [view, setView] = useState<"overview" | "map" | "read">("read");
  const [composing, setComposing] = useState(false);
  const [inspectingSource, setInspectingSource] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [syncError, setSyncError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [loadedRoom, setLoadedRoom] = useState("");
  const [recoveryScope, setRecoveryScope] = useState<{ roomId: string; actorId: string | null }>();
  const [firstNightStarter, setFirstNightStarter] = useState<ReturnType<typeof parseFirstNightStarter>>(null);
  const mutation = useRef(false);
  const taskHeading = useRef<HTMLHeadingElement>(null);
  const [focusNameEntry, setFocusNameEntry] = useState(false);
  const actorId = account?.loading ? null : account?.user?.id ?? null;
  const firstNightJourney = useFirstNightJourney({ roomId: roomId || undefined, actorId });

  useEffect(() => {
    wrenScope.current = { roomId, actorId: profile?.id };
    setWrenPreviewId(undefined); setWrenOperationId(undefined); setWrenBusy(false);
    return () => { wrenScope.current = null; };
  }, [roomId, profile?.id]);
  useEffect(() => { currentDraft.current = draft; }, [draft]);

  useEffect(() => {
    const sync = () => setFirstNightStarter(parseFirstNightStarter(window.location.search));
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

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
      const query = new URLSearchParams(window.location.search);
      const requestedRoom = query.get("room");
      if (!validRoomId(requestedRoom)) { if (active) setUnavailable(true); return; }
      const [directory, exact] = await Promise.all([
        connected.from("pilot_rooms").select("*").eq("is_listed", true).order("id"),
        connected.from("pilot_rooms").select("*").eq("id", requestedRoom).maybeSingle(),
      ]);
      if (!active) return;
      if (exact.error || directory.error) throw new Error("Rooms could not be loaded. Reconnect and refresh this page.");
      if (!exact.data) { setUnavailable(true); return; }
      setRooms([...(directory.data ?? []).filter(item => item.id !== requestedRoom), exact.data]);
      setRoomId(requestedRoom);
      setView(requestedRoom === KESSLER_ROOM_ID ? kesslerEntryView(window.location.search, window.location.hash) : "read");
      if (query.get("created") === "1") {
        setNotice("Your room is ready. Invite your storytellers to join.");
        // A link copied from the creator's address bar must not greet others as the creator.
        const url = new URL(window.location.href);
        url.searchParams.delete("created");
        window.history.replaceState(null, "", url.href);
      }
      const requestedMoment = query.get("moment");
      if (requestedMoment && isUuid(requestedMoment)) sharedTarget.current = { room: requestedRoom, moment: requestedMoment, tip: query.get("tip") ?? undefined };
      else if (requestedMoment) setError("That shared moment link is incomplete. Choose a moment below.");
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
    setProfileLoadedFor(undefined);
    if (account.loading || !account.user) {
      if (!account.user) {
        if (profile) { setDraft(undefined); setComposing(false); }
        setProfile(undefined); setOperation(undefined); setCredits(undefined);
      }
      if (!account.loading) setProfileLoadedFor(null);
      return;
    }
    const userId = account.user.id;
    setProfile(previous => previous?.id === userId ? previous : undefined);
    void client.from("pilot_profiles").select("*").eq("id", userId).maybeSingle().then(result => {
      if (!active) return;
      if (result.error) setError("Your saved storyteller name could not be loaded. Refresh to reconnect.");
      else {
        setProfileLoadedFor(userId);
        if (result.data) {
          setProfile(result.data);
          const url = new URL(window.location.href);
          if (url.searchParams.has("onboarding")) {
            setComposing(true);
            setView("read");
            url.searchParams.delete("onboarding");
            window.history.replaceState(null, "", url.href);
          }
        }
      }
    });
    return () => { active = false; };
  }, [client, account?.user?.id, account?.loading]);

  useEffect(() => {
    setJoinedRoom(false);
    if (!client || !profile || !roomId) return;
    let active = true;
    void client.from("pilot_room_participants").select("room_id,pilot_rooms(*)").eq("maker_id", profile.id).order("joined_at", { ascending: false }).limit(30).then(result => {
      if (!active || result.error) return;
      setJoinedRoom(result.data.some(row => row.room_id === roomId));
      setRooms(current => [...current, ...result.data.map(row => row.pilot_rooms).filter((row): row is PilotRoom => !!row && !current.some(item => item.id === row.id))]);
    });
    return () => { active = false; };
  }, [client, roomId, profile?.id]);

  // Restarts only for another room or storyteller: it reads just the profile's id,
  // and a restart clears notices, the invitation and the continuation.
  useEffect(() => {
    if (!client || !roomId) return;
    let active = true,
      fetching = false,
      first = true;
    setOperation(undefined);
    setDraft(undefined);
    setDraftRecovery(false);
    setRecoveryScope(undefined);
    setSnapshot(undefined); setPublications([]); setInvitation(""); setOtherWork(undefined);
    seenMoments.current = null;
    let revision: number | undefined;
    let currentStory: PilotMoment[] = [];

    if (selectionRoom.current !== roomId) {
      selectionRoom.current = roomId;
      try {
        const saved = sessionStorage.getItem(`pilot-selected:${roomId}`);
        const savedTip = sessionStorage.getItem(`pilot-tip:${roomId}`);
        if (isUuid(saved)) { setSelectedId(saved); setResume({ momentId: saved, tipId: isUuid(savedTip) ? savedTip : undefined }); }
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
          // A draft already open in memory (e.g. just saved by join) is not a recovery.
          const alreadyOpen = draftRef.current?.requestId === saved.requestId;
          setDraft(saved);
          setDraftRecovery(!alreadyOpen);
          setComposing(true);
          setView("read");
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
        const [roomState, own] = await Promise.all([
          client!.rpc("pilot_room_snapshot", { p_room_id: roomId }),
          profile
            ? client!.from("pilot_operations").select("*,pilot_jobs(operation_id,state,panel_count,updated_at)")
                .eq("room_id", roomId).order("created_at", { ascending: false }).limit(50)
            : Promise.resolve({ data: [], error: null }),
        ]);
        if (roomState.error || !roomState.data || own.error) throw new Error("Connection interrupted. Showing the last saved story; reconnect to check for updates.");
        const state = roomState.data as unknown as RoomSnapshot;
        if (revision !== state.revision) {
          const [result, assistance] = await Promise.all([
            client!.from("pilot_moments").select("*").eq("room_id", roomId).order("created_at").order("id").limit(501),
            roomId === KESSLER_ROOM_ID ? client!.rpc("pilot_wren_assistance", { p_room_id: roomId }) : Promise.resolve({ data: [], error: null }),
          ]);
          if (result.error) throw new Error("The story could not be refreshed. Your current continuation is still here.");
          if (!active) return;
          if (!assistance.error) setWrenMoments(new Set(assistance.data?.map(item => item.moment_id) ?? []));
          currentStory = result.data.slice(0, 500);
          setTruncated(result.data.length > 500);
          const fresh = newPublications(seenMoments.current, currentStory, profile?.id);
          seenMoments.current = new Set(currentStory.map(moment => moment.id));
          if (fresh.length) setPublications(previous => [...previous, ...fresh.filter(moment => !previous.some(item => item.id === moment.id))]);
          if (profile) {
            const participation = await client!.from("pilot_room_participants").select("public_id").eq("room_id", roomId).eq("maker_id", profile.id).maybeSingle();
            if (!active) return;
            if (!participation.error) setJoinedRoom(!!participation.data);
          }
          setMoments(currentStory); revision = state.revision;
        }
        if (!active) return;
        const story = { data: currentStory };
        setSnapshot(state); setCredits(state.credits); setLoadedRoom(roomId); setSyncError("");
        setRooms(current => current.map(item => item.id === roomId && item.title !== state.title ? { ...item, title: state.title } : item));
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
          if (prior?.lastMomentId) setResume(current => current ?? { momentId: prior.lastMomentId!, tipId: prior.lastTipId });
        }
        const target =
          sharedTarget.current?.room === roomId
            ? sharedTarget.current.moment
            : null;
        const targetTip = sharedTarget.current?.tip;
        if (target && !story.data.some((item) => item.id === target))
          setError(
            "That shared moment is unavailable. Showing a saved moment from this room.",
          );
        const initial = first;
        const entryId = roomId === KESSLER_ROOM_ID && story.data.some(item => item.id === KESSLER_OPENING_ID)
          ? KESSLER_OPENING_ID
          : story.data.at(-1)?.id ?? "";
        setSelectedId((current) =>
          story.data.some((item) => item.id === (target ?? current))
            ? (target ?? current)
            : initial ? entryId : current,
        );
        setTipId((current) =>
          target && story.data.some((item) => item.id === target)
            ? sharedReadingTip(story.data, roomId, target, targetTip)
            : story.data.some((item) => item.id === current)
              ? current
              : initial ? entryId : current,
        );
        if (target) sharedTarget.current = null;
        if (initial && own.data?.some(item => ["queued", "dispatching", "uncertain", "delivered", "draft"].includes(item.status))) setView("read");
        first = false;
        setOperation((current) =>
          current
            ? (own.data?.find((item) => item.id === current.id) ?? current)
            : initial
              ? own.data?.find((item) => ["queued", "dispatching", "uncertain"].includes(item.status))
                ?? own.data?.find((item) => item.status === "delivered")
                ?? own.data?.find((item) => item.status === "draft")
              : undefined,
        );
        setRecoveryScope({ roomId, actorId: profile?.id ?? null });
      } catch (reason) {
        if (active) setSyncError(message(reason));
        throw reason;
      } finally {
        fetching = false;
      }
    }
    const stop = pollWhileVisible(sync, 3000);
    return () => {
      active = false;
      stop();
    };
  }, [client, roomId, profile?.id]);

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
    // Room totals are ambient and each check is a server function, so they refresh gently.
    const stop = whileVisible(() => void syncActivity(), 10_000);
    return () => { active = false; stop(); };
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
  const signOutBlock = roomSignOutBlock({ generating: hasActive || wrenBusy || !!wrenPreviewId, drafting: !!draft, walletBusy: releaseBusy, checking: !!account?.loading, busy });
  const entranceDestinationHandled = useRef(false);

  useEffect(() => {
    if (entranceDestinationHandled.current || roomId !== KESSLER_ROOM_ID || loadedRoom !== roomId || !path.length || account?.loading || composing || hasActive || reviewing || wrenBusy) return;
    const destination = window.location.hash.slice(1);
    if (!["kessler-contributions", "kessler-wren", "kessler-backing"].includes(destination)) return;
    if (view !== "read") { setView("read"); return; }
    const target = document.getElementById(destination);
    if (!target) return;
    const frame = requestAnimationFrame(() => {
      entranceDestinationHandled.current = true;
      if (target instanceof HTMLDetailsElement) target.open = true;
      const focus = target instanceof HTMLDetailsElement ? target.querySelector("summary") : target;
      if (focus && !focus.hasAttribute("tabindex")) focus.setAttribute("tabindex", "-1");
      target.scrollIntoView({ block: "start" });
      focus?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [roomId, loadedRoom, path.length, account?.loading, composing, hasActive, reviewing, wrenBusy, view]);

  useEffect(() => {
    if (!roomId || loadedRoom !== roomId || account?.loading || profileLoadedFor !== actorId || profile && profile.id !== actorId) return;
    recordFirstNightEntry(roomId, actorId);
  }, [roomId, loadedRoom, actorId, account?.loading, profileLoadedFor, profile?.id]);

  useEffect(() => {
    applyFirstNightStarter();
  }, [firstNightStarter, roomId, loadedRoom, moments, recoveryScope, profileLoadedFor, actorId, account?.loading, draft, operation, busy, releaseBusy]);

  useEffect(() => {
    if (!focusNameEntry || profile || view !== "read" || !composing) return;
    const target = document.querySelector<HTMLInputElement>("[data-pilot-storyteller-name]");
    if (!target) return;
    target.scrollIntoView({ block: "center" });
    target.focus({ preventScroll: true });
    setFocusNameEntry(false);
  }, [focusNameEntry, profile, view, composing, draft, operation]);

  useEffect(() => {
    if (view !== "read" || !selected || loadedRoom !== roomId || visit.current?.roomId !== roomId)
      return;
    const readingTip = path.at(-1)?.id ?? selected.id;
    setResume({ momentId: selected.id, tipId: readingTip });
    try {
      sessionStorage.setItem(`pilot-selected:${roomId}`, selected.id);
      sessionStorage.setItem(`pilot-tip:${roomId}`, readingTip);
    } catch { /* Reading works without session storage. */ }
    try {
      localStorage.setItem(
        visitKey(roomId),
        JSON.stringify(visitSnapshot(moments, selected.id, readingTip)),
      );
    } catch {
      /* Reading works without visit storage. */
    }
  }, [moments, selectedId, tipId, roomId, loadedRoom, view]);

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
    setDraftRecovery(false);
  }, [operation, draft, profile, roomId]);

  async function join(name: string) {
    const joined = await joinPilotAsGuest(client!, name);
    const participation = await client!.rpc("pilot_join_room", { p_room_id: roomId });
    if (participation.error) throw new Error("Your storyteller name is saved, but joining could not be confirmed. Check this room again.");
    setJoinedRoom(true);
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

  async function invite() {
    const url = roomLink(window.location.origin, roomId);
    setInvitation(url);
    try {
      if (navigator.share) await navigator.share({ title: room?.title ?? "Fork Night", text: "Make a story together.", url });
      else { await navigator.clipboard.writeText(url); setNotice("Room link copied. Send it to your storytellers."); }
    } catch (reason) {
      if (reason instanceof Error && reason.name === "AbortError") return;
      setNotice("Select and copy the room link to invite your storytellers.");
    }
  }
  async function joinRoom() {
    if (!client) return;
    if (!profile) { setJoinOpen(true); return; }
    const result = await client.rpc("pilot_join_room", { p_room_id: roomId });
    if (result.error) throw new Error("Joining could not be confirmed. Check this room again.");
    setJoinedRoom(true); setJoinOpen(false);
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
    if (!response.ok) {
      if (result.activeWork && validRoomId(result.activeWork.roomId) && isUuid(result.activeWork.parentId))
        setOtherWork({ room_id: result.activeWork.roomId, parent_id: result.activeWork.parentId });
      throw new Error(
        result.error ??
          "Your draft is saved. Check the saved result to reconnect.",
      );
    }
  }

  async function generate() {
    if (!client || !profile || !selected) return;
    if (wrenBusy) throw new Error("Check your saved Wren request before starting another scene.");
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
      p_title: Array.from(input.captions[0]).slice(0, 80).join(""),
      p_prompt: input.captions.join("\n"),
      p_captions: input.captions,
      p_idea_id: input.idea?.id,
    });
    if (saved.error) {
      // A refused save recorded nothing, so the draft opens again to edit or cancel.
      // Only an unknown outcome keeps it locked to retry the same request.
      if (definitelyRejected(saved)) {
        changeDraft({ ...input, submitted: false });
        throw new Error(
          "This preview could not be saved. Edit it and try again, or cancel the draft.",
        );
      }
      throw new Error(
        "Your draft is kept in this browser. Reconnect and try saving it again.",
      );
    }
    localStorage.removeItem(pendingKey(profile.id, roomId));
    setDraft(undefined);
    setDraftRecovery(false);
    const panelCount = Array.isArray(saved.data.requested_captions) ? saved.data.requested_captions.length : input.captions.length;
    const optimistic: GenerationOperation = {
      ...saved.data,
      status: "dispatching",
      pilot_jobs: {
        operation_id: saved.data.id,
        state: "starting",
        panel_count: panelCount,
        updated_at: new Date().toISOString(),
      },
    };
    setOperation(optimistic);
    try {
      await enqueue(saved.data);
    } catch (reason) {
      setOperation(saved.data);
      throw reason;
    }
  }

  function select(id: string, changePath = false, pathTip?: string) {
    const nextTip = pathTip ?? (changePath ? id : tipId || id);
    setPublications(items => items.filter(item => item.id !== id));
    if (changePath || pathTip) setTipId(nextTip);
    setSelectedId(id);
    setShareUrl("");
    setInspectingSource(true);
    setView("read");
    if (roomId === KESSLER_ROOM_ID) {
      const url = new URL(window.location.href);
      url.searchParams.set("moment", id);
      if (nextTip !== id) url.searchParams.set("tip", nextTip); else url.searchParams.delete("tip");
      if (url.searchParams.get("view") !== "read") url.searchParams.delete("view");
      window.history.replaceState(window.history.state, "", url);
    }
    if (!hasActive && !draft) setComposing(false);
  }
  function resumeReading() {
    if (!resume) return;
    select(resume.momentId, false, sharedReadingTip(moments, roomId, resume.momentId, resume.tipId));
    requestAnimationFrame(() => { const reader = document.getElementById("pilot-story-reader"); reader?.focus({ preventScroll: true }); reader?.scrollIntoView({ block: "start" }); });
  }
  function showRoomOverview() {
    if (busy || releaseBusy || filmBusy || composing || hasActive || wrenBusy || wrenPreviewId) return;
    const url = new URL(window.location.href);
    for (const key of ["moment", "tip", "film", "view"]) url.searchParams.delete(key);
    url.hash = "";
    window.history.replaceState(window.history.state, "", url);
    setView("overview");
    requestAnimationFrame(() => { const heading = document.getElementById("kessler-overview-title"); heading?.focus({ preventScroll: true }); heading?.scrollIntoView({ block: "start" }); });
  }
  function readOverviewPath(id: string, fromBeginning: boolean) {
    try {
      const branch = pilotPath(moments, roomId, id);
      select(fromBeginning ? branch[0].id : id, false, id);
      requestAnimationFrame(() => { const reader = document.getElementById("pilot-story-reader"); reader?.focus({ preventScroll: true }); reader?.scrollIntoView({ block: "start" }); });
    } catch { setError("This path could not be loaded completely. Reload the room to try again."); }
  }
  function showSceneMap() {
    setView("map");
    requestAnimationFrame(() => { const map = document.querySelector<HTMLElement>(".pilot-map"); if (map) { map.tabIndex = -1; map.focus({ preventScroll: true }); map.scrollIntoView({ block: "start" }); } });
  }
  function start(idea?: Tables<"pilot_ideas">, invitation?: { parentId: string; prompt: string }, options: { replaceDraft?: boolean } = {}) {
    if (!selected) return;
    if (wrenBusy || wrenPreviewId) { setNotice("Wren has your saved fork. Check its request before starting another continuation."); return; }
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
    if ((hasActive || draft) && !options.replaceDraft) {
      setNotice(
        "Your earlier continuation is still here. Finish or cancel it before starting another.",
      );
      setComposing(true);
      setView("read");
      requestAnimationFrame(() => taskHeading.current?.focus());
      return;
    }
    const parentId = idea?.moment_id ?? invitation?.parentId ?? selected.id;
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
      thoughtPlaceholder: invitation?.prompt || undefined,
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
    setDraftRecovery(false);

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
  function applyFirstNightStarter() {
    if (!firstNightStarter || account?.loading || busy || releaseBusy || loadedRoom !== roomId ||
      firstNightStarter.roomId !== roomId || profileLoadedFor !== actorId || profile && profile.id !== actorId ||
      recoveryScope?.roomId !== roomId || recoveryScope.actorId !== (profile?.id ?? null)) return;
    const current = parseFirstNightStarter(window.location.search);
    if (!current || current.roomId !== firstNightStarter.roomId || current.momentId !== firstNightStarter.momentId ||
      current.starterId !== firstNightStarter.starterId) return;
    const source = moments.find(moment => moment.room_id === roomId && moment.id === current.momentId);
    if (!source) {
      setNotice("The opening for this invitation is unavailable. Choose a saved moment before adding your idea.");
    } else if (draft || hasActive || mutation.current) {
      setNotice("Your earlier continuation is still here. Finish or cancel it before trying this invitation.");
    } else {
      // The handoff opens the ordinary editor; generation and publication stay deliberate.
      select(source.id, true);
      start(undefined, { parentId: source.id, prompt: current.prompt });
    }
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${stripFirstNightParams(window.location.search)}${window.location.hash}`);
    setFirstNightStarter(null);
  }
  function followFirstNightResult() {
    const result = firstNightJourney.result;
    if (!result || !actorId || account?.loading || loadedRoom !== roomId || profileLoadedFor !== actorId || profile && profile.id !== actorId ||
      recoveryScope?.roomId !== roomId || recoveryScope.actorId !== (profile?.id ?? null)) return;
    if (draft || hasActive || busy || releaseBusy) {
      setNotice("Your current continuation is still here. Finish or cancel it before following another contribution.");
      return;
    }
    const source = moments.find(moment => moment.room_id === roomId && moment.id === (result.kind === "moment" ? result.id : result.parentId));
    if (!source || result.kind === "moment" && source.maker_id !== actorId) {
      setNotice("Your saved contribution is not in this view yet. Reload the saved story to find it.");
      return;
    }
    select(source.id, true);
    requestAnimationFrame(() => {
      const target = document.getElementById(result.kind === "idea" ? `idea-${result.id}` : "pilot-contribution-credits") ??
        document.getElementById(result.kind === "idea" ? "pilot-ideas" : "pilot-contribution-credits");
      if (target instanceof HTMLDetailsElement) target.open = true;
      target?.scrollIntoView({ block: "start" });
      (target instanceof HTMLDetailsElement ? target.querySelector("summary") : target)?.focus({ preventScroll: true });
    });
  }
  function readFirstNightOpening() {
    if (busy || releaseBusy || account?.loading || loadedRoom !== roomId || profileLoadedFor !== actorId || profile && profile.id !== actorId ||
      recoveryScope?.roomId !== roomId || recoveryScope.actorId !== (profile?.id ?? null)) return;
    if (draft || hasActive || mutation.current) {
      setNotice("Your current continuation is still here. Finish or cancel it before returning to the opening.");
      return;
    }
    const opening = moments.find(moment => moment.room_id === roomId && moment.parent_id === null);
    if (!opening) {
      setNotice("This story’s opening is unavailable. Reload the saved story to check again.");
      return;
    }
    select(opening.id, true);
    requestAnimationFrame(() => {
      const reader = document.getElementById("pilot-story-reader");
      reader?.scrollIntoView({ block: "start" });
      reader?.focus({ preventScroll: true });
    });
  }
  function makeFirstNightContinuation() {
    if (busy || releaseBusy || account?.loading || loadedRoom !== roomId || profileLoadedFor !== actorId || profile && profile.id !== actorId ||
      recoveryScope?.roomId !== roomId || recoveryScope.actorId !== (profile?.id ?? null)) return;
    start();
  }
  function focusStorytellerName() {
    if (!selected || busy || releaseBusy || wrenBusy || !!wrenPreviewId || account?.loading) return;
    setJoinOpen(false);
    setView("read");
    if (draft || hasActive) {
      select(draft?.parentId ?? operation!.parent_id);
      setComposing(true);
    } else if (pilotPath(moments, roomId, selected.id).length >= 13) {
      setJoinOpen(true);
      return;
    } else start();
    setFocusNameEntry(true);
  }
  function changeDraft(next: Draft) {
    setDraft(next);
    setDraftRecovery(false);
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
    setDraftRecovery(false);
    setComposing(false);
  }
  function continueRecoveredDraft() {
    setDraftRecovery(false);
    setComposing(true);
    setView("read");
    requestAnimationFrame(() => taskHeading.current?.focus());
  }
  function startFreshDraft() {
    if (!draft) return;
    if (hasActive) {
      setNotice("Your generation is still in progress. Review or discard it before starting fresh.");
      setDraftRecovery(false);
      setComposing(true);
      return;
    }
    if (wrenBusy || wrenPreviewId) { setNotice("Wren has your saved fork. Check its request before starting another continuation."); return; }
    if (releaseBusy) { setNotice("Finish the current wallet action before starting a new continuation."); return; }
    if (!selected || pilotPath(moments, roomId, selected.id).length >= 13) {
      setNotice("This path has reached the pilot’s length limit. Choose an earlier moment before starting fresh. Your draft is still saved.");
      return;
    }
    if (draft.submitted && !window.confirm("This continuation may already have generation in progress. Start fresh anyway?")) return;
    if (profile) {
      try {
        localStorage.removeItem(pendingKey(profile.id, roomId));
      } catch {
        setError("This browser could not clear the saved draft. Try again before leaving.");
        return;
      }
    }
    setDraft(undefined);
    setDraftRecovery(false);
    start(undefined, undefined, { replaceDraft: true });
  }

  async function publishMoment() {
    if (!client || !profile || !operation || operation.status !== "delivered") return;
    const result = await client.rpc("pilot_publish", { p_operation_id: operation.id });
    if (result.error || !result.data || result.data.room_id !== roomId || result.data.maker_id !== profile.id)
      throw new Error("Publication could not be confirmed. Try again to check the same saved moment.");
    recordFirstNightResult({ roomId, actorId: profile.id, kind: "moment", id: result.data.id, parentId: result.data.parent_id ?? undefined });
    setOperation({ ...operation, status: "published", published_moment_id: result.data.id });
    setMoments(items => items.some(item => item.id === result.data.id) ? items : [...items, result.data]);
    select(result.data.id, true);
    setDraft(undefined);
    setDraftRecovery(false);
    setComposing(false);
  }
  async function discardMoment() {
    if (!client || !operation || operation.status !== "delivered") return;
    const result = await client.rpc("pilot_discard", { p_operation_id: operation.id });
    if (result.error) throw new Error("Discard could not be confirmed. Your saved result remains available.");
    setOperation({ ...operation, status: "discarded" });
    setDraftRecovery(false);
  }

  async function recoverWrenPreview(operationId: string) {
    if (!client || !profile) throw new Error("Reconnect your storyteller account to review this preview.");
    const result = await client.from("pilot_operations").select("*,pilot_jobs(operation_id,state,panel_count,updated_at)")
      .eq("id", operationId).eq("room_id", roomId).eq("maker_id", profile.id).single();
    if (wrenScope.current?.roomId !== roomId || wrenScope.current.actorId !== profile.id) return;
    if (result.error || !result.data) throw new Error("Your private scene is saved. Check again to load it.");
    if (result.data.status !== "delivered") return;
    setWrenPreviewId(operationId);
    if (currentDraft.current) throw new Error("Wren’s preview is saved. Cancel your current draft when you’re ready, then check Wren’s request to review it.");
    setOperation(result.data); setWrenOperationId(operationId); setWrenPreviewId(undefined); setSelectedId(result.data.parent_id); setComposing(true); setView("read");
  }

  function acceptWrenRequest(parentId: string, originDraftId?: string) {
    if (wrenScope.current?.roomId !== roomId || wrenScope.current.actorId !== profile?.id) return;
    if (!originDraftId || !draft || draft.requestId !== originDraftId || draft.submitted || draft.stage !== "idea" || draft.parentId !== parentId) return;
    if (profile) localStorage.removeItem(pendingKey(profile.id, roomId));
    setDraft(undefined); setComposing(false);
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
        onSaved={(idea) => recordFirstNightResult({ roomId: idea.room_id, actorId: idea.maker_id, kind: "idea", id: idea.id, parentId: idea.moment_id })}
      />
    ) : null;
  const proofRoom = proofRoomIds.has(roomId);
  const identityDisabled = !selected || busy || releaseBusy || wrenBusy || !!wrenPreviewId || !!account?.loading || !!account?.error && !account.user || (profile ? hasActive || !!draft : false);
  const releasePanel = client && selected && loadedRoom === roomId && path.length ? <TestnetRelease
    roomId={roomId} moments={moments} tipId={path.at(-1)!.id}
    makerId={profile?.id} makerName={profile?.display_name} client={client}
    assisted={wrenMoments}
    onBusyChange={setReleaseBusy}
    onChoosePath={(id) => select(id, true)}
    onInspect={(id) => {
      select(id);
      requestAnimationFrame(() => {
        const reader = document.getElementById("pilot-story-reader");
        reader?.scrollIntoView({ block: "start" });
        reader?.focus({ preventScroll: true });
      });
    }}
  /> : null;

  if (unavailable) return <><AppHeader current="rooms" guide={false} /><main className="pilot-shell"><div className="pilot-intro"><h1>This room is unavailable.</h1><p>The link may be incomplete or the room may be closed.</p><a className="button primary" href="/pilot">Explore shared stories</a></div></main></>;

  const storytellerCount = new Set(path.map((item) => item.maker_id ?? item.maker_label)).size;
  const overviewVisible = roomId === KESSLER_ROOM_ID && view === "overview";
  return (
    <div className="pilot-room-page" data-room-theme={theme}>
      <a className="skip-link" href="#shared-story">Skip to story</a>
      <AppHeader current="rooms" guide={roomId ? <FirstNightGuide roomId={roomId} actorId={actorId} compact tone={theme === "neon" ? "night" : "paper"} onRead={readFirstNightOpening} onMake={makeFirstNightContinuation} onFollow={followFirstNightResult} /> : false} account={false} />
      <main className="pilot-shell" id="shared-story" data-room-theme={theme} data-overview={overviewVisible} tabIndex={-1}>
      <div className="pilot-room-toolbar">
        <a className="fn-context-link" href="/pilot"><ArrowLeft size={16} aria-hidden="true" />All shared rooms</a>
        <label className="pilot-room-choice">
          <span>Story room</span>
          <select
            aria-label="Story room"
            value={roomId}
            disabled={busy || releaseBusy || wrenBusy || !!wrenPreviewId || hasActive || !!draft}
            onChange={(event) => {
              setRoomId(event.target.value);
              setSelectedId("");
              setTipId("");
              setResume(undefined);
              setComposing(false);
              setNotice("");
              setShareUrl("");
              setView(event.target.value === KESSLER_ROOM_ID ? "overview" : "read");
              window.history.replaceState(
                null,
                "",
                `/pilot?room=${encodeURIComponent(event.target.value)}`,
              );
              window.dispatchEvent(new PopStateEvent("popstate"));
            }}
          >
            {rooms.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button secondary pilot-map-toggle"
          onClick={() => roomId === KESSLER_ROOM_ID ? overviewVisible ? showSceneMap() : showRoomOverview() : setView(view === "map" ? "read" : "map")}
          disabled={!selected || filmBusy || busy || releaseBusy || wrenBusy || !!wrenPreviewId || composing || hasActive}
        >
          <MapIcon size={16} aria-hidden="true" />
          {roomId === KESSLER_ROOM_ID ? overviewVisible ? "Full scene map" : "Room overview" : view === "map" ? "Back to story" : "Map"}
        </button>
        <div className="pilot-header-actions">
          {overviewVisible ? <details className="kessler-overview-account"><summary>{profile?.display_name ?? (account?.user ? "Your account" : "Join or sign in")}</summary><div><PilotIdentity profile={profile} disabled={identityDisabled} signOutDisabled={!!signOutBlock} signOutBlockedReason={signOutBlock} onJoin={profile ? () => setJoinOpen(true) : focusStorytellerName} /></div></details> : <PilotIdentity profile={profile} disabled={identityDisabled} signOutDisabled={!!signOutBlock} signOutBlockedReason={signOutBlock} onJoin={profile ? () => setJoinOpen(true) : focusStorytellerName} />}
        </div>
      </div>
      <div className="pilot-intro" hidden={overviewVisible}>
        <h1>{room?.title ?? "Opening the shared story…"}</h1>
        <p>{room?.description ?? "Stories and ideas stay here for the next person."}</p>
        {roomId === KESSLER_ROOM_ID && <p className="pilot-prepared-note">Two prepared branches start the story. Every scene you add keeps your byline, with Wren credited separately when it helps.</p>}
      </div>
      {overviewVisible && client && loadedRoom === roomId && moments.length > 0 && <KesslerRoomOverview
        client={client} moments={moments} resume={moments.find(moment => moment.id === resume?.momentId)} blocked={busy || releaseBusy || filmBusy || wrenBusy}
        onRead={readOverviewPath} onResume={resumeReading}
        onMap={showSceneMap}
        onWatch={id => { setRequestedFilmId(id); setFilmOpenRequest(value => value + 1); }}
      />}
      <div className="pilot-context">
        {roomId === "midnight-signal" && !composing && !hasActive && !wrenBusy && !reviewing && releasePanel}
        {roomId === KESSLER_ROOM_ID
          ? <KesslerRoomGuide overview={kessler.overview} unavailable={kessler.unavailable} blocked={composing || hasActive || wrenBusy || reviewing || filmBusy} onNavigate={destination => {
            setView("read");
            if (destination === "kessler-films") { setRequestedFilmId(undefined); setFilmOpenRequest(value => value + 1); }
            requestAnimationFrame(() => { const target = document.getElementById(destination); target?.scrollIntoView({ block: "start" }); target?.focus({ preventScroll: true }); });
          }} />
          : <PilotRoomFunding roomId={roomId} loadedRoom={loadedRoom} creditsAvailable={credits?.available} />}
        {roomId === KESSLER_ROOM_ID && client && path.length > 0 && <div hidden={composing || hasActive || wrenBusy || reviewing}><RoomFilmStudio client={client} moments={moments} currentPath={path} openRequest={filmOpenRequest} requestedFilmId={requestedFilmId} compact={overviewVisible} onBusyChange={setFilmBusy} onRead={(id, trace) => {
          select(id, true);
          setView("read");
          requestAnimationFrame(() => { const target = document.getElementById(trace ? "kessler-contributions" : "pilot-story-reader"); target?.scrollIntoView({ block: "start" }); target?.focus({ preventScroll: true }); });
        }} /></div>}
      </div>
      {room && <section className="pilot-room-sign" aria-label="Storytellers and invitation">
        <Disclosure className="pilot-roster" summary={<>Joined storytellers · {snapshot?.participants.length ?? 0}<span className="pilot-roster-preview">{snapshot?.participants.slice(0, 3).map(person => person.name).join(", ")}</span></>}><ul>{snapshot?.participants.map(person => <li key={person.id}>{person.name}</li>)}</ul>{!snapshot?.participants.length && <p>Be the first to join this story.</p>}</Disclosure>
        {!joinedRoom && profile && <button className="button secondary" disabled={busy} onClick={() => setJoinOpen(true)}>Join this room</button>}
        {joinedRoom && <span>You joined this room</span>}
        {proofRoom && <a className="text-button" href={featuredStoryLinks.kessler}>Continue in Kessler <ArrowRight size={16} aria-hidden="true" /></a>}
        <button className="button secondary" type="button" onClick={() => void invite()}><Share2 size={16} aria-hidden="true" />Invite storytellers</button>
        {invitation && <label className="pilot-invitation-link">Room invitation<input readOnly value={invitation} onFocus={event => event.target.select()} /></label>}
      </section>}
      {publications.length > 0 && <section className="pilot-publication-notice" aria-label="New published moments"><p role="status">{publications.length === 1 ? `${publications[0].maker_label} published a new branch.` : `${publications.length} new moments.`}</p><ul>{publications.map(moment => <li key={moment.id}><span>{moment.title} · {moment.maker_label}</span><button className="text-button" onClick={() => select(moment.id, true)}>Read it</button></li>)}</ul><button className="text-button" onClick={() => setPublications([])}>Dismiss</button></section>}
      {truncated && <p role="status" className="pilot-notice">Showing the first 500 moments. This room has reached the reader’s current limit; some newer branches are not shown.</p>}
      {otherWork && <p className="pilot-notice">This storyteller already has generation to finish. <a href={`/pilot?room=${encodeURIComponent(otherWork.room_id)}&moment=${otherWork.parent_id}`}>Return to your saved work</a>. Your current draft stays saved.</p>}
      {joinOpen && <PilotDialog title="Join this story" onClose={() => { if (!busy) setJoinOpen(false); }} dismissible={!busy}>
        <p>Your storyteller name will be visible in this room. Published moments are public; your unpublished previews stay private.</p>
        {profile ? <p>Joining as <strong>{profile.display_name}</strong></p> : <label className="pilot-create-label">Storyteller name<input value={joinName} maxLength={60} autoComplete="nickname" onChange={event => setJoinName(event.target.value)} /></label>}
        {error && <p role="alert">{error}</p>}
        <button className="button primary" disabled={busy || (!profile && !joinName.trim())} onClick={() => void act(async () => { if (profile) await joinRoom(); else { await join(joinName); setJoinOpen(false); } })}>{busy ? "Joining…" : "Join this room"}</button>
      </PilotDialog>}
      {loadedRoom === roomId && credits && <PilotRoomActivity credits={{ ...credits, ...activity }} interrupted={!!syncError} />}
      {roomId === KESSLER_ROOM_ID && loadedRoom === roomId && credits && credits.available === 0 && <p className="pilot-reading-status">Reading and ideas are open. New images need room credits.</p>}
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
      {account?.notice && (
        <div className="pilot-notice" role="alert">
          <p>{account.notice}</p>
          <button className="text-button" onClick={account.dismissNotice}>
            Dismiss
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
                  variant="inline"
                  description={<>
                    <ArrowUp size={16} aria-hidden="true" /> Every moment opens a possibility ·{" "}
                    {moments.length}{" "}
                    {moments.length === 1 ? "moment" : "moments"}
                  </>}
                  action={<button className="text-button" onClick={() => setView("read")}>
                    <ArrowLeft size={16} aria-hidden="true" /> Back to your moment
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
                Read any branch. Highlighted moments mark your selected path.
              </p>
            </section>
          )}
          <div className="pilot-table" hidden={view !== "read"}>
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
                id="pilot-story-reader"
                tabIndex={-1}
                aria-label="Read and continue the story"
              >
                <header className="pilot-scene-plate">
                  <span className="pilot-letter">
                    {reviewing ? <Sparkles size={20} aria-hidden="true" /> : selectedLabel}
                  </span>
                  <h2>{reviewing ? operation.title : selected.title}</h2>
                  <div className="pilot-moment-context">
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
                      {(reviewing ? operation.id === wrenOperationId : wrenMoments.has(selected.id)) && <span> · with Wren’s help</span>}
                      {reviewing ? (
                        " · ready for your review"
                      ) : parent ? (
                        <>
                          {" "}
                          {roomId === KESSLER_ROOM_ID && !selected.maker_id ? "continues" : "built on"}{" "}
                          <button
                            className="text-button"
                            onClick={() => select(parent.id)}
                          >
                            {roomId === KESSLER_ROOM_ID && !selected.maker_id ? parent.title : parent.maker_label}
                          </button>
                        </>
                      ) : (
                        roomId === KESSLER_ROOM_ID && !selected.maker_id ? " · opening scene" : " started this story"
                      )}
                    </p>
                  </div>
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
                  operation={operation} draft={draft} recoveredDraft={draftRecovery} composing={composing} composerVisible={view === "read"} busy={busy || releaseBusy || wrenBusy && !reviewing || !!account?.loading || !!account?.error && !account.user}
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
                    continueDraft: continueRecoveredDraft,
                    startFresh: startFreshDraft,
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
                      className={hasActive ? "text-button pilot-return-link" : "button primary"}
                      hidden={composing && !!draft}
                      disabled={busy || releaseBusy || wrenBusy}
                      onClick={() => start()}
                    >
                      <GitBranch size={16} aria-hidden="true" />
                      {draft || hasActive
                        ? "Return to your continuation"
                        : "Add the next part"}
                    </button>
                    <button
                      className="button secondary"
                      disabled={busy || releaseBusy}
                      onClick={() => void share()}
                    >
                      <Share2 size={16} aria-hidden="true" /> Share this moment
                    </button>
                  </div>
                )}
                {roomId === KESSLER_ROOM_ID && <div id="pilot-contribution-credits" hidden={composing || hasActive || wrenBusy || reviewing}>{releasePanel}</div>}
                {roomId === KESSLER_ROOM_ID && <WrenAssistant
                  key={`wren:${roomId}:${profile?.id ?? "visitor"}`} client={client} actorId={profile?.id}
                  publicState={kessler.overview ? kesslerWrenState(kessler.overview) : kessler.unavailable ? "unavailable" : "loading"}
                  parent={moments.find(moment => moment.id === draft?.parentId) ?? selected} moments={moments}
                  initialBrief={draft?.stage === "idea" ? draft.thought : undefined}
                  originDraftId={draft?.requestId}
                  blocked={busy || releaseBusy || !!account?.loading || !!operation && !finalStates.has(operation.status) || !!draft && (draft.submitted === true || draft.stage !== "idea")}
                  onJoin={() => setJoinOpen(true)} onBusyChange={setWrenBusy} onAccepted={acceptWrenRequest} onReady={recoverWrenPreview} onInspect={id => select(id)}
                />}
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
                {credits && (
                  <p className="pilot-credit-line">
                    <Sparkles size={16} aria-hidden="true" />
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
                {proofRoom && !reviewing && <KesslerTurnCard />}
                {roomId !== KESSLER_ROOM_ID && <Disclosure
                  className="pilot-credits"
                  id="pilot-contribution-credits"
                  summary={<>Made together by {storytellerCount} {storytellerCount === 1 ? "storyteller" : "storytellers"}</>}
                >
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
                </Disclosure>}
                {!reviewing &&
                  moments.some((item) => item.parent_id === selected.id) && (
                    <nav
                      className="pilot-continuations"
                      aria-label="What others made next"
                    >
                      <SectionPlate title="Where others took it" icon={GitBranch} variant="inline" level={3} className="pilot-branch-sign" />
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
                            <ArrowRight size={16} aria-hidden="true" />
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
        <>
          <div className="pilot-loading" role="status">
            {pathError
              ? "Reconnect to read the complete path."
              : "Opening the shared story…"}
          </div>
        </>
      )}
      <footer className="pilot-footer">
        <span>{room?.description}</span>
        <a href="/pilot">Back to shared rooms</a>
      </footer>
    </main>
    </div>
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
  const { viewportRef, helpId, centerOn } = useCanvasNavigation(`${seed.room_id}:${visible}`, selectedId);
  return (
    <>
      <div className="pilot-map-navigation">
        <p id={helpId}>Drag to move · Scroll or swipe to explore · Focus the canvas and use arrow keys or Page Up / Down</p>
        <div className="pilot-map-tools" role="group" aria-label="Map navigation">
          <button className="text-button" type="button" onClick={() => centerOn(selectedId)}>Find selected</button>
          <button className="text-button" type="button" onClick={() => centerOn(seed.id)}>Back to the seed</button>
        </div>
      </div>
      <div
        className="pilot-map-scroll story-canvas-viewport"
        ref={viewportRef}
        role="region"
        aria-label="Story map canvas"
        aria-describedby={helpId}
        tabIndex={0}
      >
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
              data-canvas-node={moment.id}
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
    </>
  );
}
