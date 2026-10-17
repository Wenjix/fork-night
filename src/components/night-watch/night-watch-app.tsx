"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Bird, Lock, MoonStar } from "lucide-react";
import type { MeResponse, WorldResponse } from "../../night-watch/api-types.ts";
import { isSavedAccount } from "../../lib/supabase/onboarding.ts";
import { pollWhileVisible } from "../../lib/visible-interval.ts";
import { usePilotAccount } from "../pilot-account.tsx";
import { PilotIdentity } from "../pilot-identity.tsx";
import { AgentRoomHeader } from "../agents/agent-room-header";
import { HeaderAccountVisibility } from "../app-header";
import { Disclosure } from "../disclosure";
import { NightWatchFooter, NightWatchIntro } from "./night-watch-intro";
import { NightWatchAccountProvider } from "./night-watch-account.tsx";
import { ActHeading, WorldPanel } from "./world-panel.tsx";
import { DeskPanel, SignInButton } from "./desk-panel.tsx";
import { AwayPanel } from "./away-panel.tsx";
import { EditionPanel } from "./edition-panel.tsx";
import { PrivyAwayCaption, PrivyControlCaption, PrivyDemoIntro, PrivyHelperCaption, PrivyPermissionCaption } from "./privy-demo-guide.tsx";
import { errorMessage, IDLE_POLL_MS, isJobActive, latestNightWatchMoment, nightWatchClient, POLL_MS, type Job } from "./api.ts";

/**
 * The /night-watch page: one story in four acts. The world is public; the desk, the night log and
 * the morning edition belong to the signed-in maker. Everything account-related renders only in the
 * browser, so the server sends a calm static frame first.
 */

const publicApi = nightWatchClient(async () => null);
const noSubscription = () => () => {};

const ACTS = [
  { href: "#world", label: "The world" },
  { href: "#desk", label: "Your desk" },
  { href: "#away", label: "While you were away" },
  { href: "#morning", label: "The morning edition" },
];

function scrollToAct(id: string) {
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const target = document.getElementById(id);
  for (let parent = target?.parentElement; parent; parent = parent.parentElement) {
    if (parent instanceof HTMLDetailsElement) parent.open = true;
  }
  target?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
}

/**
 * The bridge to /agents: Fork Night has two kinds of agent, and this page is the second.
 * Wren stays chain-neutral here; its own page tells its allowance story.
 */
function AgentRoles() {
  return <ul className="nw-agent-roles" aria-label="Two kinds of agent in Fork Night">
    <li>
      <span className="nw-agent-role-icon" aria-hidden="true"><Bird size={20} /></span>
      <p><strong>Wren · a room’s agent</strong>Takes public turns in The Uncharted Star and publishes its own credited scenes. <a href="/agents">Meet Wren</a></p>
    </li>
    <li data-current="true">
      <span className="nw-agent-role-icon" aria-hidden="true"><MoonStar size={20} /></span>
      <p><strong>Night Watch · your agent</strong>Works only for you while you’re away, can read the room with Kimi K3 before it draws, and stays inside limits you sign. You choose what gets published.</p>
    </li>
  </ul>;
}

function Frame({ account, children, privyDemo = false }: { account: ReactNode; children: ReactNode; privyDemo?: boolean }) {
  return <div className={`night-watch${privyDemo ? " nw-privy-demo" : ""}`}>
    <a className="nw-skip" href={privyDemo ? "#desk" : "#world"}>{privyDemo ? "Skip to your desk" : "Skip to the story"}</a>
    {/* AccountMenu is portalled into this header slot, so the shared account chip stays hidden. */}
    <HeaderAccountVisibility.Provider value={false}><AgentRoomHeader current={privyDemo ? "privy" : "night-watch"}>{account}</AgentRoomHeader></HeaderAccountVisibility.Provider>
    <main className="nw-main">
      <section className="nw-hero" aria-labelledby="nw-title">
        <NightWatchIntro privyDemo={privyDemo} />
        {privyDemo ? <PrivyDemoIntro /> : <><AgentRoles />
        <nav className="nw-acts" aria-label="The four acts">
          <ol>{ACTS.map((act, index) => <li key={act.href}><a href={act.href}><span aria-hidden="true">{index + 1}</span>{act.label}</a></li>)}</ol>
        </nav></>}
      </section>
      {children}
    </main>
    <NightWatchFooter />
  </div>;
}

/** Until sign-in is known, the signed-out controls hold their place, disabled, so the page does not jump. */
function CheckingSignIn() {
  return <div className="nw-header-identity">
    <SignInButton compact disabled />
    <span className="nw-visually-hidden" role="status">Checking sign-in…</span>
  </div>;
}

/**
 * Signed out: Google and wallet sign-in. Signed in: the pilot's own identity menu, so both pages read
 * the same (storyteller, full in-app wallet address with Copy, sign-out).
 */
