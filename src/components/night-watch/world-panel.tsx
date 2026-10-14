"use client";

import { useEffect, useState, type ReactNode } from "react";
import { BookOpen, Brush, Feather, Info, MoonStar, ScrollText, Sparkles, Star, Sunrise } from "lucide-react";
import type { WorldMoment, WorldPanel as WorldPanelView, WorldResponse } from "../../night-watch/api-types.ts";
import { isApprovedArtUrl } from "../../lib/art.ts";
import { SectionPlate } from "../visual-plates";
import { StoryArt } from "../story-art.tsx";
import { displayImageUrl, momentHeadline, plural, storyPath } from "./api.ts";

function Unavailable({ caption, className }: { caption: string | undefined; className: string }) {
  return <span className={`nw-image-placeholder ${className}`} role="img" aria-label={caption ? `Image unavailable: ${caption}` : "Image unavailable"}>Image unavailable</span>;
}

/** One panel image: packaged story art, a same-origin image or a signed storage URL (which can expire). */
export function MomentImage({ panel, className = "" }: { panel: WorldPanelView | undefined; className?: string }) {
  const url = panel?.imageUrl && !isApprovedArtUrl(panel.imageUrl) ? displayImageUrl(panel.imageUrl) : null;
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [url]);
  if (panel?.imageUrl && isApprovedArtUrl(panel.imageUrl)) return <StoryArt src={panel.imageUrl} description={panel.caption} className={className} />;
  if (!panel || !url || failed) return <Unavailable caption={panel?.caption} className={className} />;
  return <img className={`nw-image ${className}`} src={url} alt={panel.caption} width={1024} height={1024} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}

export function ActHeading({ act, id, title, children }: { act: string; id: string; title: string; children?: ReactNode }) {
  const icon = id === "desk-title" ? Feather : id === "away-title" ? MoonStar : id === "morning-title" ? Sunrise : BookOpen;
  const tone = id === "desk-title" ? "lavender" : id === "away-title" ? "night" : id === "morning-title" ? "butter" : "paper";
  return <SectionPlate className="nw-act-head" icon={icon} tone={tone} title={title} headingId={id}
    description={children} action={<span className="nw-act-number">{act}</span>} />;
}

function KitList({ icon: Icon, title, items }: { icon: typeof BookOpen; title: string; items: string[] }) {
  if (!items.length) return null;
  return <div className="nw-kit-list">
    <h4><Icon size={17} aria-hidden="true" />{title}</h4>
    <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>
  </div>;
}

function MomentCard({ moment, index, friend, forkPoint, signedIn, onChoose }: {
  moment: WorldMoment; index: number | null; friend: boolean; forkPoint: boolean; signedIn: boolean; onChoose: (id: string) => void;
}) {
  const first = moment.panels[0];
  const { heading, body } = momentHeadline(moment.title, first?.caption);
  return <article className="nw-moment" data-friend={friend || undefined} data-fork={forkPoint || undefined} data-source={moment.source}>
    <div className="nw-moment-art"><MomentImage panel={first} /></div>
    <div className="nw-moment-copy">
      <p className="nw-moment-meta">
        {index !== null && <span>Scene {index + 1}</span>}
        {moment.parentId === null && <span className="nw-tag">Original opening</span>}
        {friend && <span className="nw-tag nw-tag-friend"><Star size={13} aria-hidden="true" />A friend’s contribution</span>}
        {moment.source === "night-watch" && <span className="nw-tag nw-tag-watch"><MoonStar size={13} aria-hidden="true" />Prepared by a Night Watch</span>}
        {forkPoint && <span className="nw-tag nw-tag-fork">Fork point</span>}
      </p>
      <h4 title={heading}>{heading}</h4>
      <p className="nw-moment-maker">by {moment.makerLabel}</p>
      {body && <p className="nw-moment-caption">{body}</p>}
      {signedIn && !forkPoint && <button type="button" className="text-button nw-choose" onClick={() => onChoose(moment.id)}>Continue from here</button>}
    </div>
  </article>;
}

