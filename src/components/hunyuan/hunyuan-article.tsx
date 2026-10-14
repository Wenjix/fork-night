"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Clapperboard, Coins, Film, GitBranch, Images, Layers, ShieldCheck, Timer, Wand2 } from "lucide-react";
import { BLADE_RUNNER_FILM as film } from "@/lib/prepared-story-film";
import { BLADE_RUNNER_RESTYLE as restyle } from "@/lib/prepared-restyle";
import { COPY, DEMO_VIDEO, LANGS, type Lang } from "./copy";
import { RestyleCompare } from "./restyle-compare";

const ROOM = "/#/project/blade-runner-memory";
const FILM = `${ROOM}/images-to-video`;
const STORAGE_KEY = "fork-night.hunyuan-lang";
const FLOW_ICONS = [GitBranch, Wand2, Layers, Film];
const STAT_ICONS = [Coins, Timer, Images, ShieldCheck];

function readLang(): Lang | null {
  const param = new URLSearchParams(window.location.search).get("lang");
  if (param === "zh" || param === "en") return param;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "zh" || saved === "en" ? saved : null;
  } catch {
    return null;
  }
}

export function HunyuanArticle({ hasVideo }: { hasVideo: boolean }) {
  const [lang, setLang] = useState<Lang>("en");
  useEffect(() => { const saved = readLang(); if (saved) setLang(saved); }, []);
  function choose(next: Lang) {
    setLang(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* the choice still applies to this visit */ }
    const url = new URL(window.location.href);
    url.searchParams.set("lang", next);
    window.history.replaceState(null, "", url);
  }
  const t = COPY[lang];
  const htmlLang = LANGS.find(item => item.id === lang)!.htmlLang;
  // The document follows the choice, so the tab title, translation prompts and screen readers agree.
  useEffect(() => {
    document.documentElement.lang = htmlLang;
    document.title = t.pageTitle;
    // Next streams the metadata title in after hydration; apply the chosen language once more after it.
    const again = setTimeout(() => { document.title = t.pageTitle; }, 400);
    return () => clearTimeout(again);
  }, [htmlLang, t.pageTitle]);

  return <main className="hy-page" lang={htmlLang}>
    <header className="hy-header">
      <a className="hy-brand" href="/">fork night</a>
      <div className="hy-header-actions">
        <div className="hy-lang" role="group" aria-label={`${COPY.en.languageLabel} / ${COPY.zh.languageLabel}`}>
          {LANGS.map(item => <button key={item.id} type="button" lang={item.htmlLang} aria-pressed={lang === item.id} onClick={() => choose(item.id)}>{item.label}</button>)}
        </div>
        <a className="hy-button hy-button-light" href={ROOM}>{t.tryRoom} <ArrowRight size={16} aria-hidden="true" /></a>
      </div>
    </header>

    <article>
      <section className="hy-hero">
        <h1>{t.title.map(phrase => <span key={phrase}>{phrase}</span>)}</h1>
        <p className="hy-byline">{t.byline}</p>
        <p className="hy-lede">{t.lede}</p>
        <figure className="hy-video">
          {hasVideo
            ? <video src={`/${DEMO_VIDEO}`} poster={film.poster} controls playsInline preload="metadata" aria-label={t.videoLabel} />
            : <div className="hy-video-placeholder" role="img" aria-label={t.videoSoon}>
                <img src={film.poster} alt="" width={720} height={720} />
                <span><Clapperboard size={22} aria-hidden="true" /> {t.videoSoon}</span>
              </div>}
          <figcaption>{t.videoCaption}</figcaption>
        </figure>
      </section>

      <section className="hy-section" aria-labelledby="hy-why">
        <h2 id="hy-why">{t.whyTitle}</h2>
        <p>{t.why}</p>
      </section>

      <section className="hy-section" aria-labelledby="hy-where">
        <h2 id="hy-where">{t.whereTitle}</h2>
        <ol className="hy-uses">
          <li>
            <span className="hy-step" aria-hidden="true">1</span>
            <h3>{t.uses[0].title}</h3>
            <p>{t.uses[0].text}</p>
            <div className="hy-strip">{film.images.map(image => <img key={image.frame} src={image.src} alt={image.caption} width={1024} height={1024} loading="lazy" />)}</div>
          </li>
          <li>
            <span className="hy-step" aria-hidden="true">2</span>
            <h3>{t.uses[1].title}</h3>
            <p>{t.uses[1].text}</p>
            <a className="hy-film" href={FILM}><img src={film.poster} alt="" width={720} height={720} loading="lazy" /><span><Film size={18} aria-hidden="true" /> {t.watchClip}</span></a>
          </li>
          <li>
            <span className="hy-step" aria-hidden="true">3</span>
            <h3>{t.uses[2].title}</h3>
            <p>{t.uses[2].text}</p>
            <div className="hy-compares">{restyle.frames.map((item, index) => <RestyleCompare key={item.frame} before={`${restyle.source}#frame=${item.frame}`} after={`${restyle.restyled}#frame=${item.frame}`} label={t.scenes[index]} labels={{ original: t.original, restyled: t.restyled, control: t.compareLabel(t.scenes[index]), value: t.compareValue }} />)}</div>
          </li>
        </ol>
      </section>

      <section className="hy-section" aria-labelledby="hy-flow">
        <h2 id="hy-flow">{t.flowTitle}</h2>
        <ol className="hy-flow">{t.flow.map(({ title, text }, index) => {
          const Icon = FLOW_ICONS[index];
          return <li key={index}>
            <span className="hy-flow-icon" aria-hidden="true"><Icon size={20} /></span>
            <span className="hy-flow-number">{t.step(index + 1)}</span>
            <h3>{title}</h3>
            <p>{text}</p>
          </li>;
        })}</ol>
      </section>

      <section className="hy-section" aria-labelledby="hy-value">
        <h2 id="hy-value">{t.valueTitle}</h2>
        <dl className="hy-stats">{t.stats.map(({ label, value, text }, index) => {
          const Icon = STAT_ICONS[index];
          return <div key={index}><dt><Icon size={18} aria-hidden="true" /> {label}</dt><dd>{value}</dd><dd className="hy-stat-note">{text}</dd></div>;
        })}</dl>
      </section>

      <section className="hy-cta" aria-labelledby="hy-cta">
        <h2 id="hy-cta">{t.ctaTitle}</h2>
        <p>{t.cta}</p>
        <a className="hy-button" href={ROOM}>{t.ctaButton} <ArrowRight size={16} aria-hidden="true" /></a>
      </section>

      <aside className="hy-notes" aria-labelledby="hy-notes">
        <h2 id="hy-notes">{t.notesTitle}</h2>
        <ul>{t.notes.map(note => <li key={note}>{note}</li>)}</ul>
      </aside>
    </article>
  </main>;
}
