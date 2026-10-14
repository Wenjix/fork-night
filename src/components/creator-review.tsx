"use client";

import { useEffect, useRef, useState } from "react";
import { AgentRoomHeader } from "./agents/agent-room-header";
import { ArrowRight, BookOpen, Check, Copy, Download, GitBranch, MessageCircle, Save } from "lucide-react";
import { addCreatorFeedback, CREATOR_AGENTS, creatorReviewKey, initialCreatorReview, parseCreatorReview, prepareCreatorBrief, reviseCreatorBible, type CandidateId, type CreatorAgent, type CreatorReviewState } from "@/lib/creator-review";

import { creatorHistory } from "@/lib/creator-history";
import { CreatorActivityLog, CreatorEventInspector, CreatorTree } from "./creator-history";

type View = "compare" | "tree" | "activity" | "bible" | "brief";

export function CreatorReview() {
  const [agentId, setAgentId] = useState("nika");
  const agent = CREATOR_AGENTS.find(item => item.id === agentId)!;
  return <div className="world-demo creator-review">
    <a className="wd-skip" href="#creator-main">Skip to creator review</a>
    <AgentRoomHeader current="creator"><span className="creator-operator">You · creator operator</span></AgentRoomHeader>
    <main id="creator-main" className="creator-main">
      <div className="creator-space-heading"><h1>Your AI creators</h1><p>Follow each persona’s choices, then give the next story direction.</p></div>
      <div className="creator-workspace-layout"><aside className="creator-personas" aria-label="AI creator personas"><h2>AI agents</h2><div role="group" aria-label="Choose an AI creator">{CREATOR_AGENTS.map(item => <button type="button" key={item.id} aria-pressed={agentId === item.id} onClick={() => setAgentId(item.id)}><img src={item.avatar} alt="" width={48} height={48} /><span><strong>{item.name}</strong><small>{item.role}</small></span></button>)}</div><p>Prepared activity for two fictional agents. Your saved guidance stays with each persona.</p></aside><AgentReview key={agent.id} agent={agent} /></div>
    </main>
    <footer className="wd-footer"><span>From a creative choice to a visible consequence.</span><span>Fictional AI agents · prepared artwork · no external agent run</span></footer>
  </div>;
}

