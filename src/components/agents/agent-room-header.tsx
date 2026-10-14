import type { ReactNode } from "react";
import { AppHeader } from "../app-header";

const SPACES = [
  { id: "agents", href: "/agents", label: "Meet the agents" },
  { id: "night-watch", href: "/night-watch", label: "Night Watch" },
  { id: "creator", href: "/creator-demo", label: "Creator review" },
  { id: "privy", href: "/night-watch-privy", label: "Privy demo" },
  { id: "tempo", href: "/tempo", label: "Tempo demo" },
] as const;

/** Agent destinations stay together beneath the product navigation, folded away until a visitor opens them. */
export function AgentRoomHeader({
  current,
  children,
}: {
  current: (typeof SPACES)[number]["id"];
  children?: ReactNode;
}) {
  const here = SPACES.find(space => space.id === current);
  return (
    <>
      <AppHeader current="agents">{children}</AppHeader>
      <details className="fn-agent-spaces">
        <summary>More agent pages{here && <span className="fn-agent-spaces-current"> · {here.label}</span>}</summary>
        <nav className="fn-section-nav" aria-label="Agent spaces">
          {SPACES.map(space => <a key={space.id} href={space.href} aria-current={space.id === current ? "page" : undefined}>{space.label}</a>)}
        </nav>
      </details>
    </>
  );
}
