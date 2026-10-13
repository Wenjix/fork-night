"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json, Tables } from "@/lib/supabase/database.types";
import { pilotBrowserClient } from "@/lib/supabase/pilot-client";
import { pilotPanels, type PilotMoment, type PilotPanel } from "@/lib/pilot";
import { WREN } from "@/lib/agents/wren";

export type PilotIdea = Tables<"pilot_ideas">;
export type RoomCredits = { limit: number; used: number; available: number };

export type WrenScene = {
  moment: PilotMoment;
  panels: PilotPanel[];
  parentTitle: string | null;
  /** The idea note Wren left on the parent just before drawing this scene. */
  note: PilotIdea | null;
  /** Moments made by someone other than Wren that continue this scene. */
  continuedBy: number;
};

export type WrenRoomData = {
  scenes: WrenScene[]; // newest first
  ideas: PilotIdea[]; // newest first
  continuedByPeople: number;
  credits: RoomCredits | null;
  /** Title of every published moment in the room, by ID. */
  titles: Record<string, string>;
  readAt: Date;
};

export type WrenRoomState = {
  status: "loading" | "ready" | "error" | "unconfigured";
  data?: WrenRoomData;
  client?: SupabaseClient<Database>;
};

const POLL_MS = 15_000;

function parseCredits(raw: Json | null): RoomCredits | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { limit, used, available } = raw as Record<string, unknown>;
  if (
    typeof limit !== "number" ||
    typeof used !== "number" ||
    typeof available !== "number"
  )
    return null;
  return { limit, used, available };
}

/** Reads only what any guest may read: published moments, Wren's idea notes and the room's credits. */
async function readWrenRoom(
  client: SupabaseClient<Database>,
): Promise<WrenRoomData> {
  const [moments, ideas, credits] = await Promise.all([
    client
      .from("pilot_moments")
      .select("*")
      .eq("room_id", WREN.roomId)
      .order("created_at")
      .limit(500),
    client
      .from("pilot_ideas")
      .select("*")
      .eq("room_id", WREN.roomId)
      .eq("maker_id", WREN.profileId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(30),
    client.rpc("pilot_room_credits", { p_room_id: WREN.roomId }),
  ]);
  if (moments.error || ideas.error)
    throw new Error("The room could not be read.");
  const all = moments.data ?? [];
  const wrenIdeas = ideas.data ?? [];
  const scenes: WrenScene[] = [];
  for (const moment of all) {
    if (moment.maker_id !== WREN.profileId) continue;
    let panels: PilotPanel[];
    try {
      panels = pilotPanels(moment.panels);
    } catch {
      continue;
    }
    const parent = all.find((m) => m.id === moment.parent_id) ?? null;
    const note =
      wrenIdeas.find(
        (idea) =>
          idea.moment_id === moment.parent_id &&
          idea.created_at <= moment.created_at,
      ) ?? null;
    scenes.push({
      moment,
      panels,
      parentTitle: parent?.title ?? null,
      note,
      continuedBy: all.filter(
        (m) => m.parent_id === moment.id && m.maker_id !== WREN.profileId,
      ).length,
    });
  }
  scenes.reverse();
  return {
    scenes,
    ideas: wrenIdeas,
    continuedByPeople: scenes.reduce((sum, s) => sum + s.continuedBy, 0),
    credits: credits.error ? null : parseCredits(credits.data),
    titles: Object.fromEntries(all.map((m) => [m.id, m.title])),
    readAt: new Date(),
  };
}

export function useWrenRoom(): WrenRoomState {
  const [state, setState] = useState<WrenRoomState>({ status: "loading" });
  useEffect(() => {
    const client = pilotBrowserClient();
    if (!client) {
      setState({ status: "unconfigured" });
      return;
    }
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;
    const refresh = async () => {
      if (inFlight) return;
      inFlight = true;
      if (timer) clearTimeout(timer);
      try {
        const data = await readWrenRoom(client);
        if (active) setState({ status: "ready", data, client });
      } catch {
        if (active)
          setState((previous) => ({
            status: "error",
            data: previous.data,
            client,
          }));
      }
      inFlight = false;
      if (active) timer = setTimeout(tick, POLL_MS);
    };
    const tick = () => {
      if (document.visibilityState === "visible") void refresh();
      else timer = setTimeout(tick, POLL_MS);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    void refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return state;
}
