"use client";

import { Dices, RotateCcw } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  ACCESSORIES, DEFAULT_LOOK, FACES, NAME_LIMIT, PATTERNS, PRESETS, YARNS,
  cleanName, randomLook, type WrenLook, type YarnId,
} from "@/lib/wren-look";
import { StoryArt } from "../story-art";
import { WrenFigure } from "./wren-figure";
import { useWrenLook } from "./use-wren-look";

const TABS = [
  { id: "looks", label: "Looks" },
  { id: "yarn", label: "Yarn" },
  { id: "pattern", label: "Pattern" },
  { id: "face", label: "Face" },
  { id: "accessory", label: "Extra" },
] as const;
type TabId = (typeof TABS)[number]["id"];

function Chips({ label, children }: { label: string; children: ReactNode }) {
  return <fieldset className="wh-chips"><legend>{label}</legend><div>{children}</div></fieldset>;
}

/**
 * The hero's illustrated card, turned into a character maker: the maker's Wren stands in the scene, and a compact
 * panel underneath changes its look. The scene's title plate is the page's h1: the Wren's name, then `byline`.
 */
export function WrenHeroMaker({ titleId, byline, sceneSrc, sceneDescription }: { titleId: string; byline: ReactNode; sceneSrc: string; sceneDescription: string }) {
  const { look, setLook } = useWrenLook();
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("looks");
  const [mounted, setMounted] = useState(false);
  const [persisted, setPersisted] = useState(true);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const ids = useId().replace(/:/g, "");
  useEffect(() => setMounted(true), []);

  const save = (next: WrenLook | ((current: WrenLook) => WrenLook)) => setPersisted(setLook(next));
  const update = (patch: Partial<WrenLook>) => save(current => ({ ...current, ...patch }));
  const apply = (next: WrenLook) => { save(next); setNameDraft(null); };

  function onTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + TABS.length) % TABS.length;
    setTab(TABS[next].id);
    tabs.current[next]?.focus();
  }

  const yarnRow = (legend: string, value: YarnId, pick: (id: YarnId) => void) => <Chips label={legend}>
    {YARNS.map(item => <label key={item.id} className="wh-yarn" title={item.label} style={{ "--wh-yarn": item.base, "--wh-yarn-shade": item.shade } as React.CSSProperties}>
      <input type="radio" name={`${ids}-${legend}`} checked={value === item.id} onChange={() => pick(item.id)} />
      <span aria-hidden="true" /><span className="wh-visually-hidden">{item.label}</span>
    </label>)}
  </Chips>;

  const optionRow = <K extends "pattern" | "face" | "accessory">(field: K, legend: string, list: readonly { id: WrenLook[K]; label: string }[]) => <Chips label={legend}>
    {list.map(item => <label key={item.id} className="wh-option">
      <input type="radio" name={`${ids}-${field}`} checked={look[field] === item.id} onChange={() => update({ [field]: item.id } as Partial<WrenLook>)} />
      <span className="wh-thumb" aria-hidden="true"><WrenFigure look={{ ...look, [field]: item.id }} idPrefix={`${ids}-${field}-${item.id}`} /></span>
      <span>{item.label}</span>
    </label>)}
  </Chips>;

  return <div className="nw-room-sign wh-card">
    <figure className="wh-scene">
      <StoryArt src={sceneSrc} description={sceneDescription} />
      <WrenFigure look={look} idPrefix={`${ids}-hero`} className="wh-wren" />
      <div className="nw-room-sign-title wh-title"><h1 id={titleId}>{look.name}<span className="nw-privy-title nw-tempo-title">{byline}</span></h1></div>
      <figcaption>Fork Night story illustration</figcaption>
    </figure>

    <section className="wh-panel" aria-labelledby={`${ids}-heading`}>
      <div className="wh-panel-top">
        <h2 id={`${ids}-heading`} className="wh-heading">Dress your Wren</h2>
        <div className="wh-actions">
          <button type="button" className="wh-icon" onClick={() => apply(randomLook(look.name))}><Dices size={17} aria-hidden="true" /><span>Surprise me</span></button>
          <button type="button" className="wh-icon wh-icon-quiet" onClick={() => apply(DEFAULT_LOOK)}><RotateCcw size={15} aria-hidden="true" /><span>Start over</span></button>
        </div>
      </div>
      <label className="wh-name"><span>Name</span>
        <input value={nameDraft ?? look.name} maxLength={NAME_LIMIT} autoComplete="off" spellCheck={false}
          onChange={event => { setNameDraft(event.target.value); update({ name: cleanName(event.target.value) }); }}
          onBlur={() => setNameDraft(null)} />
      </label>
      <div className="wh-tabs" role="tablist" aria-label="Customize your Wren">
        {TABS.map((item, index) => <button key={item.id} ref={node => { tabs.current[index] = node; }} type="button" role="tab"
          id={`${ids}-tab-${item.id}`} aria-controls={`${ids}-panel-${item.id}`} aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1}
          onClick={() => setTab(item.id)} onKeyDown={event => onTabKey(event, index)}>{item.label}</button>)}
      </div>
      {TABS.map(item => <div key={item.id} role="tabpanel" id={`${ids}-panel-${item.id}`} aria-labelledby={`${ids}-tab-${item.id}`} hidden={tab !== item.id} className="wh-tabpanel">
        {item.id === "looks" && <Chips label="Start from a look">
          {PRESETS.map(preset => <button key={preset.label} type="button" className="wh-option wh-preset" onClick={() => apply({ ...preset.look, name: look.name })}>
            <span className="wh-thumb" aria-hidden="true"><WrenFigure look={preset.look} idPrefix={`${ids}-p-${preset.label.replace(/\W/g, "")}`} /></span>
            <span>{preset.label}</span>
          </button>)}
        </Chips>}
        {item.id === "yarn" && <>{yarnRow("Main yarn", look.yarn, value => update({ yarn: value }))}{yarnRow("Trim yarn", look.accent, value => update({ accent: value }))}</>}
        {item.id === "pattern" && optionRow("pattern", "Pattern", PATTERNS)}
        {item.id === "face" && optionRow("face", "Face", FACES)}
        {item.id === "accessory" && optionRow("accessory", "Accessory", ACCESSORIES)}
      </div>)}
      <p className="wh-saved" role="status">{mounted ? persisted ? "Saved in this browser only." : "This browser can’t save looks; changes last until you leave." : ""}</p>
    </section>
  </div>;
}
