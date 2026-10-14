import { ArrowRight, Bird, Check, Code2, MoonStar, Play, ShieldCheck, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import {
  ARTICLE,
  CLOSE_HREFS,
  FLOW_KIMI,
  JOB_KEYS,
  KIMI_CODE_PATHS,
  KIMI_FACTS,
  KIMI_HREFS,
  KIMI_QUOTES,
  KIMI_QUOTES_ZH,
  KIMI_REQUEST,
  KIMI_VIDEO,
  LANG_STATUS_ID,
  LANG_STORAGE_KEY,
  LOCALE_TAG,
  fill,
  type ArticleCopy,
  type KimiVideo,
  type Locale,
} from "../../lib/kimi-article.ts";
import { LanguageToggle } from "./language-toggle.tsx";

/**
 * /kimi: the sponsor article about Kimi K3 in the Night Watch, in English and Simplified Chinese. Both
 * languages render on the server; CSS shows the one the root's data-lang names. The first child is a tiny
 * script that applies ?lang= (or the remembered choice) before anything paints, so a link with ?lang=zh
 * opens straight in Chinese. Without JavaScript the article reads in English.
 */

const LANG_BOOT = `(function(){try{var r=document.currentScript&&document.currentScript.parentElement;if(!r)return;var l="en";try{var s=window.localStorage.getItem(${JSON.stringify(LANG_STORAGE_KEY)});if(s==="zh"||s==="en")l=s}catch(e){}var q=new URLSearchParams(window.location.search).get("lang");if(q==="zh"||q==="en")l=q;r.setAttribute("data-lang",l);r.setAttribute("lang",l==="zh"?"zh-Hans":"en")}catch(e){}})();`;

const ANNOUNCE = { en: ARTICLE.en.toggle.announce, zh: ARTICLE.zh.toggle.announce };
const TOGGLE_LABEL = `${ARTICLE.en.toggle.label} · ${ARTICLE.zh.toggle.label}`;

/** Text that differs by language, for the header outside the two article trees. */
function Both({ pick }: { pick: (copy: ArticleCopy) => string }) {
  return <>
    <span className="km-locale" data-locale="en" lang="en">{pick(ARTICLE.en)}</span>
    <span className="km-locale" data-locale="zh" lang="zh-Hans">{pick(ARTICLE.zh)}</span>
  </>;
}

const money = (usd: string, approximate: boolean) => `${approximate ? "≈" : ""}$${usd}`;

/** The article's highlight: the walkthrough video, or a frame that says where it goes. */
export function VideoSlot({ video, copy }: { video: KimiVideo; copy: ArticleCopy }) {
  if (video?.kind === "file") {
    return <figure className="km-video">
      <video className="km-video-media" controls preload="metadata" playsInline poster={video.poster}>
        <source src={video.src} />
      </video>
    </figure>;
  }
  if (video?.kind === "link") {
    return <figure className="km-video">
      <a className="km-video-frame km-video-link" href={video.href} target="_blank" rel="noreferrer">
        <span className="km-play" aria-hidden="true"><Play size={30} /></span>
        <span className="km-video-text">{video.label}</span>
      </a>
    </figure>;
  }
  return <figure className="km-video">
    <div className="km-video-frame km-video-empty" role="img" aria-label={copy.hero.videoPlaceholder}>
      <span className="km-play" aria-hidden="true"><Play size={30} /></span>
      <span className="km-video-text">{copy.hero.videoPlaceholder}</span>
    </div>
  </figure>;
}

/**
 * Kimi's own words. In English they read as written. In Chinese the translation reads first and Kimi's
 * English original follows, smaller and labelled, so the evidence stays on the page.
 */
function Quote({ locale, en, zh, original, className = "", label }: { locale: Locale; en: string; zh: string; original: string; className?: string; label?: ReactNode }) {
  const classes = `km-quote ${className}`.trim();
  if (locale !== "zh") return <p className={classes}>{label}<span lang="en">{en}</span></p>;
  return <>
    <p className={classes}>{label}<span lang="zh-Hans">{zh}</span></p>
    <p className="km-original" lang="en"><span className="km-original-label" lang="zh-Hans">{original}</span><span>{en}</span></p>
  </>;
}

function Section({ id, title, intro, children }: { id: string; title: string; intro?: string; children: ReactNode }) {
  return <section className="km-section" aria-labelledby={id}>
    <header className="km-section-head">
      <h2 id={id}>{title}</h2>
      {intro && <p>{intro}</p>}
    </header>
    {children}
  </section>;
}

function LiveLabel({ copy }: { copy: ArticleCopy }) {
  return <span className="km-live">{fill(copy.wrote.live, copy)}</span>;
}

function CopilotMock({ copy, locale }: { copy: ArticleCopy; locale: Locale }) {
  const quote = KIMI_QUOTES.copilot;
  const zh = KIMI_QUOTES_ZH.copilot;
  const original = copy.wrote.originalLabel;
  return <figure className="km-mock km-copilot">
    <figcaption className="km-mock-head">
      <span className="km-mock-title"><Sparkles size={17} aria-hidden="true" />{copy.wrote.copilot.title}</span>
      <LiveLabel copy={copy} />
    </figcaption>
    <div className="km-mock-meta"><Quote locale={locale} original={original} en={quote.forkPoint} zh={zh.forkPoint} label={<span className="km-label">{copy.wrote.copilot.forkPointLabel}</span>} /></div>
    <div className="km-copilot-read">
      <p className="km-label">{copy.wrote.copilot.readLabel}</p>
      <Quote locale={locale} original={original} en={quote.read} zh={zh.read} />
    </div>
    <ol className="km-suggestions">
      {quote.suggestions.map((suggestion, index) => <li key={suggestion.brief}>
        <Quote locale={locale} original={original} className="km-suggestion-brief" en={suggestion.brief} zh={zh.suggestions[index].brief} />
        <Quote locale={locale} original={original} className="km-suggestion-why" en={suggestion.why} zh={zh.suggestions[index].why} label={<span className="km-label">{copy.wrote.copilot.whyLabel}</span>} />
      </li>)}
    </ol>
    <p className="km-callout"><Sparkles size={16} aria-hidden="true" /><span>{copy.wrote.copilot.callout}</span></p>
  </figure>;
}

function BrainMock({ copy, locale }: { copy: ArticleCopy; locale: Locale }) {
  const quote = KIMI_QUOTES.night;
  const zh = KIMI_QUOTES_ZH.night;
  const original = copy.wrote.originalLabel;
  const words = copy.wrote.night;
  return <figure className="km-mock km-brain">
    <figcaption className="km-mock-head">
      <span className="km-mock-title"><MoonStar size={17} aria-hidden="true" />{words.title}</span>
      <LiveLabel copy={copy} />
    </figcaption>
    <div className="km-mock-meta"><Quote locale={locale} original={original} en={quote.brief} zh={zh.brief} label={<span className="km-label">{words.briefLabel}</span>} /></div>
    <div className="km-brain-read">
      <p className="km-label">{words.readLabel}</p>
      <Quote locale={locale} original={original} en={quote.read} zh={zh.read} />
    </div>
    <ol className="km-takes">
      {quote.takes.map((take, index) => {
        const picked = index + 1 === KIMI_FACTS.pick;
        return <li key={take.caption} className="km-take" data-pick={picked || undefined}>
          {picked && <p className="km-pick"><Sparkles size={14} aria-hidden="true" />{words.pickBadge}</p>}
          <p className="km-take-label">{words.takeLabel} {index + 1}</p>
          <Quote locale={locale} original={original} className="km-take-caption" en={take.caption} zh={zh.takes[index].caption} />
          <Quote locale={locale} original={original} className="km-take-check" en={take.check} zh={zh.takes[index].check} label={<span className="km-label">{words.checkLabel}</span>} />
        </li>;
      })}
    </ol>
    <blockquote className="km-note">
      <p className="km-label">{words.noteLabel}</p>
      <Quote locale={locale} original={original} en={`“${quote.morningNote}”`} zh={`“${zh.morningNote}”`} />
    </blockquote>
    <p className="km-mock-foot">{words.note}</p>
  </figure>;
}

function WrenMock({ copy, locale }: { copy: ArticleCopy; locale: Locale }) {
  const quote = KIMI_QUOTES.wren;
  const zh = KIMI_QUOTES_ZH.wren;
  const original = copy.wrote.originalLabel;
  const words = copy.wrote.wren;
  return <figure className="km-mock km-wren">
    <figcaption className="km-mock-head">
      <span className="km-mock-title"><Bird size={17} aria-hidden="true" />{words.title}</span>
      <LiveLabel copy={copy} />
    </figcaption>
    <dl className="km-wren-facts">
      <div>
        <dt className="km-label">{words.ideaLabel}</dt>
        <dd><Quote locale={locale} original={original} en={quote.idea} zh={zh.idea} /></dd>
      </div>
      <div>
        <dt className="km-label">{words.titleLabel}</dt>
        <dd><Quote locale={locale} original={original} className="km-wren-title" en={quote.title} zh={zh.title} /></dd>
      </div>
      <div>
        <dt className="km-label">{words.captionsLabel}</dt>
        <dd>
          <ol className="km-wren-captions">
            {quote.captions.map((caption, index) => <li key={caption}>
              <Quote locale={locale} original={original} en={caption} zh={zh.captions[index]} />
            </li>)}
          </ol>
        </dd>
      </div>
    </dl>
    <p className="km-mock-foot">{words.note}</p>
  </figure>;
}

/** One language's whole article. Ids carry the locale, because both trees are in the page. */
export function ArticleBody({ locale }: { locale: Locale }) {
  const copy = ARTICLE[locale];
  const id = (name: string) => `km-${locale}-${name}`;
  return <article className="km-article km-locale" data-locale={locale} lang={LOCALE_TAG[locale]} aria-labelledby={id("title")}>
    <header className="km-hero">
      <h1 id={id("title")}>{copy.hero.title}</h1>
      <p className="km-dek">{copy.hero.dek}</p>
      <p className="km-byline"><span>{copy.hero.eyebrow}</span><span aria-hidden="true">·</span><span>{fill(copy.hero.byline, copy)}</span><span aria-hidden="true">·</span><span>{copy.hero.readTime}</span></p>
      <VideoSlot video={KIMI_VIDEO} copy={copy} />
    </header>

    <Section id={id("jobs")} title={copy.jobs.heading} intro={copy.jobs.intro}>
      <ul className="km-jobs">
        {JOB_KEYS.map((key) => {
          const words = copy.jobs[key];
          const facts = KIMI_FACTS.jobs[key];
          return <li key={key} className="km-job" data-job={key}>
            <h3>{words.name}</h3>
            <p className="km-job-when">{words.when}</p>
            <p className="km-job-does">{words.does}</p>
            <p className="km-job-waiting"><span className="km-label">{copy.jobs.waitingLabel}</span>{words.waiting}</p>
            <p className="km-job-metric">
              <strong>{facts.seconds} {copy.jobs.secondsUnit}</strong>
              <span>{money(facts.usd, facts.approximate)} {words.per}</span>
            </p>
            <p className="km-job-detail">{words.detail}</p>
          </li>;
        })}
      </ul>
    </Section>

    <Section id={id("flow")} title={copy.flow.heading} intro={copy.flow.intro}>
      <ol className="km-flow">
        {copy.flow.steps.map((step, index) => <li key={step.title} className="km-step" data-kimi={FLOW_KIMI[index] || undefined}>
          <span className="km-step-number" aria-hidden="true">{index + 1}</span>
          <p className="km-step-title">{step.title}</p>
          <p className="km-step-actor">{FLOW_KIMI[index] && <MoonStar size={13} aria-hidden="true" />}{step.actor}</p>
        </li>)}
      </ol>
    </Section>

    <Section id={id("wrote")} title={copy.wrote.heading} intro={copy.wrote.intro}>
      <div className="km-wrote">
        <CopilotMock copy={copy} locale={locale} />
        <BrainMock copy={copy} locale={locale} />
        <WrenMock copy={copy} locale={locale} />
      </div>
    </Section>

    <Section id={id("why")} title={copy.why.heading} intro={copy.why.intro}>
      <ul className="km-metrics">
        {copy.why.metrics.map((metric) => <li key={metric.label} className="km-metric">
          <p className="km-metric-value">{metric.value}</p>
          <p className="km-metric-label">{metric.label}</p>
          <p className="km-metric-sub">{metric.sub}</p>
        </li>)}
      </ul>
      <ul className="km-reasons">
        {copy.why.reasons.map((reason) => <li key={reason.title} className="km-reason">
          <h3>{reason.title}</h3>
          <p>{reason.body}</p>
        </li>)}
      </ul>
      <figure className="km-request">
        <figcaption>
          <p className="km-request-title"><Code2 size={17} aria-hidden="true" />{copy.why.requestHeading}</p>
          <p className="km-request-note">{copy.why.requestNote}</p>
        </figcaption>
        <pre lang="en"><code>{KIMI_REQUEST}</code></pre>
      </figure>
    </Section>

    <Section id={id("safe")} title={copy.safe.heading}>
      <ul className="km-checklist">
        {copy.safe.items.map((item) => <li key={item}><ShieldCheck size={18} aria-hidden="true" /><span>{item}</span></li>)}
      </ul>
    </Section>

    <Section id={id("honest")} title={copy.honest.heading}>
      <ul className="km-honest">
        {copy.honest.items.map((item) => <li key={item}><Check size={16} aria-hidden="true" /><span>{fill(item, copy)}</span></li>)}
      </ul>
    </Section>

    <Section id={id("close")} title={copy.close.heading}>
      <ul className="km-links">
        {copy.close.links.map((link, index) => <li key={link.label}>
          <a className="km-link-card" href={CLOSE_HREFS[index]}>
            <span className="km-link-label">{link.label}<ArrowRight size={17} aria-hidden="true" /></span>
            <span className="km-link-note">{link.note}</span>
          </a>
        </li>)}
      </ul>
      <div className="km-code">
        <p className="km-code-title">{copy.close.codeHeading}</p>
        <ul>
          {KIMI_CODE_PATHS.map((path, index) => <li key={path}><code lang="en">{path}</code><span>{copy.close.codeRoles[index]}</span></li>)}
        </ul>
      </div>
    </Section>
  </article>;
}

export function KimiArticle() {
  return <div className="kimi-page" data-lang="en" lang="en" suppressHydrationWarning>
    <script dangerouslySetInnerHTML={{ __html: LANG_BOOT }} />
    <a className="km-skip" href="#km-main"><Both pick={(copy) => copy.skip} /></a>
    <header className="km-header">
      <a className="km-brand" href={KIMI_HREFS.home}>Fork <span>Night</span></a>
      <nav className="km-nav" aria-label="Fork Night">
        <a href={KIMI_HREFS.rooms}><Both pick={(copy) => copy.nav.rooms} /></a>
        <a href={KIMI_HREFS.agents}><Both pick={(copy) => copy.nav.agents} /></a>
        <a href={KIMI_HREFS.nightWatch}><Both pick={(copy) => copy.nav.nightWatch} /></a>
        <a href={KIMI_HREFS.kimi} aria-current="page"><MoonStar size={15} aria-hidden="true" /><Both pick={(copy) => copy.nav.kimi} /></a>
      </nav>
      <LanguageToggle label={TOGGLE_LABEL} announce={ANNOUNCE} compact />
    </header>
    <main id="km-main" className="km-main">
      <ArticleBody locale="en" />
      <ArticleBody locale="zh" />
    </main>
    <p id={LANG_STATUS_ID} className="km-visually-hidden" role="status" aria-live="polite" />
  </div>;
}
