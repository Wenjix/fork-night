"use client";

import { useRef, useState } from "react";
import { ArrowRight, BookOpen, Check, ChevronDown, GitBranch, Play, RotateCcw } from "lucide-react";
import { panelImage, type Release } from "@/lib/world-demo/model";
import { RoleIdentity } from "./identity";
import { StoryFilm } from "../story-film";
import { makeFilmPlan } from "@/lib/story-film";

const VIDEO = "/world-demo/after-hours-kling-demo.mp4";

export function ChapterFilm({ release, onReadWork }: { release: Release; onReadWork: (id: string) => void }) {
  const [mode, setMode] = useState<"storyboard" | "motion">("storyboard");
  const videoRef = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const [playback, setPlayback] = useState<"idle" | "loading" | "playing" | "paused" | "ended">("idle");
  const [error, setError] = useState("");
  const busy = playback === "loading" || playback === "playing";

  function playClip() {
    const video = videoRef.current;
    if (!video) return;
    setStarted(true);
    setError("");
    setPlayback("loading");
    if (video.error) video.load();
    video.currentTime = 0;
    // Keep play() inside the click gesture, including on browsers that require it for audio.
    void video.play().catch(() => {
      setPlayback("paused");
      setError("Playback didn’t start. Try again or open the clip below.");
    });
    video.scrollIntoView({ block: "center", behavior: "auto" });
  }

  return <div className="wd-film-layout">
    <section className="wd-film" aria-label="Chapter film workspace">
      <div className="wd-film-modes" role="group" aria-label="Video type"><button type="button" aria-pressed={mode === "storyboard"} onClick={() => { videoRef.current?.pause(); setMode("storyboard"); }}>Your chapter film</button><button type="button" aria-pressed={mode === "motion"} onClick={() => setMode("motion")}>Prepared motion example</button></div>
      {mode === "storyboard" ? <StoryFilm plan={makeFilmPlan(release.snapshot.title, release.snapshot.works.map(work => ({ id: work.id, title: work.title, maker: work.maker_label, panels: work.panels.map(panel => ({ imageUrl: panelImage(panel).src, caption: panel.caption })) })))} /> : <>
      <div className="wd-film-heading">
        <h2 id="chapter-film-title">After Hours, in motion</h2>
        <button type="button" className="wd-button wd-yellow" onClick={playClip} disabled={busy} aria-controls="chapter-film-player" aria-describedby="chapter-film-status">
          {started ? <RotateCcw size={17} aria-hidden="true" /> : <Play size={17} aria-hidden="true" />}
          {playback === "loading" ? "Loading video…" : playback === "playing" ? "Playing video" : error ? "Try video again" : started ? "Replay video" : "Play motion example"}
        </button>
      </div>
      <p id="chapter-film-status" className="wd-film-status" role="status">Prepared generative motion · 5 seconds · a fixed example of the reunion ending</p>
      <figure>
        <video id="chapter-film-player" ref={videoRef} src={VIDEO} poster="/world-demo/after-hours-kling-poster.webp" width={1600} height={902} controls={started} playsInline preload="none" aria-label="After Hours: the ledger brings a brother and sister together" aria-describedby="chapter-film-description"
          onPlay={() => { setStarted(true); setError(""); setPlayback("playing"); }}
          onPlaying={() => setPlayback("playing")}
          onWaiting={() => setPlayback("loading")}
          onPause={() => setPlayback("paused")}
          onEnded={() => setPlayback("ended")}
          onError={() => { setPlayback("paused"); setError("The clip couldn’t load. Try again or open it below."); }}>
          <track kind="captions" src="/world-demo/after-hours-kling-captions.vtt" srcLang="en" label="English scene captions" />
          <a href={VIDEO}>Open the After Hours video</a>
        </video>
        <figcaption id="chapter-film-description">The network goes dark. Nika’s paper ledger holds an address—and a way back to someone who matters.</figcaption>
      </figure>
      {error && <p className="wd-error" role="alert">{error} <a href={VIDEO} target="_blank" rel="noopener noreferrer">Open video</a></p>}
      </>}
    </section>
    <ContributionHistory release={release} onReadWork={onReadWork} />
  </div>;
}

function ContributionHistory({ release, onReadWork }: { release: Release; onReadWork: (id: string) => void }) {
  const works = release.snapshot.works;
  return <aside className="wd-contribution-history" aria-labelledby="contribution-history-title">
    <h2 id="contribution-history-title"><GitBranch size={21} aria-hidden="true" /> Contribution history</h2>
    <p>One story, carried forward. Every maker stays attached.</p>
    <ol className="wd-history-path">
      {works.map(work => {
        const parent = works.find(item => item.id === work.parent_id);
        return <li key={work.id} data-role={work.role}>
          <details className="wd-contribution">
            <summary>
              <span className="wd-history-node" aria-hidden="true" />
              {work.role === "opening" ? <span className="wd-history-opening"><BookOpen size={17} aria-hidden="true" /> Prepared opening</span> : <RoleIdentity role={work.role} name={work.maker_label} detail={work.role === "maker" ? "Original contribution" : `Continues ${parent?.maker_label ?? "the story"}’s scene`} />}
              <strong className="wd-history-title">{work.title}</strong>
              <span className="wd-history-summary"><code>{work.id.slice(0, 8)}</code><span>+{work.panels.length} {work.panels.length === 1 ? "panel" : "panels"}</span><ChevronDown size={17} aria-hidden="true" /></span>
              <span className="wd-history-hint">View contribution</span>
            </summary>
            <div className="wd-history-expanded">
              <dl><div><dt>Contribution</dt><dd><code>{work.id}</code></dd></div>{parent && <div><dt>Builds on</dt><dd>{parent.title} · {parent.maker_label}<code>{parent.id.slice(0, 8)}</code></dd></div>}</dl>
              <ol className="wd-history-panels" aria-label={`Panels added by ${work.maker_label}`}>
                {work.panels.map((panel, index) => {
                  const art = panelImage(panel);
                  return <li key={index}><img src={art.src} alt={art.alt} width={72} height={64} loading="lazy" /><div><span>Added panel {index + 1}</span><p>{panel.caption}</p></div></li>;
                })}
              </ol>
              <button type="button" className="wd-text-button" onClick={() => onReadWork(work.id)}>Read this scene <ArrowRight size={16} aria-hidden="true" /></button>
            </div>
          </details>
        </li>;
      })}
      <li className="wd-history-release"><span className="wd-history-node" aria-hidden="true"><Check size={12} /></span><strong>{release.snapshot.title}</strong><span>Published by {release.snapshot.curator.label}</span></li>
    </ol>
    <details className="wd-history-record"><summary>Chapter record</summary><p>These exact contributions are preserved in the published chapter.</p><dl><div><dt>Release</dt><dd><code>{release.id}</code></dd></div><div><dt>SHA-256</dt><dd><code>{release.digest}</code></dd></div></dl></details>
  </aside>;
}
