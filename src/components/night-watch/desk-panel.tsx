"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, CircleAlert, CircleDashed, Clock3, ExternalLink, Images, KeyRound, LoaderCircle, MoonStar, ShieldCheck, Sparkles, Wallet, X } from "lucide-react";
import type { ConsentTerms, CopilotResponse, JobSummary, MeResponse, SessionView, WorldResponse } from "../../night-watch/api-types.ts";
import { GoogleButton } from "../auth-branding.tsx";
import { BrandBadge, BrandStrip, Chip } from "../brand-badge";
import { WalletSignInButton } from "../pilot-wallet-signin.tsx";
import { usePilotAccount } from "../pilot-account.tsx";
import { useNightWatchPrivy } from "./night-watch-account.tsx";
import { ActHeading } from "./world-panel.tsx";
import { Disclosure } from "../disclosure";
import { CardHeading } from "./card-heading";
import { ModelBadge, PaymentChain, RouterBadge } from "./night-watch-badges";
import {
  BRIEF_LIMIT,
  consentItems,
  consentMismatches,
  consentPreview,
  dateTime,
  DEFAULT_HOURS,
  DEFAULT_START_SECONDS,
  deskProblems,
  errorMessage,
  forkPointChoices,
  HOUR_CHOICES,
  isJobActive,
  momentLabel,
  openSessions,
  plural,
  safeHref,
  sameAddress,
  shortHex,
  START_CHOICES,
  timeLeft,
  clockTime,
  formatUsdc,
  type ConsentPreview,
  type DeskChoices,
  type Job,
  type NightWatchClient,
} from "./api.ts";

/** A clock that ticks every `ms`, for countdowns and consent deadlines. */
export function useNow(ms: number) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

export function SignInButton({ label = "Sign in with Google", compact = false, disabled = false }: { label?: string; compact?: boolean; disabled?: boolean }) {
  const account = usePilotAccount();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  async function start() {
    if (!account || working) return;
    setWorking(true);
    setError("");
    try {
      await account.signIn("return");
    } catch (reason) {
      setError(errorMessage(reason, "Google sign-in could not start. Try again."));
      setWorking(false);
    }
  }
  return <div className={`nw-signin${compact ? " nw-signin-compact" : ""}`}>
    <div className="pilot-account-entry nw-signin-choices">
      <GoogleButton type="button" disabled={disabled || !account?.client || working} onClick={() => void start()}>{working ? "Opening Google…" : label}</GoogleButton>
      <WalletSignInButton disabled={disabled || !account?.client || working} />
    </div>
    {!account?.client && !compact && <small>Sign-in is awaiting Supabase setup on this server.</small>}
    {(error || (!compact && account?.error)) && <p role="alert" className="nw-error">{error || account?.error}</p>}
  </div>;
}

type StepKey = "session" | "signer" | "confirm" | "job";
type StepState = "working" | "done" | "failed";
const STEPS: { key: StepKey; label: string }[] = [
  { key: "session", label: "Create the session and its Privy policy" },
  { key: "signer", label: "Add the Night Watch signer to your in-app wallet" },
  { key: "confirm", label: "Check the signer and its policy with Privy" },
  { key: "job", label: "Schedule the Night Watch" },
];
const STEP_LABEL = Object.fromEntries(STEPS.map((step) => [step.key, step.label])) as Record<StepKey, string>;

const draftKey = (userId: string) => `night-watch:brief:${userId}`;
function readDraft(userId: string) {
  try {
    return userId ? window.sessionStorage.getItem(draftKey(userId)) ?? "" : "";
  } catch {
    return "";
  }
}
function writeDraft(userId: string, brief: string) {
  try {
    if (!userId) return;
    if (brief) window.sessionStorage.setItem(draftKey(userId), brief);
    else window.sessionStorage.removeItem(draftKey(userId));
  } catch {
    // An unavailable draft store only means the brief is not kept across reloads.
  }
}

const newestFirst = (a: SessionView, b: SessionView) => Date.parse(b.deadline) - Date.parse(a.deadline);
const PAYMENT_STATES: Record<SessionView["payments"][number]["state"], string> = {
  reserved: "Reserved from your allowance",
  signed: "Signed, waiting to settle",
  settled: "Settled",
  released: "Released, nothing was paid",
};

