"use client";

import { useEffect, useId, useState } from "react";
import { BadgeCheck, Ban, Check, CircleAlert, CircleDashed, Clock3, Coins, Hourglass, Lock, MoonStar, Receipt, RefreshCw, Send, Sparkles } from "lucide-react";
import { BrandBadge } from "../brand-badge";
import { Disclosure } from "../disclosure";
import type { CandidateView, JobSummary, MeResponse, WorldMoment } from "../../night-watch/api-types.ts";
import { ActHeading } from "./world-panel.tsx";
import { CardHeading } from "./card-heading";
import { BrainCard, brainCandidate, brainPick, CandidateThought, PickChip } from "./brain-card.tsx";
import { useNow } from "./desk-panel.tsx";
import {
  candidateLetter,
  clockTime,
  dateTime,
  errorMessage,
  eventLines,
  expenseText,
  formatUsd,
  formatUsdc,
  isJobActive,
  jobStateLabel,
  jobTimeline,
  receiptView,
  safeHref,
  sha256Hex,
  shortHex,
  startsIn,
  type Job,
  type NightWatchClient,
  type StepStatus,
} from "./api.ts";

const STEP_ICONS: Record<StepStatus, typeof Check> = { done: Check, current: Hourglass, upcoming: CircleDashed, skipped: CircleDashed, stopped: Ban };
const STEP_NOTES: Record<StepStatus, string> = { done: "Done", current: "In progress", upcoming: "Not yet", skipped: "Not needed", stopped: "Stopped here" };

const CANDIDATE_STATES: Record<CandidateView["state"], string> = {
  pending: "Waiting for its turn",
  delivered: "Private · only you can see this",
  failed: "Not prepared. No image was delivered.",
  uncertain: "Outcome unknown. It is not retried, so it cannot be billed twice.",
};

const PAYMENT_STATES: Record<NonNullable<Job["payment"]>["state"], string> = {
  reserved: "reserved from your allowance",
  signed: "signed by your Night Watch signer, waiting to settle",
  settled: "settled",
  released: "released; nothing was paid",
};

