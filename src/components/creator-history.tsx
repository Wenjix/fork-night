"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, ArrowUp, BookOpen, Check, FileText, GitBranch, LocateFixed, MessageCircle } from "lucide-react";
import { creativeAncestry, layoutCreatorHistory, type CreativeEvent } from "@/lib/creator-history";
import type { CreatorAgent } from "@/lib/creator-review";

const icons = { bible: BookOpen, scene: GitBranch, candidate: GitBranch, feedback: MessageCircle, brief: FileText };

export function CreatorTree({ agent, events, selectedId, onSelect }: { agent: CreatorAgent; events: CreativeEvent[]; selectedId: string; onSelect: (id: string) => void }) {
  const [availableWidth, setAvailableWidth] = useState(600);
  const nodeWidth = availableWidth < 460 ? 150 : 200;
  const { nodes, width, height } = layoutCreatorHistory(events, { nodeWidth, columnGap: nodeWidth === 150 ? 20 : 30, minimumWidth: Math.min(600, availableWidth) });
  const ancestry = creativeAncestry(events, selectedId);
  const scroller = useRef<HTMLDivElement>(null);
  const marker = useId().replaceAll(":", "");
  useEffect(() => {
    const element = scroller.current!;
    const resize = new ResizeObserver(() => setAvailableWidth(element.clientWidth));
    resize.observe(element);
    return () => resize.disconnect();
  }, []);
  function find() { scroller.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: "nearest", inline: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" }); }
  return <section className="creator-tree" aria-label={`${agent.name}’s creative story tree, growing upward`}>
    <div className="creator-tree-description"><span><ArrowUp size={16} />From instructions to possibilities</span><span>Chosen ancestry in violet</span></div>
    <div className="creator-tree-scroller" ref={scroller} tabIndex={0} role="region" aria-label="Scrollable creative tree">
      <div className="creator-tree-world" style={{ width, height }}><svg width={width} height={height} className="creator-tree-lines" aria-hidden="true"><defs><marker id={marker} markerWidth={8} markerHeight={8} refX={4} refY={4} orient="auto"><path d="M1 1 L7 4 L1 7" fill="none" stroke="currentColor" strokeWidth={1.5} /></marker></defs>
        {nodes.flatMap(node => node.event.parentIds.map(parentId => { const source = nodes.find(item => item.event.id === parentId)!; const active = ancestry.has(node.event.id) && ancestry.has(parentId); const end = node.y + 200; const mid = (source.y + end) / 2; return <path key={`${parentId}-${node.event.id}`} d={`M ${source.x} ${source.y} C ${source.x} ${mid}, ${node.x} ${mid}, ${node.x} ${end + 5}`} fill="none" stroke={active ? "var(--wd-link)" : "var(--wd-line)"} strokeWidth={active ? 2.5 : 1.5} markerEnd={`url(#${marker})`} />; }))}</svg>
        {nodes.map(({ event, x, y }) => { const Icon = icons[event.kind]; return <button key={event.id} className={`creator-tree-node ${event.status === "Discarded" ? "creator-tree-discarded" : ""}`} style={{ left: x - nodeWidth / 2, top: y, width: nodeWidth }} type="button" aria-pressed={selectedId === event.id} onClick={() => onSelect(event.id)}>
          {event.imageUrl ? <img src={event.imageUrl} alt="" width={200} height={92} /> : <div className="creator-tree-document"><Icon size={26} /><span>{event.kind === "bible" ? `v${event.bibleVersion}` : event.kind === "feedback" ? "Your direction" : "Next episode"}</span></div>}
          <span className="creator-tree-node-copy"><strong>{event.title}</strong><span className="creator-tree-status">{event.status === "Selected" && <Check size={12} />}{event.status}</span><small>{event.actor === "agent" ? `${agent.name} · AI agent` : event.prepared ? "Creator" : "You"} · {event.prepared ? "prepared" : "saved"}</small></span>
        </button>; })}
      </div>
    </div><div className="creator-tree-controls"><span>Discarded directions stay in the history</span><button className="wd-text-button" onClick={find}><LocateFixed size={16} />Find selected</button></div>
  </section>;
}

export function CreatorActivityLog({ agent, events, selectedId, onSelect }: { agent: CreatorAgent; events: CreativeEvent[]; selectedId: string; onSelect: (id: string) => void }) {
  const [filter, setFilter] = useState<"all" | "agent" | "human">("all");
  const shown = events.filter(event => filter === "all" || (filter === "agent" ? event.actor === "agent" : !event.prepared));
  return <section className="creator-activity-log" aria-label={`${agent.name}’s activity log`}><div className="creator-log-filters" role="group" aria-label="Filter activity">{([{ id: "all", label: "All activity" }, { id: "agent", label: "AI actions" }, { id: "human", label: "Your changes" }] as const).map(item => <button key={item.id} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}</button>)}</div>
    {shown.length ? <ol className="creator-log-entries">{shown.map(event => { const Icon = icons[event.kind]; return <li key={event.id}>
      <button type="button" id={`creator-log-${event.id}`} aria-pressed={selectedId === event.id} onClick={() => onSelect(event.id)}>
        <span className="creator-log-when">{event.createdAt ? <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time> : "Prepared example"}</span>
        <span className="creator-log-actor">{event.actor === "agent" ? <img src={agent.avatar} alt="" width={32} height={32} /> : <span><Icon size={16} /></span>}<span>{event.actor === "agent" ? agent.name : event.prepared ? "Creator" : "You"}<small>{event.actor === "agent" ? "AI agent" : "Human"}</small></span></span>
        <span className="creator-log-action"><strong>{event.title}</strong><span>{event.status}{event.bibleVersion !== undefined && event.kind !== "bible" && event.kind !== "brief" ? ` · bible v${event.bibleVersion}` : ""}</span></span><ArrowRight size={16} aria-hidden="true" />
      </button>
    </li>; })}</ol> : <div className="creator-log-empty"><MessageCircle size={24} /><h3>Your guidance starts here.</h3><p>Feedback, saved bible revisions and next briefs will appear as you review this creator.</p></div>}
  </section>;
}

