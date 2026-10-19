"use client";

import { useEffect, useState } from "react";
import { ArrowRight, BookOpen, ChevronDown, Feather, Plus } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "../lib/supabase/database.types";
import { pilotPanels, type PilotMoment } from "../lib/pilot";
import { HOME_HISTORY_LIMIT, returningRooms, roomHomeSummary, type HomeRoom } from "../lib/pilot-room-home";
import { featuredRooms } from "../lib/featured-stories";
import { fandomStory } from "../lib/fandom-stories";
import { StoryArt } from "./story-art";
import { PilotImage } from "./pilot-panels";

type Room = Tables<"pilot_rooms">;
type Template = Tables<"pilot_room_templates">;
type ReturnEntry = HomeRoom & { moments: PilotMoment[]; status: "loading" | "ready" | "unavailable" };

function RoomArt({ room, templates, client }: { room: Room; templates: Template[]; client: SupabaseClient<Database> | null }) {
  const template = templates.find(item => item.id === room.template_id && item.version === room.template_version);
  const panel = template ? pilotPanels(template.panels)[0] : undefined;
  const featured = featuredRooms.find(item => item.id === room.id);
  return panel && client ? <PilotImage client={client} panel={panel} allowRetry={false} />
    : featured ? <StoryArt src={featured.artwork} description={featured.artworkDescription} />
    : <span className="room-home-art-empty"><BookOpen size={28} aria-hidden="true" /><span>{room.title}</span></span>;
}

const invitations = [
  { id: "malfoy-hogwarts", beat: "unsent-owl", description: "A letter stays in her pocket. An owl leaves without it. Malfoy’s next choice is finally her own.", action: "Read Malfoy’s story" },
  { id: "blade-runner-memory", beat: "greenhouse", description: "Mara follows a memory of rain to a greenhouse above the city. Someone has kept something alive.", action: "Follow the memory" },
];

