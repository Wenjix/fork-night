"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { BadgeCheck, BrainCircuit, Check, ExternalLink, HandCoins, MoonStar, Newspaper, RefreshCw, Sunrise } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../lib/supabase/database.types.ts";
import type { PilotMoment } from "../../lib/pilot.ts";
import type { EditionResponse, MeResponse, WorldResponse } from "../../night-watch/api-types.ts";
import { NIGHT_WATCH_ROOM } from "../../night-watch/api-types.ts";
import { pollWhileVisible } from "../../lib/visible-interval.ts";
import { TestnetRelease } from "../testnet-release.tsx";
import { ActHeading, MomentImage } from "./world-panel.tsx";
import { IdentityCard } from "./identity-card.tsx";
import { RecapCard } from "./recap-card.tsx";
import { brainCandidate, brainFrontFacts, brainRecapLine } from "./brain-card.tsx";
import { useNightWatchPrivy } from "./night-watch-account.tsx";
import { withNightWatchMedia } from "./media-client.ts";
import {
  candidateLetter,
  CLAIM_STATE_LABELS,
  dateTime,
  errorMessage,
  formatMon,
  momentHeadline,
  positiveWei,
  recapModel,
  safeHref,
  sameAddress,
  shareRows,
  shortHex,
  type Job,
  type NightWatchClient,
} from "./api.ts";

const EDITION_POLL_MS = 10_000;

