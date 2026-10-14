"use client";

import { useCallback, useEffect, useState } from "react";
import {
  FIRST_NIGHT_MOMENT_ID, FIRST_NIGHT_ROOM_ID, firstNightStoryFromRows,
  readFirstNightJourney, setFirstNightPreferences, subscribeFirstNightJourney,
  type FirstNightResult, type FirstNightStep, type FirstNightStory,
} from "../lib/first-night";
import { pilotBrowserClient } from "../lib/supabase/pilot-client";

type Journey = { step: FirstNightStep; result: FirstNightResult | null; hidden: boolean; expanded: boolean };
const initialJourney: Journey = { step: 1, result: null, hidden: false, expanded: false };

export function useFirstNightJourney(options: { roomId?: string; actorId?: string | null } = {}) {
  const roomId = options.roomId ?? FIRST_NIGHT_ROOM_ID;
  const explicitActor = options.actorId;
  const client = pilotBrowserClient();
  const [account, setAccount] = useState<{ id: string | null; ready: boolean }>({ id: null, ready: false });
  const actorId = explicitActor === undefined ? account.id : explicitActor;
  const actorReady = explicitActor !== undefined || account.ready;
  const scope = JSON.stringify([roomId, actorId, actorReady]);
  const [saved, setSaved] = useState<{ scope: string; journey: Journey }>();

  useEffect(() => {
    if (explicitActor !== undefined) {
      // A later return to automatic auth must resolve a fresh session, rather
      // than reusing the account cached before the explicit actor took over.
      setAccount({ id: null, ready: false });
      return;
    }
    if (!client) { setAccount({ id: null, ready: true }); return; }
    let live = true;
    let revision = 0;
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      revision += 1;
      if (live) setAccount({ id: session?.user.id ?? null, ready: true });
    });
    const started = revision;
    void client.auth.getSession().then(({ data, error }) => {
      if (live && revision === started) setAccount({ id: error ? null : data.session?.user.id ?? null, ready: true });
    }).catch(() => { if (live && revision === started) setAccount({ id: null, ready: true }); });
    return () => { live = false; subscription.unsubscribe(); };
  }, [client, explicitActor]);

  useEffect(() => {
    if (!actorReady) return;
    const refresh = () => setSaved({ scope, journey: readFirstNightJourney(roomId, actorId) });
    refresh();
    return subscribeFirstNightJourney(refresh);
  }, [roomId, actorId, actorReady, scope]);

  const hide = useCallback(() => setFirstNightPreferences({ hidden: true }), []);
  const show = useCallback(() => setFirstNightPreferences({ hidden: false }), []);
  const setExpanded = useCallback((expanded: boolean) => setFirstNightPreferences({ expanded }), []);
  const current = saved?.scope === scope ? saved.journey : initialJourney;
  return { ...current, ready: actorReady && saved?.scope === scope, hide, show, setExpanded };
}

type StoryState = { status: "loading" | "ready" | "unavailable" | "unconfigured" | "error"; story?: FirstNightStory };

export function useFirstNightStory() {
  const client = pilotBrowserClient();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<StoryState>({ status: "loading" });
  const retry = useCallback(() => setAttempt(current => current + 1), []);

  useEffect(() => {
    if (!client) { setState({ status: "unconfigured" }); return; }
    let live = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    setState({ status: "loading" });
    void (async () => {
      try {
        const [room, moment] = await Promise.all([
          client.from("pilot_rooms").select("*").eq("id", FIRST_NIGHT_ROOM_ID).abortSignal(controller.signal).maybeSingle(),
          client.from("pilot_moments").select("*").eq("id", FIRST_NIGHT_MOMENT_ID).eq("room_id", FIRST_NIGHT_ROOM_ID).abortSignal(controller.signal).maybeSingle(),
        ]);
        if (!live) return;
        if (room.error || moment.error) { setState({ status: "error" }); return; }
        const story = firstNightStoryFromRows(room.data, moment.data);
        setState(story ? { status: "ready", story } : { status: "unavailable" });
      } catch { if (live) setState({ status: "error" }); }
      finally { clearTimeout(timeout); }
    })();
    return () => { live = false; clearTimeout(timeout); controller.abort(); };
  }, [client, attempt]);

  return { ...state, retry };
}
