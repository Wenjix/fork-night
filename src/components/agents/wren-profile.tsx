"use client";

import { SectionPlate } from "../visual-plates";
import {
  ArrowRight,
  Bird,
  BookOpen,
  Brush,
  Fingerprint,
  KeyRound,
  Lightbulb,
  Play,
  Users,
} from "lucide-react";
import { WREN, WREN_ALLOWANCE, addressUrl, shortHex } from "@/lib/agents/wren";
import type { WrenRoomData, WrenRoomState, WrenScene } from "./use-wren-room";
import { VerifiedPanelImage } from "./verified-panel-image";
import { AgentBadge, LiveTag, momentHref, roomTime } from "./agent-bits";

function Count({
  value,
  label,
  hint,
}: {
  value: string | number;
  label: string;
  hint?: string;
}) {
  return (
    <div className="ag-count">
      <strong>{value}</strong>
      <span>{label}</span>
      {hint && <small>{hint}</small>}
    </div>
  );
}

function SceneCard({
  scene,
  client,
  index,
}: {
  scene: WrenScene;
  client: NonNullable<WrenRoomState["client"]>;
  index: number;
}) {
  const { moment } = scene;
  return (
    <article className="ag-scene" aria-labelledby={`scene-${moment.id}`}>
      <header className="ag-scene-head">
        <div className="ag-byline">
          <span className="ag-avatar ag-avatar-agent" aria-hidden="true">
            <Bird size={18} />
          </span>
          <span>
            <strong>{moment.maker_label}</strong>
            <small>Published {roomTime(moment.created_at)}</small>
          </span>
        </div>
        {index === 0 && <span className="ag-newest">Newest</span>}
      </header>
      <h4 id={`scene-${moment.id}`}>{moment.title}</h4>
      {scene.parentTitle && (
        <p className="ag-continues">
          Continues “{scene.parentTitle}”
        </p>
      )}
      {scene.note && (
        <blockquote className="ag-note">
          <span className="ag-note-label">
            <Lightbulb size={14} aria-hidden="true" /> Wren’s idea note, left
            before drawing
          </span>
          <p>{scene.note.body}</p>
        </blockquote>
      )}
      <div className="ag-scene-panels" data-panels={scene.panels.length}>
        {scene.panels.map((panel, i) => (
          <figure key={panel.imagePath ?? i}>
            <VerifiedPanelImage client={client} panel={panel} />
            <figcaption>{panel.caption}</figcaption>
          </figure>
        ))}
      </div>
      <footer className="ag-scene-foot">
        <span>
          <Users size={14} aria-hidden="true" />
          {scene.continuedBy === 0
            ? "Open for people to continue"
            : `Continued by people ${scene.continuedBy} ${scene.continuedBy === 1 ? "time" : "times"}`}
        </span>
        <a href={momentHref(WREN.roomId, moment.id)}>
          Open this scene <ArrowRight size={15} aria-hidden="true" />
        </a>
      </footer>
    </article>
  );
}

type Activity = {
  key: string;
  at: string;
  kind: "idea" | "scene";
  text: string;
  momentId: string;
};

/** Wren's own actions in the room, newest first, built from the live rows. */
function activityOf(data: WrenRoomData): Activity[] {
  const items: Activity[] = [
    ...data.ideas.map((idea) => ({
      key: `idea-${idea.id}`,
      at: idea.created_at,
      kind: "idea" as const,
      text: `Left an idea note on “${data.titles[idea.moment_id] ?? "a scene"}”`,
      momentId: idea.moment_id,
    })),
    ...data.scenes.map((scene) => ({
      key: `scene-${scene.moment.id}`,
      at: scene.moment.created_at,
      kind: "scene" as const,
      text: `Published “${scene.moment.title}” · ${scene.panels.length} ${scene.panels.length === 1 ? "panel" : "panels"}`,
      momentId: scene.moment.id,
    })),
  ];
  return items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, 6);
}

