export interface VisiblePage extends EventTarget {
  readonly visibilityState: DocumentVisibilityState;
}

/** Repeats `run` every `ms` while the page is visible; a tab that comes back runs it at once. Returns a stop function. */
export function whileVisible(run: () => void, ms: number, page: VisiblePage = document) {
  let timer: ReturnType<typeof setInterval> | undefined;
  const update = () => {
    if (page.visibilityState !== "visible") {
      clearInterval(timer);
      timer = undefined;
      return false;
    }
    if (timer !== undefined) return false;
    timer = setInterval(run, ms);
    return true;
  };
  const change = () => {
    if (update()) run();
  };
  update();
  page.addEventListener("visibilitychange", change);
  return () => {
    clearInterval(timer);
    timer = undefined;
    page.removeEventListener("visibilitychange", change);
  };
}

/** Sequential polling with reconnect refresh and bounded failure backoff. */
export function pollWhileVisible(run: () => Promise<void>, ms: number, page: VisiblePage = document, events: EventTarget = window) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false, running = false, again = false, failures = 0;
  const visible = () => !stopped && page.visibilityState === "visible";
  async function tick() {
    clearTimeout(timer);
    if (!visible()) return;
    if (running) { again = true; return; }
    running = true;
    try { await run(); failures = 0; }
    catch { failures++; }
    finally {
      running = false;
      if (visible()) {
        const delay = again ? 0 : failures ? [6000, 12000, 30000][Math.min(failures - 1, 2)] : ms;
        timer = setTimeout(() => void tick(), delay);
      }
      again = false;
    }
  }
  const refresh = () => { clearTimeout(timer); if (visible()) void tick(); };
  page.addEventListener("visibilitychange", refresh);
  events.addEventListener("focus", refresh);
  events.addEventListener("online", refresh);
  void tick();
  return () => {
    stopped = true; clearTimeout(timer);
    page.removeEventListener("visibilitychange", refresh);
    events.removeEventListener("focus", refresh);
    events.removeEventListener("online", refresh);
  };
}
