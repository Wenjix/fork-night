"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, BookOpen, ChevronDown, Map as MapIcon } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { pilotPanels, type PilotMoment } from "@/lib/pilot";
import {
  momentLetter,
  pathUpdates,
  recapWindow,
  type PilotVisit,
} from "@/lib/pilot-social";
import { PilotImage } from "./pilot-panels";
import { PilotDialog } from "./pilot-dialog";
import { SectionPlate } from "./visual-plates";

export function PilotRecap({
  client,
  path,
  selectedId,
  baseline,
  onSelect,
  onMap,
}: {
  client: SupabaseClient<Database>;
  path: PilotMoment[];
  selectedId: string;
  baseline: PilotVisit | null;
  onSelect: (id: string) => void;
  onMap: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const thumbnails = useRef<HTMLDivElement>(null);
  const updates = pathUpdates(path, baseline);
  const window = recapWindow(path, selectedId, expanded);
  const compact = recapWindow(path, selectedId);
  const thumbnailIds = compact.moments.map((moment) => moment.id).join(",");
  useEffect(() => {
    const region = thumbnails.current;
    if (!region) return;
    function revealCurrent() {
      if (!region || !region.clientWidth) return;
      const current = region.querySelector('[aria-current="step"]');
      if (!current) return;
      const viewport = region.getBoundingClientRect();
      const item = current.getBoundingClientRect();
      const left = item.left - viewport.left - 8;
      const right = item.right - viewport.right + 8;
      if (left < 0 || right > 0) {
        region.scrollBy({ left: left < 0 ? left : right, behavior: "instant" });
      }
    }
    revealCurrent();
    const resize = new ResizeObserver(revealCurrent);
    resize.observe(region);
    return () => resize.disconnect();
  }, [selectedId, thumbnailIds]);
  const tip = path.at(-1)!;
  const tipLetter = momentLetter(path.length - 1);
  const newLabel = `${updates.newIds.size} new since your last visit`;
  const lastIndex = path.findIndex(
    (moment) => moment.id === updates.lastMomentId,
  );
  const mobileCatchup = `${newLabel}${lastIndex >= 0 ? ` at ${momentLetter(lastIndex)}` : ""}`;
  const choose = (id: string) => {
    onSelect(id);
    setOpen(false);
  };
  function rows(moments: PilotMoment[]) {
    return (
      <ol className="pilot-recap-list">
        {moments.map((moment) => {
          const index = path.findIndex((m) => m.id === moment.id);
          return (
            <li key={moment.id}>
              <button
                className="pilot-recap-row"
                aria-current={moment.id === selectedId ? "step" : undefined}
                onClick={() => choose(moment.id)}
              >
                <span className="pilot-letter">
                  {momentLetter(index)}
                </span>
                <span className="pilot-recap-art" aria-hidden="true">
                  <PilotImage
                    client={client}
                    panel={pilotPanels(moment.panels)[0]}
                    allowRetry={false}
                  />
                </span>
                <span className="pilot-recap-copy">
                  <strong>{moment.title}</strong>
                  <span>by {moment.maker_label}</span>
                  <span className="pilot-recap-badges">
                    {updates.lastMomentId === moment.id && (
                      <small>Last visit</small>
                    )}
                    {updates.newIds.has(moment.id) && (
                      <small className="pilot-new">New</small>
                    )}
                    {moment.id === selectedId && (
                      <small className="pilot-here">You’re here</small>
                    )}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    );
  }
  return (
    <>
      <aside className="pilot-recap-desktop" aria-label="Story so far">
        <SectionPlate
          title="Story so far"
          description={`This path · ${path.length} ${path.length === 1 ? "moment" : "moments"}`}
          icon={BookOpen}
          tone="lavender"
          className="pilot-recap-sign"
        />
        {updates.newIds.size > 0 && (
          <p
            className="pilot-catchup"
            title="Compared with your previous visit in this browser"
          >
            {newLabel}
          </p>
        )}
        {window.earlier > 0 && (
          <button
            className="text-button pilot-history-toggle"
            onClick={() => setExpanded(true)}
          >
            Show {window.earlier} earlier{" "}
            {window.earlier === 1 ? "moment" : "moments"}{" "}
            <ChevronDown size={15} />
          </button>
        )}
        {rows(window.moments)}
        {window.later > 0 && (
          <button
            className="text-button pilot-history-toggle"
            onClick={() => setExpanded(true)}
          >
            Show {window.later} later{" "}
            {window.later === 1 ? "moment" : "moments"}{" "}
            <ChevronDown size={15} />
          </button>
        )}
        {expanded && path.length > 6 && (
          <button className="text-button" onClick={() => setExpanded(false)}>
            Collapse recap
          </button>
        )}
        {selectedId !== tip.id && (
          <button
            className="pilot-return text-button"
            onClick={() => choose(tip.id)}
          >
            Back to {tipLetter} <ArrowRight size={16} />
          </button>
        )}
        <button className="pilot-map-link" onClick={onMap}>
          <MapIcon size={20} /> Open full story map <ArrowRight size={16} />
        </button>
      </aside>
      <section className="pilot-recap-mobile" aria-label="Quick story recap">
        <div className="pilot-recap-mobile-heading">
          <button className="text-button" onClick={() => setOpen(true)}>
            <BookOpen size={20} aria-hidden="true" /> Story so far <ChevronDown size={16} />
          </button>
          <span>
            {momentLetter(0)}
            {path.length > 1 ? ` to ${tipLetter}` : " · 1 moment"}
          </span>
        </div>
        <div className="pilot-thumbnail-path" ref={thumbnails}>
          {compact.moments.map((moment) => (
            <button
              key={moment.id}
              onClick={() => onSelect(moment.id)}
              aria-current={selectedId === moment.id ? "step" : undefined}
            >
              <span aria-hidden="true" style={{ display: "block" }}>
                <PilotImage
                  client={client}
                  panel={pilotPanels(moment.panels)[0]}
                  allowRetry={false}
                />
              </span>
              <span className="pilot-thumbnail-label">
                {momentLetter(path.indexOf(moment))}
                {updates.newIds.has(moment.id) && (
                  <small className="pilot-new">New</small>
                )}
              </span>
              {" "}
              <span className="pilot-thumbnail-title" title={moment.title}>
                {moment.title}
              </span>
            </button>
          ))}
        </div>
        {updates.newIds.size > 0 && (
          <p
            className="pilot-mobile-catchup"
            title="Compared with your previous visit in this browser"
          >
            {mobileCatchup}
          </p>
        )}
        {selectedId !== tip.id && (
          <button
            className="text-button pilot-mobile-return"
            onClick={() => onSelect(tip.id)}
          >
            Back to {tipLetter} <ArrowRight size={14} />
          </button>
        )}
      </section>
      {open && (
        <PilotDialog
          title="Story so far"
          onClose={() => setOpen(false)}
          className="pilot-recap-sheet"
        >
          <p>
            This path · {path.length} {path.length === 1 ? "moment" : "moments"}
          </p>
          {updates.newIds.size > 0 && (
            <p className="pilot-catchup">
              {newLabel}
              <small>In this browser</small>
            </p>
          )}
          <div className="pilot-recap-sheet-scroll">{rows(path)}</div>
          <footer>
            <button className="button primary" onClick={() => choose(tip.id)}>
              Back to {tipLetter}
            </button>
            <button
              className="text-button"
              onClick={() => {
                setOpen(false);
                onMap();
              }}
            >
              Open full story map
            </button>
          </footer>
        </PilotDialog>
      )}
    </>
  );
}
