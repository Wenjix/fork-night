"use client";

import { useRef, useState, type FormEvent } from "react";
import { ArrowRight, Check } from "lucide-react";

export function WaitlistForm({ source, configured }: { source: "demo" | "signup"; configured: boolean }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");
  const pending = useRef(false);
  const success = useRef<HTMLHeadingElement>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!configured || pending.current) return;
    pending.current = true;
    setState("saving"); setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/waitlist", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, consent: true, source, website: form.get("website") }),
        signal: AbortSignal.timeout(15_000),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || result?.ok !== true) throw new Error(typeof result?.error === "string" ? result.error : "We couldn’t save your email. Please try again.");
      setState("saved");
      requestAnimationFrame(() => success.current?.focus());
    } catch (cause) {
      setState("idle");
      setError(cause instanceof Error && cause.name !== "TimeoutError" && cause.name !== "TypeError" ? cause.message : "We couldn’t confirm your signup. Please try again—your address won’t be added twice.");
    } finally { pending.current = false; }
  }
  if (state === "saved") return <div className="signup-success" role="status">
    <Check size={36} aria-hidden="true" />
    <h2 tabIndex={-1} ref={success}>You’re on the list.</h2>
    <p>Thanks for leaving a little of yourself here. We’ll be in touch about Fork Night launches and playtests.</p>
    <p className="signup-small">Your email is saved. There’s nothing else to do.</p>
  </div>;
  return <form onSubmit={submit} className="signup-form" aria-busy={state === "saving"}>
    <h2>Save me a place.</h2>
    <label htmlFor="waitlist-email">Email address</label>
    <input id="waitlist-email" name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} placeholder="you@example.com" required maxLength={254} value={email} onChange={event => { setEmail(event.target.value); setError(""); }} disabled={state === "saving"} aria-describedby={`signup-permission${error ? " signup-error" : ""}`} aria-invalid={!!error} />
    <div className="signup-trap" aria-hidden="true"><label htmlFor="waitlist-website">Leave this field empty</label><input id="waitlist-website" name="website" tabIndex={-1} autoComplete="off" /></div>
    <button className="signup-button" disabled={!configured || state === "saving"} type="submit">{state === "saving" ? "Saving your place…" : "Join the waitlist"}<ArrowRight size={20} aria-hidden="true" /></button>
    <p id="signup-permission" className="signup-small">By joining, you agree to receive occasional Fork Night launch and playtest emails. Your address stays private.</p>
    {!configured && <p className="signup-error" role="status">Signups aren’t connected yet. Please check back shortly.</p>}
    {error && <p className="signup-error" id="signup-error" role="alert">{error}</p>}
    <noscript><p>Please enable JavaScript to submit this signup form.</p></noscript>
  </form>;
}
