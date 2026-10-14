"use client";

import { useSyncExternalStore } from "react";
import { LANG_STATUS_ID, LANG_STORAGE_KEY, LOCALE_TAG, type Locale } from "../../lib/kimi-article.ts";

/**
 * "English | 中文" for the Kimi article. Both languages are already in the page; this only flips the root's
 * data-lang and lang, keeps ?lang= in the address so the link can be shared, remembers the choice, and
 * announces it. The page reads in English without JavaScript.
 */

const CHANGE = "fork-night-kimi-lang";
const ROOT = ".kimi-page";

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

function choose(next: Locale, announce: string) {
  const root = document.querySelector<HTMLElement>(ROOT);
  if (!root || current() === next) return;
  root.setAttribute("data-lang", next);
  root.setAttribute("lang", LOCALE_TAG[next]);
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
  return <div className={`km-toggle${compact ? " km-toggle-compact" : ""}`} role="group" aria-label={label}>
    <button type="button" lang="en" aria-pressed={locale === "en"} onClick={() => choose("en", announce.en)}>English</button>
    <button type="button" lang="zh-Hans" aria-pressed={locale === "zh"} onClick={() => choose("zh", announce.zh)}>中文</button>
  </div>;
}
