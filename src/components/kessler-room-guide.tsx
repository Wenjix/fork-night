import { BookOpen, GitBranch, Sparkles, ArrowUpRight, Play } from "lucide-react";
import { kesslerWrenState, type KesslerOverview } from "../lib/kessler-overview";
import { shortAddress } from "../lib/onchain/journey";
import { getRecordedGuildFunding } from "../lib/guild-funding";
import { GuildFundingSummary } from "./guild-funding";
import { Disclosure } from "./disclosure";
import { BrandBadge, BrandStrip } from "./brand-badge";

const tempoExplorer = "https://explore.tempo.xyz";
export type KesslerDestination = "pilot-story-reader" | "kessler-contributions" | "kessler-wren" | "kessler-films";

export function KesslerRoomGuide({ overview, unavailable, blocked, onNavigate }: {
  overview: KesslerOverview | null; unavailable: boolean; blocked: boolean;
  onNavigate: (destination: KesslerDestination) => void;
}) {
  const state = overview ? kesslerWrenState(overview) : undefined;
  const guild = getRecordedGuildFunding("kessler-ward");
  return <section className="kessler-guide" aria-label="Explore the Kessler demo">
    <div className="kessler-guide-bar">
      <div className="kessler-guide-presence"><strong>The shared demo</strong><span>{overview
        ? `${overview.story.published} new ${overview.story.published === 1 ? "scene" : "scenes"} · ${overview.story.contributors} ${overview.story.contributors === 1 ? "storyteller" : "storytellers"}`
        : unavailable ? "Room activity is temporarily unavailable" : "Reading room activity…"}</span></div>
      <nav aria-label="Kessler demo path">
        <button type="button" disabled={blocked} onClick={() => onNavigate("pilot-story-reader")}><BookOpen size={16} aria-hidden="true" />Read & branch</button>
        <button type="button" disabled={blocked} onClick={() => onNavigate("kessler-films")}><Play size={16} aria-hidden="true" />Watch films</button>
        <button type="button" disabled={blocked} onClick={() => onNavigate("kessler-contributions")}><GitBranch size={16} aria-hidden="true" />Contributions</button>
        <button type="button" disabled={blocked} onClick={() => onNavigate("kessler-wren")}><Sparkles size={16} aria-hidden="true" />Meet Wren</button>
      </nav>
    </div>
    <Disclosure id="kessler-backing" className="kessler-backing" summary={<span className="kessler-backing-summary"><strong>Who keeps this room going</strong><span>{overview ? `${overview.credits.available} shared credits · Wren ${state === "enabled" ? "enabled" : state === "needs-credits" ? "needs credits" : "paused"}` : "Room credits, Wren’s allowance and creator support"}</span></span>}>
      <div className="kessler-backing-columns">
        <section>
          <h3>Shared creation credits</h3>
          <p>{overview ? `${overview.credits.available} credits available. ` : "Credits pay for new images. "}Everyone draws from the same room pool; reading and leaving ideas are free.</p>
          {guild ? <GuildFundingSummary record={guild} creditsAvailable={overview?.credits.available} /> : <p className="kessler-backing-note">Guild backing is awaiting its first Kessler receipt. <a href="/pilot?room=paper-moon&view=treasury">See the recorded Squads rehearsal in Paper Moon <ArrowUpRight size={14} aria-hidden="true" /></a></p>}
        </section>
        <section>
          <h3>Wren’s spending allowance</h3>
          <BrandStrip label="Wren payment network"><BrandBadge brand="tempo" /><BrandBadge brand="mpp" /></BrandStrip>
          <p>{state === "enabled" ? "Wren can prepare a private scene for your review." : state === "needs-credits" ? "Wren is enabled, but this room needs credits before it can make a scene." : state === "paused" ? "Wren’s scene requests are paused." : unavailable ? "Wren’s current availability could not be checked." : "Checking Wren’s availability…"} You decide what gets published under your byline.</p>
          {overview?.wren.fundingEnabled && Date.parse(overview.wren.expiresAt) > Date.now() ? <>
            <p>A separate spending key can buy 5 shared credits for 1 test pathUSD. Its limit is 2 test pathUSD per day including fees, with one top-up per day.</p>
            <dl className="kessler-wallet-facts">
              <div><dt>Wren’s spending key</dt><dd><code title={overview.wren.accessKey}>{shortAddress(overview.wren.accessKey)}</code></dd></div>
              <div><dt>Funded by the steward</dt><dd><a href={`${tempoExplorer}/address/${overview.wren.payer}`} target="_blank" rel="noreferrer">{shortAddress(overview.wren.payer)}</a></dd></div>
              <div><dt>Allowance expires</dt><dd><time dateTime={overview.wren.expiresAt}>{new Date(overview.wren.expiresAt).toLocaleString("en-US", { timeZone: "UTC", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} UTC</time></dd></div>
            </dl>
            <a href={`${tempoExplorer}/tx/${overview.wren.authorizationTx}`} target="_blank" rel="noreferrer">View spending authorization <ArrowUpRight size={14} aria-hidden="true" /></a>
          </> : <p className="kessler-backing-note">{overview ? "No active top-up allowance." : unavailable ? "Wren’s top-up allowance could not be checked." : "Checking Wren’s top-up allowance…"} Wren uses a bounded spending key backed by the steward’s account.</p>}
          {!!overview?.wren.payments.length && <ul className="kessler-payment-history" aria-label="Kessler credit purchases">{overview.wren.payments.map(payment => <li key={payment.transaction}><a href={`${tempoExplorer}/tx/${payment.transaction}`} target="_blank" rel="noreferrer">Wren added 5 credits · 1 test pathUSD <ArrowUpRight size={14} aria-hidden="true" /></a></li>)}</ul>}
        </section>
        <section>
          <h3>Support the storytellers</h3>
          <BrandStrip label="Creator support network"><BrandBadge brand="monad" /></BrandStrip>
          <p>Support a released path with test MON. The contract splits it equally across the path’s distinct registered creator wallets.</p>
          <p className="kessler-backing-note">Creator support does not add room credits. Funding or curating a story alone earns no creator share.</p>
          <button type="button" className="text-button" disabled={blocked} onClick={() => onNavigate("kessler-contributions")}>Trace a path and its release <ArrowUpRight size={14} aria-hidden="true" /></button>
        </section>
      </div>
    </Disclosure>
  </section>;
}
