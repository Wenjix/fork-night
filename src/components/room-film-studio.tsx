"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Clapperboard, Download, Film, GitBranch, Play, Share2, X } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { pilotPath, type PilotMoment } from "@/lib/pilot";
import { storyboardImage } from "@/lib/room-film-image";
import { renderStoryFilm } from "@/lib/story-film";
import { FILM_SHOT_SECONDS, KESSLER_FILMS, MAX_FILM_SHOTS, filmSceneCount, matchingRoomFilm, roomFilmShareHref, roomFilmShots, selectedFilmShots, storyboardPlan, suggestedFilmShots, type RoomFilm, type RoomFilmShot } from "@/lib/room-film";
import { PilotImage } from "./pilot-panels";
import { BrandBadge, BrandStrip } from "./brand-badge";

type Client = SupabaseClient<Database>;
type View = "closed" | "choose" | "review" | "watch" | "storyboard";
type Edit = { tipId: string; title: string; sceneCount: number; shots: RoomFilmShot[]; selected: string[] };
type Storyboard = { url: string; extension: string; title: string; tipId: string; shots: RoomFilmShot[] };

function ShotImage({ shot, client }: { shot: RoomFilmShot; client: Client }) {
  return shot.image
    ? <img src={shot.image} alt={shot.panel.caption} width={512} height={512} loading="lazy" />
    : <PilotImage client={client} panel={shot.panel} allowRetry={false} />;
}

