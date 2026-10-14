"use client";

import { useId, useState } from "react";
import { ArrowRight, BookOpen, Check, RefreshCw } from "lucide-react";
import { FIRST_NIGHT_STARTERS, firstNightRoomHref } from "@/lib/first-night";
import { pilotBrowserClient } from "@/lib/supabase/pilot-client";
import { PilotImage } from "./pilot-panels";
import { StoryArt } from "./story-art";
import { useFirstNightStory } from "./use-first-night";

export function FirstNightInvitation({ variant = "lobby" }: { variant?: "lobby" | "rooms" }) {
  const titleId = useId();
  const starterName = useId();
  const [selected, setSelected] = useState<string>(FIRST_NIGHT_STARTERS[0].id);
  const { status, story, retry } = useFirstNightStory();
  const client = pilotBrowserClient();

  if (status !== "ready" || !story) {
    const loading = status === "loading";
    const message = loading
      ? "Finding the opening…"
      : status === "unconfigured"
        ? "Shared stories aren’t connected here yet."
        : status === "unavailable"
          ? "This shared story isn’t available to join right now."
          : "We couldn’t load the shared story.";
    return <section className="fn-first-invitation fn-first-invitation-pending" data-variant={variant} aria-labelledby={titleId} aria-busy={loading}>
      <div className="fn-first-pending-art"><StoryArt src="/art/midnight-story.webp#frame=3" description="A paper moon in a lamplit night, from Fork Night’s story illustrations." /><span>Fork Night story illustration</span></div>
      <div className="fn-first-invitation-copy"><h2 id={titleId}>Every story starts somewhere.</h2><p role="status">{message}</p>{!loading && <div className="fn-first-pending-actions"><button type="button" className="fn-first-secondary" onClick={retry}><RefreshCw size={17} aria-hidden="true" />Try again</button><a href={variant === "rooms" ? "#shared-directory" : "/pilot#shared-directory"}>Browse shared stories <ArrowRight size={17} aria-hidden="true" /></a></div>}</div>
    </section>;
  }

  const panel = story.panels[0];
  return <section className="fn-first-invitation" data-variant={variant} aria-labelledby={titleId}>
    <figure className="fn-first-opening">
      <a className="fn-first-opening-art" href={firstNightRoomHref()} aria-label={`Read the opening of ${story.title}`}>
        {client && <PilotImage client={client} panel={panel} allowRetry={false} />}
        <span className="fn-first-read-label"><BookOpen size={16} aria-hidden="true" />Read the opening</span>
      </a>
      <figcaption><h3>{story.title}</h3><p>{panel.caption}</p></figcaption>
    </figure>
    <div className="fn-first-invitation-copy">
      <h2 id={titleId}>What happens next?</h2>
      <p>Choose a spark, then make it yours in the shared room.</p>
      <fieldset className="fn-first-starters"><legend>Choose a starting idea</legend>{FIRST_NIGHT_STARTERS.filter(starter => starter.id !== "own").map(starter => <label className="fn-first-starter" key={starter.id} data-selected={selected === starter.id}>
        <input type="radio" name={starterName} value={starter.id} checked={selected === starter.id} onChange={() => setSelected(starter.id)} />
        <span className="fn-first-starter-dot" aria-hidden="true">{selected === starter.id && <span />}</span><span>{starter.label}</span>
      </label>)}
        <label className="fn-first-own" data-selected={selected === "own"}><input type="radio" name={starterName} value="own" checked={selected === "own"} onChange={() => setSelected("own")} /><span>{selected === "own" && <Check size={15} aria-hidden="true" />}Write my own idea</span></label>
      </fieldset>
      <a className="fn-first-continue" href={firstNightRoomHref(selected)}>Continue this story <ArrowRight size={20} aria-hidden="true" /></a>
      <p className="fn-first-reassurance">Read first. You can edit your idea before making a private preview.</p>
      <a className="fn-first-read-first" href={firstNightRoomHref()}>I’ll read the story first</a>
    </div>
  </section>;
}
