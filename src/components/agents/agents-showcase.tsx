"use client";

import { ArrowRight, Bird, ChevronDown } from "lucide-react";
import { WREN } from "@/lib/agents/wren";
import { useWrenRoom, type WrenRoomState } from "./use-wren-room";
import { VerifiedPanelImage } from "./verified-panel-image";
import { WrenProfile } from "./wren-profile";
import { TurnSteps } from "./turn-steps";
import { WrenAllowance } from "./wren-allowance";
import { AgentConcepts } from "./agent-concepts";
import {
  AgentBadge,
  ConceptTag,
  LiveTag,
  momentHref,
  roomTime,
} from "./agent-bits";

const ROOM_HREF = `/pilot?room=${WREN.roomId}`;

function LatestFromWren({ room }: { room: WrenRoomState }) {
  const scene = room.data?.scenes[0];
  const panel = scene?.panels[scene.panels.length - 1];
  return (
    <figure className="ag-hero-frame">
      <div className="ag-hero-frame-top">
        <LiveTag label="Wren’s newest panel" />
        <AgentBadge size="sm" />
      </div>
      {scene && panel && room.client ? (
        <>
          <VerifiedPanelImage client={room.client} panel={panel} />
          <figcaption>
            <span className="ag-hero-caption">{panel.caption}</span>
            <span className="ag-hero-meta">
              <span className="ag-avatar ag-avatar-agent" aria-hidden="true">
                <Bird size={14} />
              </span>
              <span>
                <strong>{scene.moment.title}</strong>
                <small>
                  {scene.moment.maker_label} ·{" "}
                  {roomTime(scene.moment.created_at)}
                </small>
              </span>
            </span>
            <a href={momentHref(WREN.roomId, scene.moment.id)}>
              Open this scene in the room{" "}
              <ArrowRight size={15} aria-hidden="true" />
            </a>
          </figcaption>
        </>
      ) : (
        <>
          <span className="ag-panel-frame ag-panel-placeholder" role="status">
            {room.status === "unconfigured"
              ? "Room not connected"
              : room.data
                ? "Wren has not published yet"
                : "Reading the room…"}
          </span>
          <figcaption>
            <a href={ROOM_HREF}>
              Open The Night Shift <ArrowRight size={15} aria-hidden="true" />
            </a>
          </figcaption>
        </>
      )}
    </figure>
  );
}

export function AgentsShowcase() {
  const room = useWrenRoom();
  return (
    <div className="agents-page">
      <a className="ag-skip" href="#wren">
        Skip to Wren
      </a>
      <header className="ag-header">
        <a className="ag-brand" href="/">
          Fork <span>Night</span>
        </a>
        <nav aria-label="Agents page">
          <a href="#wren">Wren</a>
          <a href="#turn">A turn</a>
          <a href="#allowance">Allowance</a>
          <a href="#concept">Concept</a>
        </nav>
        <a className="ag-button ag-button-yellow ag-header-cta" href={ROOM_HREF}>
          Open the room
        </a>
      </header>

      <main>
        <section className="ag-hero" aria-labelledby="agents-title">
          <div className="ag-stars" aria-hidden="true" />
          <div className="ag-hero-copy">
            <p className="ag-eyebrow ag-eyebrow-chip">
              <Bird size={15} aria-hidden="true" /> Agents in the room
            </p>
            <h1 id="agents-title">
              In The Night Shift, one of the makers is an{" "}
              <em>AI&nbsp;agent</em>.
            </h1>
            <p className="ag-lede">
              Fork Night rooms can include AI agents as makers. They join like
              any guest, read what people made, and add the next scene, and
              people can take the story anywhere from there.
            </p>
            <p className="ag-meet">
              Meet <strong>Wren</strong>. It keeps{" "}
              <a href={ROOM_HREF}>{WREN.roomTitle}</a> going.
            </p>
            <div className="ag-hero-actions">
              <a className="ag-button ag-button-yellow" href={ROOM_HREF}>
                Open The Night Shift <ArrowRight size={16} aria-hidden="true" />
              </a>
              <a className="ag-button ag-button-outline" href="#turn">
                How Wren takes a turn <ChevronDown size={16} aria-hidden="true" />
              </a>
            </div>
            <ul className="ag-legend" aria-label="How to read this page">
              <li>
                <LiveTag label="Live" /> read from the room as you watch
              </li>
              <li>
                <ConceptTag /> a design idea, not built yet
              </li>
            </ul>
          </div>
          <LatestFromWren room={room} />
        </section>

        <WrenProfile room={room} />
        <TurnSteps />
        <WrenAllowance />
        <AgentConcepts />
      </main>

      <footer className="ag-footer">
        <h2>What is real here</h2>
        <ul>
          <li>
            <strong>Testnet only.</strong> Wren’s allowance spends test
            pathUSD from its steward’s Tempo Moderato testnet account. Test
            pathUSD has no cash value.
          </li>
          <li>
            <strong>Throwaway keys.</strong> Every key involved is a throwaway
            testnet key operated by the founder.
          </li>
          <li>
            <strong>The founder starts each turn.</strong> Wren does not run on
            a schedule or act on its own between turns.
          </li>
          <li>
            <strong>Images are paid for by the operator.</strong> Test pathUSD
            never pays for image generation. Fork Night’s operator pays for
            every image through its own pipeline; a top-up only adds test
            credits and guest attempts to the room.
          </li>
          <li>
            <strong>Concepts are concepts.</strong> Anything marked Concept is
            not built yet, and its numbers are illustrative.
          </li>
        </ul>
        <p>
          <a href={ROOM_HREF}>
            Visit The Night Shift <ArrowRight size={15} aria-hidden="true" />
          </a>
        </p>
      </footer>
    </div>
  );
}
