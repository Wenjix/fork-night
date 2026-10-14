"use client";

import type { MouseEvent, ReactNode } from "react";

type LocalDestination = { kind: "lobby" | "spaces" | "desk" };
export type AppDestination = LocalDestination["kind"] | "rooms" | "agents";

const destinations: { id: AppDestination; label: string; href: string; local?: LocalDestination }[] = [
  { id: "lobby", label: "Lobby", href: "/", local: { kind: "lobby" } },
  { id: "rooms", label: "Shared rooms", href: "/pilot" },
  { id: "spaces", label: "My spaces", href: "/#/spaces", local: { kind: "spaces" } },
  { id: "desk", label: "Your desk", href: "/#/desk", local: { kind: "desk" } },
  { id: "agents", label: "Agents", href: "/agents" },
];

/** Native cross-page links preserve each workspace's existing leave protection. */
export function AppHeader({ current, onLocalNavigate, children }: {
  current: AppDestination;
  onLocalNavigate?: (route: LocalDestination) => void;
  children?: ReactNode;
}) {
  function followLocal(event: MouseEvent<HTMLAnchorElement>, route?: LocalDestination) {
    if (!route || !onLocalNavigate || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onLocalNavigate(route);
  }

  return <header className="fn-header">
    <a className="fn-brand" href="/" aria-label="Fork Night, return to the lobby" onClick={event => followLocal(event, { kind: "lobby" })}>
      Fork Night
      <svg aria-hidden="true" width="28" height="32" viewBox="0 0 28 32" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
        <path d="M14 28V15M14 15 4 5M14 15 24 5M14 15V3" />
      </svg>
    </a>
    <nav className="fn-primary-nav" aria-label="Main navigation">
      {destinations.map(item => <a key={item.id} href={item.href} aria-current={current === item.id ? "page" : undefined} onClick={event => followLocal(event, item.local)}>{item.label}</a>)}
    </nav>
    {children && <div className="fn-header-actions">{children}</div>}
  </header>;
}
