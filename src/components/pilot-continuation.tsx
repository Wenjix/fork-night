"use client";

import { useState, type RefObject } from "react";
import { ArrowRight, RefreshCw, Share2 } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "../lib/supabase/database.types.ts";
import { pilotPanels, type PilotMoment } from "../lib/pilot.ts";
import type { ComposerDraft } from "../lib/pilot-composer.ts";
import { pilotCreditCost } from "../lib/pilot-format.ts";
import type { GenerationOperation, PilotCredits } from "../lib/pilot-generation.ts";
import { PilotComposer } from "./pilot-composer.tsx";
import { PilotGenerationStatus } from "./pilot-generation-status.tsx";
import { PilotPanels } from "./pilot-panels.tsx";
import { GoogleButton, WalletProviderNote } from "./auth-branding.tsx";
import { WalletSignInButton } from "./pilot-wallet-signin.tsx";

const finalStates = new Set(["published", "discarded", "failed"]);
export function visibleContinuation(operation: GenerationOperation | undefined, selectedId: string) {
  if (!operation) return undefined;
  if (operation.status === "published" && operation.published_moment_id !== selectedId) return undefined;
  if (["discarded", "failed"].includes(operation.status) && operation.parent_id !== selectedId) return undefined;
  return operation;
}
export type ContinuationActions = {
  join: (name: string) => void; publish: () => void; discard: () => void; check: () => void;
  google?: (name: string) => void; returning?: () => void;
  continue: () => void; share: () => void; change: (draft: ComposerDraft) => boolean;
  generate: () => void; cancel: () => void; useIdea: (id: string) => void; inspect: () => void;
  continueDraft: () => void; startFresh: () => void;
};

