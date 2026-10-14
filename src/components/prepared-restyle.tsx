"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, RotateCcw, Sparkles, Wand2 } from "lucide-react";
import { BLADE_RUNNER_RESTYLE as restyle } from "@/lib/prepared-restyle";
import { StoryArt } from "./story-art";
import "@/app/prepared-restyle.css";

type Scene = { title: string; caption: string };

/** A replay of a prepared image-to-image restyle; it never contacts a provider. */
export function PreparedRestyle({ scenes, applied, onApply, onRestore }: {
  scenes: readonly Scene[];
  applied: boolean;
  onApply: () => void;
  onRestore: () => void;
}) {
  const [stage, setStage] = useState<"closed" | "choose" | "working" | "done">("closed");
  const [progress, setProgress] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (stage !== "working") return;
    const timer = setInterval(() => setProgress(value => {
      if (value >= restyle.frames.length) {
        clearInterval(timer);
        setStage("done");
        return value;
      }
      return value + 1;
    }), 700);
    return () => clearInterval(timer);
  }, [stage]);
  useEffect(() => { if (stage !== "closed") heading.current?.focus({ preventScroll: true }); }, [stage]);

  if (applied) return <div className="restyle-applied" role="status">
    <Check size={16} aria-hidden="true" />
    <span><strong>{restyle.style} restyle applied</strong> to this path’s three scenes. Captions and credits are unchanged.</span>
    <button type="button" className="text-button" onClick={() => { onRestore(); setStage("closed"); }}><RotateCcw size={14} aria-hidden="true" /> Restore original</button>
  </div>;

  if (stage === "closed") return <button type="button" className="button secondary full restyle-open" onClick={() => setStage("choose")}>
    <Wand2 size={17} aria-hidden="true" /> Restyle this path · image-to-image
  </button>;

  const before = (frame: number) => `${restyle.source}#frame=${frame}`;
  const after = (frame: number) => `${restyle.restyled}#frame=${frame}`;
  return <section className="restyle-panel" aria-labelledby="restyle-heading">
    <h3 id="restyle-heading" ref={heading} tabIndex={-1}><Sparkles size={17} aria-hidden="true" /> Restyle this path</h3>
    {stage === "choose" && <>
      <p>Redraw this fork’s three scenes in a new style. Each original image is the reference, so the people, places and framing carry over.</p>
      <ol className="restyle-sources">
        {restyle.frames.map((item, index) => <li key={item.frame}>
          <StoryArt src={before(item.frame)} description={scenes[index].caption} />
          <span>{scenes[index].title}</span>
        </li>)}
      </ol>
      <fieldset className="restyle-styles">
        <legend>Style</legend>
        <button type="button" aria-pressed="true">{restyle.style}</button>
      </fieldset>
      <p className="restyle-model">{restyle.model} · {restyle.provider} · image references</p>
      <button type="button" className="button primary full" onClick={() => { setProgress(0); setStage("working"); }}>
        <Wand2 size={17} aria-hidden="true" /> Restyle 3 scenes <ArrowRight size={16} aria-hidden="true" />
      </button>
      <button type="button" className="text-button restyle-cancel" onClick={() => setStage("closed")}>Cancel</button>
    </>}
    {stage === "working" && <div className="restyle-working" role="status">
      <p>Redrawing scene {Math.min(progress + 1, restyle.frames.length)} of {restyle.frames.length}…</p>
      <div className="restyle-bar" aria-hidden="true"><span style={{ width: `${(progress / restyle.frames.length) * 100}%` }} /></div>
    </div>}
    {stage === "done" && <>
      <p>Same story, redrawn. Compare each scene before you apply it.</p>
      <ol className="restyle-compare">
        {restyle.frames.map((item, index) => <li key={item.frame}>
          <span className="restyle-label">{scenes[index].title}</span>
          <div>
            <figure><StoryArt src={before(item.frame)} description={`Original: ${scenes[index].caption}`} /><figcaption>Original</figcaption></figure>
            <figure><StoryArt src={after(item.frame)} description={`${restyle.style}: ${scenes[index].caption}`} /><figcaption>{restyle.style}</figcaption></figure>
          </div>
        </li>)}
      </ol>
      <button type="button" className="button primary full" onClick={onApply}><Check size={17} aria-hidden="true" /> Apply to this path</button>
      <button type="button" className="text-button restyle-cancel" onClick={() => setStage("closed")}>Discard</button>
    </>}
    <p className="restyle-note">Prepared example: these restyles were generated on October 13, 2026 with {restyle.model} through {restyle.provider}, using the original images as references. Replaying them makes no provider request and uses no credits.</p>
  </section>;
}
