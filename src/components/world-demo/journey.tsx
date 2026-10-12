"use client";

import { ArrowRight, Check } from "lucide-react";
import { makerJourney } from "@/lib/world-demo/journey";
import { DEMO_ROLES } from "@/lib/world-demo/roles";
import type { DemoController } from "./world-demo";
import { RoleIdentity } from "./identity";

export function RoomContext({ demo }: { demo: DemoController }) {
  const journey = makerJourney(demo.state!);
  const member = demo.state!.me;
  const step = member.role === "curator" && journey.continuation && !journey.release ? 3 : journey.step;
  const labels = ["Make a scene", "Share it", "Continue the story", "Chapter review", "Published & credited"];
  return <div className="wd-room-context">
    <div className="wd-room-banner">
      <div><button className="wd-room-name" onClick={() => demo.navigate("story")}>Side Street</button><p>Night City After Hours <span>· a shared story room</span></p></div>
      <img src="/world-demo/guild.webp" alt="Side Street’s lamplit room, with books, plants and a sleeping cat." width={1036} height={244} />
    </div>
    <div className="wd-role-context" aria-label="Your role in this room">
      <RoleIdentity role={member.role} name={member.role === "curator" ? "Room curator" : member.label} prefix={member.role === "curator" ? "Your account" : "You’re creating as"} detail={DEMO_ROLES[member.role].action} />
    </div>
    <ol className="wd-journey" aria-label="From contribution to recognition">
      {labels.map((label, index) => <li key={label} aria-current={step === index ? "step" : undefined} className={journey.completed[index] && step !== index ? "wd-milestone-done" : ""}>
        <span className="wd-step-marker" aria-hidden="true">{journey.completed[index] && step !== index ? <Check size={14} /> : index + 1}</span><span>{label}</span>
      </li>)}
    </ol>
  </div>;
}

export function JourneyPanel({ demo, readingId }: { demo: DemoController; readingId: string }) {
  const state = demo.state!;
  const { source, continuation, selection, release } = makerJourney(state);
  const mine = state.works.find(work => work.maker_id === state.me.id);
  if (state.me.role === "continuing" && !mine) return <section className="wd-maker-note"><h2>Kai, make the next moment yours.</h2><p>{source ? "Start with the blackout scene. Add a panel, change the captions, and decide how the moment unfolds." : "Mira is making the first scene. Her draft stays private until she shares it."}</p><button className="wd-button wd-yellow" disabled={!source} onClick={() => demo.navigate("contribute")}>Create Kai’s continuation <ArrowRight size={18} /></button><small>Mira’s scene keeps her name. Your new scene carries yours.</small></section>;
  if (!source) return <section className="wd-maker-note"><h2>Give this place a memory.</h2><p>Nika keeps the things the city forgets. Introduce her paper repair ledger in a short scene that someone else can continue.</p><button className="wd-button wd-yellow" onClick={() => demo.navigate("contribute")}>Make your scene <ArrowRight size={18} /></button><small>Prepared artwork. Your captions. Your byline.</small></section>;
  return <section className="wd-maker-note">
    <h2>{release ? "You helped this story grow." : continuation ? "A detail worth carrying forward." : "Your scene belongs here."}</h2>
    <p>{release ? "The chapter keeps the source and continuation together, with each maker’s credit." : continuation ? `${continuation.maker_label} built on ${source.maker_label}’s scene. Follow the ledger into its next moment.` : "Your published scene keeps its byline. Kai can now pick it up and make the next moment."}</p>
    {release ? <button className="wd-button wd-yellow" onClick={() => demo.navigate("release")}>See it in Chapter 2 <ArrowRight size={18} /></button>
      : continuation ? <button className="wd-button wd-yellow" onClick={() => demo.navigate("story", readingId === continuation.id ? source.id : continuation.id)}>{readingId === continuation.id ? "Return to the original scene" : "Read Kai’s continuation"}<ArrowRight size={18} /></button>
        : <button className="wd-button wd-outline" disabled={demo.busy} onClick={() => void demo.refresh()}>Check for a continuation</button>}
    {selection && !release && <div className="wd-selection-note"><h3>Selected for Chapter 2</h3><p>{selection.reason}</p><small>Room curator · chapter awaiting publication</small></div>}
    {!selection && !release && <small>A scene can be continued before a curator selects it.</small>}
  </section>;
}
