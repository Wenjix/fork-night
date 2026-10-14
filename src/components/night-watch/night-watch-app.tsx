"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Bird, Lock, MoonStar } from "lucide-react";
import type { MeResponse, WorldResponse } from "../../night-watch/api-types.ts";
import { isSavedAccount } from "../../lib/supabase/onboarding.ts";
import { pollWhileVisible } from "../../lib/visible-interval.ts";
import { usePilotAccount } from "../pilot-account.tsx";
import { PilotIdentity } from "../pilot-identity.tsx";
import { AgentRoomHeader } from "../agents/agent-room-header";
import { NightWatchIntro } from "./night-watch-intro";
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
      <span className="nw-agent-role-icon" aria-hidden="true"><Bird size={18} /></span>
      <p><strong>Wren · a room’s agent</strong>Takes public turns in The Night Shift and publishes its own credited scenes. <a href="/agents">Meet Wren</a></p>
    </li>
    <li data-current="true">
      <span className="nw-agent-role-icon" aria-hidden="true"><MoonStar size={18} /></span>
      <p><strong>Night Watch · your agent</strong>Works only for you while you’re away, can read the room with Kimi K3 before it draws, and stays inside limits you sign. You choose what gets published.</p>
    </li>
  </ul>;
}

function Frame({ account, children, privyDemo = false }: { account: ReactNode; children: ReactNode; privyDemo?: boolean }) {
  return <div className={`night-watch${privyDemo ? " nw-privy-demo" : ""}`}>
    <a className="nw-skip" href={privyDemo ? "#desk" : "#world"}>{privyDemo ? "Skip to your desk" : "Skip to the story"}</a>
    <AgentRoomHeader current={privyDemo ? "privy" : "night-watch"}>{account}</AgentRoomHeader>
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
    <footer className="nw-footer">
      <p>Fork Night · testnet only. Test USDC, test MON and test credits have no redemption value. Images are operator-paid inference.</p>
    </footer>
  </div>;
}

/**
 * Signed out: Google and wallet sign-in. Signed in: the pilot's own identity menu, so both pages read
 * the same (storyteller, full in-app wallet address with Copy, sign-out).
 */
function AccountMenu({ me }: { me: MeResponse | null }) {
  const account = usePilotAccount();
  if (!account) return null;
  if (account.loading && !account.user) return <span className="nw-account-quiet" role="status">Checking sign-in…</span>;
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
    <div className="nw-card nw-empty"><Lock size={22} aria-hidden="true" /><p>{text}</p></div>
  </section>;
}

export function NightWatchApp({ privyDemo = false }: { privyDemo?: boolean }) {
  const mounted = useSyncExternalStore(noSubscription, () => true, () => false);
  if (!mounted) return <Frame account={null} privyDemo={privyDemo}><p className="nw-opening" role="status">Opening the Night Watch…</p></Frame>;
  return <NightWatchAccountProvider><NightWatchExperience privyDemo={privyDemo} /></NightWatchAccountProvider>;
}

function NightWatchExperience({ privyDemo }: { privyDemo: boolean }) {
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
  const [worldVersion, setWorldVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const read = userId
      // The world is public; reading it as the maker only refines the friend's contribution.
      ? api.viewerWorld(controller.signal).catch(() => publicApi.world(controller.signal))
      : publicApi.world(controller.signal);
    read.then((next) => {
      setWorld(next);
      setWorldError("");
    }).catch((reason) => {
      if (!controller.signal.aborted) setWorldError(errorMessage(reason, "The world could not be read."));
    });
    return () => controller.abort();
  }, [api, userId, worldVersion]);

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
  const worldPanel = <WorldPanel world={world} error={worldError} forkPointId={forkPoint} signedIn={signedIn} onChooseForkPoint={chooseForkPoint} />;
  const editionPanel = signedIn
    ? <EditionPanel api={api} tip={tip} world={world} me={me} job={currentJob} client={client} />
    : <LockedAct id="morning" act="Act 4" title="The morning edition" text="Published moments appear in the world above. Sign in to release your edition, support it and deliver its shares." />;
  return <Frame account={<AccountMenu me={me} />} privyDemo={privyDemo}>
    {account.error && <p role="alert" className="nw-error nw-on-night nw-page-alert">{account.error}</p>}
    {privyDemo
      ? <details className="nw-privy-context"><summary>Story context: {world?.room.title ?? "The Midnight Signal"}</summary>{worldPanel}</details>
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
      ? <details className="nw-privy-context nw-privy-bonus"><summary>Optional demo: a Privy wallet delivers a Monad share</summary><PrivyHelperCaption />{editionPanel}</details>
      : editionPanel}
  </Frame>;
}