export function EditionPanel({ api, tip, world, me, job, client }: {
  api: NightWatchClient;
  tip: string | null;
  world: WorldResponse | null;
  me: MeResponse | null;
  job: Job | null;
  client?: SupabaseClient<Database>;
}) {
  const privy = useNightWatchPrivy();
  const ids = useId();
  // The release panel's scene images: Night Watch moments are served from this machine.
  const nightWatchIds = useMemo(() => new Set((world?.moments ?? []).filter((moment) => moment.source === "night-watch").map((moment) => moment.id)), [world]);
  const releaseClient = useMemo(() => (client ? withNightWatchMedia(client, nightWatchIds) : client), [client, nightWatchIds]);
  const [edition, setEdition] = useState<EditionResponse | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [claiming, setClaiming] = useState("");
  const [claimError, setClaimError] = useState("");
  const [claimNotice, setClaimNotice] = useState("");

  useEffect(() => {
    setEdition(null);
    setError("");
    setClaimError("");
    setClaimNotice("");
  }, [tip]);
  const signedIn = !!me;
  useEffect(() => {
    if (!tip || !signedIn) return;
    let active = true;
    const stop = pollWhileVisible(async () => {
      try {
        const next = await api.edition(tip);
        if (active) {
          setEdition(next);
          setError("");
        }
      } catch (reason) {
        if (active) setError(errorMessage(reason, "The morning edition could not be read."));
        throw reason;
      }
    }, EDITION_POLL_MS);
    return () => {
      active = false;
      stop();
    };
  }, [api, tip, signedIn, version]);

  const heading = <ActHeading act="Act 4" id="morning-title" title="The morning edition">
    <p>Your published moment joins the path. Release it on Monad testnet, gather support, and let the Night Watch helper deliver each share to its frozen recipient.</p>
  </ActHeading>;

  if (!tip) {
    return <section id="morning" className="nw-act nw-act-dawn" aria-labelledby="morning-title">
      {heading}
      <div className="nw-card nw-empty"><Sunrise size={24} aria-hidden="true" /><p>The morning edition opens after you publish a candidate. Nothing is published automatically, and the Night Watch never closes an edition.</p></div>
    </section>;
  }

  async function deliver(beneficiary: string) {
    if (!edition?.release || claiming) return;
    setClaiming(beneficiary);
    setClaimError("");
    setClaimNotice("");
    try {
      const { claim } = await api.claim({ releaseId: edition.release.id, beneficiary });
      setClaimNotice(claim.state === "finalized"
        ? `Delivered ${formatMon(claim.claimedWei ?? claim.amountWei)} to ${shortHex(beneficiary)}. Settled on Monad testnet.`
        : `${CLAIM_STATE_LABELS[claim.state]}. The page checks again shortly.`);
      setVersion((value) => value + 1);
    } catch (reason) {
      setClaimError(errorMessage(reason, "The helper could not deliver that share. Nothing was sent."));
    } finally {
      setClaiming("");
    }
  }

  const moment = world?.moments.find((item) => item.id === tip) ?? null;
  const row = edition?.moments.find((item) => item.id === tip) ?? null;
  const title = moment?.title ?? row?.title ?? "Your published moment";
  const makerLabel = moment?.makerLabel ?? row?.maker_label ?? me?.maker.displayName ?? "you";
  const nightWatch = moment?.nightWatch ?? null;
  const headline = momentHeadline(title, moment?.panels[0]?.caption);
  const release = edition?.release ?? null;
  const shares = edition ? shareRows(edition) : [];
  const yourWallet = me?.privy.wallet?.address ?? privy.address;
  const pathMakers = edition ? edition.moments.map((item) => item.maker_label) : moment ? [moment.makerLabel] : [];
  // The brain's account belongs to the job that published this tip.
  const brain = job?.publishedMomentId === tip ? job.brain ?? null : null;
  const frontFacts = brainFrontFacts(brain, nightWatch?.candidate ?? null);
  const baseRecap = recapModel({
    worldTitle: world?.kit.title ?? "The Midnight Signal",
    kitVersion: nightWatch?.kitVersion ?? world?.kit.version ?? "1",
    momentTitle: title,
    makerName: makerLabel,
    pathMakers,
    candidate: nightWatch?.candidate ?? null,
    receipt: job?.publishedMomentId === tip && job.receipt ? { amountAtomic: job.receipt.amountAtomic, creditsAdded: job.receipt.creditsAdded, transaction: job.receipt.transaction } : null,
    release: release ? { id: release.id, exists: release.exists, receivedWei: release.receivedWei } : null,
    claims: edition?.claims ?? [],
    expense: job?.publishedMomentId === tip ? { operatorPaidUsd: job.expense.operatorPaidUsd, images: job.expense.images } : null,
    date: dateTime(moment?.createdAt ?? row?.created_at ?? new Date().toISOString()),
  });
  const brainLine = brainCandidate(brain, nightWatch?.candidate ?? 0)?.plain ? null : brainRecapLine(brain);
  const recap = brainLine ? { ...baseRecap, lines: [...baseRecap.lines, brainLine] } : baseRecap;
  return <section id="morning" className="nw-act nw-act-dawn" aria-labelledby="morning-title">
    {heading}
    <div className="nw-morning">
      <article className="nw-card nw-front-page" aria-labelledby={`${ids}-moment`}>
        <p className="nw-card-eyebrow"><Newspaper size={15} aria-hidden="true" />Published moment</p>
        <div className="nw-front">
          <div className="nw-front-art">{moment ? <MomentImage panel={moment.panels[0]} /> : <span className="nw-image-placeholder">Opening the published image…</span>}</div>
          <div className="nw-front-copy">
            <h3 id={`${ids}-moment`}>{headline.heading}</h3>
            <p className="nw-moment-maker">by {makerLabel}</p>
            {headline.body && <p className="nw-front-caption">{headline.body}</p>}
            <ul className="nw-front-facts">
              {nightWatch && <li><MoonStar size={15} aria-hidden="true" />Prepared by a Night Watch from kit v{nightWatch.kitVersion} · candidate {candidateLetter(nightWatch.candidate)}</li>}
              {frontFacts.map((fact) => <li key={fact}><BrainCircuit size={15} aria-hidden="true" />{fact}</li>)}
              <li><Check size={15} aria-hidden="true" />Published by its maker, not by the Night Watch</li>
              {edition && <li><BadgeCheck size={15} aria-hidden="true" />{edition.moments.length} scenes on this path, from the original opening</li>}
            </ul>
          </div>
        </div>
      </article>

      {error && <p role="alert" className="nw-error">{error}</p>}
      {!edition && !error && <p role="status" className="nw-quiet nw-on-dawn">Reading the edition…</p>}
      {edition && <div className="nw-card nw-release-card">
        <div className="pilot-shell nw-release-shell">
          <TestnetRelease roomId={NIGHT_WATCH_ROOM} moments={edition.moments as PilotMoment[]} tipId={edition.tipId}
            makerId={me?.maker.id} makerName={me?.maker.displayName} client={releaseClient} onChoosePath={() => {}} />
        </div>
      </div>}

      {edition && <section className="nw-card nw-shares" aria-labelledby={`${ids}-shares`}>
        <div className="nw-card-head">
          <h3 id={`${ids}-shares`}><HandCoins size={20} aria-hidden="true" />Deliver a share with the Night Watch helper</h3>
          <button type="button" className="pilot-icon-button nw-icon-button" aria-label="Refresh the release and claims" onClick={() => setVersion((value) => value + 1)}><RefreshCw size={18} aria-hidden="true" /></button>
        </div>
        <p className="nw-fine">The helper is an app-funded wallet that pays the gas to call <code>claim</code> on the release contract. The contract sends each share only to its frozen recipient, so the helper can deliver a share but never redirect it. A delivery counts once Monad testnet has settled it.</p>
        {!release || !release.exists
          ? <p className="nw-quiet">This release is not frozen yet. The curator freezes it in the release panel above; then its recipients and their shares appear here.</p>
          : <>
            <p className="nw-release-line">Release <code title={release.id}>{shortHex(release.id, 10, 6)}</code> · {formatMon(release.receivedWei)} support received · {formatMon(release.paidWei)} delivered{release.finalizedBlock !== null ? ` · read at finalized block ${release.finalizedBlock.toLocaleString()}` : ""}</p>
            <ul className="nw-share-list">
              {shares.map((share) => {
                const claimHref = safeHref(share.claim?.explorerUrl);
                const label = sameAddress(share.address, yourWallet) ? "Your in-app wallet" : "Frozen recipient";
                return <li key={share.address} data-claimable={positiveWei(share.claimableWei) || undefined}>
                  <div>
                    <strong>{label}</strong>
                    <code title={share.address}>{shortHex(share.address, 8, 6)}</code>
                    <span>{formatMon(share.claimableWei)} waiting · {formatMon(share.claimedWei)} delivered so far</span>
                    {share.claim && <span className="nw-claim-state" data-state={share.claim.state}>
                      {share.claim.state === "finalized" ? <Check size={14} aria-hidden="true" /> : null}
                      {CLAIM_STATE_LABELS[share.claim.state]}{share.claim.claimedWei ? ` · ${formatMon(share.claim.claimedWei)}` : ""}
                      {claimHref && <a href={claimHref} target="_blank" rel="noreferrer">{shortHex(share.claim.hash)} <ExternalLink size={13} aria-hidden="true" /></a>}
                    </span>}
                  </div>
                  {(() => {
                    // A delivery sent but not yet finalized resumes its saved transaction; nothing is signed again.
                    const inFlight = !!share.claim && ["signed", "broadcast", "confirmed"].includes(share.claim.state);
                    const waiting = positiveWei(share.claimableWei);
                    return <button type="button" className={`button ${waiting || inFlight ? "primary" : "secondary"}`}
                      disabled={!(waiting || inFlight) || !!claiming} onClick={() => void deliver(share.address)}>
                      {claiming === share.address ? "Delivering… (waits for finality)" : inFlight ? "Check delivery" : waiting ? "Deliver this share" : "Nothing waiting"}
                    </button>;
                  })()}
                </li>;
              })}
            </ul>
          </>}
        {claimError && <p role="alert" className="nw-error">{claimError}</p>}
        {claimNotice && <p role="status" className="nw-success">{claimNotice}</p>}
        {edition.helper && <p className="nw-fine">Helper wallet <code title={edition.helper.address}>{shortHex(edition.helper.address)}</code> holds {formatMon(edition.helper.balanceWei)} for gas.</p>}
      </section>}

      <RecapCard model={recap} panel={moment?.panels[0] ?? null} />
      <IdentityCard api={api} />
    </div>
  </section>;
}
