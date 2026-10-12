"use client";

import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export function PilotCreditRefill({ client, roomId, userId, onRefill }: {
  client: SupabaseClient<Database>;
  roomId: string;
  userId: string;
  onRefill: () => void;
}) {
  const [enabled, setEnabled] = useState(false);
  const [pending, setPending] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const active = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => {
    active.current = true;
    try {
      setRecovering(!!sessionStorage.getItem(`fork-night-refill:${userId}:${roomId}`));
    } catch { /* A click reports an unavailable retry store before dispatch. */ }
    const controller = new AbortController();
    void fetch("/api/pilot/local-refill", {
      headers: { "x-fork-night-local": "1" },
      signal: controller.signal,
    }).then(async response => {
      if (response.ok && active.current) setEnabled((await response.json()).enabled === true);
    }).catch(() => { /* Local operator controls are optional. */ });
    return () => { active.current = false; controller.abort(); };
  }, [roomId, userId]);

  async function refill() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError("");
    setNotice("");
    try {
      // Persist before dispatch so a lost reply/refresh cannot add credits twice.
      const key = `fork-night-refill:${userId}:${roomId}`;
      const requestId = sessionStorage.getItem(key) ?? crypto.randomUUID();
      sessionStorage.setItem(key, requestId);
      setRecovering(true);
      const session = await client.auth.getSession();
      if (session.error || !session.data.session) throw new Error("Reconnect to your guest session and try again.");
      const response = await fetch("/api/pilot/local-refill", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-fork-night-local": "1",
          Authorization: `Bearer ${session.data.session.access_token}`,
        },
        body: JSON.stringify({ roomId, requestId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "The refill could not be confirmed. Retry to check it.");
      sessionStorage.removeItem(key);
      if (active.current) {
        setRecovering(false);
        setNotice("5 test credits added to this room.");
        onRefill();
      }
    } catch (reason) {
      if (active.current) setError(reason instanceof Error ? reason.message : "The refill could not be confirmed. Retry to check it.");
    } finally {
      inFlight.current = false;
      if (active.current) setPending(false);
    }
  }

  if (!enabled) return null;
  return <div className="pilot-refill">
    <button className="button secondary" disabled={pending} onClick={() => void refill()}>
      <Plus size={16} />{pending ? "Adding credits…" : recovering ? "Check last refill" : "Add 5 test credits"}
    </button>
    <small>No payment. Uses the existing API budget.</small>
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