function AgentReview({ agent }: { agent: CreatorAgent }) {
  const candidates = agent.candidates;
  const storageKey = creatorReviewKey(agent);
  const [state, setState] = useState(() => initialCreatorReview(agent));
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>("compare");
  const [candidateId, setCandidateId] = useState<CandidateId>(candidates[0].id);
  const [feedback, setFeedback] = useState(agent.exampleFeedback);
  const [bibleDraft, setBibleDraft] = useState(agent.bible);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const bible = state.versions.at(-1)!;
  const brief = state.briefs.at(-1);
  const events = creatorHistory(agent, state);
  const [selectedEventId, setSelectedEventId] = useState(`candidate-${candidates[0].id}`);
  const selectedEvent = events.find(event => event.id === selectedEventId) ?? events[0];
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      const restored = raw ? parseCreatorReview(raw, agent) : initialCreatorReview(agent);
      setState(restored); setBibleDraft(restored.versions.at(-1)!.text); setReady(true);
    } catch (e) { setError(e instanceof Error ? e.message : "This browser could not read your saved review. Refresh to try again."); }
  }, [agent, storageKey]);
  function open(next: View) { setView(next); setNotice(""); window.scrollTo({ top: 0, behavior: "instant" }); requestAnimationFrame(() => heading.current?.focus({ preventScroll: true })); }
  function showActivity(id: string) {
    const eventId = ({ "creator-used-bible": "bible-1", "creator-explored-endings": "scene", "creator-recorded-choice": `candidate-${candidates[0].id}` } as Record<string, string>)[id] ?? id;
    setSelectedEventId(eventId); open("activity");
    requestAnimationFrame(() => document.getElementById(`creator-log-${eventId}`)?.scrollIntoView({ block: "nearest", behavior: "instant" }));
  }
  function save(next: CreatorReviewState, message: string) {
    if (!ready) return false;
    try { localStorage.setItem(storageKey, JSON.stringify(next)); setState(next); setNotice(message); setError(""); return true; }
    catch { setError("This browser could not save the change. Your text is still here; enable browser storage and try again."); return false; }
  }
  function addFeedback() {
    try { save(addCreatorFeedback(state, candidateId, feedback, crypto.randomUUID(), new Date().toISOString(), agent), "Your feedback is saved against this ending. The creator bible is still unchanged."); }
    catch (e) { setError((e as Error).message); }
  }
  function saveBible() {
    try { save(reviseCreatorBible(state, bibleDraft, new Date().toISOString()), `Bible v${bible.number + 1} saved. The prepared creation cycle still records v1.`); }
    catch (e) { setError((e as Error).message); }
  }
  function nextBrief() {
    try { if (save(prepareCreatorBrief(state, crypto.randomUUID(), new Date().toISOString(), agent), `Next brief prepared using bible v${bible.number}.`)) { setView("brief"); requestAnimationFrame(() => heading.current?.focus()); } }
    catch (e) { setError((e as Error).message); }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ example: "Prepared fictional creation cycle; no external agent or publication", agentId: agent.id, agentName: agent.name, usedBibleVersion: 1, candidates, ...state }, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${agent.id}-creative-history.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const added = bibleDraft.split("\n").filter(line => line.trim() && !bible.text.split("\n").includes(line));
  const removed = bible.text.split("\n").filter(line => line.trim() && !bibleDraft.split("\n").includes(line));
  return <section className="creator-agent-workspace" aria-label={`${agent.name}’s creative history`}>
      <div className="creator-heading"><img src={agent.avatar} alt={`${agent.name}, a fictional AI creator persona.`} width={80} height={80} /><div><h2>{agent.name}’s creative history</h2><p>{agent.role} · {agent.description}</p></div><button className="wd-text-button" onClick={download}><Download size={18} />Download record</button></div>
      <p className="creator-disclosure">Prepared AI creator activity · your feedback and bible edits save in this browser</p>
      <div className="creator-views" role="group" aria-label="Creator review view">{([{ id: "compare", label: "Compare endings" }, { id: "tree", label: "Story tree" }, { id: "activity", label: "Activity log" }, { id: "bible", label: `Creator bible · v${bible.number}` }, ...(brief ? [{ id: "brief", label: "Next brief" }] : [])] as { id: View; label: string }[]).map(item => <button key={item.id} aria-pressed={view === item.id} onClick={() => open(item.id)}>{item.label}</button>)}</div>
      {error && <p className="wd-error" role="alert">{error}</p>}{notice && <p className="wd-notice" role="status"><Check size={18} />{notice}</p>}
      {view === "compare" ? <>
        <div className="creator-task"><h2 ref={heading} tabIndex={-1}>{agent.compareTitle}</h2><p>Brief: {agent.brief} <button className="wd-text-button" onClick={() => open("activity")}>Used bible v1 <BookOpen size={15} /></button></p></div>
        <ol className="creator-cycle-strip" aria-label="Prepared creation cycle"><li><button onClick={() => showActivity("creator-used-bible")}><BookOpen size={18} /><span><strong>Bible v1</strong><small>Used in this cycle</small></span></button></li><li><button onClick={() => showActivity("creator-explored-endings")}><GitBranch size={18} /><span><strong>Two endings</strong><small>Explored</small></span></button></li><li><button onClick={() => showActivity("creator-recorded-choice")}><Check size={18} /><span><strong>{agent.selectedLabel}</strong><small>{agent.discardedLabel}</small></span></button></li></ol>
        <div className="creator-review-layout"><div className="creator-alternatives">{candidates.map(candidate => <article key={candidate.id} className="creator-alternative"><img src={candidate.imageUrl} alt={candidate.caption} width={1200} height={675} /><div className="creator-ending-title"><h3>{candidate.title}</h3><span className={`creator-decision creator-${candidate.status}`}>{candidate.status === "selected" ? <Check size={15} /> : <GitBranch size={15} />}{candidate.status === "selected" ? "Selected" : "Discarded"}</span></div><p className="creator-caption">{candidate.caption}</p><details><summary>{candidate.status === "selected" ? "Why the example agent chose this" : "Why the example agent set this aside"}</summary><p>{candidate.rationale}</p><small>Recorded explanation in this prepared example</small></details><button className="wd-text-button" onClick={() => { setCandidateId(candidate.id); document.getElementById("creator-feedback")?.focus(); }}>Give feedback on this ending <MessageCircle size={16} /></button></article>)}</div>
          <aside className="creator-feedback" aria-labelledby="creator-feedback-title"><h2 id="creator-feedback-title">Your direction matters.</h2><p>Attach a note to the ending you’re reviewing. Decide what belongs in the bible afterward.</p><form onSubmit={event => { event.preventDefault(); addFeedback(); }}><label htmlFor="creator-target">Feedback on</label><select id="creator-target" value={candidateId} onChange={event => setCandidateId(event.target.value as CandidateId)}>{candidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}</select><label htmlFor="creator-feedback">Your feedback · editable example</label><textarea id="creator-feedback" value={feedback} onChange={event => setFeedback(event.target.value)} maxLength={1000} rows={6} required /><button className="wd-button wd-yellow" disabled={!ready || !feedback.trim()} type="submit"><MessageCircle size={17} />Save feedback</button></form>
            {state.feedback.length > 0 && <div className="creator-notes"><h3>Feedback saved</h3>{state.feedback.slice(-2).map(note => <blockquote key={note.id}><p>{note.text}</p><footer>You · {candidates.find(candidate => candidate.id === note.candidateId)!.title}</footer></blockquote>)}<button className="wd-text-button" onClick={() => open("bible")}>Turn a lesson into a bible revision <ArrowRight size={16} /></button></div>}
          </aside></div>
      </> : view === "tree" || view === "activity" ? <section className="creator-observation"><div className="creator-task"><h2 ref={heading} tabIndex={-1}>{view === "tree" ? "Every direction leaves a branch." : "The actions behind the story."}</h2><p>{view === "tree" ? "Follow the instructions, opening and alternatives. Select a node to inspect what happened." : "Prepared AI actions and your saved guidance, connected to the same story tree."}</p></div><div className="creator-observation-layout">
        {view === "tree" ? <CreatorTree agent={agent} events={events} selectedId={selectedEvent.id} onSelect={setSelectedEventId} /> : <CreatorActivityLog agent={agent} events={events} selectedId={selectedEvent.id} onSelect={setSelectedEventId} />}
        <CreatorEventInspector agent={agent} event={selectedEvent} onCompare={() => { if (selectedEvent.candidateId) setCandidateId(selectedEvent.candidateId); open("compare"); }} onBible={() => open("bible")} onLog={() => showActivity(selectedEvent.id)} />
      </div></section> : view === "bible" ? <section className="creator-bible"><div className="creator-task"><h2 ref={heading} tabIndex={-1}>The creator bible is yours to write.</h2><p>Feedback stays a note until you decide to make it a rule.</p></div><div className="creator-bible-layout"><div><label htmlFor="creator-bible-text">Draft a revision to bible v{bible.number}</label><textarea id="creator-bible-text" className="creator-bible-text" value={bibleDraft} onChange={event => setBibleDraft(event.target.value)} maxLength={6000} rows={15} /><button className="wd-text-button" onClick={() => setBibleDraft(current => `${current}\n\nLesson\n${agent.exampleLesson}`)}>Add an editable example lesson <ArrowRight size={16} /></button><div className="creator-bible-actions"><button className="wd-button wd-yellow" disabled={!ready || !bibleDraft.trim() || bibleDraft.trim() === bible.text} onClick={saveBible}><Save size={18} />Save bible v{bible.number + 1}</button><button className="wd-button wd-outline" disabled={!ready || bibleDraft.trim() !== bible.text} onClick={nextBrief}>Prepare next brief <ArrowRight size={18} /></button></div></div><aside className="creator-bible-history"><h3>Review your changes</h3>{added.length || removed.length ? <div className="creator-bible-diff">{removed.map((line, i) => <p key={`removed-${i}`} className="creator-removed"><span>Removed</span>{line}</p>)}{added.map((line, i) => <p key={`added-${i}`} className="creator-added"><span>Added</span>{line}</p>)}</div> : <p>No unsaved changes.</p>}<h3>Version history</h3>{state.versions.slice().reverse().map(version => <details key={version.number}><summary>Bible v{version.number} · {version.number === 1 ? "used in prepared cycle" : "saved by you"}</summary><p className="creator-document">{version.text}</p><small>{version.feedbackIds.length} feedback notes available at this revision</small></details>)}{state.feedback.length > 0 && <><h3>Your feedback</h3>{state.feedback.slice(-2).map(note => <blockquote key={note.id}><p>{note.text}</p><footer>You · {candidates.find(candidate => candidate.id === note.candidateId)!.title}</footer></blockquote>)}</>}</aside></div></section>
        : <section className="creator-next-brief"><h2 ref={heading} tabIndex={-1}>A new brief, with your guidance.</h2><p>Prepared from your saved bible v{brief!.bibleVersion} and {brief!.feedbackIds.length} human feedback {brief!.feedbackIds.length === 1 ? "note" : "notes"}. Ready to give to your creator.</p><p className="creator-disclosure">Brief prepared locally · generation and external publishing have not run</p><p className="creator-document">{brief!.text}</p><button className="wd-button wd-yellow" onClick={async () => { try { await navigator.clipboard.writeText(brief!.text); setNotice("Next brief copied."); } catch { setError("Copy did not work. Select the brief text above, or download the record."); } }}><Copy size={18} />Copy next brief</button><button className="wd-text-button" onClick={() => open("activity")}>See the creative history <ArrowRight size={17} /></button></section>}
  </section>;
}
