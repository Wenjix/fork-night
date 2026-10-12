"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, Download, GitBranch, Link as LinkIcon } from "lucide-react";
import { recognition, releaseText, worldLink, type Release } from "@/lib/world-demo/model";
import type { DemoController } from "./world-demo";
import { ContributionEditor, CuratorPanel, RehearsalSeats } from "./tasks";
import { JourneyPanel } from "./journey";
import { WorkPanels } from "./panels";
import { RoleIdentity } from "./identity";
import { ChapterFilm } from "./chapter-film";

export function Story({ demo }: { demo: DemoController }) {
  const state = demo.state!;
  const mine = state.works.find(w => w.maker_id === state.me.id);
  if (demo.location?.view === "my-work" && !mine && state.me.role !== "curator") return <ContributionEditor demo={demo} />;
  const source = state.works.find(w => w.role === "maker");
  const opening = state.works.find(w => w.role === "opening")!;
  const specified = demo.location?.workId ? state.works.find(w => w.id === demo.location!.workId) : undefined;
  if (demo.location?.workId && !specified) return <section className="wd-empty"><h1 tabIndex={-1}>This contribution isn’t in this rehearsal.</h1><button className="wd-button" onClick={() => demo.navigate("story")}>Back to the room</button></section>;
  const work = demo.location?.view === "my-work" && mine ? mine : specified ?? source ?? opening;
  const parent = state.works.find(w => w.id === work.parent_id);
  const seen = recognition(state, work.id);
  const isMine = work.maker_id === state.me.id;
  return <div className="wd-room-content">
    {seen.release && isMine && <section className="wd-recognition"><div><Check size={24} aria-hidden="true" /><div><h2>Your scene is in Chapter 2.</h2><p>Your original work and byline are part of the published chapter.</p></div></div><button className="wd-button wd-yellow" onClick={() => demo.navigate("release")}>See what you helped create <ArrowRight size={18} /></button></section>}
    <details className="wd-story-history"><summary>Story so far · {state.works.length} {state.works.length === 1 ? "scene" : "scenes"}</summary><ol>{state.works.map(w => <li key={w.id}><button aria-current={w.id === work.id ? "step" : undefined} onClick={() => demo.navigate("story", w.id)}><span>{w.title}</span><small>{w.role === "opening" ? "Prepared opening" : `by ${w.maker_label}`}</small></button></li>)}</ol></details>
    <div className="wd-story-layout">
      <article className="wd-reader"><h1 tabIndex={-1}>{work.title}</h1><p className="wd-byline">{work.role === "opening" ? work.maker_label : <RoleIdentity role={work.role} name={work.maker_label} prefix="by" detail={work.role === "maker" ? "Original contribution · Side Street" : "Continuation · Side Street"} />}</p>
        {state.me.role !== "curator" && !mine && (state.me.role === "maker" || source) && <button className="wd-button wd-yellow wd-reading-action" onClick={() => demo.navigate("contribute")}>{state.me.role === "maker" ? "Make your scene" : "Create Kai’s continuation"}<ArrowRight size={18} /></button>}
        {parent && work.role === "continuing" && <button className="wd-text-button wd-parent-link" onClick={() => demo.navigate("story", parent.id)}><GitBranch size={17} /> Continues “{parent.title}” by {parent.maker_label}</button>}
        <WorkPanels panels={work.panels} />
        <div className="wd-work-status">{seen.release ? <span><Check size={17} /> Included in {seen.release.snapshot.title}</span> : seen.selection ? <span>Selected for Chapter 2 · awaiting publication</span> : <span>{work.role === "opening" ? "The starting point for this room" : `Shared with Side Street · published by ${work.maker_label}`}</span>}</div>
        {seen.continuations.length > 0 && work.role !== "opening" && <section className="wd-peer"><GitBranch size={21} aria-hidden="true" /><div><h2>{seen.continuations[0].maker_label} continued this scene.</h2><p>The paper ledger has a new part to play.</p>{seen.continuations.map(child => <button key={child.id} className="wd-text-button" onClick={() => demo.navigate("story", child.id)}>Read “{child.title}” <ArrowRight size={17} /></button>)}</div></section>}
        <details className="wd-details"><summary>Source and credits</summary><p>{work.role === "opening" ? "This opening was prepared for the demo." : `Contribution by ${work.maker_label}. Prepared AI artwork with captions saved by this example maker.`}</p>{parent && <button className="wd-text-button" onClick={() => demo.navigate("story", parent.id)}>Read the exact source <ArrowRight size={17} /></button>}<p>Publishing preserves this version. A curator’s selection does not change its maker or make it an official Cyberpunk work.</p></details>
      </article>
      <aside className="wd-task-rail" aria-label={state.me.role === "curator" ? "Curator’s work" : "Your next moment"}>{state.me.role === "curator" ? <><CuratorPanel demo={demo} source={source} /><RehearsalSeats demo={demo} /></> : <JourneyPanel demo={demo} readingId={work.id} />}</aside>
    </div>
  </div>;
}