/** A private candidate, fetched with the maker's token into an object URL and checked against its hash. */
function useCandidateImage(api: NightWatchClient, path: string | null, sha256: string | null, attempt: number) {
  const [state, setState] = useState<{ url?: string; verified?: boolean; error?: string }>({});
  useEffect(() => {
    if (!path) {
      setState({});
      return;
    }
    const controller = new AbortController();
    let objectUrl: string | undefined;
    setState({});
    void api.candidateImage(path, controller.signal).then(async (blob) => {
      const digest = sha256 ? await sha256Hex(await blob.arrayBuffer()) : null;
      if (sha256 && digest !== sha256.toLowerCase()) throw new Error("This image does not match the hash the Night Watch recorded, so it is not shown.");
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      setState({ url: objectUrl, verified: !!digest });
    }).catch((error) => {
      if (!controller.signal.aborted) setState({ error: errorMessage(error, "This private candidate could not be loaded.") });
    });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [api, path, sha256, attempt]);
  return state;
}

function CandidateCard({ api, job, candidate, confirming, publishing, onAsk, onCancel, onPublish }: {
  api: NightWatchClient;
  job: Job;
  candidate: CandidateView;
  confirming: boolean;
  publishing: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onPublish: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const image = useCandidateImage(api, candidate.state === "delivered" ? candidate.imagePath : null, candidate.sha256, attempt);
  const letter = candidateLetter(candidate.number);
  // What the brain planned for this take, and whether it suggests looking here first.
  const thought = brainCandidate(job.brain, candidate.number);
  const picked = brainPick(job.brain) === candidate.number;
  const canPublish = job.state === "ready" && candidate.state === "delivered" && !job.publishedMomentId && !!image.url;
  const decided = !!job.publishedMomentId;
  return <li className="nw-candidate" data-state={candidate.state} data-published={candidate.published || undefined} data-picked={picked || undefined}>
    <figure>
      <div className="nw-candidate-art">
        {image.url
          ? <img src={image.url} alt={candidate.caption || `Candidate ${letter}`} width={1024} height={1024} />
          : <span className="nw-image-placeholder" role="status">
            {candidate.state === "delivered" ? image.error || "Opening the private image…" : CANDIDATE_STATES[candidate.state]}
            {image.error && <button type="button" className="text-button" onClick={() => setAttempt(attempt + 1)}>Load it again</button>}
          </span>}
        {image.verified && <span className="nw-hash-chip"><BadgeCheck size={16} aria-hidden="true" />Hash verified</span>}
        {picked && <PickChip />}
      </div>
      <figcaption>
        <strong>Candidate {letter}</strong>
        {candidate.caption && <span>{candidate.caption}</span>}
        <CandidateThought thought={thought} />
      </figcaption>
    </figure>
    <p className="nw-candidate-state">
      {candidate.published ? <><Send size={16} aria-hidden="true" />Published by you</> : decided && candidate.state === "delivered" ? <><Lock size={16} aria-hidden="true" />Stays private</> : <>{candidate.state === "delivered" ? <Lock size={16} aria-hidden="true" /> : <CircleAlert size={16} aria-hidden="true" />}{CANDIDATE_STATES[candidate.state]}</>}
      {candidate.expenseUsd && <span> · operator-paid inference {formatUsd(candidate.expenseUsd)}</span>}
    </p>
    {canPublish && (confirming
      ? <div className="nw-confirm" role="group" aria-label={`Publish candidate ${letter}`}>
        <p>Publish candidate {letter} as your moment? It joins the story under your name. The other candidates stay private.</p>
        <div className="button-row">
          <button type="button" className="button primary" disabled={publishing} onClick={onPublish}>{publishing ? "Publishing…" : `Yes, publish candidate ${letter}`}</button>
          <button type="button" className="text-button" disabled={publishing} onClick={onCancel}>Not yet</button>
        </div>
      </div>
      : <button type="button" className="button secondary" onClick={onAsk}>Publish this one</button>)}
  </li>;
}

export function AwayPanel({ api, jobs, jobId, job, jobError, me, forkPoint, onSelectJob, onRefresh, onPublished }: {
  api: NightWatchClient;
  jobs: JobSummary[];
  jobId: string | null;
  job: Job | null;
  jobError: string;
  me: MeResponse | null;
  forkPoint: WorldMoment | null;
  onSelectJob: (id: string) => void;
  onRefresh: () => void;
  onPublished: (momentId: string) => void;
}) {
  const now = useNow(1_000);
  const ids = useId();
  const [confirming, setConfirming] = useState<number | null>(null);
  const [publishing, setPublishing] = useState<number | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setConfirming(null);
    setError("");
  }, [jobId]);

  const heading = <ActHeading act="Act 3" id="away-title" title="While you were away">
    <p>What the Night Watch did, step by step: its receipt, its expense and the private candidates waiting for you. Nothing here is public until you choose.</p>
  </ActHeading>;

  if (!jobId) {
    return <section id="away" className="nw-act nw-act-night" aria-labelledby="away-title">
      {heading}
      <div className="nw-card nw-empty"><MoonStar size={24} aria-hidden="true" /><p>No Night Watch has run yet. Authorize one on your desk; this part fills in while you are away.</p></div>
    </section>;
  }

  async function publish(number: number) {
    if (!job || publishing !== null) return;
    setPublishing(number);
    setError("");
    try {
      const { moment } = await api.publish(job.id, number);
      setConfirming(null);
      onPublished(moment.id);
    } catch (reason) {
      setError(errorMessage(reason, "The candidate could not be published. Nothing changed."));
    } finally {
      setPublishing(null);
    }
  }

  const sorted = [...jobs].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const current = job && job.id === jobId ? job : null;
  const timeline = current ? jobTimeline(current) : [];
  const receipt = current?.receipt ? receiptView(current.receipt, me?.privy.wallet?.address) : null;
  const receiptHref = safeHref(receipt?.explorerUrl);
  const events = current ? eventLines(current.events) : [];
  const runnerOff = !!me && !me.runner.alive && !!current && isJobActive(current.state);
  return <section id="away" className="nw-act nw-act-night" aria-labelledby="away-title">
    {heading}
    {sorted.length > 1 && <label className="nw-job-picker nw-on-night">
      <span>Night Watch</span>
      <select value={jobId} onChange={(event) => onSelectJob(event.target.value)}>
        {sorted.map((item) => <option key={item.id} value={item.id}>{dateTime(item.createdAt)} · {jobStateLabel(item.state)}</option>)}
      </select>
    </label>}
    {jobError && <p role="alert" className="nw-error nw-on-night">{jobError}</p>}
    {!current
      ? <div className="nw-card"><p role="status" className="nw-quiet">Reading the Night Watch log…</p></div>
      : <div className="nw-away">
        <div className="nw-card nw-status-card" data-state={current.state}>
          <div className="nw-status-head">
            <div aria-live="polite" role="status" aria-atomic="true">
              <CardHeading title={jobStateLabel(current.state)} kind="Night Watch status" icon={MoonStar} />
              {current.message && <p className="nw-status-message">{current.message}</p>}
            </div>
            <button type="button" className="pilot-icon-button nw-icon-button" aria-label="Refresh the Night Watch status" onClick={onRefresh}><RefreshCw size={20} aria-hidden="true" /></button>
          </div>
          {current.state === "scheduled" && <p className="nw-countdown"><Clock3 size={16} aria-hidden="true" />Starts {startsIn(current.runAfter, now)} · {clockTime(current.runAfter)}</p>}
          {runnerOff && <p className="nw-warning"><CircleAlert size={16} aria-hidden="true" />The runner is not running on this machine, so this job waits until the operator starts it.</p>}
          <ol className="nw-timeline" aria-label="Night Watch steps">
            {timeline.map((step) => {
              const Icon = STEP_ICONS[step.status];
              return <li key={step.state} data-status={step.status} aria-current={step.status === "current" ? "step" : undefined}>
                <Icon size={16} aria-hidden="true" />
                <span>{step.label}{step.optional && step.status === "upcoming" ? " (only if credits run short)" : ""}</span>
                <small>{STEP_NOTES[step.status]}</small>
              </li>;
            })}
          </ol>
          <dl className="nw-job-facts">
            <div><dt>Fork point</dt><dd>{current.forkPoint.title} · {current.forkPoint.makerLabel}</dd></div>
            <div><dt>Brief</dt><dd>{current.brief}</dd></div>
            <div><dt>Kit</dt><dd>{current.kit.id} v{current.kit.version} · <code title={current.kit.digest}>{current.kit.digest.slice(0, 12)}…</code></dd></div>
            <div><dt>Room credits</dt><dd>
              Needed {current.capacity.neededCredits}
              {current.capacity.availableAtCheck !== null && ` · ${current.capacity.availableAtCheck} available when checked`}
              {current.capacity.charged > 0 && ` · ${current.capacity.charged} charged`}
              {current.capacity.refunded > 0 && ` · ${current.capacity.refunded} refunded`}
            </dd></div>
          </dl>
          {events.length > 0 && <Disclosure className="nw-log" defaultOpen={isJobActive(current.state)} summary={`Night log (${events.length} ${events.length === 1 ? "entry" : "entries"})`}>
            <ol>{events.map((event, index) => <li key={`${event.at}-${index}`}><time dateTime={event.at}>{clockTime(event.at)}</time><strong>{event.title}</strong>{event.detail && <span>{event.detail}</span>}</li>)}</ol>
          </Disclosure>}
        </div>

        <div className="nw-away-side">
          <article className="nw-card nw-receipt" aria-labelledby={`${ids}-receipt`}>
            <CardHeading id={`${ids}-receipt`} title={receipt ? "Room top-up" : current.payment?.state === "released" ? "No payment made" : current.payment ? "Room top-up in progress" : "No payment"} kind="Payment receipt" icon={Receipt} />
            {receipt
              ? <>
                <p className="nw-receipt-amount">{receipt.amount}<span>on <BrandBadge brand="base" label={receipt.network} /></span></p>
                <ul className="nw-receipt-lines">
                  <li><Coins size={16} aria-hidden="true" />{receipt.credits}</li>
                  <li><Check size={16} aria-hidden="true" />Paid by {receipt.payer}</li>
                  <li><BadgeCheck size={16} aria-hidden="true" />{receipt.signedBy}</li>
                </ul>
                {receiptHref && receipt.transaction && <BrandBadge className="nw-tx" brand="base" label={`Base Sepolia transaction ${shortHex(receipt.transaction)}`} href={receiptHref} />}
                <p className="nw-fine">A top-up added test credits to the room. It explains a credit change, not a particular image.</p>
              </>
              : current.payment
                ? <p>{formatUsdc(current.payment.amountAtomic)} {PAYMENT_STATES[current.payment.state]}.</p>
                : <p className="nw-quiet">{isJobActive(current.state) ? "The Night Watch pays only if the room runs short of test credits." : "The room had enough test credits, so nothing was paid."}</p>}
          </article>
          <article className="nw-card nw-expense" aria-labelledby={`${ids}-expense`}>
            <CardHeading id={`${ids}-expense`} title="Image generation" kind="Expense" icon={Sparkles} />
            <p>{expenseText(current.expense)}</p>
            <p className="nw-fine">Paid by the operator, within a per-job cap. It is not paid from your allowance.</p>
          </article>
        </div>

        <BrainCard brain={current.brain} titleId={`${ids}-brain`} />

        <div className="nw-card nw-candidates-card">
          <div className="nw-card-head">
            <h3>Private candidates</h3>
            <span>{current.publishedMomentId ? "You chose one. The others stay private." : "Only you can see these. Publishing is your separate choice."}</span>
          </div>
          {current.candidates.length
            ? <ul className="nw-candidates">{current.candidates.map((candidate) => <CandidateCard key={candidate.number} api={api} job={current} candidate={candidate}
              confirming={confirming === candidate.number} publishing={publishing === candidate.number}
              onAsk={() => setConfirming(candidate.number)} onCancel={() => setConfirming(null)} onPublish={() => void publish(candidate.number)} />)}</ul>
            : <p className="nw-quiet">{isJobActive(current.state) ? "Candidates appear here as the Night Watch prepares them." : "No candidates were prepared."}</p>}
          {error && <p role="alert" className="nw-error">{error}</p>}
          {current.publishedMomentId && <p className="nw-success"><Send size={16} aria-hidden="true" /><span>Published. Read it in <a href="#morning">the morning edition</a>.</span></p>}
          {forkPoint && <p className="nw-fine">Continues “{forkPoint.title}” by {forkPoint.makerLabel}.</p>}
        </div>
      </div>}
  </section>;
}
