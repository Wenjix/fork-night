"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ExternalLink, LockKeyhole, Plus, Save, Trash2 } from "lucide-react";
import { ASSETS, draftTemplate, invitationLink, panelImage, worldLink, type Asset, type Work } from "@/lib/world-demo/model";
import { addDraftPanel, canonicalDraft, contributionDraftKey, draftContent, moveDraftPanel, preserveSelectionDraft, readContributionDraft, readSelectionDraft, rememberContributionDraft, rememberSelectionDraft, sameDraft, selectionDraftKey, type EditableDraft } from "@/lib/world-demo/drafts";
import { Disclosure } from "../disclosure";
import type { DemoController } from "./world-demo";
import { WorkPanels } from "./panels";
import { RoleIdentity } from "./identity";

export function RehearsalSeats({ demo }: { demo: DemoController }) {
  const state = demo.state!;
  const [message, setMessage] = useState("");
  const source = state.works.some(w => w.role === "maker");
  async function copy(path: string) {
    try { await navigator.clipboard.writeText(new URL(path, window.location.origin).href); setMessage("Invitation copied. It can be claimed once."); }
    catch { setMessage("Copy the invitation from the open-seat link."); }
  }
  return <Disclosure className="wd-seats" defaultOpen={!source} summary="Room invitations"><p>Invite another maker. Each invitation opens a separate guest account with private drafts.</p>
    {state.invitations.map(invitation => {
      const name = invitation.role === "maker" ? "Mira" : "Kai";
      const link = invitation.token ? invitationLink(state.id, invitation.role, invitation.token) : worldLink(state.id, invitation.role, "my-work");
      return <div className="wd-seat" key={invitation.role}><RoleIdentity role={invitation.role} name={name} detail={invitation.role === "maker" ? "Starts the scene" : "Continues Mira’s scene"} /><span>{invitation.claimed ? "Claimed · reopen in its original browser" : "Available · private invitation"}</span><a className="wd-button wd-outline" href={link} target="_blank" rel="noopener noreferrer">Open {name}’s seat <ExternalLink size={16} /></a>{invitation.token && <button className="wd-text-button" onClick={() => void copy(link)}>Copy {name}’s invitation</button>}</div>;
    })}
    {message && <p role="status">{message}</p>}
    <p>Published contributions appear in chapter review. Choose an account from the top-right menu to open its workspace.</p>
  </Disclosure>;
}

