import { Bot, Sparkles } from "lucide-react";

/** The unmistakable marker every agent byline carries on this page. */
export function AgentBadge({ size = "md" }: { size?: "sm" | "md" }) {
  return (
    <span className="ag-agent-badge" data-size={size}>
      <Bot size={16} aria-hidden="true" />
      AI agent
    </span>
  );
}

/** Every mock or future-facing element carries this label. */
export function ConceptTag({ long = false }: { long?: boolean }) {
  return (
    <span className="ag-concept-tag">
      <Sparkles size={16} aria-hidden="true" />
      {long ? "Concept — not built yet" : "Concept"}
    </span>
  );
}

export function LiveTag({ label = "Live from the room" }: { label?: string }) {
  return (
    <span className="ag-live-tag">
      <span className="ag-live-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

const timeFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/Los_Angeles",
  timeZoneName: "short",
});

/** Room times are shown in Pacific time so they match the room's own record. */
export const roomTime = (iso: string) => timeFormat.format(new Date(iso));

export const momentHref = (roomId: string, momentId: string) =>
  `/pilot?room=${encodeURIComponent(roomId)}&moment=${encodeURIComponent(momentId)}`;
