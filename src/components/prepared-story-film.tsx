"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowDown, ArrowUpRight, Download, Film, Play, RotateCcw } from "lucide-react";
import type { PreparedFilm } from "@/lib/prepared-story-film";
import { BrandBadge, BrandStrip, Chip } from "./brand-badge";
import { ToArrow } from "./inline-arrow";
import { Button } from "./ui/button";
import { Card, CardAction, CardContent, CardDescription } from "./ui/card";

/** The invitation to the film: the section-plate anatomy (mount, heading, text, action) with the film's poster as its mount. */
export function PreparedFilmInvite({ film, onOpen }: { film: PreparedFilm; onOpen: () => void }) {
  return <Card className="fn-section-plate fn-film-plate" data-tone="lavender" data-variant="plate">
    <span className="fn-plate-mount" aria-hidden="true"><img src={film.poster} width={56} height={56} alt="" /></span>
    <CardContent className="fn-plate-copy">
      <h2 className="fn-plate-heading">See this story come to life.</h2>
      <CardDescription className="fn-plate-description">{film.invite}</CardDescription>
    </CardContent>
    <CardAction className="fn-plate-action">
      <Button type="button" className="fn-film-button" onClick={onOpen}><Film size={18} aria-hidden="true" /><span>Images <ToArrow />video</span></Button>
    </CardAction>
  </Card>;
}

export function PreparedStoryFilm({ film }: { film: PreparedFilm }) {
  const headingId = useId();
  const playerId = useId();
  const descriptionId = useId();
  const player = useRef<HTMLVideoElement>(null);
  const motionHeading = useRef<HTMLHeadingElement>(null);
  const [started, setStarted] = useState(false);
  const [playback, setPlayback] = useState<"idle" | "loading" | "playing" | "paused" | "ended">("idle");
  const [error, setError] = useState("");
  const busy = playback === "loading" || playback === "playing";
  useEffect(() => {
    const video = player.current;
    return () => video?.pause();
  }, []);

  function play() {
    const video = player.current;
    if (!video) return;
    setStarted(true);
    setError("");
    setPlayback("loading");
    if (video.error) video.load();
    if (playback === "ended") video.currentTime = 0;
    // Start within the click gesture so browsers can allow the clip's audio.
    void video.play().catch(() => {
      setPlayback("paused");
      setError("Playback didn’t start. Try again or open the video below.");
    });
    motionHeading.current?.focus({ preventScroll: true });
    video.scrollIntoView({ block: "center", behavior: "auto" });
  }

  const playLabel = playback === "loading" ? "Loading video…" : playback === "playing" ? "Playing video" : error ? "Try video again" : playback === "ended" ? "Replay demo video" : started ? "Continue video" : "Play demo video";

  return <section className="fn-film-demo" aria-labelledby={headingId}>
    <header className="fn-film-intro">
      <h2 id={headingId}>{film.heading}</h2>
      <Button type="button" className="fn-film-button" onClick={play} disabled={busy} aria-controls={playerId}><Play size={18} aria-hidden="true" />{playLabel}<ArrowDown size={17} aria-hidden="true" /></Button>
      <p>{film.intro}</p>
    </header>

    <section className="fn-film-sources" aria-label={`${film.sourcesHeading}, in story order`}>
      <div className="fn-film-section-heading"><h3>{film.sourcesHeading}</h3>
        <BrandStrip label="Image model and provider">
          <BrandBadge brand={film.brands.imageModel} label={film.imageModel} />
          <BrandBadge brand={film.brands.provider} label={film.provider} />
        </BrandStrip>
      </div>
      <ol className="fn-film-images">
        {film.images.map((image, index) => <li key={image.frame}>
          <figure><img src={image.src} width={1024} height={1024} alt={image.caption} loading={index < 2 ? "eager" : "lazy"} />
            <figcaption><span className="fn-film-image-position">Image {index + 1} of {film.images.length}</span><h4>{image.title}</h4><p>{image.caption}</p></figcaption>
          </figure>
        </li>)}
      </ol>
    </section>

    <Card className="fn-film-motion">
      <div className="fn-film-motion-heading"><div><h3 ref={motionHeading} tabIndex={-1}>Now, in motion.</h3>
        <div className="fn-film-credit">
          <BrandStrip label="Video model and provider">
            <BrandBadge brand={film.brands.videoModel} label={film.videoModel} />
            <BrandBadge brand={film.brands.provider} label={film.provider} />
          </BrandStrip>
          <span>{film.duration} seconds</span>
        </div>
      </div>
        <Button type="button" className="fn-film-button fn-film-button-light" onClick={play} disabled={busy} aria-controls={playerId}>{playback === "ended" ? <RotateCcw size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}{playLabel}</Button>
      </div>
      <div className="fn-film-motion-body">
        <figure>
          <video id={playerId} ref={player} src={film.video} poster={film.poster} width={720} height={720} controls playsInline preload="none" aria-label={film.videoLabel} aria-describedby={descriptionId}
            onPlay={() => { setStarted(true); setError(""); setPlayback("playing"); }}
            onPlaying={() => setPlayback("playing")}
            onWaiting={() => setPlayback("loading")}
            onPause={() => setPlayback("paused")}
            onEnded={() => setPlayback("ended")}
            onError={() => { setPlayback("paused"); setError("The video couldn’t load. Try again or open it below."); }}>
            <track kind="captions" src={film.captions} srcLang="en" label="English scene descriptions" />
            <a href={film.video}>Open the demo video</a>
          </video>
          <figcaption id={descriptionId}>A prepared interpretation of the “{film.ending}” path, using the {film.images.length === 4 ? "four" : film.images.length} images above.</figcaption>
        </figure>
        <div className="fn-film-film-note">
          <Chip>Prepared motion example</Chip>
          <p>The images are the references. The film adds movement and camera work, with the original audio.</p>
          <p>Generated on {film.preparedOnLabel}. This fixed clip is ready to show; changes to your story can be made into a separate storyboard video through <strong>Make a video</strong>.</p>
          <div className="fn-film-downloads"><Button asChild variant="outline" className="fn-film-button fn-film-button-outline"><a href={film.video} target="_blank" rel="noopener noreferrer">Open video<ArrowUpRight size={16} aria-hidden="true" /></a></Button><Button asChild variant="outline" className="fn-film-button fn-film-button-outline"><a href={film.video} download={film.downloadName}><Download size={17} aria-hidden="true" />Download MP4</a></Button></div>
          <details><summary>Read the story captions</summary><ol>{film.images.map(image => <li key={image.frame}>{image.caption}</li>)}</ol></details>
        </div>
      </div>
      <p className="fn-film-playback" role="status">{playback === "loading" ? "Loading the prepared video…" : playback === "playing" ? "Playing the prepared video." : playback === "ended" ? "Video finished. Replay it or return to the story map." : playback === "paused" && !error ? "Video paused." : "Play when you’re ready. Audio is included."}</p>
      {error && <p className="fn-film-error" role="alert">{error}</p>}
    </Card>
    <p className="fn-film-disclosure">{film.disclosure}</p>
  </section>;
}