export function PilotContinuation({ client, selected, moments, profile, authenticated = false, operation: saved, draft, recoveredDraft = false, composing, composerVisible, busy, interrupted, credits, inspecting, heading, actions }: {
  client: SupabaseClient<Database>; selected: PilotMoment; moments: PilotMoment[]; profile?: Tables<"pilot_profiles">;
  operation?: GenerationOperation; draft?: ComposerDraft; recoveredDraft?: boolean; composing: boolean; composerVisible: boolean; busy: boolean; interrupted: boolean;
  credits?: PilotCredits; inspecting: boolean; heading: RefObject<HTMLHeadingElement | null>; actions: ContinuationActions;
  authenticated?: boolean;
}) {
  const [name, setName] = useState("");
  const operation = visibleContinuation(saved, selected.id);
  if (!composing && !operation) return null;
  return <section className="pilot-task" aria-label="Your continuation">
    <h2 ref={heading} tabIndex={-1}>{operation?.status === "delivered" ? "Your moment, ready to share" : operation?.status === "published" ? "You’re part of the story" : "Make the next moment yours"}</h2>
    {!profile ? <form className="pilot-onboarding" onSubmit={event => { event.preventDefault(); (authenticated ? actions.join : actions.google ?? actions.join)(name); }} aria-busy={busy}>
      {!authenticated && <div className="pilot-wallet-entry"><WalletSignInButton disabled={busy} /><p>Sign in with an EVM or Solana wallet. No gas is used.</p></div>}
      <p>{authenticated ? "You’re signed in. Choose the name that will appear beside your published moments." : "Choose the name that will appear beside your published moments. No wallet needed."}</p>
      <label>Your storyteller name<input data-pilot-storyteller-name required maxLength={60} autoComplete="nickname" value={name} onChange={event => setName(event.target.value)} /></label>
      <div className="pilot-auth-actions">
        {!authenticated && actions.google && <GoogleButton type="submit" disabled={busy || !name.trim()}>{busy ? "Opening sign-in…" : "Continue with Google"}</GoogleButton>}
        <button type={!authenticated && actions.google ? "button" : "submit"} className={`button ${!authenticated && actions.google ? "secondary" : "primary"}`} disabled={busy} onClick={!authenticated && actions.google ? event => { if (event.currentTarget.form?.reportValidity()) actions.join(name); } : undefined}>{authenticated ? "Save my storyteller name" : "Join as a guest"}</button>
      </div>
      {!authenticated && <div className="pilot-auth-guidance">
        {actions.google && <><p>Google saves your byline and prepares a personal in-app wallet.</p><WalletProviderNote /></>}
        <small>Your guest identity and private drafts stay in this browser.</small>
      </div>}
      <div className="pilot-auth-footer">
        {!authenticated && actions.returning && <div className="pilot-returning"><span>Already joined?</span><GoogleButton type="button" className="pilot-google-returning" disabled={busy} onClick={actions.returning}>Sign in with Google</GoogleButton></div>}
        <button type="button" className="text-button" disabled={busy} onClick={actions.cancel}>Cancel continuation</button>
      </div>
    </form> : operation ? <>
      {!finalStates.has(operation.status) && <PilotGenerationStatus operation={operation} interrupted={interrupted} starting={busy} />}
      <p className="pilot-parent">Building on <strong>{moments.find(moment => moment.id === operation.parent_id)?.title}</strong></p>
      {operation.status === "discarded" && <PilotPanels client={client} panels={pilotPanels(operation.panels)} />}
      {operation.status === "delivered" ? <>
        <p>Your preview is saved privately. Publish it with your name so the next person can continue.</p>
        <div className="button-row"><button className="button primary" disabled={busy} onClick={actions.publish}>Publish my moment</button><button className="button secondary" disabled={busy} onClick={actions.discard}>Discard</button></div>
        <small>{operation.charged_units} room {operation.charged_units === 1 ? "credit" : "credits"} used for complete delivery, even if discarded.</small>
      </> : operation.status === "published" ? <>
        <div className="pilot-live-invite">
          <strong>Your moment is live. Invite the next maker <ArrowRight size={16} aria-hidden="true" /></strong>
          <p>Published with credit to {profile.display_name}. Let someone else pick up the story.</p>
          <div className="button-row"><button className="button secondary" disabled={busy} onClick={actions.share}><Share2 size={16} aria-hidden="true" />Copy invite link</button><button className="button secondary" disabled={busy} onClick={actions.continue}>Continue from here</button></div>
        </div>
      </> : finalStates.has(operation.status) ? <>
        <p>{operation.status === "discarded" ? `Kept off the public story. Complete delivery used ${operation.charged_units} room ${operation.charged_units === 1 ? "credit" : "credits"}.` : operation.generation_error ?? "This moment could not be completed. No room credit was used."}</p>
        <button className="button secondary" disabled={busy} onClick={actions.continue}>Try a new idea</button>
      </> : operation.status === "draft" ? <>
        <small>{pilotCreditCost(Array.isArray(operation.requested_captions) ? operation.requested_captions.length : 2)} room {pilotCreditCost(Array.isArray(operation.requested_captions) ? operation.requested_captions.length : 2) === 1 ? "credit" : "credits"} reserved when generation starts.</small>
        {!busy && <div className="button-row"><button className="button secondary" onClick={actions.check}><RefreshCw size={16} aria-hidden="true" />Try again</button></div>}
      </> : <div className="pilot-progress"><button className="button secondary" disabled={busy} onClick={actions.check}><RefreshCw size={16} aria-hidden="true" />Check saved result</button><small>Checking never buys a recorded panel again.</small></div>}
    </> : draft && composerVisible ? recoveredDraft ? <div className="pilot-draft-recovery" role="status">
      <strong>You have an unfinished draft. Continue it or start fresh.</strong>
      <p>We found a draft saved in this browser for this room.</p>
      <div className="button-row"><button className="button primary" disabled={busy} onClick={actions.continueDraft}>Continue draft</button><button className="button secondary" disabled={busy} onClick={actions.startFresh}>Start fresh</button></div>
    </div> : <PilotComposer key={`${draft.requestId}:${selected.id}`} client={client} draft={draft} parent={moments.find(moment => moment.id === draft.parentId) ?? selected} busy={busy} credits={credits} onChange={actions.change} onGenerate={actions.generate} onCancel={actions.cancel} onIdea={actions.useIdea} onInspect={actions.inspect} inspecting={inspecting && selected.id === draft.parentId} /> : null}
  </section>;
}