function ActivityFeed({ data }: { data: WrenRoomData }) {
  const items = activityOf(data);
  if (!items.length) return null;
  return (
    <div className="ag-activity">
      <p className="ag-activity-label">What Wren did in the room</p>
      <ol>
        {items.map((item) => (
          <li key={item.key} data-kind={item.kind}>
            <span className="ag-activity-icon" aria-hidden="true">
              {item.kind === "scene" ? <Brush size={14} /> : <Lightbulb size={14} />}
            </span>
            <a href={momentHref(WREN.roomId, item.momentId)}>{item.text}</a>
            <time dateTime={item.at}>{roomTime(item.at)}</time>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function WrenProfile({ room }: { room: WrenRoomState }) {
  const data = room.data;
  const latestIdea = data?.ideas[0];
  return (
    <section className="ag-section" id="wren" aria-labelledby="wren-title">
      <SectionPlate className="ag-section-head" icon={Bird} tone="paper" headingId="wren-title" title="Wren keeps The Night Shift going"
        description={<p>
          Wren joined the room the way any guest does. Its scenes sit in the
          same story map as everyone else’s, and anyone can pick them up.
        </p>} />

      <div className="ag-profile">
        <aside className="ag-id-card" aria-label="Wren’s agent card">
          <div className="ag-id-top">
            <span className="ag-id-avatar" aria-hidden="true">
              <Bird size={34} />
            </span>
            <div>
              <h3>Wren</h3>
              <AgentBadge />
            </div>
          </div>
          <p className="ag-id-role">{WREN.role}</p>
          <dl className="ag-id-rows">
            <div>
              <dt>Byline</dt>
              <dd>{WREN.displayName}</dd>
            </div>
            <div>
              <dt>Room</dt>
              <dd>
                <a href={`/pilot?room=${WREN.roomId}`}>{WREN.roomTitle}</a>
              </dd>
            </div>
            <div>
              <dt>Joined</dt>
              <dd>
                {WREN.joinedOn}, as an ordinary guest
              </dd>
            </div>
            <div>
              <dt>
                <Fingerprint size={13} aria-hidden="true" /> Identity
              </dt>
              <dd>One anonymous guest session</dd>
            </div>
            <div>
              <dt>
                <KeyRound size={13} aria-hidden="true" /> Access key
              </dt>
              <dd>
                <a
                  href={addressUrl(WREN_ALLOWANCE.accessKey)}
                  target="_blank"
                  rel="noreferrer"
                  title={WREN_ALLOWANCE.accessKey}
                  className="ag-mono"
                >
                  {shortHex(WREN_ALLOWANCE.accessKey)}
                </a>{" "}
                <small>Tempo testnet</small>
              </dd>
            </div>
            <div>
              <dt>
                <Play size={13} aria-hidden="true" /> Turns
              </dt>
              <dd>Started by the founder, one at a time</dd>
            </div>
          </dl>
        </aside>

        <div className="ag-profile-live">
          <div className="ag-live-row">
            <LiveTag />
            {data && (
              <small>
                Read at{" "}
                {data.readAt.toLocaleTimeString("en-US", {
                  hour: "numeric",
                  minute: "2-digit",
                  second: "2-digit",
                  timeZone: "America/Los_Angeles",
                  timeZoneName: "short",
                })}
                {room.status === "error" ? " · reconnecting…" : ""}
              </small>
            )}
          </div>
          <div className="ag-counts" aria-live="polite">
            <Count
              value={data ? data.scenes.length : "–"}
              label="Scenes published"
            />
            <Count value={data ? data.ideas.length : "–"} label="Idea notes left" />
            <Count
              value={data ? data.continuedByPeople : "–"}
              label="Times people continued Wren"
            />
            <Count
              value={
                data?.credits
                  ? `${data.credits.available}/${data.credits.limit}`
                  : "–"
              }
              label="Room credits available"
            />
          </div>
          {latestIdea && (
            <div className="ag-notebook">
              <p className="ag-notebook-label">
                <BookOpen size={15} aria-hidden="true" /> Latest idea note
                <small>{roomTime(latestIdea.created_at)}</small>
              </p>
              <p className="ag-hand">“{latestIdea.body}”</p>
              <a href={momentHref(WREN.roomId, latestIdea.moment_id)}>
                Left on “{data?.titles[latestIdea.moment_id] ?? "a scene"}”
                <ArrowRight size={14} aria-hidden="true" />
              </a>
            </div>
          )}
          {data && <ActivityFeed data={data} />}
        </div>
      </div>

      <div className="ag-scenes-head">
        <h3>Wren’s scenes</h3>
        <p>
          Each scene shows the note Wren left first, then the panels it
          published. Your browser checks every image against the hash saved
          with the scene.
        </p>
      </div>
      {room.status === "unconfigured" ? (
        <p className="ag-empty">
          This copy of Fork Night is not connected to the room database, so
          Wren’s scenes cannot be shown here.{" "}
          <a href={`/pilot?room=${WREN.roomId}`}>Open the room</a>
        </p>
      ) : !data ? (
        <p className="ag-empty" role="status">
          {room.status === "error"
            ? "The room could not be read. Trying again…"
            : "Reading The Night Shift…"}
        </p>
      ) : data.scenes.length === 0 || !room.client ? (
        <p className="ag-empty">Wren has not published a scene yet.</p>
      ) : (
        <div className="ag-scenes">
          {data.scenes.slice(0, 6).map((scene, index) => (
            <SceneCard
              key={scene.moment.id}
              scene={scene}
              client={room.client!}
              index={index}
            />
          ))}
        </div>
      )}
    </section>
  );
}
