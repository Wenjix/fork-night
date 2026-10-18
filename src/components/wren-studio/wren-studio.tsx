"use client";

import { ArrowLeft, ChevronRight, Dices, RotateCcw, Check } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { AppHeader } from "../app-header";
import { useWrenLook } from "./use-wren-look";
import {
  ACCESSORIES, DEFAULT_LOOK, FACES, NAME_LIMIT, PATTERNS, PRESETS, YARNS,
  cleanName, randomLook, type WrenLook, type YarnId,
} from "@/lib/wren-look";
import { WrenFigure } from "./wren-figure";

const TABS = [
  { id: "yarn", label: "Yarn" },
  { id: "pattern", label: "Pattern" },
  { id: "face", label: "Face" },
  { id: "accessory", label: "Accessory" },
] as const;
type TabId = (typeof TABS)[number]["id"];

function Swatches({ legend, value, onPick }: { legend: string; value: YarnId; onPick: (id: YarnId) => void }) {
  return <fieldset className="ws-swatches">
    <legend>{legend}</legend>
    <div>{YARNS.map(item => <label key={item.id} className="ws-swatch" style={{ "--ws-yarn": item.base, "--ws-yarn-shade": item.shade } as React.CSSProperties}>
      <input type="radio" name={legend} checked={value === item.id} onChange={() => onPick(item.id)} />
      <span className="ws-swatch-ball" aria-hidden="true" />
      <span>{item.label}</span>
    </label>)}</div>
  </fieldset>;
}

function Options<K extends "pattern" | "face" | "accessory">({ field, legend, list, look, onPick }: {
  field: K; legend: string; list: readonly { id: WrenLook[K]; label: string }[]; look: WrenLook; onPick: (value: WrenLook[K]) => void;
}) {
  const prefix = useId().replace(/:/g, "");
  return <fieldset className="ws-options">
    <legend>{legend}</legend>
    <div>{list.map(item => <label key={item.id} className="ws-option">
      <input type="radio" name={`${prefix}-${field}`} checked={look[field] === item.id} onChange={() => onPick(item.id)} />
      <span className="ws-option-thumb" aria-hidden="true"><WrenFigure look={{ ...look, [field]: item.id }} idPrefix={`${prefix}-${item.id}`} /></span>
      <span>{item.label}</span>
    </label>)}</div>
  </fieldset>;
}

/** The workbench: a live preview on a knitted mat and a game-style panel. `compact` fits it inside another page. */
export function WrenMaker({ compact = false }: { compact?: boolean }) {
  const { look, setLook } = useWrenLook();
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("yarn");
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

  return <div className={`ws-maker${compact ? " ws-maker-compact" : ""}`}>
    <div className="ws-workbench">
      <section className="ws-stage" aria-labelledby={`${ids}-preview`}>
        <h3 id={`${ids}-preview`} className="ws-visually-hidden">Preview</h3>
        <div className="ws-mat">
          <WrenFigure look={look} idPrefix={`${ids}-main`} className="ws-hero-figure" />
        </div>
        <p className="ws-tag" aria-live="polite"><span>{look.name}</span><small>AI agent · your Wren</small></p>
        <div className="ws-stage-actions">
          <button type="button" className="ws-button" onClick={() => apply(randomLook(look.name))}><Dices size={20} aria-hidden="true" />Surprise me</button>
          <button type="button" className="ws-button ws-button-quiet" onClick={() => apply(DEFAULT_LOOK)}><RotateCcw size={16} aria-hidden="true" />Start over</button>
        </div>
        <p className="ws-saved" role="status">{!mounted ? "" : persisted ? <><Check size={16} aria-hidden="true" />Saved in this browser</> : "This browser can’t save looks; your changes last until you leave."}</p>
      </section>

      <section className="ws-panel" aria-labelledby={`${ids}-make`}>
        <h3 id={`${ids}-make`} className="ws-visually-hidden">Customize</h3>
        <label className="ws-name">
          <span>Name</span>
          <input value={nameDraft ?? look.name} maxLength={NAME_LIMIT} autoComplete="off" spellCheck={false}
            onChange={event => { setNameDraft(event.target.value); update({ name: cleanName(event.target.value) }); }}
            onBlur={() => setNameDraft(null)} />
        </label>

        <div className="ws-presets" role="group" aria-label="Start from a preset">
          {PRESETS.map(preset => <button key={preset.label} type="button" className="ws-preset" onClick={() => apply({ ...preset.look, name: look.name })}>
            <span className="ws-preset-thumb" aria-hidden="true"><WrenFigure look={preset.look} idPrefix={`${ids}-${preset.label.replace(/\W/g, "")}`} /></span>
            <span>{preset.label}</span>
          </button>)}
        </div>

        <div className="ws-tabs" role="tablist" aria-label="Customize">
          {TABS.map((item, index) => <button key={item.id} ref={node => { tabs.current[index] = node; }} type="button" role="tab"
            id={`${ids}-tab-${item.id}`} aria-controls={`${ids}-panel-${item.id}`} aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1}
            onClick={() => setTab(item.id)} onKeyDown={event => onTabKey(event, index)}>{item.label}</button>)}
        </div>
        {TABS.map(item => <div key={item.id} role="tabpanel" id={`${ids}-panel-${item.id}`} aria-labelledby={`${ids}-tab-${item.id}`} hidden={tab !== item.id} className="ws-tabpanel">
          {item.id === "yarn" && <>
            <Swatches legend="Main yarn" value={look.yarn} onPick={value => update({ yarn: value })} />
            <Swatches legend="Trim yarn" value={look.accent} onPick={value => update({ accent: value })} />
          </>}
          {item.id === "pattern" && <Options field="pattern" legend="Pattern" list={PATTERNS} look={look} onPick={value => update({ pattern: value })} />}
          {item.id === "face" && <Options field="face" legend="Face" list={FACES} look={look} onPick={value => update({ face: value })} />}
          {item.id === "accessory" && <Options field="accessory" legend="Accessory" list={ACCESSORIES} look={look} onPick={value => update({ accessory: value })} />}
        </div>)}
      </section>
    </div>
  </div>;
}

/** A small, live picture of the maker's Wren, for other pages. */
export function WrenBadge({ className = "" }: { className?: string }) {
  const { look } = useWrenLook();
  const ids = useId().replace(/:/g, "");
  return <span className={`ws-badge ${className}`}><WrenFigure look={look} idPrefix={`${ids}-badge`} /><span>{look.name}</span></span>;
}

/** A game-style character maker for a maker's own Wren. Looks are saved only in this browser for now. */
export function WrenStudio() {
  return <div className="ws-page">
    <a className="ws-skip" href="#ws-main">Skip to the studio</a>
    <AppHeader current="agents" tone="paper" />
    <nav className="ws-crumb" aria-label="Breadcrumb">
      <a href="/agents"><ArrowLeft size={16} aria-hidden="true" />Meet the agents</a>
      <ChevronRight size={16} aria-hidden="true" />
      <span aria-current="page">Wren’s studio</span>
    </nav>
    <main id="ws-main" className="ws-main">
      <div className="ws-intro">
        <h1>Make your Wren</h1>
        <p>Every maker’s Wren can look like their own. Pick its yarn, pattern, face and one small accessory, then give it a name.</p>
      </div>
      <WrenMaker />
      <p className="ws-note">A first sketch. Your look stays in this browser and isn’t shown to anyone else yet. Later, a maker’s Wren could carry its look into the rooms it joins.</p>
    </main>
  </div>;
}