export function CuratorPanel({ demo, source }: { demo: DemoController; source?: Work }) {
  const [reason, setReason] = useState("The paper ledger gives this neighborhood a shared memory. Let’s carry it into a night when the network goes dark.");
  const [localError, setLocalError] = useState("");
  const [restored, setRestored] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const state = demo.state!;
  const key = selectionDraftKey(state.id, state.me.id);
  const selected = state.selections.find(s => !s.withdrawn_at);
  const release = state.releases[0];
  const tip = state.works.find(w => w.role === "continuing" && w.parent_id === source?.id);
  const blocked = demo.busy || !!demo.pending || !restored || publishing;
  useEffect(() => {
    try {
      if (demo.pending?.kind === "select" && demo.pending.runId === state.id) {
        preserveSelectionDraft(localStorage, key, demo.pending.payload.reason);
      }
      const saved = readSelectionDraft(localStorage, key);
      if (saved !== null) setReason(saved);
      else if (selected) setReason(selected.reason);
    } catch (e) { setLocalError(e instanceof Error ? e.message : "This browser could not restore your selection explanation."); }
    setRestored(true);
  // Restore once for this member; shared-state polling must not replace unsent text.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  function editReason(value: string) {
    setReason(value); setLocalError("");
    try { rememberSelectionDraft(localStorage, key, value); }
    catch { setLocalError("This browser could not keep your explanation. Keep this page open while editing it."); }
  }
  async function publish() {
    if (blocked) return;
    setPublishing(true);
    try { if (await demo.publishChapter(reason)) demo.navigate("release"); }
    finally { setPublishing(false); }
  }
  return <section className="wd-curator-panel"><h2>Review the chapter</h2><p className="wd-muted">Bring the two scenes together. Each maker keeps their credit.</p>
    {localError && <p className="wd-error" role="alert">{localError}</p>}
    {release ? <div className="wd-curator-published"><Check size={24} aria-hidden="true" /><h3>Chapter 2 is published.</h3><p>The exact source and continuation are preserved with their makers.</p><button className="wd-button" onClick={() => demo.navigate("release")}>Read the chapter <ArrowRight size={20} /></button></div>
      : !source ? <div className="wd-waiting"><h3>Waiting for the first contribution.</h3><p>Private drafts appear here after their maker shares them.</p></div>
        : !tip ? <div className="wd-waiting"><h3>Mira’s scene is ready.</h3><p>A continuation can carry the ledger into its next moment.</p></div>
          : <form onSubmit={event => { event.preventDefault(); void publish(); }}>
            <ol className="wd-chapter-review">{[source, tip].map(work => <li key={work.id}><button type="button" className="wd-text-button" onClick={() => demo.navigate("story", work.id)}><strong>{work.title}</strong><span>{work.maker_label} · {work.panels.length} {work.panels.length === 1 ? "panel" : "panels"}</span></button></li>)}</ol>
            {selected ? <div className="wd-selection-note"><h3>Selection saved</h3><p>{selected.reason}</p></div> : <><label htmlFor="selection-reason">Why bring these scenes together?</label><textarea id="selection-reason" value={reason} onChange={event => editReason(event.target.value)} maxLength={500} required rows={4} disabled={blocked} /></>}
            <button className="wd-button wd-yellow" disabled={blocked || !reason.trim()} aria-busy={publishing || demo.busy || undefined} type="submit">{publishing || demo.busy ? "Publishing chapter…" : "Publish chapter & open film"}<ArrowRight size={20} /></button>
            <p className="wd-muted">Saves the selection and exact contribution path as Chapter 2, then opens its video workspace.</p>
            {selected && <Disclosure summary="Change this selection"><button type="button" className="wd-text-button" disabled={blocked} onClick={() => void demo.send({ kind: "withdraw", payload: {} })}>Withdraw selection</button></Disclosure>}
          </form>}
  </section>;
}

export function ContributionEditor({ demo }: { demo: DemoController }) {
  const state = demo.state!;
  const role = state.me.role;
  const [draft, setDraft] = useState<EditableDraft>(() => draftContent(state.draft ?? draftTemplate(role)));
  const [localError, setLocalError] = useState("");
  const [restored, setRestored] = useState(false);
  const [preview, setPreview] = useState(false);
  const [sequenceNotice, setSequenceNotice] = useState("");
  const key = contributionDraftKey(state.id, state.me.id);
  const published = state.works.find(w => w.maker_id === state.me.id);
  const parent = state.works.find(w => w.role === (role === "maker" ? "opening" : "maker"));
  const blocked = demo.busy || !!demo.pending;
  const saved = sameDraft(draft, state.draft);
  useEffect(() => {
    try {
      const local = readContributionDraft(localStorage, key);
      if (local) setDraft(local);
    } catch (e) { setLocalError(e instanceof Error ? e.message : "This browser could not restore your unfinished captions."); }
    setRestored(true);
  // The editor is keyed by its authenticated member. A poll must never replace unsent text.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  function edit(next: EditableDraft) {
    setDraft(next); setLocalError("");
    try { rememberContributionDraft(localStorage, key, next); }
    catch { setLocalError("This browser could not keep an unfinished copy. Keep this page open and save the private draft."); }
  }
  function focusCaption(index: number) {
    requestAnimationFrame(() => document.getElementById(`caption-${index}`)?.focus());
  }
  function addPanel() {
    if (blocked || !restored || draft.panels.length >= 3) return;
    edit(addDraftPanel(draft, role));
    setSequenceNotice(`Panel ${draft.panels.length + 1} added to ${state.me.label}’s private scene. Write its caption.`);
    focusCaption(draft.panels.length);
  }
  function movePanel(index: number, direction: -1 | 1) {
    if (blocked || !restored) return;
    const next = moveDraftPanel(draft, index, direction);
    if (next === draft) return;
    edit(next);
    setSequenceNotice(`Panel ${index + 1} moved to position ${index + direction + 1}.`);
    focusCaption(index + direction);
  }
  function removePanel(index: number) {
    if (blocked || !restored || draft.panels.length <= 1) return;
    edit({ ...draft, panels: draft.panels.filter((_, i) => i !== index) });
    setSequenceNotice(`Panel ${index + 1} removed from your private scene.`);
    focusCaption(Math.min(index, draft.panels.length - 2));
  }
  async function save() {
    const submitted = canonicalDraft(draft);
    if (await demo.send({ kind: "save_draft", payload: submitted })) {
      setDraft(current => sameDraft(current, submitted) ? submitted : current);
      return true;
    }
    return false;
  }
  if (published) return <section className="wd-empty"><Check size={32} aria-hidden="true" /><h1 tabIndex={-1}>Your contribution is published.</h1><p>“{published.title}” is preserved with your byline, {state.me.label}.</p><button className="wd-button" onClick={() => demo.navigate("my-work")}>Read my contribution <ArrowRight size={20} /></button></section>;
  if (!parent) return <section className="wd-empty"><h1 tabIndex={-1}>A new scene is on its way.</h1><p>Mira needs to publish the source before Kai can continue it. Her draft stays private while she works.</p><button className="wd-button" onClick={() => void demo.refresh()}>Check for Mira’s scene</button><button className="wd-text-button" onClick={() => demo.navigate("story")}>Read the opening</button></section>;
  if (preview) return <section className="wd-editor wd-publish-preview">
    <button className="wd-text-button" onClick={() => { setPreview(false); requestAnimationFrame(() => document.getElementById("contribution-title")?.focus()); }}><ArrowLeft size={16} /> Keep editing</button>
    <h1 tabIndex={-1}>{draft.title}</h1><p className="wd-byline"><RoleIdentity role={role} name={state.me.label} prefix="by" detail={role === "continuing" ? `Continues “${parent.title}” by ${parent.maker_label}` : "Original contribution · Side Street"} /></p>
    <p className="wd-preview-context"><LockKeyhole size={16} /> Preview · only you can see this draft</p>
    <WorkPanels panels={draft.panels} />
    <div className="wd-editor-save"><div><h2>Ready to leave your mark?</h2><p>This {draft.panels.length === 1 ? "panel" : `${draft.panels.length}-panel scene`} will be shared with Side Street as {state.me.label}’s contribution. Other makers can continue it, and the demo curator can include it in the chapter with your credit. Publishing preserves this version.</p></div><button className="wd-button wd-yellow" disabled={blocked || !restored || !saved} aria-busy={demo.busy || undefined} onClick={async () => { if (await demo.send({ kind: "publish_work", payload: {} })) demo.navigate("my-work"); }}>{demo.busy ? "Publishing…" : `Publish as ${state.me.label}`}<ArrowRight size={20} /></button></div>
  </section>;
  return <section className="wd-editor"><button className="wd-text-button" onClick={() => demo.navigate("story", parent.id)}><ArrowLeft size={16} /> Read your starting point: {parent.title}{role === "continuing" && ` · by ${parent.maker_label}`}</button>
    <div className="wd-editor-heading"><div><h1 tabIndex={-1}>{role === "maker" ? "Mira, give this place a memory." : "Kai, what happens next?"}</h1><p>{role === "maker" ? "Introduce Nika’s paper ledger. Make these prepared scenes yours through the captions." : "Mira introduced the ledger. Now the network goes dark. Shape your continuation by adding a panel and writing what happens next."}</p></div><span><LockKeyhole size={16} /> Private until you publish</span></div>
    <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="wd-editor-title"><label htmlFor="contribution-title">Your scene’s title</label><input id="contribution-title" value={draft.title} onChange={event => edit({ ...draft, title: event.target.value })} maxLength={80} required disabled={blocked || !restored} /></div>
      <div className="wd-sequence-heading"><div><h2>{state.me.label}’s scene · {draft.panels.length} {draft.panels.length === 1 ? "panel" : "panels"}</h2><p>Read in order. Add, rearrange, and edit before publishing.</p></div>{draft.panels.length < 3 && <button type="button" className="wd-button wd-outline" disabled={blocked || !restored} onClick={addPanel}><Plus size={20} /> Add panel {draft.panels.length + 1}</button>}</div>
      <p className="wd-art-note">{role === "continuing" ? "Prepared AI artwork · added panels reuse this illustration with your new caption." : "Prepared AI illustrations · choose a scene and edit its caption."} This is one contribution, credited to {state.me.label}.</p>
      <div className="wd-edit-panels" data-panel-count={draft.panels.length}>
        {draft.panels.map((panel, index) => <fieldset key={index} disabled={blocked || !restored}><legend>Panel {index + 1}</legend><img src={panelImage(panel).src} alt={ASSETS[panel.asset].alt} width={1200} height={panel.asset === "outcome" ? 800 : 1200} />
          {role === "maker" && <label className="wd-art-choice">Prepared scene<select value={panel.asset} onChange={event => edit({ ...draft, panels: draft.panels.map((p, i) => i === index ? { ...p, asset: event.target.value as Asset } : p) })}><option value="source-writing">Writing in the ledger</option><option value="source-ledger">Keeping the names</option></select></label>}
          <label htmlFor={`caption-${index}`}>{state.me.label}’s caption · panel {index + 1}</label><textarea id={`caption-${index}`} maxLength={500} required rows={4} placeholder={role === "continuing" ? "What does the ledger help them remember?" : "What does Nika want to keep?"} value={panel.caption} onChange={event => edit({ ...draft, panels: draft.panels.map((p, i) => i === index ? { ...p, caption: event.target.value } : p) })} />
          {draft.panels.length > 1 && <div className="wd-panel-tools"><button type="button" className="wd-text-button" aria-label={`Move panel ${index + 1} earlier`} disabled={index === 0} onClick={() => movePanel(index, -1)}><ArrowLeft size={16} /> Earlier</button><button type="button" className="wd-text-button" aria-label={`Move panel ${index + 1} later`} disabled={index === draft.panels.length - 1} onClick={() => movePanel(index, 1)}>Later <ArrowRight size={16} /></button><button type="button" className="wd-text-button" aria-label={`Remove panel ${index + 1}`} onClick={() => removePanel(index)}><Trash2 size={16} /> Remove</button></div>}
        </fieldset>)}
        {draft.panels.length < 3 && <button type="button" className="wd-panel-placeholder" disabled={blocked || !restored} onClick={addPanel}><Plus size={24} aria-hidden="true" /><strong>Add panel {draft.panels.length + 1}</strong><span>Give the next beat its own caption.</span></button>}
      </div>
      <p className="wd-sequence-status" role="status">{sequenceNotice || (draft.panels.length === 3 ? "Your scene has all 3 panels. You can still edit, rearrange, or remove them." : "One scene can hold up to 3 panels. Adding a panel keeps it in this contribution.")}</p>
      {localError && <p className="wd-error" role="alert">{localError}</p>}
      <div className="wd-editor-save"><div><strong>{saved ? "Private draft saved" : "Your captions are still a draft"}</strong><p>Preview your scene and byline before sharing it with the room.</p></div><div className="wd-save-buttons"><button type="submit" className="wd-button wd-outline" disabled={blocked || !restored || !draft.title.trim() || draft.panels.some(p => !p.caption.trim())} aria-busy={demo.busy || undefined}><Save size={16} />{demo.busy ? "Saving…" : "Save private draft"}</button><button type="button" className="wd-button wd-yellow" disabled={blocked || !restored || !draft.title.trim() || draft.panels.some(p => !p.caption.trim())} onClick={async () => { if (saved || await save()) { setPreview(true); window.scrollTo({ top: 0, behavior: "instant" }); requestAnimationFrame(() => document.querySelector<HTMLElement>(".wd-publish-preview h1")?.focus()); } }}>Preview contribution <ArrowRight size={20} /></button></div></div>
    </form>
  </section>;
}