function FilmPlayer({ film, onRead }: { film: RoomFilm; onRead: (id: string, trace?: boolean) => void }) {
  const player = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  async function play() {
    if (!player.current) return;
    setError("");
    try { await player.current.play(); setStarted(true); player.current.focus(); }
    catch { setError("Playback didn’t start. Try Play again or download the film below."); }
  }
  async function share() {
    const href = roomFilmShareHref(window.location.href, film);
    try { await navigator.clipboard.writeText(href); setCopied(true); }
    catch { setShareUrl(href); }
  }
  return <div className="room-film-screening">
    <div className="room-film-player">
      {film.video ? <>
        <video ref={player} src={film.video} poster={film.poster} controls={started} preload="none" playsInline tabIndex={started ? 0 : -1} width={960} height={960} aria-label={`${film.title}, an 18-second Wan film`}
          onPlay={() => setStarted(true)} onError={() => setError("The film couldn’t load. Try opening or downloading it below.")}>
          <track kind="captions" src={film.captions} srcLang="en" label="Story descriptions" />
        </video>
        {!started && <button type="button" className="room-film-play" onClick={() => void play()}><Play size={26} aria-hidden="true" />Play film<span>{film.duration} seconds · sound on</span></button>}
      </> : <><img src={film.poster} alt={film.shots.at(-1)?.panel.caption ?? film.title} /><p className="room-film-pending">This film is being prepared.</p></>}
    </div>
    <div className="room-film-about">
      <h3>{film.title}</h3>
      <p>{film.description}</p>
      <BrandStrip label="Film model and provider"><BrandBadge brand="wan" label={film.model} /><BrandBadge brand="gmi" label={film.provider} /></BrandStrip>
      <p className="room-film-meta">6 selected panels · {film.duration} seconds · prepared {new Date(`${film.preparedOn}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}</p>
      <div className="room-film-sources">
        <h4>The story behind the film</h4>
        <ol>{film.shots.map((shot, index) => <li key={shot.id}><button type="button" onClick={() => onRead(shot.sourceId)} aria-label={`Read source ${index + 1}: ${shot.title}`}><img src={shot.image} width={64} height={64} alt="" /><span><strong>{shot.title}</strong><small>{shot.maker}</small></span><ArrowRight size={15} aria-hidden="true" /></button></li>)}</ol>
      </div>
      <p className="room-film-note">A short interpretation of this branch. Every original scene stays in the story, including moments condensed in the edit.</p>
      <div className="room-film-actions"><button type="button" className="button secondary" onClick={() => onRead(film.tipId, true)}><GitBranch size={16} aria-hidden="true" />Contribution trail</button><button type="button" className="text-button" onClick={() => onRead(film.tipId)}>Read this branch<ArrowRight size={16} aria-hidden="true" /></button></div>
      {film.video && <div className="room-film-actions"><a className="text-button" href={film.video} download={`kessler-${film.id}.mp4`}><Download size={16} aria-hidden="true" />Download MP4</a><button type="button" className="text-button" onClick={() => void share()}><Share2 size={16} aria-hidden="true" />{copied ? "Link copied" : "Copy film link"}</button></div>}
      <span role="status" className="room-film-note">{copied ? "Film link copied. It opens this finished cut." : ""}</span>
      {shareUrl && <label className="room-film-share">Film link<input readOnly value={shareUrl} onFocus={event => event.target.select()} /></label>}
      {error && <p role="alert" className="room-film-error">{error} {film.video && <a href={film.video} target="_blank" rel="noreferrer">Open film</a>}</p>}
    </div>
  </div>;
}

export function RoomFilmStudio({ client, moments, currentPath, openRequest, requestedFilmId, compact = false, onRead, onBusyChange }: {
  client: Client; moments: PilotMoment[]; currentPath: PilotMoment[]; openRequest: number;
  requestedFilmId?: string; compact?: boolean;
  onRead: (id: string, trace?: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [view, setView] = useState<View>("closed");
  const [filmId, setFilmId] = useState(KESSLER_FILMS[0].id);
  const [edit, setEdit] = useState<Edit>();
  const [result, setResult] = useState<Storyboard>();
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const job = useRef<AbortController | null>(null);
  const alive = useRef(false);
  const film = KESSLER_FILMS.find(item => item.id === filmId) ?? KESSLER_FILMS[0];
  const tips = useMemo(() => {
    const parents = new Set(moments.map(moment => moment.parent_id));
    const ends = moments.filter(moment => !parents.has(moment.id));
    const current = currentPath.at(-1);
    if (current && !ends.some(end => end.id === current.id)) ends.push(current);
    return ends;
  }, [moments, currentPath]);
  const selected = edit?.selected.length ? selectedFilmShots(edit.shots, edit.selected) : [];
  const sourceSceneCount = filmSceneCount(selected);
  const matching = matchingRoomFilm(selected);
  const busy = progress !== null;
  const readyCount = KESSLER_FILMS.filter(item => item.video).length;
  function focusWorkspace() {
    requestAnimationFrame(() => { heading.current?.focus({ preventScroll: true }); heading.current?.scrollIntoView({ block: "start", behavior: "instant" }); });
  }
  function watch(id: string) {
    if (job.current) return;
    const next = KESSLER_FILMS.find(item => item.id === id);
    if (!next) return;
    // Watching a film leaves the reader and any pending invitation in place.
    const url = new URL(window.location.href);
    url.searchParams.set("film", next.id);
    window.history.replaceState(window.history.state, "", url);
    setFilmId(id); setView("watch"); setError(""); focusWorkspace();
  }
  function choose(tipId = currentPath.at(-1)?.id) {
    if (!tipId || job.current) return;
    try {
      const path = pilotPath(moments, "kessler-ward", tipId);
      const shots = roomFilmShots(path);
      const url = new URL(window.location.href);
      url.searchParams.delete("film");
      window.history.replaceState(window.history.state, "", url);
      setEdit({ tipId, title: path.at(-1)!.title, sceneCount: path.length, shots, selected: suggestedFilmShots(shots, tipId) });
      setView("choose"); setError(""); focusWorkspace();
    } catch { setError("This branch is incomplete. Reload the room to choose its saved scenes."); }
  }
  function close() {
    setView("closed");
    const url = new URL(window.location.href);
    if (url.searchParams.has("film")) { url.searchParams.delete("film"); window.history.replaceState(window.history.state, "", url); }
    const target = document.getElementById(compact ? "kessler-overview-title" : "room-films-title");
    target?.focus({ preventScroll: true });
    if (compact) target?.scrollIntoView({ block: "start" });
  }
  function readSource(id: string, trace?: boolean) {
    setView("closed");
    const url = new URL(window.location.href);
    url.searchParams.delete("film");
    url.searchParams.set("moment", id);
    window.history.replaceState(window.history.state, "", url);
    onRead(id, trace);
  }
  useEffect(() => { alive.current = true; return () => { alive.current = false; job.current?.abort(); onBusyChange(false); }; }, [onBusyChange]);
  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url); }, [result]);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("film");
    if (id && KESSLER_FILMS.some(item => item.id === id)) watch(id);
  }, []);
  useEffect(() => { if (compact && !job.current) setView("closed"); }, [compact]);
  useEffect(() => { if (openRequest) watch(requestedFilmId ?? filmId); }, [openRequest]);

  async function createStoryboard() {
    if (!edit || !selected.length || job.current) return;
    const controller = new AbortController(); job.current = controller;
    setError(""); setProgress(0); onBusyChange(true);
    try {
      const images = await Promise.all(selected.map(shot => storyboardImage(client, shot, controller.signal)));
      controller.signal.throwIfAborted();
      const blob = await renderStoryFilm(storyboardPlan(edit.title, selected, images), controller.signal, fraction => { if (alive.current) setProgress(fraction); });
      if (!alive.current || controller.signal.aborted) return;
      setResult({ url: URL.createObjectURL(blob), extension: blob.type.startsWith("video/mp4") ? "mp4" : "webm", title: edit.title, tipId: edit.tipId, shots: selected });
      setView("storyboard"); focusWorkspace();
    } catch (cause) {
      if (alive.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "The storyboard couldn’t finish. Try again.");
    } finally { job.current = null; if (alive.current) { setProgress(null); onBusyChange(false); } }
  }
  const step = view === "choose" ? 1 : view === "review" ? 2 : 3;
  return <section id="kessler-films" className="room-films" hidden={compact && view === "closed" && !result} aria-labelledby="room-films-title">
    <header className="room-films-heading"><div><h2 id="room-films-title" tabIndex={-1}><Film size={19} aria-hidden="true" />Films from this room</h2><p>{readyCount === 3 ? "Three branches, three short films. Pick an ending to watch." : `${readyCount} finished film · two more branches being prepared.`}</p></div><button type="button" className="button secondary" onClick={() => choose()} disabled={busy || !currentPath.length}><Clapperboard size={17} aria-hidden="true" />Make a film</button></header>
    <div className="room-film-shelf" aria-label="Kessler branch films">{KESSLER_FILMS.map(item => <button type="button" key={item.id} className="room-film-ticket" aria-pressed={view === "watch" && filmId === item.id} onClick={() => watch(item.id)} disabled={busy}>
      <span className="room-film-poster"><img src={item.poster} alt="" width={128} height={128} loading="lazy" /><Play size={20} aria-hidden="true" /></span>
      <span><strong>{item.title}</strong><small>{item.video ? <><span className="room-film-ready"><Check size={13} aria-hidden="true" />Film ready</span> · 18 sec</> : "Film being prepared"}</small>{item.id === "lift" && <small>Burkes + Wren’s continuation</small>}</span><ArrowRight className="room-film-ticket-arrow" size={17} aria-hidden="true" />
    </button>)}</div>
    {result && view !== "storyboard" && <div className="room-film-result-cue" role="status"><Check size={17} aria-hidden="true" /><span>Your storyboard is ready · {result.shots.length * FILM_SHOT_SECONDS} seconds</span><button type="button" className="text-button" disabled={busy} onClick={() => { setView("storyboard"); focusWorkspace(); }}>Watch storyboard<Play size={15} aria-hidden="true" /></button></div>}
    {view !== "closed" && <div className="room-film-workspace">
      <header className="room-film-workspace-heading"><h2 ref={heading} tabIndex={-1}>{view === "watch" ? "Choose a film. Follow its story." : view === "storyboard" ? "Your storyboard is ready." : view === "choose" ? "Choose the moments that move the story." : "Review your film."}</h2><button type="button" className="pilot-icon-button" aria-label="Close film workspace" disabled={busy} onClick={close}><X size={20} aria-hidden="true" /></button></header>
      {(view === "choose" || view === "review" || view === "storyboard") && <ol className="room-film-steps" aria-label="Film steps">{["Choose shots", "Review", "Watch"].map((label,index) => <li key={label} aria-current={step === index + 1 ? "step" : undefined}><span>{index + 1}</span>{label}</li>)}</ol>}
      {error && <p className="room-film-error" role="alert">{error}</p>}
      {view === "watch" && <FilmPlayer key={film.id} film={film} onRead={readSource} />}
      {view === "choose" && edit && <>
        <div className="room-film-selection-heading"><label>Story branch<select value={edit.tipId} onChange={event => choose(event.target.value)}>{tips.map(tip => <option key={tip.id} value={tip.id}>{tip.title} · {tip.maker_label}</option>)}</select></label><p>{edit.sceneCount} scenes · {edit.shots.length} panels<br /><strong aria-live="polite">{selected.length} of {MAX_FILM_SHOTS} shots selected · {selected.length * FILM_SHOT_SECONDS} seconds</strong></p></div>
        <p className="room-film-note">We’ve suggested a short edit. Choose up to six panels; they stay in story order. Uncheck a shot to choose a replacement.</p>
        <fieldset className="room-film-choices"><legend className="sr-only">Choose source panels for the film</legend>{edit.shots.map(shot => {
          const index = selected.findIndex(item => item.id === shot.id);
          return <label className="room-film-choice" key={shot.id} data-selected={index >= 0}>
            <span className="room-film-choice-art"><ShotImage shot={shot} client={client} /><span className="room-film-choice-number">{index >= 0 ? `Shot ${index + 1}` : `Panel ${shot.panelIndex + 1}`}</span></span>
            <span className="room-film-choice-copy"><input type="checkbox" checked={index >= 0} disabled={index < 0 && selected.length >= MAX_FILM_SHOTS} onChange={event => setEdit({ ...edit, selected: event.target.checked ? [...edit.selected, shot.id] : edit.selected.filter(id => id !== shot.id) })} aria-label={`${shot.title}, panel ${shot.panelIndex + 1}`} /><span><strong title={shot.title}>{shot.title}</strong><small>{shot.maker}</small></span></span>
          </label>;
        })}</fieldset>
        <footer className="room-film-footer"><p>Longer stories can become several short chapters. This cut keeps its original sources and credits.</p><button type="button" className="button primary" disabled={!selected.length} onClick={() => { setView("review"); focusWorkspace(); }}>Review {selected.length} {selected.length === 1 ? "shot" : "shots"}<ArrowRight size={17} aria-hidden="true" /></button></footer>
      </>}
      {view === "review" && edit && <div className="room-film-review">
        <ol className="room-film-shot-list">{selected.map((shot,index) => <li key={shot.id}><div className="room-film-shot-image"><ShotImage shot={shot} client={client} /></div><div><span className="room-film-timing">Shot {index + 1} · {index * FILM_SHOT_SECONDS}–{(index + 1) * FILM_SHOT_SECONDS}s</span><h3>{shot.title}</h3><p>{matching?.shots[index].direction ?? shot.panel.caption}</p><small>{shot.maker}</small></div></li>)}</ol>
        <aside className="room-film-review-summary" aria-label="Film summary"><h3>{edit.title}</h3><dl><div><dt>Length</dt><dd>{selected.length * FILM_SHOT_SECONDS} seconds</dd></div><div><dt>Source</dt><dd>{selected.length} {selected.length === 1 ? "panel" : "panels"} from {sourceSceneCount} {sourceSceneCount === 1 ? "scene" : "scenes"}</dd></div><div><dt>Format</dt><dd>{matching?.video ? "Wan 3.0 motion film" : "Storyboard video"}</dd></div><div><dt>Cost now</dt><dd>{matching?.video ? "Already made · free to watch" : "Free · 0 room credits"}</dd></div></dl>
          <p>{matching?.video ? "This exact selection already has a finished film. Watch it now, or make a storyboard of the source images." : "Create a video of your selected images and captions in this browser. New Wan motion generation isn’t available from the room yet."}</p>
          {busy ? <div className="room-film-progress"><progress max={1} value={progress} aria-label="Creating storyboard video" /><p role="status">Creating your storyboard… {Math.round(progress * 100)}%</p><button type="button" className="button secondary" onClick={() => job.current?.abort()}>Cancel</button></div> : <>
            {matching?.video && <button type="button" className="button primary" onClick={() => watch(matching.id)}><Play size={17} aria-hidden="true" />Watch finished film</button>}
            <button type="button" className={`button ${matching?.video ? "secondary" : "primary"}`} onClick={() => void createStoryboard()}><Clapperboard size={17} aria-hidden="true" />Create storyboard video</button>
            <button type="button" className="text-button" onClick={() => { setView("choose"); focusWorkspace(); }}><ArrowLeft size={16} aria-hidden="true" />Change shots</button>
          </>}
          <p className="room-film-note">The original bylines stay with every shot. Making a film does not change the story or its registered contributions.</p>
        </aside>
      </div>}
      {view === "storyboard" && result && <div className="room-film-storyboard-result"><video key={result.url} src={result.url} controls playsInline preload="metadata" aria-label={`Storyboard: ${result.title}`} /><div><h3>{result.title}</h3><p>{result.shots.length} source panels · {result.shots.length * FILM_SHOT_SECONDS} seconds · original captions and credits</p><p>A silent storyboard made from your chosen illustrations. Download it to keep it; this preview lasts until you leave or reload the page.</p><div className="room-film-actions"><a className="button primary" href={result.url} download={`kessler-storyboard.${result.extension}`}><Download size={17} aria-hidden="true" />Download storyboard</a><button type="button" className="button secondary" onClick={() => readSource(result.tipId)}>Back to the story<ArrowRight size={16} aria-hidden="true" /></button></div><button type="button" className="text-button" onClick={() => watch(KESSLER_FILMS[0].id)}>Watch the finished Wan films<Play size={16} aria-hidden="true" /></button></div></div>}
    </div>}
  </section>;
}