export function WorldPanel({ world, error, forkPointId, signedIn, onChooseForkPoint }: {
  world: WorldResponse | null;
  error: string;
  forkPointId: string;
  signedIn: boolean;
  onChooseForkPoint: (id: string) => void;
}) {
  if (!world) {
    return <section id="world" className="nw-act" aria-labelledby="world-title">
      <ActHeading act="Act 1" id="world-title" title="The world" />
      <div className="nw-card">{error ? <p role="alert" className="nw-error">{error}</p> : <p role="status" className="nw-quiet">Reading the world…</p>}</div>
    </section>;
  }
  const { kit, credits, friendContribution } = world;
  const path = storyPath(world.moments, world.defaultForkPointId);
  const onPath = new Set(path.map((moment) => moment.id));
  const published = world.moments
    .filter((moment) => moment.source === "night-watch" && !onPath.has(moment.id))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const friend = friendContribution ? world.moments.find((moment) => moment.id === friendContribution.momentId) : undefined;
  return <section id="world" className="nw-act" aria-labelledby="world-title">
    <ActHeading act="Act 1" id="world-title" title="The world">
      <p>{world.room.description || "A shared story that grows by forks. Every published moment stays credited to its maker."}</p>
    </ActHeading>
    {error && <p role="alert" className="nw-error nw-on-night">{error}</p>}
    <div className="nw-card nw-kit">
      <header className="nw-kit-head">
        <div>
          <p className="nw-card-eyebrow">World kit</p>
          <h3>{kit.title}</h3>
          <p className="nw-kit-creator">{kit.creator}</p>
        </div>
        <ul className="nw-references" aria-label="Reference art">
          {kit.references.map((reference) => <li key={reference.label}>
            <MomentImage panel={{ caption: reference.label, imageUrl: reference.imageUrl }} />
            <span>{reference.label}</span>
          </li>)}
        </ul>
      </header>
      <p className="nw-disclosure"><Info size={17} aria-hidden="true" /><span>{kit.disclosure}</span></p>
      <div className="nw-kit-grid">
        <KitList icon={BookOpen} title="Lore" items={kit.lore} />
        <KitList icon={Brush} title="Style" items={kit.style} />
        <KitList icon={ScrollText} title="Rules" items={kit.rules} />
        <KitList icon={Feather} title="Participation terms" items={kit.participation} />
      </div>
      <details className="nw-technical">
        <summary>Kit version {kit.version} · digest {kit.digest.slice(0, 12)}…</summary>
        <p>Every Night Watch job pins this kit version and digest. Its prompt is built only from the pinned kit, so later edits cannot change a job that already ran.</p>
        <dl>
          <div><dt>Kit</dt><dd><code>{kit.id}@{kit.version}</code></dd></div>
          <div><dt>Digest (SHA-256)</dt><dd><code>{kit.digest}</code></dd></div>
        </dl>
      </details>
    </div>

    <div className="nw-card nw-path">
      <div className="nw-card-head">
        <h3>The story so far</h3>
        <span>{plural(path.length, "scene")} on the release path</span>
      </div>
      {friend && <p className="nw-friend-note"><Star size={17} aria-hidden="true" /><span><strong>{friend.makerLabel}</strong> added “{friend.title}”. It stays credited to them on every path that continues from it.</span></p>}
      {path.length
        ? <ol className="nw-path-list">{path.map((moment, index) => <li key={moment.id}>
          <MomentCard moment={moment} index={index} friend={moment.id === friendContribution?.momentId} forkPoint={moment.id === forkPointId} signedIn={signedIn} onChoose={onChooseForkPoint} />
        </li>)}</ol>
        : <p className="nw-quiet">The story path is not available yet.</p>}
      {published.length > 0 && <>
        <h4 className="nw-subhead">Published after a Night Watch</h4>
        <ol className="nw-path-list">{published.map((moment) => <li key={moment.id}>
          <MomentCard moment={moment} index={null} friend={false} forkPoint={moment.id === forkPointId} signedIn={signedIn} onChoose={onChooseForkPoint} />
        </li>)}</ol>
      </>}
      <p className="nw-credits">
        <Sparkles size={16} aria-hidden="true" />
        {credits
          ? <span>{credits.enabled ? `${plural(credits.available, "test credit")} available in ${world.room.title}` : `Generation is paused in ${world.room.title}`}{credits.reserved > 0 && ` · ${credits.reserved} reserved for unfinished work`}. Reading is free.</span>
          : <span>Room credits are not visible right now. Reading is free.</span>}
      </p>
    </div>
  </section>;
}