function StepIcon({ state }: { state: StepState | undefined }) {
  if (state === "done") return <Check size={16} aria-hidden="true" />;
  if (state === "failed") return <X size={16} aria-hidden="true" />;
  if (state === "working") return <LoaderCircle size={16} aria-hidden="true" className="nw-spin" />;
  return <CircleDashed size={16} aria-hidden="true" />;
}

function SessionCard({ session, now, revoking, disabled, onRevoke }: { session: SessionView; now: Date; revoking: boolean; disabled: boolean; onRevoke: () => void }) {
  const active = session.state === "active";
  return <section className="nw-session" data-state={session.state} aria-labelledby={`nw-session-${session.id}`}>
    <div className="nw-session-head">
      <ShieldCheck size={20} aria-hidden="true" />
      <div>
        <h4 id={`nw-session-${session.id}`}>{active ? "Night Watch authorized" : "Waiting for the Night Watch signer"}</h4>
        <p>Signing stops at {dateTime(session.deadline)} · {timeLeft(session.deadline, now)}</p>
      </div>
    </div>
    <dl className="nw-limits">
      <div><dt>Limit</dt><dd>{formatUsdc(session.limits.totalAllowanceAtomic)} · {plural(session.limits.maxPayments, "top-up")}</dd></div>
      <div><dt>Allowed call</dt><dd>{session.limits.maxPayments > 0 ? <>One transfer of at most {formatUsdc(session.limits.maxPaymentAtomic)} on <PaymentChain /></> : "None: no payments allowed"}</dd></div>
      <div><dt>Still available</dt><dd>{formatUsdc(session.remainingAtomic)}</dd></div>
      <div><dt>Attempts</dt><dd>Up to {plural(session.limits.attemptAllowance, "candidate")}</dd></div>
    </dl>
    {session.payments.length > 0 && <ul className="nw-payments" aria-label="Payments under this allowance">
      {session.payments.map((payment) => {
        const href = safeHref(payment.explorerUrl);
        return <li key={payment.id}>
          <span><strong>{formatUsdc(payment.amountAtomic)}</strong> · {PAYMENT_STATES[payment.state]}{payment.creditsAdded ? ` · +${payment.creditsAdded} test credits` : ""}</span>
          {href && payment.transaction && <a href={href} target="_blank" rel="noreferrer">{shortHex(payment.transaction)} <ExternalLink size={16} aria-hidden="true" /></a>}
        </li>;
      })}
    </ul>}
    <div className="nw-session-actions">
      <button type="button" className="button secondary nw-revoke" disabled={disabled || revoking} onClick={onRevoke}>{revoking ? "Revoking…" : "Revoke Night Watch"}</button>
      <small>Revoking removes the signer from your wallet and sets its policy to deny every request. A payment that already settled stays settled.</small>
    </div>
    <Disclosure className="nw-technical" summary="Session details">
      <dl>
        <div><dt>Session</dt><dd><code>{session.id}</code></dd></div>
        <div><dt>Wallet</dt><dd><code>{session.walletAddress}</code></dd></div>
        <div><dt>Pays only to</dt><dd><code>{session.limits.payTo}</code></dd></div>
        <div><dt>Token (test USDC)</dt><dd><code>{session.limits.token}</code> · <PaymentChain label={`chain ${session.limits.chainId}`} /></dd></div>
      </dl>
    </Disclosure>
  </section>;
}

