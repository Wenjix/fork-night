"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, Download, Film, RotateCcw, X } from "lucide-react";
import { isApprovedArtUrl, isLocalRasterUrl } from "@/lib/art";
import { renderStoryFilm, type FilmPlan } from "@/lib/story-film";
import { StoryArt } from "./story-art";
import "@/app/story-film.css";

export function FilmArtwork({ src, caption }: { src: string; caption: string }) {
  return isApprovedArtUrl(src) || isLocalRasterUrl(src) ? <StoryArt src={src} description={caption} /> : <img src={src} alt={caption} width={1200} height={675} />;
}

export function StoryFilm({ plan }: { plan: FilmPlan }) {
  const headingId = useId();
  const captionId = useId();
  const [shotIndex, setShotIndex] = useState(0);
  const [layout, setLayout] = useState<"horizontal" | "vertical">("horizontal");
  const [result, setResult] = useState<{ url: string; extension: string } | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const job = useRef<AbortController | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const storyboard = useRef<HTMLOListElement>(null);
  const alive = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; job.current?.abort(); }; }, []);
  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url); }, [result]);
  async function create() {
    if (job.current) return;
    const controller = new AbortController(); job.current = controller;
    setError(""); setProgress(0);
    try {
      const blob = await renderStoryFilm(plan, controller.signal, fraction => { if (alive.current) setProgress(fraction); });
      if (!alive.current || controller.signal.aborted) return;
      setShotIndex(0);
      setResult({ url: URL.createObjectURL(blob), extension: blob.type.startsWith("video/mp4") ? "mp4" : "webm" });
    } catch (e) {
      if (alive.current && !(e instanceof DOMException && e.name === "AbortError")) setError(e instanceof Error ? e.message : "The video could not finish. Try again.");
    } finally { job.current = null; if (alive.current) setProgress(null); }
  }
  function syncShot(player: HTMLVideoElement) {
    setShotIndex(Math.min(plan.shots.length - 1, Math.max(0, Math.floor(player.currentTime / plan.secondsPerShot))));
  }
  function inspect(index: number) {
    setShotIndex(index);
    if (video.current) video.current.currentTime = index * plan.secondsPerShot;
    storyboard.current?.children[index]?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }
  const seconds = plan.shots.length * plan.secondsPerShot;
  const shot = plan.shots[shotIndex];
  return <section className="story-film" aria-labelledby={headingId}>
    <div className="story-film-heading"><div><h2 id={headingId}>Review your storyboard</h2><p>{plan.shots.length} panels · {seconds} seconds · every maker credited</p></div>
      {progress !== null ? <button className="button secondary" onClick={() => job.current?.abort()}><X size={17} />Cancel</button>
        : <button className="button primary" onClick={() => void create()}>{result ? <RotateCcw size={18} /> : <Film size={18} />}{result ? "Create again" : "Create video"}</button>}
    </div>
    <p className="story-film-disclosure">Storyboard video · made from this path’s saved illustrations and captions</p>
    {error && <p className="error-message" role="alert">{error}</p>}
    <div className="storyboard-toolbar"><div className="storyboard-layouts" role="group" aria-label="Storyboard reading direction"><button type="button" aria-pressed={layout === "horizontal"} onClick={() => setLayout("horizontal")}><ArrowRight size={16} />Left to right</button><button type="button" aria-pressed={layout === "vertical"} onClick={() => setLayout("vertical")}><ArrowDown size={16} />Top to bottom</button></div><span>Beginning → ending</span></div>
    <ol ref={storyboard} className={`storyboard-panels storyboard-${layout}`} tabIndex={layout === "horizontal" ? 0 : undefined} aria-label={`Storyboard, read ${layout === "horizontal" ? "left to right" : "top to bottom"}`}>
      {plan.shots.map((item, index) => <li key={item.id} aria-current={shotIndex === index ? "true" : undefined}>
        <button type="button" className="storyboard-art" onClick={() => inspect(index)} aria-label={`${result ? "Play from" : "Review"} panel ${index + 1}: ${item.title}`}><FilmArtwork src={item.imageUrl} caption={item.caption} /></button>
        <div className="storyboard-copy"><div className="storyboard-position"><span>Panel {index + 1}</span><span>{index * plan.secondsPerShot}–{(index + 1) * plan.secondsPerShot}s</span></div><h3>{item.title}</h3><span className="storyboard-credit">{item.maker}{item.sourceVersion !== undefined && ` · v${item.sourceVersion}`}</span><p>{item.caption}</p></div>
      </li>)}
    </ol>
    <div className="storyboard-navigation"><span>{plan.shots.length} panels in story order</span><div><button type="button" className="text-button" aria-label="Previous panel" disabled={shotIndex === 0} onClick={() => inspect(shotIndex - 1)}><ArrowLeft size={17} /></button><span>Panel {shotIndex + 1} / {plan.shots.length}</span><button type="button" className="text-button" aria-label="Next panel" disabled={shotIndex === plan.shots.length - 1} onClick={() => inspect(shotIndex + 1)}><ArrowRight size={17} /></button></div></div>
    {progress !== null && <div className="story-film-progress"><progress max={1} value={progress} aria-label="Creating storyboard video" /><p role="status">Creating your video… {Math.round(progress * 100)}%</p></div>}
    {result && <figure className="story-film-preview"><h3>Your storyboard film</h3><div className="story-film-stage"><video ref={video} src={result.url} width={1280} height={720} controls playsInline autoPlay muted aria-label={`Storyboard video: ${plan.title}`} aria-describedby={captionId}
      onLoadedMetadata={event => { syncShot(event.currentTarget); event.currentTarget.scrollIntoView({ block: "nearest", behavior: "instant" }); }} onTimeUpdate={event => syncShot(event.currentTarget)} onSeeked={event => syncShot(event.currentTarget)} onEnded={event => syncShot(event.currentTarget)}>Your browser cannot play this video. Use the download below.</video></div><figcaption id={captionId} className="story-film-caption"><div><strong>Panel {shotIndex + 1} of {plan.shots.length} · {shot.title}</strong><span>Made by {shot.maker}{shot.sourceVersion !== undefined && ` · v${shot.sourceVersion}`}</span></div><p>{shot.caption}</p></figcaption></figure>}
    {result && <a className="button secondary story-film-download" href={result.url} download={`fork-night-story.${result.extension}`}><Download size={18} />Download video</a>}
  </section>;
}
