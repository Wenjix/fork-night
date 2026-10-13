import { Check, CircleAlert, Clock3, RefreshCw, Sparkles } from "lucide-react";
import { generationStatus, roomActivity, type GenerationOperation, type PilotCredits } from "../lib/pilot-generation.ts";

export function PilotGenerationStatus({ operation, interrupted = false }: { operation: GenerationOperation; interrupted?: boolean }) {
  const status = generationStatus(operation);
  const Icon = status.phase === "ready" ? Check : status.phase === "generating" ? RefreshCw : status.phase === "checking" ? CircleAlert : Clock3;
  return <div className="pilot-generation-status" data-phase={status.phase} role="status" aria-live="polite" aria-atomic="true">
    <div className="pilot-generation-state"><Icon size={20} aria-hidden="true" className={status.phase === "generating" && !interrupted ? "pilot-generation-active" : undefined} /><strong>{status.title}</strong></div>
    <p>{status.detail}</p>
    <ol className="pilot-generation-steps" aria-label="Image generation stages">
      {["Queued", "Generating", "Ready to review"].map((label, index) => <li key={label} aria-current={status.step === index ? "step" : undefined} data-complete={index < status.step}>
        {index < status.step ? <Check size={14} aria-hidden="true" /> : <span className="pilot-generation-step" aria-hidden="true" />}{label}
      </li>)}
    </ol>
    {status.reserved > 0 && <small>{status.reserved} {status.reserved === 1 ? "room credit reserved" : "room credits reserved"} for this request. Used only when every panel is ready.</small>}
    {interrupted && <small>Connection interrupted. Showing the last recorded state.</small>}
  </div>;
}

export function PilotRoomActivity({ credits, interrupted = false }: { credits: PilotCredits; interrupted?: boolean }) {
  const activity = roomActivity(credits);
  const active = !!activity?.generating && !interrupted;
  return <section className="pilot-room-activity" aria-label="Room generation activity">
    <div className="pilot-room-activity-summary" role="status" aria-live="polite" aria-atomic="true">
      {active ? <RefreshCw size={17} className="pilot-generation-active" aria-hidden="true" /> : <Clock3 size={17} aria-hidden="true" />}
      <strong>{interrupted ? "Last saved room activity" : "In this room"}</strong>
      {activity ? <div className="pilot-room-activity-counts">
        {activity.queued > 0 && <span>{activity.queued} queued</span>}
        {activity.generating > 0 && <span>{activity.generating} generating</span>}
        {activity.checking > 0 && <span>{activity.checking} {activity.checking === 1 ? "request needs checking" : "requests need checking"}</span>}
        {activity.queued + activity.generating + activity.checking === 0 && <span>No image requests in progress</span>}
      </div> : <span>{credits.reserved > 0 ? "Image requests are pending; detailed activity is unavailable." : "Detailed activity is unavailable."}</span>}
    </div>
    <p className="pilot-room-capacity"><Sparkles size={19} aria-hidden="true" /><strong>{credits.available} {credits.available === 1 ? "room credit available" : "room credits available"}</strong>
      {credits.reserved > 0 && <span>{credits.reserved} reserved for unfinished requests</span>}
      {!credits.enabled && <span>New image generation is paused</span>}
    </p>
  </section>;
}
