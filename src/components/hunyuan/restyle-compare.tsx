"use client";

import { useId, useState } from "react";
import { StoryArt } from "../story-art";

/** Drag to reveal the restyled frame over the original; both come from packaged sheets. */
export function RestyleCompare({ before, after, label, labels }: {
  before: string;
  after: string;
  label: string;
  labels: { original: string; restyled: string; control: string; value: (percent: number) => string };
}) {
  const [split, setSplit] = useState(50);
  const id = useId();
  return <figure className="hy-compare">
    <div className="hy-compare-stage">
      <StoryArt src={before} description={`${labels.original}: ${label}`} />
      <div className="hy-compare-after" style={{ clipPath: `inset(0 0 0 ${split}%)` }}>
        <StoryArt src={after} description={`${labels.restyled}: ${label}`} />
      </div>
      <span className="hy-compare-line" style={{ left: `${split}%` }} aria-hidden="true" />
      <span className="hy-compare-tag hy-compare-tag-left" aria-hidden="true">{labels.original}</span>
      <span className="hy-compare-tag hy-compare-tag-right" aria-hidden="true">{labels.restyled}</span>
    </div>
    <label htmlFor={id} className="hy-compare-control">
      <span className="hy-visually-hidden">{labels.control}</span>
      <input id={id} type="range" min={0} max={100} step={5} value={split} aria-valuetext={labels.value(split)} onChange={event => setSplit(Number(event.target.value))} />
    </label>
    <figcaption>{label}</figcaption>
  </figure>;
}