export function PilotRoomHome({ client, rooms, joined, templates, loading, unavailable }: {
  client: SupabaseClient<Database> | null; rooms: Room[]; joined: Room[]; templates: Template[]; loading: boolean; unavailable: boolean;
}) {
  const [returns, setReturns] = useState<ReturnEntry[]>([]);
  const [refresh, setRefresh] = useState(0);
  const [search, setSearch] = useState("");
  useEffect(() => {
    const candidates = returningRooms(rooms, joined, key => localStorage.getItem(key));
    setReturns(candidates.map(item => ({ ...item, moments: [], status: client ? "loading" : "unavailable" })));
    if (!client || !candidates.length) return;
    const controller = new AbortController();
    void Promise.all(candidates.map(async item => {
      try {
        const result = await client.from("pilot_moments").select("*").eq("room_id", item.room.id)
          .order("created_at", { ascending: false }).order("id").limit(HOME_HISTORY_LIMIT + 1).abortSignal(controller.signal);
        if (result.error) throw result.error;
        return { ...item, moments: result.data ?? [], status: "ready" as const };
      } catch { return { ...item, moments: [], status: "unavailable" as const }; }
    })).then(entries => { if (!controller.signal.aborted) setReturns(entries); });
    return () => controller.abort();
  }, [client, rooms, joined, refresh]);

  const returning = returns.map(item => ({ ...item, summary: roomHomeSummary(item, item.moments) }))
    .sort((a, b) => Number(b.summary.hasNew) - Number(a.summary.hasNew)
      || (b.summary.latest?.created_at ?? "").localeCompare(a.summary.latest?.created_at ?? "")).slice(0, 3);
  const allRooms = [...new Map([...joined, ...rooms].map(room => [room.id, room])).values()]
    .sort((a, b) => a.title.localeCompare(b.title));
  const matching = allRooms.filter(room => `${room.title} ${room.description}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));

  return <div className="room-home" id="shared-directory">
    {returning.length > 0 && <section className="room-home-returning" aria-labelledby="room-home-return-title">
      <div className="room-home-heading"><div><h2 id="room-home-return-title">Back to your stories</h2><p>Your joined rooms and reading places saved in this browser.</p></div></div>
      <div className="room-home-return-grid">{returning.map(({ room, visit, status, summary }) => <article className="room-home-return" key={room.id}>
        <a className="room-home-return-art" href={summary.latestHref} aria-label={`Read ${summary.latest?.title ?? room.title}`}>
          {summary.panel && client ? <PilotImage client={client} panel={summary.panel} allowRetry={false} /> : <RoomArt room={room} templates={templates} client={client} />}
        </a>
        <div className="room-home-return-copy">
          <div className="room-home-return-status" data-new={summary.hasNew}>{status === "loading" ? "Checking for new scenes…" : status === "unavailable" ? "Updates unavailable" : summary.hasNew ? summary.newCount === undefined ? "New scenes since your visit" : `${summary.newCount} new ${summary.newCount === 1 ? "scene" : "scenes"} since your visit` : visit ? "Your reading place" : "Joined room"}</div>
          <h3><a href={`/pilot?room=${encodeURIComponent(room.id)}`}>{room.title}</a></h3>
          {summary.latest ? <p><a href={summary.latestHref}>{summary.latest.title}</a><span> · {summary.latest.maker_label}</span></p> : <p>{status === "unavailable" ? "The room is still open. Check inside for the latest story." : room.description}</p>}
          <div className="room-home-return-actions">{summary.hasNew && <a href={summary.latestHref}>Read what’s new <ArrowRight size={16} aria-hidden="true" /></a>}
            <a href={summary.resumeHref}>{visit?.lastMomentId ? "Continue reading" : "Enter room"}<ArrowRight size={16} aria-hidden="true" /></a>
          </div>
        </div>
      </article>)}</div>
      {returns.some(item => item.status === "unavailable") && <p className="room-home-refresh" role="status">Some updates could not be checked. <button className="text-button" onClick={() => setRefresh(value => value + 1)}>Check updates again</button></p>}
    </section>}

    <section aria-labelledby="room-home-discover-title">
      <div className="room-home-heading"><div><h2 id="room-home-discover-title">{returning.length ? "A different world for tonight" : "Find your next chapter"}</h2><p>Familiar worlds. A turn you haven’t read yet.</p></div><span className="room-home-preview-note">Authored stories · local previews</span></div>
      <div className="room-home-invitations">{invitations.map(invitation => {
        const story = fandomStory(invitation.id)!;
        const beat = story.beats.find(item => item.id === invitation.beat)!;
        return <a className="room-home-story" href={`/#/project/${story.id}`} key={story.id}>
          <div className="room-home-story-art"><StoryArt src={`${beat.artwork ?? story.artwork}#frame=${beat.frames[0]}`} description={beat.captions[0]} /></div>
          <div className="room-home-story-copy"><h3>{story.title}</h3><p>{invitation.description}</p><span className="room-home-story-byline">A story turn by {beat.authorId === "jules" ? "Jules" : "Priya"}</span><span className="room-home-action">{invitation.action}<ArrowRight size={18} aria-hidden="true" /></span></div>
        </a>;
      })}</div>
    </section>

    <div className="room-home-together">
      <section className="room-home-agent" aria-labelledby="room-home-agent-title">
        <div className="room-home-agent-art"><StoryArt src="/art/night-shift-neon.webp#frame=2" description="A bird of cyan light finds a path across Kessler Ward’s rooftops." /></div>
        <div className="room-home-agent-copy"><h2 id="room-home-agent-title">Leave the next turn to Wren.</h2><p>A scene to build on. A direction from you. An agent with its own place in the story.</p>
          <a className="room-home-action" href="/pilot?room=kessler-ward#kessler-wren"><Feather size={17} aria-hidden="true" />Make with Wren<ArrowRight size={18} aria-hidden="true" /></a>
          <a className="room-home-secondary" href="/agents">Meet the agents</a>
        </div>
      </section>
      <section className="room-home-guild" aria-labelledby="room-home-guild-title">
        <div className="room-home-guild-top"><h2 id="room-home-guild-title">Around the guild table</h2><span className="room-home-preview-note">Local guild preview</span></div>
        <div className="room-home-guild-content"><div className="room-home-guild-art"><StoryArt src="/art/social-people.webp#frame=3" description="Storytellers draw and share ideas around a table." /></div>
          <div><h3>Paper Lantern</h3><p>Strange stories. Generous collaborators.</p><blockquote><p>“Could our next story fit inside a matchbox?”</p><cite>Sam left an idea for the guild</cite></blockquote>
          <a className="room-home-action" href="/#/guild/paper-lantern">Visit the guild<ArrowRight size={18} aria-hidden="true" /></a></div>
        </div>
      </section>
    </div>

    <details className="room-home-directory">
      <summary><span>All shared rooms <span className="room-home-directory-count">{loading ? "" : allRooms.length}</span></span><span>Find a room<ChevronDown size={18} aria-hidden="true" /></span></summary>
      <div className="room-home-directory-body" aria-busy={loading}>
        <label className="room-home-search">Find a story<input type="search" placeholder="Search room names or stories" value={search} onChange={event => setSearch(event.target.value)} /></label>
        {loading ? <p role="status">Opening the shared rooms…</p> : unavailable && !allRooms.length ? <p role="status">The room list is unavailable. Use Check connection above to try again.</p> : <>
          <div className="room-home-all-grid">{matching.map(room => <a key={room.id} href={`/pilot?room=${encodeURIComponent(room.id)}`}><span className="room-home-all-art"><RoomArt room={room} templates={templates} client={client} /></span><span><strong>{room.title}</strong><span>{room.description}</span></span><ArrowRight size={18} aria-hidden="true" /></a>)}</div>
          {!matching.length && <p role="status">{allRooms.length ? "No rooms match that search. Try another name." : "No listed rooms yet. If someone invited you, open their room link."}</p>}
        </>}
      </div>
    </details>
    <div className="room-home-close"><p>Bring a world of your own.</p><a className="text-button" href="/pilot?create=1"><Plus size={17} aria-hidden="true" />Create a room</a><a className="text-button" href="/">Explore the lobby<ArrowRight size={17} aria-hidden="true" /></a></div>
  </div>;
}
