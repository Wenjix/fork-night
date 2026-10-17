"use client";

import { createContext, type MouseEvent, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { FirstNightGuide } from "./first-night-guide";

/** False hides the storyteller account chip, for wrappers that show the account in their own header menu. */
export const HeaderAccountVisibility = createContext(true);
// Its own chunk with its stylesheet; it reads the account only when a session is stored.
// If the chunk cannot load, the header goes without the chip rather than failing the page.
const HeaderAccount = dynamic(() => import("./header-account.tsx").catch(() => ({ default: () => null })));

type LocalDestination = { kind: "lobby" | "spaces" | "desk" };
export type AppDestination = LocalDestination["kind"] | "rooms" | "agents";

const destinations: { id: AppDestination; label: string; href: string; local?: LocalDestination }[] = [
  { id: "lobby", label: "Lobby", href: "/", local: { kind: "lobby" } },
  { id: "rooms", label: "Shared rooms", href: "/pilot" },
  { id: "spaces", label: "My spaces", href: "/#/spaces", local: { kind: "spaces" } },
  { id: "desk", label: "Your desk", href: "/#/desk", local: { kind: "desk" } },
  { id: "agents", label: "Agents", href: "/agents" },
];

/**
 * On a phone the five links scroll sideways in one row. Scroll only as far as it takes to show the current page's link
 * clear of the faded edges, and let `data-fade` tell the stylesheet which edge still has something behind it.
 * A ref callback, not an effect, so the header stays an ordinary function of its props.
 */
function watchNavigation(nav: HTMLElement | null) {
  if (!nav) return;
  const fade = () => {
    const behind = nav.scrollLeft > 1;
    const ahead = nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 1;
    nav.dataset.fade = behind && ahead ? "both" : ahead ? "end" : behind ? "start" : "none";
  };
  const reveal = () => {
    const here = nav.querySelector<HTMLElement>("[aria-current]");
    if (here && nav.scrollWidth > nav.clientWidth) {
      const clear = 40;
      const track = nav.getBoundingClientRect();
      const link = here.getBoundingClientRect();
      if (link.right > track.right - clear) nav.scrollLeft += link.right - (track.right - clear);
      else if (link.left < track.left + clear) nav.scrollLeft -= track.left + clear - link.left;
    }
    fade();
  };
  reveal();
  nav.addEventListener("scroll", fade, { passive: true });
  const resized = new ResizeObserver(fade);
  [nav, ...Array.from(nav.children)].forEach(node => resized.observe(node));
  // A local route change moves aria-current without remounting the header.
  const moved = new MutationObserver(reveal);
  moved.observe(nav, { attributes: true, attributeFilter: ["aria-current"], subtree: true });
  return () => { nav.removeEventListener("scroll", fade); resized.disconnect(); moved.disconnect(); };
}

/** Native cross-page links preserve each workspace's existing leave protection. */
export function AppHeader({ current, onLocalNavigate, children, guide, account = true, tone }: {
  current: AppDestination;
  onLocalNavigate?: (route: LocalDestination) => void;
  children?: ReactNode;
  guide?: ReactNode;
  /** The storyteller account chip. Views with their own account bar pass false. */
  account?: boolean;
  /** The surface the page sits on, so the default first-night guide can match it. The agent pages are navy; the rest are cream unless a page says otherwise. */
  tone?: "night" | "paper";
}) {
  function followLocal(event: MouseEvent<HTMLAnchorElement>, route?: LocalDestination) {
    if (!route || !onLocalNavigate || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onLocalNavigate(route);
  }

  const surface = tone ?? (current === "agents" ? "night" : "paper");
  return <><header className="fn-header">
    <a className="fn-brand" href="/" aria-label="Fork Night, return to the lobby" onClick={event => followLocal(event, { kind: "lobby" })}>
      Fork Night
      <svg aria-hidden="true" width="28" height="32" viewBox="0 0 28 32" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
        <path d="M14 28V15M14 15 4 5M14 15 24 5M14 15V3" />
      </svg>
    </a>
    <nav className="fn-primary-nav" aria-label="Main navigation" ref={watchNavigation}>
      {destinations.map(item => <a key={item.id} href={item.href} aria-current={current === item.id ? "page" : undefined} onClick={event => followLocal(event, item.local)}>{item.label}</a>)}
    </nav>
    {(children || account) && <div className="fn-header-actions">{children}{account && <HeaderAccount />}</div>}
  </header>
    {guide !== false && <div className="fn-first-header-guide">{guide === undefined ? <FirstNightGuide compact tone={surface} /> : guide}</div>}
  </>;
}
