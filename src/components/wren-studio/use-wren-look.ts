"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { DEFAULT_LOOK, LOOK_STORAGE_KEY, parseLook, type WrenLook } from "@/lib/wren-look";

// One saved look per browser, shared by every Wren maker and badge on the page.
const CHANGED = "fork-night:wren-look";
let memory: string | null = null; // used when storage is unavailable, so the page still works

function read(): string | null {
  try { return window.localStorage.getItem(LOOK_STORAGE_KEY) ?? memory; } catch { return memory; }
}

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === LOOK_STORAGE_KEY) onChange(); };
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", onStorage);
  return () => { window.removeEventListener(CHANGED, onChange); window.removeEventListener("storage", onStorage); };
}

/** The maker's Wren look and a setter. Before hydration it is the default look. `persisted` is false when storage failed. */
export function useWrenLook() {
  const raw = useSyncExternalStore(subscribe, read, () => null);
  const look = useMemo(() => {
    if (!raw) return DEFAULT_LOOK;
    try { return parseLook(JSON.parse(raw)); } catch { return DEFAULT_LOOK; }
  }, [raw]);
  const setLook = useCallback((next: WrenLook | ((current: WrenLook) => WrenLook)) => {
    const current = (() => { const value = read(); try { return value ? parseLook(JSON.parse(value)) : DEFAULT_LOOK; } catch { return DEFAULT_LOOK; } })();
    const value = JSON.stringify(typeof next === "function" ? next(current) : next);
    memory = value;
    let persisted = true;
    try { window.localStorage.setItem(LOOK_STORAGE_KEY, value); } catch { persisted = false; }
    window.dispatchEvent(new Event(CHANGED));
    return persisted;
  }, []);
  return { look, setLook };
}
