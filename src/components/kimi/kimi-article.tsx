import { ArrowRight, Bird, Check, ChevronDown, Code2, Image, ListChecks, LockKeyhole, MoonStar, Play, ShieldCheck, Sparkles, Sunrise } from "lucide-react";
import type { ReactNode } from "react";
import { BRANDS, type BrandId } from "../../lib/brands.ts";
import { BrandBadge, BrandTile } from "../brand-badge.tsx";
import { ForkNightMark } from "../fork-night-mark.tsx";
import { ArticleLinks } from "./article-links.tsx";
import {
  ARTICLE,
  CLOSE_HREFS,
  FLOW_KIMI,
  JOB_KEYS,
  KIMI_CODE_PATHS,
  KIMI_DESK_BASELINE_SECONDS,
  KIMI_FACTS,
  KIMI_HREFS,
  KIMI_QUOTES,
  KIMI_QUOTES_ZH,
  KIMI_REQUEST,
  KIMI_VIDEO,
  LANG_STATUS_ID,
  LANG_STORAGE_KEY,
  LOCALE_TAG,
  PAGE_TITLE,
  YOUTUBE_ORIGIN,
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
 * opens straight in Chinese. It also sets the document's language and tab title, and remembers a ?lang=
 * choice so the page's own links keep it. Without JavaScript the article reads in English.
 */

const LANG_BOOT = `(function(){try{var r=document.currentScript&&document.currentScript.parentElement;if(!r)return;var l="en";try{var s=window.localStorage.getItem(${JSON.stringify(LANG_STORAGE_KEY)});if(s==="zh"||s==="en")l=s}catch(e){}var q=new URLSearchParams(window.location.search).get("lang");if(q==="zh"||q==="en"){l=q;try{window.localStorage.setItem(${JSON.stringify(LANG_STORAGE_KEY)},q)}catch(e){}}var g=l==="zh"?"zh-Hans":"en";r.setAttribute("data-lang",l);r.setAttribute("lang",g);document.documentElement.lang=g;document.title=${JSON.stringify(PAGE_TITLE)}[l]}catch(e){}})();`;

/** Runs right after the toggle is parsed, so its pressed state names the boot script's language before hydration. */
const PRESSED_BOOT = `(function(){try{var r=document.currentScript&&document.currentScript.closest(".kimi-page");if(!r)return;var l=r.getAttribute("data-lang")==="zh"?"zh-Hans":"en";r.querySelectorAll(".km-toggle button").forEach(function(b){b.setAttribute("aria-pressed",String(b.getAttribute("lang")===l))})}catch(e){}})();`;

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
const JOB_ICONS = { desk: Sparkles, night: MoonStar, wren: Bird };
const FLOW_ICONS = [Sparkles, LockKeyhole, MoonStar, ShieldCheck, ListChecks, Image, Sunrise];

/**
 * A short credit line whose tool names are drawn as badges. The words around the names stay text and keep their
 * order, so the line reads the same in both languages; only the names named in `brands` change shape.
 */
function Credit({ text, brands }: { text: string; brands: readonly BrandId[] }) {
  const names = brands.map((id) => BRANDS[id].name);
  const parts = text.split(new RegExp(`(${names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`));
  return <>{parts.map((part, index) => {
    const id = brands.find((item) => BRANDS[item].name === part);
    return id ? <BrandBadge key={index} brand={id} /> : part.trim() ? <span key={index}>{part.trim()}</span> : null;
  })}</>;
}

function Details({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return <details className={`km-details ${className}`.trim()}>
    <summary>{label}<ChevronDown size={16} aria-hidden="true" /></summary>
    <div className="km-details-body">{children}</div>
  </details>;
}

/** The article's highlight: the walkthrough video, or a frame that says where it goes. */
export function VideoSlot({ video, copy }: { video: KimiVideo; copy: ArticleCopy }) {
  if (video?.kind === "file") {
    return <figure className="km-video">
      <video className="km-video-media" controls preload="metadata" playsInline poster={video.poster}>
        <source src={video.src} />
      </video>
    </figure>;
  }
  if (video?.kind === "youtube") {
    // The page sends no referrer; YouTube's player needs one, so the frame sets its own policy. enablejsapi lets
    // the language toggle pause this player when its language is hidden.
    return <figure className="km-video">
      <iframe className="km-video-media" src={`${YOUTUBE_ORIGIN}/embed/${encodeURIComponent(video.id)}?rel=0&enablejsapi=1`}
        title={copy.hero.videoLabel} loading="lazy" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" />
      <figcaption className="km-video-caption">
        <a href={video.href} target="_blank" rel="noreferrer">{copy.hero.videoLabel}<ArrowRight size={16} aria-hidden="true" /></a>
      </figcaption>
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
 * Translations read first; the verbatim English stays available without doubling the reading length.
 */
function Quote({ locale, en, zh, original, className = "", label }: { locale: Locale; en: string; zh: string; original: string; className?: string; label?: ReactNode }) {
  const classes = `km-quote ${className}`.trim();
  if (locale !== "zh") return <p className={classes}>{label}<span lang="en">{en}</span></p>;
  return <>
    <p className={classes}>{label}<span lang="zh-Hans">{zh}</span></p>
    <Details label={original} className="km-translation">
      <p className="km-original" lang="en"><span className="km-original-label" lang="zh-Hans">{original}</span><span>{en}</span></p>
    </Details>
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
      <span className="km-mock-title"><Sparkles size={20} aria-hidden="true" />{copy.wrote.copilot.title}</span>
      <LiveLabel copy={copy} />
    </figcaption>
    <blockquote className="km-spotlight-quote">
      <Quote locale={locale} original={original} en={quote.suggestions[0].brief} zh={zh.suggestions[0].brief} />
    </blockquote>
    <p className="km-callout"><Sparkles size={16} aria-hidden="true" /><span>{copy.wrote.copilot.callout}</span></p>
    <Details label={copy.reading.copilotDetails}>
      <div className="km-mock-meta"><Quote locale={locale} original={original} en={quote.forkPoint} zh={zh.forkPoint} label={<span className="km-label">{copy.wrote.copilot.forkPointLabel}</span>} /></div>
      <div className="km-copilot-read">
        <p className="km-label">{copy.wrote.copilot.readLabel}</p>
        <Quote locale={locale} original={original} en={quote.read} zh={zh.read} />
      </div>
      <Quote locale={locale} original={original} className="km-suggestion-why" en={quote.suggestions[0].why} zh={zh.suggestions[0].why} label={<span className="km-label">{copy.wrote.copilot.whyLabel}</span>} />
      <ol className="km-suggestions" start={2}>
        {quote.suggestions.slice(1).map((suggestion, index) => <li key={suggestion.brief}>
          <Quote locale={locale} original={original} className="km-suggestion-brief" en={suggestion.brief} zh={zh.suggestions[index + 1].brief} />
          <Quote locale={locale} original={original} className="km-suggestion-why" en={suggestion.why} zh={zh.suggestions[index + 1].why} label={<span className="km-label">{copy.wrote.copilot.whyLabel}</span>} />
        </li>)}
      </ol>
    </Details>
  </figure>;
}

function BrainMock({ copy, locale }: { copy: ArticleCopy; locale: Locale }) {
  const quote = KIMI_QUOTES.night;
  const zh = KIMI_QUOTES_ZH.night;
  const original = copy.wrote.originalLabel;
  const words = copy.wrote.night;
  return <figure className="km-mock km-brain">
    <figcaption className="km-mock-head">
      <span className="km-mock-title"><MoonStar size={20} aria-hidden="true" />{words.title}</span>
      <LiveLabel copy={copy} />
    </figcaption>
    <div className="km-mock-meta"><Quote locale={locale} original={original} en={quote.brief} zh={zh.brief} label={<span className="km-label">{words.briefLabel}</span>} /></div>
    <ol className="km-takes">
      {quote.takes.map((take, index) => {
        const picked = index + 1 === KIMI_FACTS.pick;
        return <li key={take.caption} className="km-take" data-pick={picked || undefined}>
          <div className="km-take-heading">
            <p className="km-take-label">{words.takeLabel} {index + 1}</p>
            {picked && <p className="km-pick"><Check size={16} aria-hidden="true" />{words.pickBadge}</p>}
          </div>
          <Quote locale={locale} original={original} className="km-take-caption" en={take.caption} zh={zh.takes[index].caption} />
          <p className="km-verdict">{picked ? <Check size={16} aria-hidden="true" /> : <ListChecks size={16} aria-hidden="true" />}{copy.reading.verdicts[index]}</p>
        </li>;
      })}
    </ol>
    <p className="km-mock-foot">{words.note}</p>
    <Details label={copy.reading.nightDetails}>
      <div className="km-brain-read">
        <p className="km-label">{words.readLabel}</p>
        <Quote locale={locale} original={original} en={quote.read} zh={zh.read} />
      </div>
      <ol className="km-self-checks">
        {quote.takes.map((take, index) => <li key={take.check}>
          <p className="km-label">{words.takeLabel} {index + 1} · {words.checkLabel}</p>
          <Quote locale={locale} original={original} className="km-take-check" en={take.check} zh={zh.takes[index].check} />
        </li>)}
      </ol>
      <blockquote className="km-note">
        <p className="km-label">{words.noteLabel}</p>
        <Quote locale={locale} original={original} en={`“${quote.morningNote}”`} zh={`“${zh.morningNote}”`} />
      </blockquote>
    </Details>
  </figure>;
}

function WrenMock({ copy, locale }: { copy: ArticleCopy; locale: Locale }) {
  const quote = KIMI_QUOTES.wren;
  const zh = KIMI_QUOTES_ZH.wren;
  const original = copy.wrote.originalLabel;
  const words = copy.wrote.wren;
  return <figure className="km-mock km-wren">
    <figcaption className="km-mock-head">
      <span className="km-mock-title"><Bird size={20} aria-hidden="true" />{words.title}</span>
      <LiveLabel copy={copy} />
    </figcaption>
    <dl className="km-wren-facts">
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
    <Details label={copy.reading.wrenDetails}>
      <Quote locale={locale} original={original} en={quote.idea} zh={zh.idea} label={<span className="km-label">{words.ideaLabel}</span>} />
    </Details>
  </figure>;
}

/** One language's whole article. Ids carry the locale, because both trees are in the page. */
export function ArticleBody({ locale }: { locale: Locale }) {
  const copy = ARTICLE[locale];
  const id = (name: string) => `km-${locale}-${name}`;
  return <article className="km-article km-locale" data-locale={locale} lang={LOCALE_TAG[locale]} aria-labelledby={id("title")}>
    <header className="km-hero">
      <div className="km-hero-copy">
        <h1 id={id("title")}>{copy.hero.title}</h1>
        <p className="km-dek">{copy.hero.dek}</p>
        <p className="km-byline"><span className="km-byline-credit"><Credit text={copy.hero.eyebrow} brands={["kimi", "tokenrouter"]} /></span><span>{fill(copy.hero.byline, copy)}</span></p>
        <nav className="km-jump" aria-label={copy.reading.jumpLabel}>
          {copy.reading.jumps.map((jump) => <a key={jump.target} href={`#${id(jump.target)}`}>{jump.label}<ArrowRight size={16} aria-hidden="true" /></a>)}
        </nav>
      </div>
      <VideoSlot video={KIMI_VIDEO} copy={copy} />
    </header>

    <Section id={id("jobs")} title={copy.jobs.heading} intro={copy.jobs.intro}>
      <ul className="km-jobs">
        {JOB_KEYS.map((key) => {
          const words = copy.jobs[key];
          const facts = KIMI_FACTS.jobs[key];
          const Icon = JOB_ICONS[key];
          return <li key={key} className="km-job" data-job={key}>
            <h3><Icon size={24} aria-hidden="true" />{words.name}</h3>
            <p className="km-job-when">{words.when}</p>
            <p className="km-job-does">{words.does}</p>
            <p className="km-job-metric">
              <strong>{facts.seconds} {copy.jobs.secondsUnit}</strong>
              <span>{money(facts.usd, facts.approximate)} {words.per}</span>
            </p>
          </li>;
        })}
      </ul>
      <Details label={copy.reading.timingDetails}>
        <dl className="km-timing-notes">
          {JOB_KEYS.map((key) => <div key={key}><dt>{copy.jobs[key].name}</dt><dd>{copy.jobs[key].detail}</dd></div>)}
        </dl>
      </Details>
    </Section>

    <Section id={id("flow")} title={copy.flow.heading} intro={copy.flow.intro}>
      <ol className="km-flow">
        {copy.flow.steps.map((step, index) => {
          const Icon = FLOW_ICONS[index];
          return <li key={step.title} className="km-step" data-kimi={FLOW_KIMI[index] || undefined}>
            <span className="km-step-icon" aria-hidden="true"><Icon size={24} /><span className="km-step-number">{index + 1}</span></span>
            <p className="km-step-title">{step.title}</p>
            <p className="km-step-actor"><Credit text={step.actor} brands={["kimi", "privy"]} /></p>
          </li>;
        })}
      </ol>
    </Section>

    <Section id={id("wrote")} title={copy.wrote.heading} intro={copy.wrote.intro}>
      <div className="km-wrote">
        <BrainMock copy={copy} locale={locale} />
        <CopilotMock copy={copy} locale={locale} />
        <WrenMock copy={copy} locale={locale} />
      </div>
    </Section>

    <Section id={id("why")} title={copy.why.heading} intro={fill(copy.why.intro, copy)}>
      <ul className="km-metrics">
        {copy.why.metrics.map((metric, index) => <li key={metric.label} className="km-metric">
          <p className="km-metric-value">{metric.value}</p>
          <p className="km-metric-label">{metric.label}</p>
          <p className="km-metric-sub">{metric.sub}</p>
          {index === 0 && <div className="km-latency">
            <div className="km-latency-row"><span>{copy.reading.defaultEffort}</span><strong>{KIMI_DESK_BASELINE_SECONDS} {copy.jobs.secondsUnit}</strong><i aria-hidden="true" style={{ width: "100%" }} /></div>
            <div className="km-latency-row" data-low><span>{copy.reading.lowEffort}</span><strong>{KIMI_FACTS.jobs.desk.seconds} {copy.jobs.secondsUnit}</strong><i aria-hidden="true" style={{ width: `${Number(KIMI_FACTS.jobs.desk.seconds) / Number(KIMI_DESK_BASELINE_SECONDS) * 100}%` }} /></div>
          </div>}
        </li>)}
      </ul>
      <Details label={copy.reading.technicalDetails}>
        <ul className="km-reasons">
          {copy.why.reasons.map((reason) => <li key={reason.title} className="km-reason">
            <h3>{reason.title}</h3>
            <p>{reason.body}</p>
          </li>)}
        </ul>
        <figure className="km-request">
          <figcaption>
            <p className="km-request-title"><Code2 size={16} aria-hidden="true" />{copy.why.requestHeading}</p>
            <p className="km-request-note">{copy.why.requestNote}</p>
          </figcaption>
          <pre lang="en"><code>{KIMI_REQUEST}</code></pre>
        </figure>
      </Details>
    </Section>

    <Section id={id("safe")} title={copy.safe.heading}>
      <ul className="km-safeguards">
        {copy.reading.safeguards.map((item) => <li key={item}><ShieldCheck size={24} aria-hidden="true" /><span>{item}</span></li>)}
      </ul>
      <Details label={copy.reading.safetyDetails}>
        <ul className="km-checklist">
          {copy.safe.items.map((item) => <li key={item}><Check size={16} aria-hidden="true" /><span>{item}</span></li>)}
        </ul>
      </Details>
    </Section>

    <Section id={id("honest")} title={copy.honest.heading}>
      <ul className="km-honest">
        {[0, 2, 4].map((index) => <li key={index}><Check size={16} aria-hidden="true" /><span>{fill(copy.honest.items[index], copy)}</span></li>)}
      </ul>
      <Details label={copy.reading.pricingDetails}>
        {[1, 3].map((index) => <p key={index}>{fill(copy.honest.items[index], copy)}</p>)}
      </Details>
    </Section>

    <Section id={id("close")} title={copy.close.heading}>
      <ul className="km-links">
        {copy.close.links.map((link, index) => <li key={link.label}>
          <a className="km-link-card" href={CLOSE_HREFS[index]}>
            <span className="km-link-label">{link.label}<ArrowRight size={16} aria-hidden="true" /></span>
            <span className="km-link-note">{link.note}</span>
          </a>
        </li>)}
      </ul>
      <Details label={copy.close.codeHeading}>
        <ul className="km-code">
          {KIMI_CODE_PATHS.map((path, index) => <li key={path}><code lang="en">{path}</code><span>{copy.close.codeRoles[index]}</span></li>)}
        </ul>
      </Details>
      <ArticleLinks current="kimi" className="km-more" />
    </Section>
  </article>;
}

export function KimiArticle() {
  return <div className="kimi-page" data-lang="en" lang="en" suppressHydrationWarning>
    <script dangerouslySetInnerHTML={{ __html: LANG_BOOT }} />
    <a className="km-skip" href="#km-main"><Both pick={(copy) => copy.skip} /></a>
    <header className="km-header">
      <ForkNightMark href={KIMI_HREFS.home} />
      <nav className="km-nav" aria-label="Fork Night">
        <a href={KIMI_HREFS.rooms}><Both pick={(copy) => copy.nav.rooms} /></a>
        <a href={KIMI_HREFS.agents}><Both pick={(copy) => copy.nav.agents} /></a>
        <a href={KIMI_HREFS.nightWatch}><Both pick={(copy) => copy.nav.nightWatch} /></a>
        <a href={KIMI_HREFS.kimi} aria-current="page"><BrandTile brand="kimi" /><Both pick={(copy) => copy.nav.kimi} /></a>
      </nav>
      <LanguageToggle label={TOGGLE_LABEL} announce={ANNOUNCE} compact />
      <script dangerouslySetInnerHTML={{ __html: PRESSED_BOOT }} />
    </header>
    <main id="km-main" className="km-main">
      <ArticleBody locale="en" />
      <ArticleBody locale="zh" />
    </main>
    <p id={LANG_STATUS_ID} className="km-visually-hidden" role="status" aria-live="polite" />
  </div>;
}