export function CreatorEventInspector({ agent, event, onCompare, onBible, onLog }: { agent: CreatorAgent; event: CreativeEvent; onCompare: () => void; onBible: () => void; onLog: () => void }) {
  const candidate = agent.candidates.find(item => item.id === event.candidateId);
  return <section className="creator-event-inspector" aria-label="Selected creative event">
    {event.imageUrl && <img src={event.imageUrl} alt={event.description} width={600} height={338} />}
    <h3>{event.title}</h3><div className="creator-inspector-meta"><span>{event.actor === "agent" ? `${agent.name} · AI agent` : event.prepared ? "Creator · human" : "You · human"}</span><span>{event.prepared ? "Prepared example" : "Saved in this browser"}</span></div>
    <p className={event.kind === "bible" || event.kind === "brief" ? "creator-document" : ""}>{event.description}</p>
    {candidate && event.kind === "candidate" && <><h4>{candidate.status === "selected" ? "Why this was selected" : "Why this was discarded"}</h4><p>{candidate.rationale}</p><small>Recorded explanation · prepared example</small></>}
    {event.bibleVersion !== undefined && <p className="creator-inspector-version"><BookOpen size={15} />{event.kind === "bible" ? "Saved instructions" : "Instructions used"} · bible v{event.bibleVersion}</p>}
    <div className="creator-inspector-actions">{candidate && <button className="wd-button wd-yellow" onClick={onCompare}>Compare & give feedback <MessageCircle size={16} /></button>}{event.kind === "bible" && <button className="wd-button wd-outline" onClick={onBible}>Open creator bible <BookOpen size={16} /></button>}<button className="wd-text-button" onClick={onLog}>See in activity log <ArrowRight size={16} /></button></div>
  </section>;
}
