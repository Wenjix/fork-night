"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Maximize2 } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { PilotPanel } from "@/lib/pilot";
import { PilotImage } from "./pilot-panels";
import { PilotDialog } from "./pilot-dialog";

export function PilotArtwork({
  client,
  panels,
  title,
  maker,
}: {
  client: SupabaseClient<Database>;
  panels: PilotPanel[];
  title: string;
  maker: string;
}) {
  const [page, setPage] = useState(0);
  const [inspecting, setInspecting] = useState<number | null>(null);
  const showCaption = (caption: string) => caption.trim().toLocaleLowerCase() !== title.trim().toLocaleLowerCase();
  function pager(index: number, change: (n: number) => void, className = "") {
    // One panel has nothing to page through.
    if (panels.length < 2) return null;
    return (
      <nav
        className={`pilot-panel-pager ${className}`}
        aria-label="Panels in this moment"
      >
        <button
          className="pilot-icon-button"
          aria-label="Previous panel"
          disabled={index === 0}
          onClick={() => change(index - 1)}
        >
          <ChevronLeft size={20} aria-hidden="true" />
        </button>
        <span aria-live="polite">
          Panel {index + 1} of {panels.length}
        </span>
        <button
          className="pilot-icon-button"
          aria-label="Next panel"
          disabled={index === panels.length - 1}
          onClick={() => change(index + 1)}
        >
          <ChevronRight size={20} aria-hidden="true" />
        </button>
      </nav>
    );
  }
  return (
    <>
      <div className="pilot-artwork" data-panels={panels.length}>
        {panels.map((panel, index) => (
          <figure key={index} className={page === index ? "current-panel" : ""}>
            <div className="pilot-artwork-image">
              <PilotImage client={client} panel={panel} />
              <button
                className="pilot-expand"
                aria-label={`Enlarge panel ${index + 1}`}
                onClick={() => setInspecting(index)}
              >
                <Maximize2 size={20} aria-hidden="true" />
              </button>
            </div>
            {showCaption(panel.caption) && <figcaption>{panel.caption}</figcaption>}
          </figure>
        ))}
      </div>
      {pager(page, setPage, "pilot-reading-pager")}
      {inspecting !== null && (
        <PilotDialog
          title={title}
          onClose={() => setInspecting(null)}
          className="pilot-art-dialog"
        >
          <p className="pilot-byline">
            A moment by <strong>{maker}</strong>
          </p>
          <figure>
            <PilotImage client={client} panel={panels[inspecting]} />
            {showCaption(panels[inspecting].caption) && <figcaption>{panels[inspecting].caption}</figcaption>}
          </figure>
          {pager(inspecting, setInspecting)}
        </PilotDialog>
      )}
    </>
  );
}