function saveFile(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ReleaseView({ demo }: { demo: DemoController }) {
  const [copied, setCopied] = useState("");
  const [showSource, setShowSource] = useState(false);
  const state = demo.state!;
  const release = state.releases[0];
  if (!release) return <section className="wd-empty"><h1 tabIndex={-1}>Chapter 2 is still taking shape.</h1><p>A selection becomes inclusion when the curator publishes a chapter containing the exact contribution.</p><button className="wd-button" onClick={() => demo.navigate("story")}>Back to the room <ArrowRight size={18} /></button></section>;
  const source = release.snapshot.works.find(w => w.id === release.source_id)!;
  const tip = release.snapshot.works.find(w => w.id === release.tip_id)!;
  async function copyLink() {
    try { await navigator.clipboard.writeText(new URL(worldLink(state.id, demo.location!.seat, "release"), window.location.origin).href); setCopied("Return link copied. It opens with your existing guest session."); }
    catch { setCopied("Copy this page’s address to keep a return link. It uses your existing guest session."); }
  }
  return <section className="wd-release">
    <button className="wd-text-button" onClick={() => demo.navigate("story", source.id)}><ArrowLeft size={17} /> Return to the original scene</button>
    <h1 tabIndex={-1}>A small detail. A shared story.</h1>
    <p className="wd-release-intro">When the network goes dark, the ledger brings people back together. See what the room made from one small idea.</p>
    <div className="wd-release-meta"><span><Check size={17} /> {release.snapshot.title}</span><span>Published in this private demo</span></div>
    <ChapterFilm key={release.id} release={release} onReadWork={id => demo.navigate("story", id)} />
    <div className="wd-included-credit"><div><p>Includes <strong>“{source.title}”</strong> by <strong>{source.maker_label}</strong></p><span>The original contribution stays attached to this chapter.</span></div><button className="wd-button wd-yellow" aria-expanded={showSource} aria-controls="chapter-source" onClick={() => setShowSource(value => !value)}>{showSource ? "Close the comparison" : `See ${source.maker_label}’s contribution`}<ArrowRight size={18} /></button></div>
    <div className={`wd-chapter-scenes ${showSource ? "wd-show-source" : ""}`}>
      <article className="wd-release-work"><h2>{tip.title}</h2><p className="wd-byline"><RoleIdentity role="continuing" name={tip.maker_label} prefix="Continued by" /></p><WorkPanels panels={tip.panels} /></article>
      <section id="chapter-source" className="wd-source-comparison" hidden={!showSource}><h2>{source.title}</h2><p className="wd-byline"><RoleIdentity role="maker" name={source.maker_label} prefix="Original contribution by" /></p><WorkPanels panels={source.panels} /><button className="wd-text-button" onClick={() => demo.navigate("story", source.id)}>Return to this contribution <ArrowRight size={17} /></button></section>
    </div>
    <div className="wd-editorial-reason"><h2>Why this detail stayed</h2><p>{release.snapshot.selectionReason}</p><span>Selected by {release.snapshot.curator.label} · fictional participation</span></div>
    <div className="wd-credit-strip"><div><span>Source contribution</span><strong>{source.maker_label}</strong><small>{source.title}</small></div><ArrowRight size={23} aria-hidden="true" /><div><span>Continued by</span><strong>{tip.maker_label}</strong><small>{tip.title}</small></div><div className="wd-curator-credit"><span>Curated by</span><strong>{release.snapshot.curator.label}</strong><small>Mike Pondsmith · imagined role only</small></div></div>
    <div className="wd-release-actions"><button className="wd-button" onClick={() => demo.navigate("story", source.id)}>Read the original contribution <ArrowRight size={18} /></button><button className="wd-button wd-outline" onClick={() => void copyLink()}><LinkIcon size={17} /> Copy my return link</button></div>
    {copied && <p className="wd-inline-status" role="status">{copied}</p>}
    <details className="wd-details wd-release-credits"><summary>How this was made · full credits</summary><ReleaseCredits release={release} /><div className="wd-downloads"><button className="wd-button wd-outline" onClick={() => saveFile("after-hours-credits.txt", releaseText(release), "text/plain")}><Download size={17} /> Download readable credits</button><button className="wd-button wd-outline" onClick={() => saveFile("after-hours-source-record.json", JSON.stringify(release, null, 2), "application/json")}><Download size={17} /> Download source record</button></div></details>
  </section>;
}
function ReleaseCredits({ release }: { release: Release }) {
  return <div className="wd-credit-detail"><p>The exact published versions below are preserved in this chapter’s record. Private drafts and prompts are not part of this record.</p><ol>{release.snapshot.works.map(work => <li key={work.id}><strong>{work.title}</strong><span>{work.maker_label} · {work.role === "opening" ? "prepared story opening" : "prepared AI artwork; contribution captions"}</span></li>)}</ol><p><strong>Curatorial selection:</strong> {release.snapshot.selectionReason}</p><p>Selection by {release.snapshot.curator.label}. “Imagine Mike Pondsmith making the final selections” describes the concept; he did not make this selection.</p><p>Published {new Date(release.created_at).toLocaleString()} · private concept terms {release.snapshot.termsVersion}.</p><p>Credits document the contribution path in this rehearsal. They do not establish IP ownership, official canon or earnings.</p></div>;
}
