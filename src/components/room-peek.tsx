"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, Eye, X } from "lucide-react";
import type { DemoState, Project } from "@/domain";
import { projectActivity } from "@/social/activity";
import { Chip } from "./brand-badge";
import { StoryArt } from "./story-art";

/** A nonmodal, top-layer preview. Opening it never changes the active project. */
export function RoomPeek({
  project,
  demo,
  onEnter,
}: {
  project: Project;
  demo: DemoState;
  onEnter: () => void;
}) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinned = useRef(false);
  const [open, setOpen] = useState(false);
  const seed = demo.moments.find((moment) => moment.id === project.seedId);
  const activity = projectActivity(demo, project.id);
  function cancelClose() {
    if (timer.current) clearTimeout(timer.current);
  }
  function close(returnFocus = false) {
    cancelClose();
    panel.current?.hidePopover();
    pinned.current = false;
    if (returnFocus) trigger.current?.focus({ preventScroll: true });
  }
  function leave() {
    cancelClose();
    timer.current = setTimeout(() => {
      if (!pinned.current && !panel.current?.contains(document.activeElement))
        close();
    }, 200);
  }
  function show(interactive: boolean) {
    cancelClose();
    const element = panel.current;
    const button = trigger.current;
    if (!element || !button) return;
    if (interactive && pinned.current && element.matches(":popover-open")) {
      close(true);
      return;
    }
    pinned.current = interactive || pinned.current;
    element.showPopover();
    const anchor = button.getBoundingClientRect();
    const bounds = element.getBoundingClientRect();
    element.style.left = `${Math.max(12, Math.min(anchor.left, window.innerWidth - bounds.width - 12))}px`;
    element.style.top = `${Math.max(12, Math.min(anchor.bottom + 8, window.innerHeight - bounds.height - 12))}px`;
    if (interactive)
      element
        .querySelector<HTMLButtonElement>("button")
        ?.focus({ preventScroll: true });
  }
  useEffect(() => {
    const dismiss = () => {
      panel.current?.hidePopover();
      pinned.current = false;
    };
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("resize", dismiss);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  return (
    <>
      <button
        ref={trigger}
        className="social-button purple peek"
        aria-label={`Peek in: preview ${project.title}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse") show(false);
        }}
        onPointerLeave={leave}
        onClick={() => show(true)}
      >
        <Eye size={16} /> Peek in
      </button>
      <div
        ref={panel}
        id={id}
        className="room-peek-panel"
        popover="auto"
        role="dialog"
        aria-label={`A peek at ${project.title}`}
        onToggle={() => {
          const visible = panel.current?.matches(":popover-open") ?? false;
          setOpen(visible);
          if (!visible) pinned.current = false;
        }}
        onPointerEnter={cancelClose}
        onPointerLeave={leave}
        onBlur={(event) => {
          if (
            event.relatedTarget &&
            !event.currentTarget.contains(event.relatedTarget) &&
            event.relatedTarget !== trigger.current
          )
            close();
        }}
      >
        <div className="room-peek-heading">
          <h2>{project.title}</h2>
          <button aria-label="Close room preview" onClick={() => close(true)}>
            <X size={20} />
          </button>
        </div>
        <Chip icon={Eye} className="room-peek-chip">A look inside</Chip>
        <div className="room-peek-panels">
          {seed?.panels.map((frame, index) => (
            <figure key={index}>
              <StoryArt src={frame.imageUrl} description={frame.caption} />
              <figcaption>{frame.caption}</figcaption>
            </figure>
          ))}
        </div>
        <p>{project.description}</p>
        <p className="room-peek-progress">
          {activity.contributors}{" "}
          {activity.contributors === 1 ? "contributor" : "contributors"} ·{" "}
          {activity.moments} {activity.moments === 1 ? "moment" : "moments"} ·
          longest path {activity.longestPath}
        </p>
        <button className="social-button yellow" onClick={onEnter}>
          Step inside <ArrowRight size={16} />
        </button>
        <small>You’re still in the lobby. Enter when you’re ready.</small>
      </div>
    </>
  );
}
