"use client";

import { useEffect, useSyncExternalStore } from "react";
import { LANG_STATUS_ID, LANG_STORAGE_KEY, LOCALE_TAG, PAGE_TITLE, YOUTUBE_ORIGIN, type Locale } from "../../lib/kimi-article.ts";

/**
 * "English | 中文" for the Kimi article. Both languages are already in the page; this only flips the root's
 * data-lang and lang (and the document's language and tab title), keeps ?lang= in the address so the link can
 * be shared, remembers the choice, and announces it. The page reads in English without JavaScript.
 */

const CHANGE = "fork-night-kimi-lang";
const ROOT = ".kimi-page";
/** The YouTube player's pause command, in its iframe API's message format (the embed sets enablejsapi=1). */
const PAUSE = JSON.stringify({ event: "command", func: "pauseVideo", args: [] });

function current(): Locale {
  return document.querySelector(ROOT)?.getAttribute("data-lang") === "zh" ? "zh" : "en";
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE, onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener(CHANGE, onChange);
    window.removeEventListener("popstate", onChange);
  };
}

/** The document follows the article, so the tab title, translation prompts and screen readers agree. */
function showDocumentIn(locale: Locale) {
  document.documentElement.lang = LOCALE_TAG[locale];
  document.title = PAGE_TITLE[locale];
}

/** display:none doesn't stop a playing video, so the walkthrough in the language being hidden is paused. */
function pauseVideos(root: Element, locale: Locale) {
  const hidden = `.km-locale[data-locale="${locale}"]`;
  for (const video of root.querySelectorAll<HTMLVideoElement>(`${hidden} video`)) video.pause();
  // A frame whose document we can still read is its own about:blank (a lazy player not loaded yet): nothing plays
  // there, and posting to it logs an origin mismatch. A loaded YouTube player is cross-origin: contentDocument is null.
  for (const frame of root.querySelectorAll<HTMLIFrameElement>(`${hidden} iframe`)) {
    if (!frame.contentDocument) frame.contentWindow?.postMessage(PAUSE, YOUTUBE_ORIGIN);
  }
}

export function choose(next: Locale, announce: string) {
  const root = document.querySelector<HTMLElement>(ROOT);
  if (!root || current() === next) return;
  pauseVideos(root, current());
  root.setAttribute("data-lang", next);
  root.setAttribute("lang", LOCALE_TAG[next]);
  showDocumentIn(next);
  try {
    window.localStorage.setItem(LANG_STORAGE_KEY, next);
  } catch {
    // Private windows and blocked storage: the choice simply isn't remembered.
  }
  try {
    const url = new URL(window.location.href);
    if (next === "zh") url.searchParams.set("lang", "zh");
    else url.searchParams.delete("lang");
    window.history.replaceState(window.history.state, "", url);
  } catch {
    // The address keeps its old ?lang; the page itself has already switched.
  }
  const status = document.getElementById(LANG_STATUS_ID);
  if (status) status.textContent = announce;
  window.dispatchEvent(new Event(CHANGE));
}

export function LanguageToggle({ label, announce, compact = false }: { label: string; announce: Record<Locale, string>; compact?: boolean }) {
  const locale = useSyncExternalStore(subscribe, current, () => "en" as Locale);
  // The boot script set the document's language and title before paint. Next's metadata title replaces the
  // title when it hydrates, just before or after this component, so apply the language now and after that change.
  useEffect(() => {
    showDocumentIn(current());
    const watch = new MutationObserver(() => {
      if (document.title === PAGE_TITLE[current()]) return;
      watch.disconnect();
      showDocumentIn(current());
    });
    watch.observe(document.head, { childList: true, subtree: true, characterData: true });
    const stop = setTimeout(() => watch.disconnect(), 5000);
    return () => { watch.disconnect(); clearTimeout(stop); };
  }, []);
  // A script right after the toggle sets aria-pressed from the boot script's language before hydration, so the
  // buttons accept that difference from the server's "en".
  return <div className={`km-toggle${compact ? " km-toggle-compact" : ""}`} role="group" aria-label={label}>
    <button type="button" lang="en" aria-pressed={locale === "en"} suppressHydrationWarning onClick={() => choose("en", announce.en)}>English</button>
    <button type="button" lang="zh-Hans" aria-pressed={locale === "zh"} suppressHydrationWarning onClick={() => choose("zh", announce.zh)}>中文</button>
  </div>;
}
