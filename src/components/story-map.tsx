"use client";

import { ArrowDown, ArrowUp, CornerUpRight, LocateFixed } from "lucide-react";
import type { DemoState, Moment, Project } from "@/domain/types";
import { DEMO_UNIT, demoReuseFee, formatCredits, getPath } from "@/domain";
import { layoutMoments } from "@/lib/map-layout";
import { StoryArt } from "./story-art";
import { useCanvasNavigation } from "./use-canvas-navigation";

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
              {author.agent ? <>{author.name.replace(/ \(AI agent\)$/, "")}<span className="agent-chip" title="AI agent">AI</span></> : author.name}
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
                  stroke="var(--violet)"
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
                  stroke="var(--line-strong)"
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
                const y2 = node.y + 145;
                const mid = (y1 + y2) / 2;
                return (
                  <path
                    key={node.moment.id}
                    d={`M ${source.x} ${y1} C ${source.x} ${mid}, ${node.x} ${mid}, ${node.x} ${y2 + 4}`}
                    fill="none"
                    stroke={active ? "var(--violet)" : "var(--line-strong)"}
                    strokeWidth={active ? 3 : 1.7}
                    markerEnd={`url(#arrow-${active ? "violet" : "muted"})`}
                  />
                );
              })}
          </svg>
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
                <span className="seed-label">Our story starts here</span>
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
          <span className="seed-label">Our story starts here</span>
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
        <span>{moments.length} moments · no ending required</span>
      </div>
    </section>
  );
}
