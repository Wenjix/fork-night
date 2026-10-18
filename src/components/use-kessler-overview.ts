"use client";

import { useEffect, useState } from "react";
import { pilotBrowserClient } from "../lib/supabase/pilot-client";
import { parseKesslerOverview, type KesslerOverview } from "../lib/kessler-overview";
import { pollWhileVisible } from "../lib/visible-interval";

export function useKesslerOverview(enabled = true) {
  const [overview, setOverview] = useState<KesslerOverview | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const client = pilotBrowserClient();
    if (!client) { setUnavailable(true); return; }
    let live = true;
    const stop = pollWhileVisible(async () => {
      try {
        const result = await client.rpc("pilot_kessler_overview");
        const next = result.error ? null : parseKesslerOverview(result.data);
        if (live) { setOverview(next); setUnavailable(!next); }
      } catch { if (live) { setOverview(null); setUnavailable(true); } }
    }, 30000);
    return () => { live = false; stop(); };
  }, [enabled]);
  return { overview: enabled ? overview : null, unavailable: enabled && unavailable };
}
