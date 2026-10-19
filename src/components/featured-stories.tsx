"use client";

import { ArrowRight, ChevronDown, GitBranch, GitCommitHorizontal, Play, Sparkles, Users } from "lucide-react";
import { builtWith, featuredRooms, KESSLER_CTA_ROOM_ID } from "@/lib/featured-stories";
import { kesslerWrenState } from "@/lib/kessler-overview";
import { KESSLER_FILMS } from "@/lib/room-film";
import { getRecordedGuildFunding } from "@/lib/guild-funding";
import { FIRST_NIGHT_STARTERS, firstNightRoomHref } from "@/lib/first-night";
import { BrandBadge, BrandStrip, Chip } from "./brand-badge";
import { StoryArt } from "./story-art";
import { useKesslerOverview } from "./use-kessler-overview";

export function FeaturedStories() {
  const { overview, unavailable } = useKesslerOverview();
  const wrenState = overview ? kesslerWrenState(overview) : unavailable ? "unavailable" : "loading";
  const wrenLabel = { loading: "Checking preview availability…", unavailable: "Preview status unavailable", paused: "New previews paused", "needs-credits": "New previews need credits", enabled: "Private previews available" }[wrenState];
  const kessler = featuredRooms[0];
  const films = KESSLER_FILMS.filter(film => film.video);
  const continuation = films.find(film => film.id === "lift");
  const continuationHref = `${kessler.href}${continuation ? `&moment=${continuation.tipId}` : ""}`;
  const guild = getRecordedGuildFunding(KESSLER_CTA_ROOM_ID);
  return (
    <section className="fn-featured-stories" aria-labelledby="fn-featured-title">
      <article className="fn-featured-kessler">
        <div className="fn-kessler-art" aria-hidden="true"><StoryArt src={kessler.artwork} description={kessler.artworkDescription} /></div>
        <div className="fn-kessler-copy">
          <h1 id="fn-featured-title">Start in {kessler.title}</h1>
          <p className="fn-kessler-description">A blackout, an insulin case and eighty-one floors before dawn.</p>
          <p className="fn-kessler-route">People and Wren take the story in different directions. Read a branch, add a scene, or watch how it ends.</p>
          <div className="fn-kessler-entry">
            <a className="fn-kessler-cta" href={kessler.href}>{kessler.action}<ArrowRight size={18} aria-hidden="true" /></a>
          </div>
          <p className="fn-kessler-status">{overview
            ? `${overview.story.moments} scenes · ${overview.story.published} new contributions · ${films.length} branch films`
            : unavailable ? `Room activity unavailable · ${films.length} branch films ready` : `Checking room activity · ${films.length} branch films ready`}</p>
          <details className="fn-kessler-starters"><summary>Start with an idea</summary><p>Choose a spark for a private draft. Writing is free.</p><ul>{FIRST_NIGHT_STARTERS.map(starter => <li key={starter.id}><a href={firstNightRoomHref(starter.id)}>{starter.label}<ArrowRight size={14} aria-hidden="true" /></a></li>)}</ul></details>
        </div>
        <aside className="fn-kessler-films" aria-labelledby="fn-kessler-films-title">
          <div className="fn-kessler-films-heading"><h2 id="fn-kessler-films-title">Three branches. Three films.</h2><p>Finished films · 18 seconds each</p></div>
          <ol>{films.map(film => <li key={film.id}><a className="fn-kessler-film" href={`${kessler.href}&moment=${film.tipId}&film=${film.id}`}>
            <span className="fn-kessler-film-poster"><img src={film.poster} width={64} height={64} alt="" /><Play size={18} aria-hidden="true" fill="currentColor" /></span>
            <span className="fn-kessler-film-copy"><strong>{film.title}</strong><span>{film.id === "lift" ? "Burkes + Wren’s continuation" : film.id === "rooftops" ? "The rooftop branch" : "The neighbors’ branch"}</span></span>
            <ArrowRight size={16} aria-hidden="true" />
          </a></li>)}</ol>
        </aside>
      </article>
      <nav className="fn-kessler-features" aria-label={kessler.focus}>
        <a className="fn-kessler-feature" href={`${continuationHref}#kessler-contributions`}>
          <span className="fn-kessler-feature-title"><GitCommitHorizontal size={20} aria-hidden="true" /><strong>Contribution tracker</strong><ArrowRight size={16} aria-hidden="true" /></span>
          <span className="fn-kessler-feature-description">Follow each scene back to its maker.</span>
          <BrandStrip label="Contribution records"><BrandBadge brand="monad" /></BrandStrip>
        </a>
        <a className="fn-kessler-feature" href={`${continuationHref}#kessler-wren`}>
          <span className="fn-kessler-feature-title"><Sparkles size={20} aria-hidden="true" /><strong>Wren</strong><ArrowRight size={16} aria-hidden="true" /></span>
          <span className="fn-kessler-feature-description">Own byline and wallet. <span>{wrenLabel}.</span></span>
          <BrandStrip label="Wren payments"><BrandBadge brand="tempo" /><BrandBadge brand="mpp" role="payments" /></BrandStrip>
        </a>
        <a className="fn-kessler-feature" href={`${kessler.href}#kessler-backing`}>
          <span className="fn-kessler-feature-title"><Users size={20} aria-hidden="true" /><strong>Guild backing</strong><ArrowRight size={16} aria-hidden="true" /></span>
          <span className="fn-kessler-feature-description">{guild ? `A recorded guild payment added ${guild.appCredit.added} shared credits.` : "See how shared creation is funded."}</span>
          <BrandStrip label="Guild treasury tools"><BrandBadge brand="solana" /><BrandBadge brand="squads" /></BrandStrip>
        </a>
      </nav>
      <details className="fn-featured-rehearsals" open>
      <summary><span><strong>Follow the recorded rehearsals</strong><span>3 focused integration demos</span></span><ChevronDown size={18} aria-hidden="true" /></summary>
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
      </details>
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