function AccountMenu({ me }: { me: MeResponse | null }) {
  const account = usePilotAccount();
  if (!account) return null;
  if (account.loading && !account.user) return <CheckingSignIn />;
  // Signed out (or a browser guest): both sign-ins, never the pilot's guest-name detour.
  if (!isSavedAccount(account.user)) return <div className="nw-header-identity"><SignInButton compact /></div>;
  // "Maker" is the server's stand-in when no storyteller name exists yet (src/night-watch/maker.ts).
  const named = me && me.maker.displayName !== "Maker" ? me.maker : null;
  const profile = named ? { id: named.id, display_name: named.displayName, created_at: "" } : undefined;
  return <div className="nw-header-identity">
    <PilotIdentity profile={profile} disabled={account.loading} joinLabel="Choose a storyteller name"
      onJoin={() => window.location.assign("/pilot?create=1")} />
  </div>;
}

function LockedAct({ id, act, title, text }: { id: string; act: string; title: string; text: string }) {
  return <section id={id} className={`nw-act${id === "morning" ? " nw-act-dawn" : " nw-act-night"}`} aria-labelledby={`${id}-title`}>
    <ActHeading act={act} id={`${id}-title`} title={title} />
    <div className="nw-card nw-empty"><Lock size={24} aria-hidden="true" /><p>{text}</p></div>
  </section>;
}

/**
 * The frame is the same server-rendered nodes before and after mount, so hydration keeps it and any keyboard
 * focus in it. The account provider and the acts mount inside it; the account menu is portalled into its header.
 */
export function NightWatchApp({ privyDemo = false }: { privyDemo?: boolean }) {
  const mounted = useSyncExternalStore(noSubscription, () => true, () => false);
  const [accountSlot, setAccountSlot] = useState<HTMLSpanElement | null>(null);
  const slot = mounted ? accountSlot : null;
  return <Frame account={<span ref={setAccountSlot} className="nw-account-slot">{!slot && <CheckingSignIn />}</span>} privyDemo={privyDemo}>
    {slot
      ? <NightWatchAccountProvider><NightWatchExperience privyDemo={privyDemo} accountSlot={slot} /></NightWatchAccountProvider>
      : <p className="nw-opening" role="status">Opening the Night Watch…</p>}
  </Frame>;
}

