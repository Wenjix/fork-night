"use client";

import { ArrowRight, GitBranch, GitCommitHorizontal, Sparkles } from "lucide-react";
import { builtWith, featuredRooms, KESSLER_CTA_ROOM_ID } from "@/lib/featured-stories";
import { kesslerWrenState } from "@/lib/kessler-overview";
import { FIRST_NIGHT_STARTERS, firstNightRoomHref } from "@/lib/first-night";
import { BrandBadge, BrandStrip, Chip } from "./brand-badge";
import { StoryArt } from "./story-art";
import { useKesslerOverview } from "./use-kessler-overview";

export function FeaturedStories() {
  const { overview, unavailable } = useKesslerOverview();
  const wrenState = overview ? kesslerWrenState(overview) : unavailable ? "unavailable" : "loading";
  const wrenLabel = { loading: "Wren · checking…", unavailable: "Wren · status unavailable", paused: "Wren · paused", "needs-credits": "Wren · needs credits", enabled: "Wren assistant" }[wrenState];
  const kessler = featuredRooms[0];
  return (
    <section className="fn-featured-stories" aria-labelledby="fn-featured-title">
      <article className="fn-featured-kessler">
        <div className="fn-kessler-art" aria-hidden="true"><StoryArt src={kessler.artwork} description={kessler.artworkDescription} /></div>
        <div className="fn-kessler-copy">
          <h1 id="fn-featured-title">Start in {kessler.title}</h1>
          <p className="fn-kessler-description">{kessler.description}</p>
          <BrandStrip label={kessler.focus} className="fn-kessler-capabilities">
            <Chip icon={GitBranch}>Branch the story</Chip>
            <Chip icon={GitCommitHorizontal}>Monad contributions</Chip>
            <Chip icon={Sparkles}>{wrenLabel}</Chip>
          </BrandStrip>
          <p className="fn-kessler-route">One room to explore the story, its Monad contribution trail, and the funding behind each new scene.</p>
          <div className="fn-kessler-entry">
            <a className="fn-kessler-cta" href={kessler.href}>{kessler.action}<ArrowRight size={18} aria-hidden="true" /></a>
            <span className="fn-kessler-status">{overview
              ? `${overview.story.prepared} prepared scenes · ${overview.story.published} new contributions${kesslerWrenState(overview) === "enabled" ? " · Wren enabled" : ""}`
              : "Two prepared branches. Your next scene."}</span>
          </div>
          <details className="fn-kessler-starters"><summary>Start with an idea</summary><p>Choose a spark for a private draft. Writing is free.</p><ul>{FIRST_NIGHT_STARTERS.map(starter => <li key={starter.id}><a href={firstNightRoomHref(starter.id)}>{starter.label}<ArrowRight size={14} aria-hidden="true" /></a></li>)}</ul></details>
        </div>
      </article>
      <div className="fn-featured-heading"><h3>Follow the recorded rehearsals</h3><p>Take a closer look at each integration.</p></div>
      <ul className="fn-featured-rooms" aria-label="Recorded integration rooms">
        {featuredRooms.filter(room => room.id !== KESSLER_CTA_ROOM_ID).map(room => <li className="fn-featured-room" key={room.id}>
          <div className="fn-featured-art" aria-hidden="true">
            <StoryArt src={room.artwork} description={room.artworkDescription} />
          </div>
          <div className="fn-featured-copy">
            <h3>{room.title}</h3>
            <BrandStrip label={room.focus} className="fn-featured-stack">
              {room.stack.length
                ? room.stack.map(item => <BrandBadge key={item.brand} brand={item.brand} role={"role" in item ? item.role : undefined} />)
                : <Chip icon={GitBranch}>{room.focus}</Chip>}
            </BrandStrip>
            <p className="fn-featured-description">{room.description}</p>
            <p className="fn-featured-status">{room.status}</p>
          </div>
          <div className="fn-featured-actions">
            <a className="fn-featured-cta" href={room.href}>{room.action} <ArrowRight size={16} aria-hidden="true" /></a>
            {room.record && <BrandBadge brand={room.record.brand} label={room.record.label} net={false} href={room.record.href} />}
          </div>
        </li>)}
      </ul>
    </section>
  );
}

/** The tools and chains behind the rooms, in one quiet row under them. Each badge opens the page that shows it at work. */
export function BuiltWith() {
  return (
    <div className="fn-built-with">
      <span className="fn-built-with-label" aria-hidden="true">Built with</span>
      <BrandStrip label="Built with">
        {builtWith.map(item => <BrandBadge key={item.brand} brand={item.brand} href={item.href} />)}
      </BrandStrip>
    </div>
  );
}
