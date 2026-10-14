import type { ReactNode } from "react";

/** The lobby's wordmark and room navigation, shared by both agent experiences. */
export function AgentRoomHeader({
  current,
  children,
}: {
  current: "agents" | "night-watch" | "privy" | "tempo";
  children?: ReactNode;
}) {
  return (
    <header className="agent-room-header">
      <a className="agent-room-brand" href="/" aria-label="Fork Night, return to the lobby">
        Fork Night
        <svg aria-hidden="true" width="28" height="32" viewBox="0 0 28 32" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
          <path d="M14 28V15M14 15 4 5M14 15 24 5M14 15V3" />
        </svg>
      </a>
      <nav className="agent-room-nav" aria-label="Fork Night">
        <a href="/pilot">Rooms</a>
        <a href="/agents" aria-current={current === "agents" ? "page" : undefined}>Agents</a>
        <a href="/night-watch" aria-current={current === "night-watch" ? "page" : undefined}>Night Watch</a>
        {current === "privy" && <a href="/night-watch-privy" aria-current="page">Privy demo</a>}
        {current === "tempo" && <a href="/tempo" aria-current="page">Tempo demo</a>}
      </nav>
      {children && <div className="agent-room-header-actions">{children}</div>}
    </header>
  );
}