function NightWatchExperience({ privyDemo, accountSlot }: { privyDemo: boolean; accountSlot: HTMLElement }) {
  const account = usePilotAccount()!;
  const client = account.client;
  const signedIn = isSavedAccount(account.user);
  const userId = signedIn ? account.user!.id : "";
  const token = useCallback(async () => {
    if (!client) return null;
    const session = await client.auth.getSession();
    return session.error ? null : session.data.session?.access_token ?? null;
  }, [client]);
  const api = useMemo(() => nightWatchClient(token), [token]);

  const [world, setWorld] = useState<WorldResponse | null>(null);
  const [worldError, setWorldError] = useState("");
  const [worldReading, setWorldReading] = useState(true);
  const [worldVersion, setWorldVersion] = useState(0);
  const readWorld = useCallback((signal: AbortSignal) => userId
    // The world is public; reading it as the maker only refines the friend's contribution.
    ? api.viewerWorld(signal).catch(() => publicApi.world(signal))
    : publicApi.world(signal), [api, userId]);
  useEffect(() => {
    const controller = new AbortController();
    setWorldReading(true);
    readWorld(controller.signal).then((next) => {
      setWorld(next);
      setWorldError("");
    }).catch((reason) => {
      if (!controller.signal.aborted) setWorldError(errorMessage(reason, "The world could not be read."));
    }).finally(() => {
      if (!controller.signal.aborted) setWorldReading(false);
    });
    return () => controller.abort();
  }, [readWorld, worldVersion]);
  // After a failed read, keep trying quietly: with backoff, and at once when the reader returns or reconnects.
  const worldFailed = !!worldError;
  useEffect(() => {
    if (!worldFailed) return;
    const controller = new AbortController();
    const stop = pollWhileVisible(async () => {
      const next = await readWorld(controller.signal);
      setWorld(next);
      setWorldError("");
    }, IDLE_POLL_MS);
    return () => {
      controller.abort();
      stop();
    };
  }, [readWorld, worldFailed]);
  const retryWorld = useCallback(() => setWorldVersion((value) => value + 1), []);

  const [me, setMe] = useState<MeResponse | null>(null);
  const [meError, setMeError] = useState("");
  const [meVersion, setMeVersion] = useState(0);
  const refreshMe = useCallback(() => setMeVersion((value) => value + 1), []);
  const meBusy = !!me?.jobs.some((item) => isJobActive(item.state));
  useEffect(() => {
    setMe(null);
    setMeError("");
  }, [userId]);
  useEffect(() => {
    if (!userId) return;
    let active = true;
    const stop = pollWhileVisible(async () => {
      try {
        const next = await api.me();
        if (active) {
          setMe(next);
          setMeError("");
        }
      } catch (reason) {
        if (active) setMeError(errorMessage(reason, "Your Night Watch could not be read."));
        throw reason;
      }
    }, meBusy ? POLL_MS : IDLE_POLL_MS);
    return () => {
      active = false;
      stop();
    };
  }, [api, userId, meVersion, meBusy]);

  const jobs = useMemo(() => [...(me?.jobs ?? [])].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)), [me]);
  const [chosenJobId, setChosenJobId] = useState<string | null>(null);
  useEffect(() => {
    setChosenJobId(null);
  }, [userId]);
  const jobId = chosenJobId ?? jobs[0]?.id ?? null;
  const jobIdRef = useRef(jobId);
  jobIdRef.current = jobId;
  const [job, setJob] = useState<Job | null>(null);
  const [jobError, setJobError] = useState("");
  const loadJob = useCallback(async (id: string) => {
    try {
      const next = await api.job(id);
      if (next.job.id === jobIdRef.current) {
        setJob(next.job);
        setJobError("");
      }
    } catch (reason) {
      if (id === jobIdRef.current) setJobError(errorMessage(reason, "The Night Watch log could not be read."));
      throw reason;
    }
  }, [api]);
  const currentJob = job && job.id === jobId ? job : null;
  const summary = jobs.find((item) => item.id === jobId);
  // Poll while the job can still change, or when the summary says it moved on.
  const watching = !!jobId && (!currentJob || isJobActive(currentJob.state) || (!!summary && summary.state !== currentJob.state));
  useEffect(() => {
    if (!userId || !jobId || !watching) return;
    return pollWhileVisible(() => loadJob(jobId), POLL_MS);
  }, [userId, jobId, watching, loadJob]);
  const refreshJob = useCallback(() => {
    if (jobIdRef.current) void loadJob(jobIdRef.current).catch(() => undefined);
  }, [loadJob]);

  const [forkPointId, setForkPointId] = useState("");
  const forkPoint = forkPointId || world?.defaultForkPointId || "";
  const chooseForkPoint = useCallback((id: string) => {
    setForkPointId(id);
    requestAnimationFrame(() => scrollToAct("desk"));
  }, []);
  const scheduled = useCallback((created: Job) => {
    setChosenJobId(created.id);
    setJob(created);
    refreshMe();
  }, [refreshMe]);
  const published = useCallback(() => {
    setWorldVersion((value) => value + 1);
    refreshMe();
    refreshJob();
    setTimeout(() => scrollToAct("morning"), 250);
  }, [refreshMe, refreshJob]);

  const tip = currentJob?.publishedMomentId ?? latestNightWatchMoment(world?.moments ?? [], userId)?.id ?? null;
  const jobForkPoint = currentJob ? world?.moments.find((moment) => moment.id === currentJob.forkPointId) ?? null : null;
  const worldPanel = <WorldPanel world={world} error={worldError} reading={worldReading} forkPointId={forkPoint} signedIn={signedIn}
    onChooseForkPoint={chooseForkPoint} onRetry={retryWorld} />;
  const editionPanel = signedIn
    ? <EditionPanel api={api} tip={tip} world={world} me={me} job={currentJob} client={client} />
    : <LockedAct id="morning" act="Act 4" title="The morning edition" text="Published moments appear in the world above. Sign in to release your edition, support it and deliver its shares." />;
  return <>
    {createPortal(<AccountMenu me={me} />, accountSlot)}
    {account.error && <p role="alert" className="nw-error nw-on-night nw-page-alert">{account.error}</p>}
    {privyDemo
      ? <Disclosure className="nw-privy-context" summary={`Story context: ${world?.room.title ?? "The Midnight Signal"}`}>{worldPanel}</Disclosure>
      : worldPanel}
    {privyDemo && <PrivyPermissionCaption />}
    <DeskPanel api={api} world={world} me={me} meError={meError} signedIn={signedIn} accountLoading={account.loading}
      forkPointId={forkPoint} onForkPoint={setForkPointId} latestJob={jobs[0] ?? null} onScheduled={scheduled} onChanged={refreshMe} />
    {privyDemo && <PrivyAwayCaption />}
    {signedIn
      ? <AwayPanel api={api} jobs={jobs} jobId={jobId} job={currentJob} jobError={jobError} me={me} forkPoint={jobForkPoint}
        onSelectJob={setChosenJobId} onRefresh={refreshJob} onPublished={published} />
      : <LockedAct id="away" act="Act 3" title="While you were away" text="Sign in to read your Night Watch log, its receipt and the private candidates it prepared for you." />}
    {privyDemo && <PrivyControlCaption />}
    {privyDemo
      ? <Disclosure className="nw-privy-context nw-privy-bonus" summary="Optional demo: a Privy wallet delivers a Monad share"><PrivyHelperCaption />{editionPanel}</Disclosure>
      : editionPanel}
  </>;
}
