"use client";

import { useState } from "react";
import { AppHeader } from "../app-header";
import { ArrowRight, BookOpen, Check, LoaderCircle, RefreshCw } from "lucide-react";
import { draftTemplate, worldLink } from "@/lib/world-demo/model";
import { useWorldDemo } from "@/lib/world-demo/use-world-demo";
import { Story, ReleaseView } from "./story";
import { WorkPanels } from "./panels";
import { ContributionEditor } from "./tasks";
import { RoomContext } from "./journey";
import { RoleIdentity } from "./identity";
import { DEMO_ROLES } from "@/lib/world-demo/roles";
import { AccountSwitcher } from "./accounts";

export type DemoController = ReturnType<typeof useWorldDemo>;

export function WorldDemo() {
  const demo = useWorldDemo();
  const { state, location, error, notice, busy, pending, loading } = demo;
  const landing = !state || !!location?.invite;
  return <div className="world-demo wd-night">
    <a className="wd-skip" href="#world-main">Skip to story</a>
    <AppHeader current="rooms">
      <div className="wd-account">{state && <><button className="wd-icon-button" onClick={() => void demo.refresh()} aria-label="Refresh shared work" disabled={busy}><RefreshCw size={20} /></button><AccountSwitcher demo={demo} /></>}</div>
    </AppHeader>
    <div className="wd-room-navigation">
      <a className="fn-context-link" href="/pilot">Shared rooms</a>
      <nav aria-label="Shared world">
        {state ? <>
          <button aria-current={location?.view === "story" ? "page" : undefined} onClick={() => demo.navigate("story")}>The room</button>
          {state.me.role !== "curator" && <button aria-current={location?.view === "my-work" || location?.view === "contribute" ? "page" : undefined} onClick={() => demo.navigate("my-work")}>My contribution</button>}
          {state.releases.length > 0 && <button aria-current={location?.view === "release" ? "page" : undefined} onClick={() => demo.navigate("release")}>Chapter 2</button>}
        </> : <><a href="#world-main" aria-current="page">After Hours</a><a href="#example-source">The idea</a></>}
        <a href="/creator-demo">Creator review</a>
      </nav>
    </div>
    <aside className="wd-disclosure" aria-label="Concept disclosure">
      <strong>Unofficial shared world · fictional participation</strong>
      <span>No affiliation with Mike Pondsmith, CD PROJEKT RED or R. Talsorian Games.</span>
    </aside>
    {(error || notice || pending) && <div className="wd-messages">
      {error && <p role="alert" className="wd-error">{error}</p>}
      {notice && <p role="status" className="wd-notice"><Check size={20} aria-hidden="true" />{notice}</p>}
      {pending && !busy && <div className="wd-recovery"><p>An action is waiting for its saved receipt. Check it before making another change.</p><button className="wd-button" onClick={() => void demo.send()}>Check saved action</button></div>}
    </div>}
    {landing ? (loading || (location?.runId && !location.invite)) ? <main id="world-main" className="wd-loading"><h1 tabIndex={-1}>{loading ? "Opening your room…" : "This room is private"}</h1><p>Your account is tied to the guest session in the browser where you joined.</p><button className="wd-button" onClick={() => void demo.refresh()}>Try loading again</button><a href="/world-demo">Back to the invitation</a></main> : <Invitation demo={demo} />
      : <main id="world-main" aria-busy={busy}>
        <RoomContext demo={demo} />
        {location?.view === "release" ? <ReleaseView demo={demo} />
          : location?.view === "contribute" && state.me.role !== "curator" ? <ContributionEditor key={state.me.id} demo={demo} />
          : <Story demo={demo} />}
      </main>}
    <footer className="wd-footer"><span>A contribution can become part of something bigger. Its maker stays visible.</span><span>Private room · prepared AI artwork · no live voting or payouts</span></footer>
  </div>;
}