export function DeskPanel({ api, world, me, meError, signedIn, accountLoading, forkPointId, onForkPoint, latestJob, onScheduled, onChanged }: {
  api: NightWatchClient;
  world: WorldResponse | null;
  me: MeResponse | null;
  meError: string;
  signedIn: boolean;
  accountLoading: boolean;
  forkPointId: string;
  onForkPoint: (id: string) => void;
  latestJob: JobSummary | null;
  onScheduled: (job: Job) => void;
  onChanged: () => void;
}) {
  const privy = useNightWatchPrivy();
  const ids = useId();
  const now = useNow(30_000);
  const userId = me?.maker.id ?? "";
  const [brief, setBrief] = useState("");
  const [attempts, setAttempts] = useState<1 | 2 | 3>(2);
  const [maxPayments, setMaxPayments] = useState<0 | 1>(1);
  const [hours, setHours] = useState(DEFAULT_HOURS);
  const [startInSeconds, setStartInSeconds] = useState(DEFAULT_START_SECONDS);
  const [agreed, setAgreed] = useState(false);
  const [working, setWorking] = useState(false);
  const [revoking, setRevoking] = useState("");
  const [progress, setProgress] = useState<Partial<Record<StepKey, StepState>>>({});
  const [terms, setTerms] = useState<ConsentTerms | null>(null);
  const [scheduled, setScheduled] = useState<Job | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const busy = useRef(false);

  useEffect(() => {
    // Restore a saved draft only into an empty brief, so text typed while loading is kept.
    setBrief((current) => current || readDraft(userId));
  }, [userId]);
  const changeBrief = (value: string) => {
    setBrief(value);
    writeDraft(userId, value);
  };

  // The desk co-pilot: suggestions belong to one fork point, so a new fork point clears them.
  const [copilot, setCopilot] = useState<CopilotResponse | null>(null);
  const [asking, setAsking] = useState(false);
  const [copilotError, setCopilotError] = useState("");
  const copilotRun = useRef(0);
  useEffect(() => {
    copilotRun.current += 1;
    setCopilot(null);
    setCopilotError("");
    setAsking(false);
  }, [forkPointId]);
  async function askCopilot() {
    if (asking || working || !forkPointId) return;
    const run = ++copilotRun.current;
    setAsking(true);
    setCopilotError("");
    try {
      const answer = await api.copilot({ forkPointId, draft: brief.trim() || undefined });
      if (run === copilotRun.current) setCopilot(answer);
    } catch (reason) {
      if (run === copilotRun.current) setCopilotError(errorMessage(reason, "The room co-pilot didn't answer. Try again, or write your own brief."));
    } finally {
      if (run === copilotRun.current) setAsking(false);
    }
  }
  // Consent covers specific limits: changing any of them asks again.
  useEffect(() => {
    setAgreed(false);
    setTerms(null);
    setScheduled(null);
  }, [attempts, maxPayments, hours, forkPointId]);

  const choices: DeskChoices = { forkPointId, brief, attempts, maxPayments, hours, startInSeconds };
  const forkPoint = world?.moments.find((moment) => moment.id === forkPointId);
  const preview: ConsentPreview = consentPreview(choices, now, forkPoint?.title);
  const problems = deskProblems(choices);
  const sessions = [...(me?.sessions ?? [])].sort(newestFirst);
  const open = openSessions(sessions)[0] ?? null;
  const earlier = sessions.filter((session) => session.id !== open?.id);
  const jobRunning = !!latestJob && isJobActive(latestJob.state);
  const serverWallet = me?.privy.wallet ?? null;
  const walletMismatch = !!serverWallet && !!privy.address && !sameAddress(serverWallet.address, privy.address);

  function blockReason(): string {
    if (!signedIn) return "Sign in with Google or your wallet on this machine first.";
    if (!privy.configured) return privy.error;
    if (!me) return meError || "Loading your Night Watch…";
    if (!me.privy.configured) return "The operator has not finished the Privy server setup on this machine.";
    if (!me.privy.signerId) return "The operator has not created the Night Watch signer yet.";
    if (privy.error) return privy.error;
    if (!privy.ready) return "Preparing your in-app wallet…";
    if (!privy.walletId) return "Privy has not reported a server ID for your in-app wallet yet, so a signer cannot be added. Refresh in a moment.";
    if (walletMismatch) return "The server sees a different Privy wallet than this browser. Refresh before authorizing.";
    if (jobRunning) return "A Night Watch is already scheduled or running. Wait for it to finish or revoke it first.";
    if (problems.length) return problems[0];
    if (!agreed) return "Tick the consent box to authorize these limits.";
    return "";
  }
  const reason = blockReason();

  async function retire(sessionId: string, signerTouched: boolean) {
    const notes: string[] = [];
    // The app's own refusal first: it never waits on the wallet.
    try {
      const revoked = await api.revokeSession(sessionId);
      notes.push(revoked.message);
    } catch {
      notes.push("The server could not revoke this attempt yet; use Revoke to try again.");
    }
    if (signerTouched) {
      try {
        await privy.removeAllSigners();
        notes.push("The signer was removed from your wallet.");
      } catch {
        notes.push("Privy could not remove the signer; use Revoke to try again.");
      }
    }
    return notes.join(" ");
  }

  async function authorize() {
    if (busy.current) return;
    const blocked = blockReason();
    if (blocked) {
      setError(blocked);
      return;
    }
    busy.current = true;
    setWorking(true);
    setError("");
    setNotice("");
    setScheduled(null);
    setTerms(null);
    setProgress({});
    const agreedTerms = consentPreview(choices, new Date(), forkPoint?.title);
    let step: StepKey = "session";
    let sessionId = "";
    let signerTouched = false;
    try {
      setProgress({ session: "working" });
      // A new signer replaces the old one, so an earlier allowance is retired first.
      for (const previous of openSessions(me!.sessions)) {
        try {
          await api.revokeSession(previous.id);
        } catch (reason) {
          throw new Error(`An earlier Night Watch allowance could not be revoked (${errorMessage(reason, "unknown error")}).`);
        }
      }
      const created = await api.createSession({ hours: choices.hours, maxPayments: choices.maxPayments, attemptAllowance: choices.attempts });
      sessionId = created.session.id;
      const mismatches = consentMismatches(agreedTerms, created.consent);
      if (mismatches.length) throw new Error(`The server proposed different terms (${mismatches.join(", ")}) from the ones you agreed to. Nothing was added to your wallet.`);
      if (!sameAddress(created.signer.address, privy.address)) throw new Error("The session names a different wallet than your in-app wallet. Nothing was added to your wallet.");
      if (!created.signer.policyIds.length) throw new Error("The session has no Privy policy, so its signer would be unrestricted. Nothing was added to your wallet.");
      setTerms(created.consent);
      step = "signer";
      setProgress({ session: "done", signer: "working" });
      signerTouched = true;
      // Privy appends signers without removing duplicates, so an existing list is cleared first.
      if (privy.delegated || me!.privy.wallet?.delegated) await privy.removeAllSigners();
      await privy.addSigner(created.signer.signerId, created.signer.policyIds);
      step = "confirm";
      setProgress({ session: "done", signer: "done", confirm: "working" });
      await api.confirmSession(sessionId);
      step = "job";
      setProgress({ session: "done", signer: "done", confirm: "done", job: "working" });
      const { job } = await api.createJob({ sessionId, forkPointId: choices.forkPointId, brief: choices.brief.trim(), startInSeconds: choices.startInSeconds });
      setProgress({ session: "done", signer: "done", confirm: "done", job: "done" });
      setScheduled(job);
      setAgreed(false);
      changeBrief("");
      onScheduled(job);
    } catch (reason) {
      setProgress((current) => ({ ...current, [step]: "failed" }));
      const message = errorMessage(reason, "The Night Watch could not be authorized.");
      const cleanup = sessionId ? await retire(sessionId, signerTouched) : "";
      setError(`${STEP_LABEL[step]} did not finish: ${message}${cleanup ? ` ${cleanup}` : ""}`);
    } finally {
      busy.current = false;
      setWorking(false);
      onChanged();
    }
  }

  async function revoke(session: SessionView) {
    if (busy.current) return;
    busy.current = true;
    setRevoking(session.id);
    setError("");
    setNotice("");
    let walletNote = "";
    try {
      // Server first: the app stops signing and the session policy turns to deny-all at once.
      const revoked = await api.revokeSession(session.id);
      try {
        if (privy.ready) await privy.removeAllSigners();
        else walletNote = " Your in-app wallet is not open in this browser, so its signer list was not changed.";
      } catch (reason) {
        walletNote = ` Privy could not remove the signer from your wallet (${errorMessage(reason, "unknown error")}).`;
      }
      setNotice(revoked.privyPolicyRevoked
        ? `Night Watch revoked. ${revoked.message}${walletNote}`
        : `Night Watch revoked in this app, which will not sign again. ${revoked.message} Privy may still accept a signature under the session policy until its deadline; press Revoke again to retry.${walletNote}`);
      setScheduled(null);
    } catch (reason) {
      setError(`The server could not revoke the session: ${errorMessage(reason, "unknown error")}. Nothing changed; try again.`);
    } finally {
      busy.current = false;
      setRevoking("");
      onChanged();
    }
  }

  const heading = <ActHeading act="Act 2" id="desk-title" title="Your desk">
    <p>Choose a fork point, leave a brief and set the limits. The Night Watch works while you sleep and leaves everything private for your review.</p>
  </ActHeading>;

  if (!signedIn) {
    return <section id="desk" className="nw-act" aria-labelledby="desk-title">
      {heading}
      <div className="nw-card nw-desk-signin">
        <MoonStar size={24} aria-hidden="true" />
        <div>
          <h3>Sign in to authorize a Night Watch</h3>
          <p>{accountLoading ? "Checking your sign-in…" : "Sign in with Google or your wallet on this machine to authorize a Night Watch. Either way, top-ups are paid from your Privy in-app wallet, not the sign-in wallet. The world above is public; your desk, drafts and receipts are yours."}</p>
          {!accountLoading && <SignInButton />}
        </div>
      </div>
    </section>;
  }

  if (!privy.configured) {
    return <section id="desk" className="nw-act" aria-labelledby="desk-title">
      {heading}
      <div className="nw-card nw-desk-signin" role="status">
        <CircleAlert size={24} aria-hidden="true" />
        <div>
          <h3>The Night Watch signer is unavailable here</h3>
          <p>{privy.error}</p>
          <p>Nothing can be authorized from this page until Privy loads with this server’s app ID. Existing allowances can still be revoked below.</p>
        </div>
      </div>
      {meError && <p className="nw-error nw-on-night" role="alert">{meError}</p>}
      {open && <div className="nw-card">
        <SessionCard session={open} now={now} revoking={revoking === open.id} disabled={!!revoking} onRevoke={() => void revoke(open)} />
        {error && <p role="alert" className="nw-error">{error}</p>}
        {notice && <p role="status" className="nw-success">{notice}</p>}
      </div>}
    </section>;
  }

  const choicesForForm = world ? forkPointChoices(world) : [];
  const serverTerms = (working || scheduled) && terms ? terms : null;
  const glance = serverTerms ?? preview;
  const items = consentItems(glance);
  return <section id="desk" className="nw-act" aria-labelledby="desk-title">
    {heading}
    {meError && <p className="nw-error nw-on-night" role="alert">{meError}</p>}
    <div className="nw-desk">
      <div className="nw-card nw-desk-form">
        <div className="nw-status-panel">
          <div className="nw-wallet-line">
            <Wallet size={20} aria-hidden="true" />
            <div>
              <strong>Your in-app wallet <BrandBadge brand="privy" /></strong>
              <span>{privy.address
                ? <><code title={privy.address}>{shortHex(privy.address, 8, 6)}</code>{privy.delegated || serverWallet?.delegated ? " · has a signer today" : " · no signers"}</>
                : privy.error || (privy.configured ? "Preparing your in-app wallet…" : "Unavailable on this server")}</span>
              {maxPayments === 1 && <small>A top-up is paid from this wallet’s own test USDC on <PaymentChain />. Add at least 1.00 test USDC to the same address first.</small>}
              {serverWallet && !serverWallet.tee && <small className="nw-warning">Privy reports this wallet without TEE execution, which session signers need. Adding the signer may be refused.</small>}
              {walletMismatch && <small className="nw-warning">The server sees {shortHex(serverWallet!.address)}; this browser opened {shortHex(privy.address)}.</small>}
            </div>
          </div>
          {me && <p className={`nw-runner${me.runner.alive ? "" : " nw-runner-off"}`}>
            {me.runner.alive
              ? <><Check size={16} aria-hidden="true" />The Night Watch runner is running on this machine{me.runner.lastSeen ? ` (last seen ${clockTime(me.runner.lastSeen)})` : ""}.</>
              : <><CircleAlert size={16} aria-hidden="true" /><span>The runner is not running on this machine. Scheduled jobs wait until the operator starts <code>node --env-file-if-exists=.env.local scripts/night-watch-runner.ts</code>.</span></>}
          </p>}
        </div>
        {open
          ? <SessionCard session={open} now={now} revoking={revoking === open.id} disabled={working || !!revoking} onRevoke={() => void revoke(open)} />
          : null}
        <form className="nw-form" onSubmit={(event) => event.preventDefault()}>
          <fieldset disabled={working}>
            <legend className="nw-visually-hidden">Night Watch brief and limits</legend>
            <label className="nw-field">
              <span>Fork point</span>
              <select value={forkPointId} onChange={(event) => onForkPoint(event.target.value)} required>
                {!forkPointId && <option value="">Choose a moment</option>}
                {choicesForForm.map((moment) => <option key={moment.id} value={moment.id}>{momentLabel(moment)}{moment.id === world?.defaultForkPointId ? " (newest on the release path)" : ""}</option>)}
              </select>
              <small>The Night Watch continues from this moment. Earlier scenes stay unchanged and credited.</small>
            </label>
            <label className="nw-field">
              <span>Brief</span>
              <textarea value={brief} maxLength={BRIEF_LIMIT} rows={4} required onChange={(event) => changeBrief(event.target.value)}
                placeholder="What should happen next? Keep the world’s rules: no written words, a gentle beat." aria-describedby={`${ids}-count`} />
              <small id={`${ids}-count`} className="nw-count">{brief.length} / {BRIEF_LIMIT}</small>
            </label>
            {world && world.kit.starters.length > 0 && <div className="nw-starters" role="group" aria-label="Starter briefs from the world kit">
              {world.kit.starters.map((starter) => <button type="button" key={starter} className="nw-chip" aria-pressed={brief === starter} onClick={() => changeBrief(starter)}>{starter}</button>)}
            </div>}
            <div className="nw-copilot">
              <button type="button" className="button secondary nw-copilot-ask" disabled={asking || !forkPointId} aria-describedby={`${ids}-copilot-note`} onClick={() => void askCopilot()}>
                {asking ? <LoaderCircle size={16} aria-hidden="true" className="nw-spin" /> : <Sparkles size={16} aria-hidden="true" />}
                {asking ? "Kimi K3 is reading the room…" : copilot ? "Ask the room co-pilot again" : "Ask the room co-pilot"}
              </button>
              <div aria-live="polite">
                {copilot && <div className="nw-copilot-answer">
                  {copilot.read && <p className="nw-copilot-read">{copilot.read}</p>}
                  <div className="nw-copilot-suggestions" role="group" aria-label="The room co-pilot's suggested briefs">
                    {copilot.suggestions.map((suggestion) => <button type="button" key={suggestion.brief} className="nw-copilot-suggestion" aria-pressed={brief === suggestion.brief} onClick={() => changeBrief(suggestion.brief)}>
                      <span>{suggestion.brief}</span>
                      <small>{suggestion.why}</small>
                    </button>)}
                  </div>
                </div>}
                {copilotError && <p className="nw-error" role="alert">{copilotError}</p>}
              </div>
              <small id={`${ids}-copilot-note`} className="nw-copilot-note">Room co-pilot: <ModelBadge label={copilot?.copilot.label ?? "Kimi K3"} /> <RouterBadge /> · operator-paid · suggestions only, you choose</small>
            </div>
            <div className="nw-field-row">
              <fieldset className="nw-field nw-segmented">
                <legend>Private candidates</legend>
                {([1, 2, 3] as const).map((value) => <label key={value}><input type="radio" name={`${ids}-attempts`} checked={attempts === value} onChange={() => setAttempts(value)} /><span>{value}</span></label>)}
              </fieldset>
              <fieldset className="nw-field nw-segmented">
                <legend>Room top-up</legend>
                <label><input type="radio" name={`${ids}-payments`} checked={maxPayments === 1} onChange={() => setMaxPayments(1)} /><span>May buy one</span></label>
                <label><input type="radio" name={`${ids}-payments`} checked={maxPayments === 0} onChange={() => setMaxPayments(0)} /><span>No payments</span></label>
              </fieldset>
            </div>
            <div className="nw-field-row">
              <label className="nw-field">
                <span>Allowance lasts</span>
                <select value={hours} onChange={(event) => setHours(Number(event.target.value))}>
                  {HOUR_CHOICES.map((value) => <option key={value} value={value}>{plural(value, "hour")}</option>)}
                </select>
              </label>
              <label className="nw-field">
                <span>Start</span>
                <select value={startInSeconds} onChange={(event) => setStartInSeconds(Number(event.target.value))}>
                  {START_CHOICES.map((choice) => <option key={choice.seconds} value={choice.seconds}>{choice.label}</option>)}
                </select>
              </label>
            </div>
          </fieldset>
        </form>
        {earlier.length > 0 && <Disclosure className="nw-technical" summary={`Earlier allowances (${earlier.length})`}>
          <ul className="nw-earlier">{earlier.map((session) => <li key={session.id}>
            <span>{session.state === "revoked" ? "Revoked" : session.state === "expired" ? "Expired" : session.state === "active" ? "Active" : "Awaiting signer"}</span>
            <span>until {dateTime(session.deadline)} · {formatUsdc(session.limits.totalAllowanceAtomic)} allowance · {plural(session.payments.filter((payment) => payment.state === "settled").length, "settled payment")}</span>
          </li>)}</ul>
        </Disclosure>}
      </div>

      <aside className="nw-card nw-consent" aria-labelledby={`${ids}-consent`}>
        <CardHeading id={`${ids}-consent`} title="What this Night Watch may do" kind={serverTerms ? "Terms the server set" : "Consent"} icon={KeyRound} />
        <BrandStrip label="The limits at a glance" className="nw-consent-glance">
          <BrandBadge brand="usdc" label={formatUsdc(glance.totalAllowanceAtomic)} />
          {glance.maxPayments > 0 && <BrandBadge brand="base" />}
          <Chip icon={Clock3}>Signing stops at {clockTime(glance.deadline)}</Chip>
          <Chip icon={Images}>{plural(glance.attemptAllowance, "candidate")}</Chip>
        </BrandStrip>
        <dl className="nw-consent-terms">
          {items.map((item) => <div key={item.label} data-term={item.label === "Never" ? "never" : undefined}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}
        </dl>
        <label className="nw-consent-check">
          <input type="checkbox" checked={agreed} disabled={working} onChange={(event) => setAgreed(event.target.checked)} />
          <span>I authorize this Night Watch within these limits. It signs only through a Privy signer added to my in-app wallet, and I can revoke it here.</span>
        </label>
        <button type="button" className="button primary nw-authorize" disabled={!!reason || working} aria-describedby={reason ? `${ids}-reason` : undefined} onClick={() => void authorize()}>
          {working ? "Authorizing…" : "Authorize Night Watch"}
        </button>
        {reason && !working && <p id={`${ids}-reason`} className="nw-help">{reason}</p>}
        {(working || Object.keys(progress).length > 0) && <ol className="nw-progress" aria-label="Authorization steps" aria-live="polite">
          {STEPS.map((step) => <li key={step.key} data-state={progress[step.key] ?? "waiting"}><StepIcon state={progress[step.key]} /><span>{step.label}</span></li>)}
        </ol>}
        {error && <p role="alert" className="nw-error">{error}</p>}
        {notice && <p role="status" className="nw-success">{notice}</p>}
        {scheduled && <div className="nw-scheduled" role="status">
          <MoonStar size={20} aria-hidden="true" />
          <div>
            <strong>Night Watch is scheduled. You can close this tab.</strong>
            <span>It starts around {clockTime(scheduled.runAfter)} and stops signing at {terms ? dateTime(terms.deadline) : "the deadline you set"}. Its progress appears under <a href="#away">While you were away</a>.</span>
          </div>
        </div>}
      </aside>
    </div>
  </section>;
}
