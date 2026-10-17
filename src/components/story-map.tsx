"use client";

import type { CSSProperties } from "react";
import { ArrowDown, ArrowUp, CornerUpRight, LocateFixed, Plus } from "lucide-react";
import type { DemoState, Moment, Project } from "@/domain/types";
import { DEMO_UNIT, demoReuseFee, formatCredits, getPath } from "@/domain";
import { layoutMoments } from "@/lib/map-layout";
import { Chip } from "./brand-badge";
import { MakerName } from "./maker-name";
import { StoryArt } from "./story-art";
import { useCanvasNavigation } from "./use-canvas-navigation";

/** A moment card is this tall (see .moment-card), and the map puts one tier every TIER pixels. */
const CARD_HEIGHT = 145;
const TIER = 180;

interface Props {
  state: DemoState;
  project: Project;
  selected: Moment;
  onSelect: (id: string) => void;
}

export function StoryMap({ state, project, selected, onSelect }: Props) {
  const { viewportRef, helpId, centerOn } = useCanvasNavigation(project.id, selected.id);
  const moments = state.moments.filter((item) => item.projectId === project.id);
  const { nodes, width, height } = layoutMoments(moments, project.seedId);
  const path = getPath(state, project.id, selected.id);
  const selectedIds = new Set(path.map((item) => item.id));
  const children = moments.filter((item) => item.parentId === selected.id);
  const parent = moments.find((item) => item.id === selected.parentId);
  // A selected moment with nothing built on it shows where the next one would go, when the map has room above it.
  const selectedNode = nodes.find((node) => node.moment.id === selected.id);
  const slot =
    selectedNode && children.length === 0 && selectedNode.y - TIER >= 30
      ? { x: selectedNode.x, y: selectedNode.y - TIER, from: selectedNode.y }
      : null;

  function card(moment: Moment, compact = false) {
    const author = state.users.find((user) => user.id === moment.authorId)!;
    const fee =
      project.visibility === "private"
        ? 0
        : getPath(state, project.id, moment.id).reduce(
            (total, item) => total + demoReuseFee(item),
            0,
          );
    return (
      <button
        type="button"
        className={`moment-card ${selected.id === moment.id ? "selected" : ""} ${compact ? "compact" : ""}`}
        onClick={() => onSelect(moment.id)}
        aria-pressed={selected.id === moment.id}
      >
        <span aria-hidden="true" style={{ display: "block" }}>
          <StoryArt
            src={moment.panels[0].imageUrl}
            description={moment.panels[0].caption}
            className={project.id === "malfoy-hogwarts" ? "malfoy-map-art" : undefined}
          />
        </span>
        <span className="moment-card-body">
          <strong>{moment.title}</strong>
          <span className="moment-meta">
            <span className="author-inline">
              <span
                className="avatar tiny"
                style={{ backgroundColor: author.color }}
              >
                {author.initials}
              </span>
              <MakerName name={author.name} agent={author.agent} />
            </span>
            <span>
              {formatCredits(fee)} {fee === DEMO_UNIT ? "credit" : "credits"}{" "}
              <span className="fee-label">to build on</span>
            </span>
          </span>
        </span>
      </button>
    );
  }

  return (
    <section
      className="map-region"
      aria-label="Story map, growing from bottom to top"
    >
      <div className="map-description">
        <span>
          <ArrowUp size={15} /> One beginning. Many possibilities.
        </span>
        <span>Selected path highlighted</span>
      </div>
      <p className="map-navigation-help desktop-only" id={helpId}>
        Drag to move · Scroll or swipe to explore · Focus the canvas and use arrow keys or Page Up / Down
      </p>
      <div
        className="map-scroller story-canvas-viewport"
        ref={viewportRef}
        role="region"
        aria-label="Story map canvas"
        aria-describedby={helpId}
        tabIndex={0}
        style={{ "--map-world-height": `${height}px` } as CSSProperties}
      >
        <div className="map-world" style={{ width, height }}>
          <svg
            className="map-lines"
            width={width}
            height={height}
            aria-hidden="true"
          >
            <defs>
              <marker
                id="arrow-violet"
                markerWidth="8"
                markerHeight="8"
                refX="4"
                refY="4"
                orient="auto"
              >
                <path
                  d="M1 1 L7 4 L1 7"
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth="1.5"
                />
              </marker>
              <marker
                id="arrow-muted"
                markerWidth="8"
                markerHeight="8"
                refX="4"
                refY="4"
                orient="auto"
              >
                <path
                  d="M1 1 L7 4 L1 7"
                  fill="none"
                  stroke="var(--edge)"
                  strokeWidth="1.5"
                />
              </marker>
            </defs>
            {nodes
              .filter((node) => node.moment.parentId)
              .map((node) => {
                const source = nodes.find(
                  (item) => item.moment.id === node.moment.parentId,
                )!;
                const active =
                  selectedIds.has(node.moment.id) &&
                  selectedIds.has(source.moment.id);
                const y1 = source.y;
                const y2 = node.y + CARD_HEIGHT;
                const mid = (y1 + y2) / 2;
                return (
                  <path
                    key={node.moment.id}
                    d={`M ${source.x} ${y1} C ${source.x} ${mid}, ${node.x} ${mid}, ${node.x} ${y2 + 4}`}
                    fill="none"
                    stroke={active ? "var(--accent)" : "var(--edge)"}
                    strokeWidth={active ? 3 : 2}
                    markerEnd={`url(#arrow-${active ? "violet" : "muted"})`}
                  />
                );
              })}
            {slot && (
              <path
                d={`M ${slot.x} ${slot.from} L ${slot.x} ${slot.y + CARD_HEIGHT + 4}`}
                fill="none"
                stroke="var(--edge)"
                strokeWidth={2}
                strokeDasharray="4 5"
                markerEnd="url(#arrow-muted)"
              />
            )}
          </svg>
          {slot && (
            <div className="map-slot" style={{ left: slot.x - 90, top: slot.y }}>
              <Plus size={20} aria-hidden="true" />
              <p>The next moment could be yours</p>
            </div>
          )}
          {nodes.map((node) => (
            <div
              key={node.moment.id}
              className="map-node"
              id={`moment-${node.moment.id}`}
              data-canvas-node={node.moment.id}
              style={{ left: node.x - 90, top: node.y }}
            >
              {card(node.moment)}
              {node.moment.parentId === null && (
                <Chip className="seed-chip">Our story starts here</Chip>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="mobile-map">
        <div className="mobile-children">
          <p className="muted">
            {children.length
              ? "What happens next"
              : "The next moment could be yours"}
          </p>
          <div>
            {children.map((child) => (
              <div key={child.id}>{card(child, true)}</div>
            ))}
          </div>
        </div>
        <ArrowUp className="mobile-path-arrow" size={22} />
        <div className="mobile-selected">
          {card(selected)}
          <span className="selection-label">Your starting point</span>
        </div>
        {parent ? (
          <>
            <ArrowUp className="mobile-path-arrow" size={22} />
            <button
              className="earlier-moment"
              onClick={() => onSelect(parent.id)}
            >
              <CornerUpRight size={17} />
              <span>
                Built on <strong>{parent.title}</strong>
              </span>
            </button>
          </>
        ) : (
          <Chip className="seed-chip">Our story starts here</Chip>
        )}
      </div>
      <div className="map-controls">
        <button
          className="text-button"
          onClick={() => {
            onSelect(project.seedId);
            centerOn(project.seedId);
          }}
        >
          <ArrowDown size={16} /> Back to the seed
        </button>
        <button
          className="text-button desktop-only"
          onClick={() => centerOn(selected.id)}
        >
          <LocateFixed size={16} /> Find selected
        </button>
        <span>{moments.length} moment{moments.length === 1 ? "" : "s"} · no ending required</span>
      </div>
    </section>
  );
}