function Invitation({ demo }: { demo: DemoController }) {
  const [accepted, setAccepted] = useState(false);
  const inviting = !!demo.location?.invite;
  const hosting = !inviting && demo.location?.seat === "curator";
  const name = demo.location?.seat === "continuing" ? "Kai" : "Mira";
  const entryRole = hosting ? "curator" : demo.location?.seat ?? "maker";
  const example = draftTemplate("maker");
  return <main id="world-main" className="wd-invitation">
    <section className="wd-hero" aria-labelledby="world-title">
      <img className="wd-hero-art" src="/world-demo/invitation-hero.webp" alt="Nika keeps her repair stall open in the rainy city." fetchPriority="high" width={1492} height={696} />
      <div className="wd-hero-copy">
        <h1 id="world-title" tabIndex={-1}>Night City<br />After Hours</h1>
        <p className="wd-hero-invitation">{entryRole === "continuing" ? <>Mira left a story open.<br />Kai, what happens next is up to you.</> : <>The city has a thousand stories.<br />Leave a little of yourself in one.</>}</p>
        <p className="wd-hero-description">{entryRole === "continuing" ? "Pick up Mira’s scene about a paper repair ledger. Add a panel, write your captions, and publish a continuation with your own byline." : "Nika repairs the things people leave behind. Give her neighborhood a memory. Someone else can carry it forward—with your name still attached."}</p>
        <div className="wd-entry">
          <div className="wd-entry-identity"><RoleIdentity role={entryRole} name={DEMO_ROLES[entryRole].name} prefix="You’ll enter as" detail={DEMO_ROLES[entryRole].part} /></div>
          <label className="wd-terms"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} /><span>I understand this is a fictional shared world. Published captions may be continued and included in its chapter with their example bylines. {inviting ? "I’m joining this invited account." : "Room accounts keep separate private drafts."} <a href="#rehearsal-terms">Room terms</a></span></label>
          <button className="wd-button wd-yellow" disabled={!accepted || demo.busy || !demo.ready} aria-busy={demo.busy || undefined} onClick={() => void demo.start()}>{demo.busy ? "Opening your room…" : hosting ? "Create a room" : `Enter the room as ${name}`}{demo.busy ? <LoaderCircle className="wd-spin" size={20} aria-hidden="true" /> : <ArrowRight size={20} aria-hidden="true" />}</button>
          {!inviting && demo.lastRun && <a className="wd-resume" href={worldLink(demo.lastRun, demo.location?.seat ?? "maker")}>Return to my room</a>}
        </div>
        <small>{hosting ? "You’ll host as the room curator and invite two makers." : "Prepared artwork, editable captions, your own contribution."}</small>
      </div>
    </section>
    <section className="wd-room-invitation">
      <img src="/world-demo/guild.webp" alt="A quiet couch, sleeping cat and lamplit desk overlooking the city." width={1036} height={244} loading="lazy" />
      <div><h2>There’s a place for you at Side Street.</h2><p>An example creative guild for the small stories between the big ones. Make a scene, see someone build on it, and find your part in the chapter.</p><p className="wd-imagined-host">Imagine Mike Pondsmith making the final selections.</p><small>Cyberpunk 2077 · imagined collaboration, not an announced program</small></div>
    </section>
    <section id="example-source" className="wd-example-source"><div><h2>One small detail can travel a long way.</h2><p>Mira introduces a handwritten repair ledger. Kai carries it into a scene where the network goes dark. The chapter keeps both contributions—and both names.</p><p className="wd-example-label">Prepared example · “Names We Keep” by Mira</p></div><WorkPanels panels={example.panels} compact /></section>
    <section className="wd-terms-detail" id="rehearsal-terms"><BookOpen size={24} aria-hidden="true" /><div><h2>Inside this room</h2><p>The main entrance opens a private room and joins you as Mira. Use the account menu at the top right to open another room account. Each account has its own guest session and private drafts. The room curator can publish the exact contributions together and open their film.</p><p>Drafts stay private. Publishing shares your captions with this room and allows their inclusion in its example chapter, with your recorded byline. Prepared AI artwork, characters, guild and participation are fictional. This grants no Cyberpunk license, official status or financial rights.</p><p>Use example captions and keep this browser to return to your account. Each invitation can be claimed once.</p><a className="wd-text-button" href={hosting ? "/world-demo" : "/world-demo?seat=curator"}>{hosting ? "Enter as a maker instead" : "Host a room for other people"}<ArrowRight size={16} aria-hidden="true" /></a></div></section>
  </main>;
}
