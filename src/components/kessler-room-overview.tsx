"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, GitBranch, Map as MapIcon, Play, Search, Star } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { pilotPanels, type PilotMoment } from "@/lib/pilot";
import { KESSLER_OPENING_ID } from "@/lib/kessler-room";
import { KESSLER_FILMS } from "@/lib/room-film";
import { featuredPaths, followedPathsKey, followsPath, overviewMap, overviewPaths, parseFollowedPaths, toggleFollowedPath } from "@/lib/room-overview";
import { PilotImage } from "./pilot-panels";

type Filter = "featured" | "recent" | "following" | "all";
export function KesslerRoomOverview({ client, moments, resume, blocked, onRead, onResume, onWatch, onMap }: {
  client: SupabaseClient<Database>; moments: PilotMoment[]; resume?: PilotMoment; blocked: boolean;
  onRead: (tipId: string, fromBeginning: boolean) => void; onResume: () => void;
  onWatch: (filmId: string) => void; onMap: () => void;
}) {
  const paths = useMemo(() => overviewPaths(moments), [moments]);
  const [filter, setFilter] = useState<Filter>("featured");
  const [scope, setScope] = useState(KESSLER_OPENING_ID);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState("");
  const [followed, setFollowed] = useState<string[]>([]);
  const [storageNotice, setStorageNotice] = useState("");
  const listHeading = useRef<HTMLHeadingElement>(null);
  const mapHeading = useRef<HTMLHeadingElement>(null);
  const nodes = useMemo(() => overviewMap(paths, scope), [paths, scope]);
  const terminals = nodes.filter(node => node.terminal);
  const allInScope = paths.filter(path => path.scenes.some(scene => scene.id === scope));
  const source = filter === "featured" ? featuredPaths(allInScope) : filter === "following" ? allInScope.filter(path => followsPath(followed, path)) : allInScope;
  const matches = source.filter(path => `${path.title} ${path.makers} ${path.description}`.toLowerCase().includes(query.trim().toLowerCase()));
  const currentPage = Math.min(page, Math.max(0, Math.ceil(matches.length / 3) - 1));
  const visible = matches.slice(currentPage * 3, currentPage * 3 + 3);
  const followedCount = paths.filter(path => followsPath(followed, path)).length;
  const scopeMoment = moments.find(moment => moment.id === scope);
  const filmCount = KESSLER_FILMS.filter(film => film.video && moments.some(moment => moment.id === film.tipId)).length;

  useEffect(() => { try { setFollowed(parseFollowedPaths(localStorage.getItem(followedPathsKey))); } catch { setStorageNotice("Following is available for this visit; browser storage is unavailable."); } }, []);

  function browse() { setScope(KESSLER_OPENING_ID); setFilter("all"); setQuery(""); setPage(0); }
  function focusList() { requestAnimationFrame(() => { listHeading.current?.focus({ preventScroll: true }); listHeading.current?.scrollIntoView({ block: "nearest" }); }); }
  function follow(id: string) {
    const path = paths.find(item => item.id === id)!;
    const next = toggleFollowedPath(followed, path, paths);
    setFollowed(next);
    try { localStorage.setItem(followedPathsKey, JSON.stringify(next)); }
    catch { setStorageNotice("Your follows will last for this visit only; browser storage is unavailable."); }
    if (filter === "following") focusList();
  }
  function chooseNode(id: string) {
    const node = nodes.find(item => item.id === id)!;
    setFilter("all"); setQuery(""); setPage(0);
    if (node.paths.length === 1) {
      setSelected(node.paths[0].id);
      setPage(Math.floor(allInScope.findIndex(path => path.id === node.paths[0].id) / 3));
      focusList();
    } else if (id === scope) focusList();
    else { setScope(id); setSelected(""); requestAnimationFrame(() => mapHeading.current?.focus({ preventScroll: true })); }
  }

  return <section className="kessler-overview" aria-labelledby="kessler-overview-title">
    <header className="kessler-overview-intro">
      <div><h1 id="kessler-overview-title" tabIndex={-1}>Kessler Ward</h1><p>The power is out. Mika has a delivery to make on floor eighty-one. How she gets there is up to the room.</p><p className="kessler-overview-count">{paths.length} {paths.length === 1 ? "path" : "paths"}<span>{filmCount} {filmCount === 1 ? "film" : "films"}</span><span>Open to read</span></p></div>
      <div className="kessler-overview-start"><button className="button primary" disabled={blocked || !paths.length} onClick={() => onRead(KESSLER_OPENING_ID, true)}>Start at the beginning <ArrowRight size={17} aria-hidden="true" /></button>{resume && <button className="kessler-overview-resume" disabled={blocked} onClick={onResume}><span>Continue reading</span><strong>{resume.title}</strong></button>}</div>
    </header>
    <div className="kessler-overview-explorer">
      <section className="kessler-overview-map" aria-labelledby="kessler-map-title">
        <header className="kessler-overview-heading"><div><h2 id="kessler-map-title" ref={mapHeading} tabIndex={-1}>{scope === KESSLER_OPENING_ID ? "One beginning. More possibilities." : scopeMoment?.title}</h2><p>Choose a path to see its preview.</p></div>{scope !== KESSLER_OPENING_ID && <button className="text-button" onClick={() => { setScope(KESSLER_OPENING_ID); setPage(0); setSelected(""); }}><ArrowLeft size={15} aria-hidden="true" />Whole story</button>}</header>
        <div className={`kessler-overview-canvas${scope !== KESSLER_OPENING_ID ? " is-expanded" : ""}`} data-leaves={terminals.length} aria-label="Story map, from the shared beginning upward">
          <svg className="kessler-overview-lines" viewBox="0 0 1000 600" preserveAspectRatio="none" aria-hidden="true">{nodes.filter(node => node.parent).map(node => {
            const parent = nodes.find(item => item.id === node.parent)!;
            const childBottom = (node.y + (node.terminal ? 33 : 13)) * 6;
            const parentTop = parent.y * 6;
            const mid = (childBottom + parentTop) / 2;
            return <path key={node.id} data-route={node.route} d={`M${node.x * 10} ${childBottom}V${mid - 12}Q${node.x * 10} ${mid} ${(node.x * 10 + parent.x * 10) / 2} ${mid}T${parent.x * 10} ${mid + 12}V${parentTop}`} />;
          })}</svg>
          {nodes.map(node => {
            const width = node.terminal ? Math.min(27, 90 / terminals.length) : 27;
            const image = node.terminal ? node.paths[0].image : node.moment;
            const panel = pilotPanels(image.panels)[0];
            return <button key={node.id} className={`kessler-overview-node ${node.terminal ? "is-path" : node.parent ? "is-fork" : "is-origin"}${node.paths.length === 1 && node.paths[0].id === selected ? " is-selected" : ""}`} data-route={node.route} data-slot={terminals.indexOf(node)} style={{ left: `${Math.max(2, Math.min(98 - width, node.x - width / 2))}%`, top: `${node.y}%`, width: `${width}%` }} disabled={blocked} onClick={() => node.terminal ? chooseNode(node.id) : onRead(node.id, false)} aria-label={node.terminal ? `Explore ${node.label}, ${node.paths.length} ${node.paths.length === 1 ? "path" : "paths"}` : `Read ${node.moment.title}`}>
              {(node.terminal || !node.parent) && panel && <span className="kessler-overview-node-art" aria-hidden="true"><PilotImage client={client} panel={panel} allowRetry={false} /></span>}
              <span className="kessler-overview-node-copy"><strong>{node.label}</strong><small>{node.terminal ? `${node.paths.length} ${node.paths.length === 1 ? "path" : "paths"}` : node.parent ? "A choice in the story" : "Our shared beginning"}</small>{node.terminal && <span>Explore <ArrowRight size={12} aria-hidden="true" /></span>}</span>
            </button>;
          })}
        </div>
        <footer className="kessler-overview-map-note"><span><GitBranch size={15} aria-hidden="true" />Shared scenes stay together. Open a group to explore.</span><button className="text-button" disabled={blocked} onClick={onMap}><MapIcon size={15} aria-hidden="true" />Full scene map</button></footer>
      </section>
      <section className="kessler-overview-paths" aria-labelledby="kessler-paths-title">
        <header className="kessler-overview-heading"><div><h2 id="kessler-paths-title" ref={listHeading} tabIndex={-1}>Find your next path</h2><p>{scope !== KESSLER_OPENING_ID ? `${allInScope.length} paths from this part of the story` : filter === "featured" ? "Room picks, with every path still in reach." : filter === "following" ? "Follow as many paths as you like. Saved in this browser." : filter === "recent" ? "The latest additions first." : "Every path, including the quieter ones."}</p></div>{scope !== KESSLER_OPENING_ID && <button className="text-button" onClick={browse}>All paths</button>}</header>
        <div className="kessler-overview-filters" role="group" aria-label="Choose paths to show">{(["featured", "recent", "following", "all"] as const).map(value => <button type="button" key={value} aria-pressed={filter === value} onClick={() => { setFilter(value); setQuery(""); setPage(0); }}>{value === "featured" ? "Featured" : value === "recent" ? "Recent" : value === "following" ? `Following ${followedCount}` : "All paths"}</button>)}</div>
        <label className="kessler-overview-search"><Search size={17} aria-hidden="true" /><span className="sr-only">Search all paths and storytellers</span><input type="search" placeholder="Find a path or storyteller" value={query} onChange={event => { setQuery(event.target.value); setFilter("all"); setScope(KESSLER_OPENING_ID); setPage(0); }} /></label>
        <div className="kessler-overview-results" aria-live="polite" aria-atomic="false">
          {visible.map(path => <article key={path.id} className={`kessler-path-preview${selected === path.id ? " is-selected" : ""}`}>
            <div className="kessler-path-art" aria-hidden="true">{pilotPanels(path.image.panels)[0] && <PilotImage client={client} panel={pilotPanels(path.image.panels)[0]} allowRetry={false} />}</div>
            <div className="kessler-path-copy"><div className="kessler-path-title"><h3>{path.title}</h3><button className="kessler-path-follow" aria-label={`${followsPath(followed, path) ? "Unfollow" : "Follow"} ${path.title}`} aria-pressed={followsPath(followed, path)} onClick={() => follow(path.id)}><Star size={18} aria-hidden="true" /></button></div><p>{path.description}</p><small>{path.makers} · {path.scenes.length} scenes</small><div className="kessler-path-actions"><button className="button secondary" disabled={blocked} onClick={() => onRead(path.id, true)}>Read path <ArrowRight size={15} aria-hidden="true" /></button>{path.film?.video && <button className="text-button" disabled={blocked} onClick={() => onWatch(path.film!.id)}><Play size={15} aria-hidden="true" />{path.film.tipId === path.id ? "Watch film" : "Earlier film"}</button>}</div></div>
          </article>)}
          {!visible.length && <div className="kessler-overview-empty"><Star size={25} aria-hidden="true" /><h3>{filter === "following" ? "Keep a path close" : "No matching paths"}</h3><p>{filter === "following" ? "Use the star beside a path to follow it and the scenes that grow from it." : "Try another title or storyteller, or explore every path."}</p><button className="button secondary" onClick={browse}>Browse all paths</button></div>}
        </div>
        <div className="kessler-overview-pagination"><span>{filter === "featured" && scope === KESSLER_OPENING_ID ? `Showing ${visible.length} of ${paths.length}` : matches.length ? `${currentPage * 3 + 1}–${Math.min(currentPage * 3 + 3, matches.length)} of ${matches.length}` : "0 paths"}</span>{filter === "featured" ? <button className="text-button" onClick={browse}>Browse all {paths.length} <ArrowRight size={16} aria-hidden="true" /></button> : matches.length > 3 && <nav aria-label="Path pages"><button aria-label="Previous three paths" disabled={!currentPage} onClick={() => { setPage(currentPage - 1); focusList(); }}><ArrowLeft size={17} aria-hidden="true" /></button><span>{currentPage + 1} / {Math.ceil(matches.length / 3)}</span><button aria-label="Next three paths" disabled={(currentPage + 1) * 3 >= matches.length} onClick={() => { setPage(currentPage + 1); focusList(); }}><ArrowRight size={17} aria-hidden="true" /></button></nav>}</div>
        {storageNotice && <p className="kessler-overview-storage" role="status">{storageNotice}</p>}
      </section>
    </div>
  </section>;
}
