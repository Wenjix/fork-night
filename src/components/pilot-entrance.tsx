"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Plus, Users } from "lucide-react";
import { pilotBrowserClient } from "../lib/supabase/pilot-client";
import type { Tables } from "../lib/supabase/database.types";
import { joinPilotAsGuest } from "../lib/supabase/guest";
import { parseRoomIntent, roomIntentKey, type CreationStatus, type RoomIntent } from "../lib/pilot-rooms";
import { usePilotAccount } from "./pilot-account";
import { PilotIdentity } from "./pilot-identity";
import { PilotImage } from "./pilot-panels";
import { pilotPanels } from "../lib/pilot";

type Room = Tables<"pilot_rooms">;
type Template = Tables<"pilot_room_templates">;
const formKey = "fork-night:room-form";

export function PilotEntrance({ creating, navigate }: { creating: boolean; navigate: (path: string) => void }) {
  const account = usePilotAccount();
  const client = pilotBrowserClient();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [joined, setJoined] = useState<Room[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [policy, setPolicy] = useState<CreationStatus>();
  const [profile, setProfile] = useState<Tables<"pilot_profiles">>();
  const [name, setName] = useState("");
  const [choice, setChoice] = useState("midnight-signal:1");
  const [title, setTitle] = useState("The midnight signal");
  const [edited, setEdited] = useState(false);
  const [pending, setPending] = useState<RoomIntent>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [check, setCheck] = useState(0);
  const actor = useRef(account?.user?.id);
  actor.current = account?.user?.id;
  const locked = useRef(false);
  const lastActor = useRef<string | undefined>(undefined);
  const nameField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(formKey) ?? "null");
      if (saved && typeof saved.title === "string" && typeof saved.choice === "string") {
        setTitle(saved.title.slice(0, 160)); setChoice(saved.choice); setEdited(true);
      }
    } catch { /* A new form works without a prior session. */ }
  }, []);
  useEffect(() => {
    if (!client) { setError("Shared rooms are not configured yet."); return; }
    let live = true;
    setPolicy(undefined); setJoined([]); setProfile(undefined); setPending(undefined);
    const id = account?.user?.id;
    if (lastActor.current && lastActor.current !== id) {
      setTitle("The midnight signal"); setChoice("midnight-signal:1"); setEdited(false); setName("");
      try { sessionStorage.removeItem(formKey); } catch { /* Actor-bound pending requests remain saved independently. */ }
    }
    lastActor.current = id;
    if (id) {
      try {
        const intent = parseRoomIntent(JSON.parse(localStorage.getItem(roomIntentKey(id)) ?? "null"));
        if (intent) { setPending(intent); setTitle(intent.title); setChoice(`${intent.templateId}:${intent.templateVersion}`); }
      } catch { setError("This browser could not restore your room request. Keep its original browser open before creating another."); }
    }
    void (async () => {
      const [directory, openings, status, own, participation] = await Promise.all([
        client.from("pilot_rooms").select("*").eq("is_listed", true).order("title"),
        client.from("pilot_room_templates").select("*").order("id").order("version", { ascending: false }),
        client.rpc("pilot_creation_status", {}),
        id ? client.from("pilot_profiles").select("*").eq("id", id).maybeSingle() : Promise.resolve({ data: null, error: null }),
        id ? client.from("pilot_room_participants").select("pilot_rooms(*)").eq("maker_id", id).order("joined_at", { ascending: false }).limit(30) : Promise.resolve({ data: [], error: null }),
      ]);
      if (!live) return;
      if ([directory, openings, status, own, participation].some(result => result.error)) {
        setError("Shared stories could not be refreshed. Reconnect and check again."); return;
      }
      setRooms(directory.data ?? []); setTemplates(openings.data ?? []); setPolicy(status.data as CreationStatus);
      setProfile(own.data ?? undefined);
      setJoined((participation.data ?? []).map(row => row.pilot_rooms).filter((room): room is Room => !!room));
    })().catch(() => { if (live) setError("Shared stories could not be refreshed. Reconnect and check again."); });
    return () => { live = false; };
  }, [client, account?.user?.id, check]);

  function saveForm(nextTitle: string, nextChoice: string) {
    try { sessionStorage.setItem(formKey, JSON.stringify({ title: nextTitle, choice: nextChoice })); }
    catch { /* The form stays in memory; submitted intents require durable storage below. */ }
  }
  async function join() {
    if (!client || locked.current) return;
    locked.current = true; setBusy(true); setError("");
    try { setProfile(await joinPilotAsGuest(client, name)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Your name could not be saved."); }
    finally { locked.current = false; setBusy(false); }
  }
  async function create() {
    if (!client || !profile || locked.current) return;
    const owner = profile.id;
    locked.current = true; setBusy(true); setError("");
    try {
      const [templateId, version] = choice.split(":");
      const intent = pending ?? parseRoomIntent({ requestId: crypto.randomUUID(), title, templateId, templateVersion: Number(version) });
      if (!intent) throw new Error("Enter a room title of 1–80 characters and choose an opening.");
      // Persist before sending. Unknown outcomes can only check this exact request.
      localStorage.setItem(roomIntentKey(owner), JSON.stringify(intent)); setPending(intent);
      const session = await client.auth.getSession();
      if (session.error || session.data.session?.user.id !== owner) throw new Error("Your storyteller account changed. Reconnect before creating a room.");
      const response = await fetch("/api/pilot/rooms", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.data.session.access_token}` },
        body: JSON.stringify(intent), signal: AbortSignal.timeout(30_000),
      });
      const result = await response.json();
      if (actor.current !== owner) return;
      if (!response.ok) {
        if (result.rejected === true) { localStorage.removeItem(roomIntentKey(owner)); setPending(undefined); }
        throw new Error(result.error ?? "Your room could not be confirmed. Check the same request.");
      }
      if (typeof result.roomId !== "string") throw new Error("Your room could not be confirmed. Check the same request.");
      localStorage.removeItem(roomIntentKey(owner)); sessionStorage.removeItem(formKey);
      navigate(`/pilot?room=${encodeURIComponent(result.roomId)}&created=1`);
    } catch (reason) { if (actor.current === owner) setError(reason instanceof Error ? reason.message : "Check your saved room request when you reconnect."); }
    finally { locked.current = false; setBusy(false); }
  }
  const available = !!policy?.enabled && policy.remainingRooms > 0 && !policy.ownRoomId;
  const cards = (items: Room[]) => <div className="pilot-room-cards">{items.map(room => <a className="pilot-room-card" key={room.id} href={`/pilot?room=${encodeURIComponent(room.id)}`}><Users size={22} aria-hidden="true" /><h3>{room.title}</h3><p>{room.description}</p><span>Read this story <ArrowRight size={17} aria-hidden="true" /></span></a>)}</div>;
  return <main className="pilot-shell pilot-entrance">
    <header className="pilot-header"><a className="pilot-brand" href="/pilot">fork night<span>.</span></a><div className="pilot-header-actions"><PilotIdentity profile={profile} disabled={busy || !!pending || !!account?.loading} onJoin={() => { navigate("/pilot?create=1"); requestAnimationFrame(() => nameField.current?.focus()); }} joinLabel="Choose a storyteller name" /></div></header>
    {creating ? <>
      <a className="text-button" href="/pilot"><ArrowLeft size={16} aria-hidden="true" />Shared stories</a>
      <div className="pilot-intro"><h1>A beginning for your story.</h1><p>Choose a prepared opening, then invite two or three storytellers to see where it goes.</p></div>
      <form className="pilot-create-form" onSubmit={event => { event.preventDefault(); void create(); }}>
        <fieldset disabled={busy || !!pending}><legend>Choose an opening</legend><div className="pilot-template-cards">{templates.map(template => <label className="pilot-template-card" key={`${template.id}:${template.version}`} data-selected={choice === `${template.id}:${template.version}`}>
          <input type="radio" name="opening" value={`${template.id}:${template.version}`} checked={choice === `${template.id}:${template.version}`} onChange={() => { const next = `${template.id}:${template.version}`; setChoice(next); if (!edited) setTitle(template.title); saveForm(edited ? title : template.title, next); }} />
          <div className="pilot-template-art"><PilotImage client={client!} panel={pilotPanels(template.panels)[0]} /></div><span><strong>{template.title}</strong><small>Prepared opening · {template.seed_byline}</small><p>{template.description}</p></span>
        </label>)}</div><label className="pilot-create-label">Room title<input value={title} maxLength={80} required onChange={event => { setTitle(event.target.value); setEdited(true); saveForm(event.target.value, choice); }} /></label></fieldset>
        {profile ? <p>Creating as <strong>{profile.display_name}</strong></p> : <div className="pilot-create-name"><label className="pilot-create-label">Your public storyteller name<input ref={nameField} value={name} maxLength={60} autoComplete="nickname" disabled={busy} onChange={event => setName(event.target.value)} /></label><button type="button" className="button secondary" disabled={busy || !client || !!account?.loading || !name.trim()} onClick={() => void join()}>Save storyteller name</button></div>}
        <p>Published stories and your room name are public. Your previews stay private until you publish. Your storyteller name will be visible in the room.</p>
        {policy?.enabled && <p className="pilot-room-grant"><strong>{policy.creditsPerRoom} room credits to start.</strong> One or two panels use one credit; three use two. Generation depends on the remaining demo allowance.</p>}
        {policy && !available && !pending && <p role="status">{policy.ownRoomId ? <>Your demo room is ready. <a href={`/pilot?room=${encodeURIComponent(policy.ownRoomId)}`}>Return to your room</a>.</> : policy.enabled ? "All demo rooms have been created. You can still join an existing story." : "New room creation is paused. Existing stories are open to read and join."}</p>}
        <button className="button primary" disabled={busy || !profile || !client || !!account?.loading || (!pending && !available)}>{busy ? "Checking your room…" : pending ? "Check room" : "Create room"}<ArrowRight size={18} aria-hidden="true" /></button>
        {pending && !busy && <p>Your room request is saved. Check it to confirm the same room.</p>}
      </form>
    </> : <><div className="pilot-intro"><h1>Make a story together.</h1><p>One beginning. A few storytellers. Follow a thread or take it somewhere new.</p></div><a className="pilot-create-invitation" href="/pilot?create=1"><Plus size={26} aria-hidden="true" /><span><strong>Create a room</strong><small>Start with a prepared opening and invite your storytellers.</small></span><ArrowRight size={22} aria-hidden="true" /></a></>}
    {(error || account?.error) && <div className="pilot-notice" role="alert"><p>{error || account?.error}</p><button type="button" className="text-button" onClick={() => { setError(""); setCheck(value => value + 1); }}>Check connection</button></div>}
    {!!joined.length && <section aria-label="Your joined rooms"><h2>Your joined stories</h2>{cards(joined)}</section>}
    <section aria-label="Open shared stories"><h2>Stories to pick up</h2>{cards(rooms)}</section>
  </main>;
}
