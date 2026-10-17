"use client";

import { useId, useSyncExternalStore } from "react";
import { ArrowRight, Check, ChevronDown, EyeOff, Moon } from "lucide-react";
import { FIRST_NIGHT_ROOM_ID, firstNightRoomHref, type FirstNightResult } from "@/lib/first-night";
import { useFirstNightJourney } from "./use-first-night";

type FirstNightGuideProps = {
  roomId?: string;
  actorId?: string | null;
  compact?: boolean;
  /** The surface the guide sits on: `night` on navy pages, `paper` (the default) on cream ones. */
  tone?: "night" | "paper";
  activeStep?: 1 | 2 | 3;
  onRead?: () => void;
  onMake?: () => void;
  onFollow?: () => void;
};

const steps = [
  { title: "Join a story", description: "Read a beginning that sparks something." },
  { title: "Make your mark", description: "Add a twist, a continuation, or an idea." },
  { title: "See what you added", description: "Your byline. Your place in the story." },
];

// The width at which the page stylesheets switch to their phone layout.
const PHONE = "(max-width: 760px)";
const watchPhone = (notify: () => void) => {
  const query = window.matchMedia(PHONE);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
};
const onPhone = () => window.matchMedia(PHONE).matches;

export function firstNightContributionHref(roomId: string, result: FirstNightResult) {
  const params = new URLSearchParams({ room: roomId });
  const momentId = result.kind === "moment" ? result.id : result.parentId;
  if (momentId) params.set("moment", momentId);
  return `/pilot?${params}${result.kind === "idea" ? "#pilot-ideas" : ""}`;
}

export function FirstNightGuide({
  roomId = FIRST_NIGHT_ROOM_ID,
  actorId,
  compact: wantsCompact = false,
  tone = "paper",
  activeStep,
  onRead,
  onMake,
  onFollow,
}: FirstNightGuideProps) {
  const journey = useFirstNightJourney({ roomId, actorId });
  const detailsId = useId();
  // On a phone every page gets the compact bar. The server and the first client render keep the form the caller asked
  // for (the stylesheet already shows the full form as one row there), so hydration never moves the page.
  const phone = useSyncExternalStore(watchPhone, onPhone, () => false);
  const compact = wantsCompact || phone;
  // A selected screen may suggest the next task; only a saved result completes it.
  const step = journey.result ? 3 : activeStep === 1 || activeStep === 2 ? activeStep : journey.step === 3 ? 2 : journey.step;
  const completed = journey.result ? 3 : step - 1;
  const roomHref = roomId === FIRST_NIGHT_ROOM_ID
    ? firstNightRoomHref()
    : `/pilot?room=${encodeURIComponent(roomId)}`;
  const resultHref = journey.result ? firstNightContributionHref(roomId, journey.result) : roomHref;
  const makeHref = roomId === FIRST_NIGHT_ROOM_ID ? firstNightRoomHref("own") : roomHref;
  const expanded = !compact || journey.expanded;

  if (journey.hidden) {
    return <div className="fn-first-guide-reopen" data-tone={tone}><button type="button" onClick={journey.show}>
      <Moon size={16} aria-hidden="true" /> Your first night <ChevronDown size={16} aria-hidden="true" />
    </button></div>;
  }

  function stepContent(index: number) {
    const label = <><span className="fn-first-step-number" aria-hidden="true">{index < completed ? <Check size={16} /> : index + 1}</span><span><strong>{steps[index].title}</strong><span>{steps[index].description}</span></span></>;
    if (index === 0) return onRead
      ? <button className="fn-first-step-action" type="button" onClick={onRead}>{label}</button>
      : <a className="fn-first-step-action" href={roomHref}>{label}</a>;
    if (index === 1) return onMake
      ? <button className="fn-first-step-action" type="button" onClick={onMake}>{label}</button>
      : <a className="fn-first-step-action" href={makeHref}>{label}</a>;
    if (!journey.result) return <span className="fn-first-step-action">{label}</span>;
    return onFollow
      ? <button className="fn-first-step-action" type="button" onClick={onFollow}>{label}</button>
      : <a className="fn-first-step-action" href={resultHref}>{label}</a>;
  }

  return <section className="fn-first-guide" data-compact={compact} data-expanded={expanded} data-tone={tone} aria-label="Your first night guide">
    {compact ? <button className="fn-first-guide-toggle" type="button" aria-expanded={expanded} aria-controls={detailsId} onClick={() => journey.setExpanded(!journey.expanded)}>
      <ProgressMark completed={completed} />
      <span><strong>Your first night <span className="fn-first-guide-count">{step} of 3</span></strong><span>{steps[step - 1].title}</span></span>
      <ChevronDown className="fn-first-guide-chevron" size={16} aria-hidden="true" />
    </button> : <div className="fn-first-guide-intro"><ProgressMark completed={completed} /><span><strong>Your first night</strong><span>Read a little. Add something of your own.</span></span></div>}
    {expanded && <div className="fn-first-guide-details" id={detailsId}>
      <nav aria-label="First-night steps"><ol className="fn-first-steps">{steps.map((item, index) => <li key={item.title} data-state={index < completed ? "complete" : index + 1 === step ? "current" : "next"} aria-current={index + 1 === step ? "step" : undefined}>{stepContent(index)}</li>)}</ol></nav>
      {journey.result && <div className="fn-first-guide-result"><span><Check size={16} aria-hidden="true" />{journey.result.kind === "idea" ? "Your idea is part of the conversation." : "Your continuation is part of the story."}</span>{onFollow ? <button type="button" onClick={onFollow}>See your contribution <ArrowRight size={16} aria-hidden="true" /></button> : <a href={resultHref}>See your contribution <ArrowRight size={16} aria-hidden="true" /></a>}</div>}
    </div>}
    <button className="fn-first-guide-hide" type="button" onClick={journey.hide} aria-label="Hide first-night guide"><EyeOff size={16} aria-hidden="true" /><span>Hide guide</span></button>
  </section>;
}

function ProgressMark({ completed }: { completed: number }) {
  return <span className="fn-first-progress" aria-hidden="true"><svg viewBox="0 0 44 44" fill="none"><circle cx="22" cy="22" r="18" className="fn-first-progress-track" /><circle cx="22" cy="22" r="18" className="fn-first-progress-value" pathLength="3" strokeDasharray="3" strokeDashoffset={3 - completed} /></svg>{completed === 3 ? <Check size={16} /> : <Moon size={16} />}</span>;
}
