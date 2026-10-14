"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { BadgeCheck, BookOpen, Bot, CircleDashed, ExternalLink, Fingerprint, Globe, HandCoins, IdCard, MoonStar, RefreshCw, Send, Wallet } from "lucide-react";
import type { IdentityResponse } from "../../night-watch/api-types.ts";
import { errorMessage, safeHref, shortHex, type NightWatchClient } from "./api.ts";

const IDENTITY_NOTE = "An identity registration on a draft standard; it does not prove quality, ownership or trust.";
export const AGENT_ROLE = "AI agent · works for the maker who authorizes it";

/** The Night Watch's ERC-8004 calling card, read from the identity registry on Monad testnet. */
export function IdentityCard({ api }: { api: NightWatchClient }) {
  const ids = useId();
  const [identity, setIdentity] = useState<IdentityResponse | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api.identity(controller.signal).then((next) => {
      setIdentity(next);
      setError("");
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(errorMessage(reason, "The Night Watch identity could not be read."));
    });
    return () => controller.abort();
  }, [api, version]);

  const refresh = <button type="button" className="pilot-icon-button nw-icon-button" aria-label="Read the identity again" onClick={() => setVersion((value) => value + 1)}><RefreshCw size={18} aria-hidden="true" /></button>;
  if (!identity) {
    return <section className="nw-card nw-agent-card" aria-labelledby={`${ids}-identity`}>
      <AgentTop titleId={`${ids}-identity`} name="Night Watch" action={refresh} />
      <p className="nw-agent-card-byline">{AGENT_ROLE}</p>
      {error ? <p role="alert" className="nw-error">{error}</p> : <p role="status" className="nw-quiet">Reading the identity registry…</p>}
    </section>;
  }
  return <AgentCard identity={identity} titleId={`${ids}-identity`} action={refresh} />;
}

function AgentTop({ titleId, name, action }: { titleId: string; name: string; action?: ReactNode }) {
  return <div className="nw-agent-card-top">
    <span className="nw-agent-card-avatar" aria-hidden="true"><MoonStar size={32} /></span>
    <div>
      <p className="nw-agent-card-eyebrow"><IdCard size={14} aria-hidden="true" />ERC-8004 calling card</p>
      <h3 id={titleId}>{name}</h3>
      <span className="nw-agent-badge"><Bot size={14} aria-hidden="true" />AI agent</span>
    </div>
    {action}
  </div>;
}

/** The Night Watch drawn as an agent profile, like Wren's card on /agents, from what the registry reports. */
export function AgentCard({ identity, titleId, action }: { identity: IdentityResponse; titleId: string; action?: ReactNode }) {
  const { card } = identity;
  const service = safeHref(card.service);
  const transaction = safeHref(identity.explorerUrl);
  const agentNumber = identity.registered && identity.agentId !== null ? ` as agent #${identity.agentId}` : "";
  return <section className="nw-card nw-agent-card" aria-labelledby={titleId}>
    <AgentTop titleId={titleId} name="Night Watch" action={action} />
    <p className="nw-agent-card-byline">{AGENT_ROLE}</p>
    <p className="nw-agent-card-steward">Steward: <strong>{card.steward}</strong></p>
    <p className="nw-agent-card-status" data-pending={identity.registered ? undefined : ""}>
      {identity.registered
        ? <><BadgeCheck size={16} aria-hidden="true" />Registered on Monad testnet{agentNumber}</>
        : <><CircleDashed size={16} aria-hidden="true" />Not registered yet. This card shows what a registration would say.</>}
    </p>
    <dl className="nw-agent-card-rows">
      <div><dt><Send size={13} aria-hidden="true" />Publishes</dt><dd>Never. The maker chooses in the morning.</dd></div>
      <div><dt><Wallet size={13} aria-hidden="true" />Spends</dt><dd>Only within a Privy policy the maker authorizes: Base Sepolia test USDC, to one room’s door, capped, expiring and revocable.</dd></div>
      <div><dt><HandCoins size={13} aria-hidden="true" />Delivers shares</dt><dd>As a Privy server wallet whose policy allows only <code>claim()</code> on the release contract, plus its one identity registration.</dd></div>
      <div><dt><Fingerprint size={13} aria-hidden="true" />Identity</dt><dd>{identity.registered
        ? `ERC-8004 on Monad testnet${identity.agentId !== null ? `, agent #${identity.agentId}` : ""}`
        : "ERC-8004 on Monad testnet, not registered yet"}</dd></div>
      <div><dt><BookOpen size={13} aria-hidden="true" />World kit</dt><dd>{card.kitVersion}</dd></div>
      <div><dt><Globe size={13} aria-hidden="true" />Service</dt><dd>{service ? <a href={service}>{card.service}</a> : card.service}</dd></div>
    </dl>
    {card.capabilities.length > 0 && <div className="nw-agent-card-block">
      <h4>What it does</h4>
      <ul className="nw-agent-card-list">{card.capabilities.map((capability) => <li key={capability}>{capability}</li>)}</ul>
    </div>}
    {card.evidence.length > 0 && <div className="nw-agent-card-block">
      <h4>Evidence</h4>
      <ul className="nw-agent-card-links">{card.evidence.map((item) => {
        const href = safeHref(item.url);
        return <li key={`${item.label}-${item.url}`}>{href ? <a href={href} target="_blank" rel="noreferrer">{item.label} <ExternalLink size={13} aria-hidden="true" /></a> : item.label}</li>;
      })}</ul>
    </div>}
    <p className="nw-agent-card-note">{identity.note || IDENTITY_NOTE}</p>
    <details className="nw-technical">
      <summary>Registry, owner and transaction</summary>
      <dl>
        <div><dt>Registered as</dt><dd>{card.name}. {card.description}</dd></div>
        <div><dt>Registry (chain {identity.chainId})</dt><dd><code>{identity.registry}</code></dd></div>
        {identity.agentId !== null && <div><dt>Agent ID</dt><dd><code>{identity.agentId}</code></dd></div>}
        {identity.owner && <div><dt>Owner</dt><dd><code>{identity.owner}</code></dd></div>}
        {identity.agentURI && <div><dt>Agent URI</dt><dd><code title={identity.agentURI}>{identity.agentURI.length > 96 ? `${identity.agentURI.slice(0, 96)}…` : identity.agentURI}</code></dd></div>}
        {identity.transaction && <div><dt>Registration</dt><dd>{transaction ? <a href={transaction} target="_blank" rel="noreferrer">{shortHex(identity.transaction)} <ExternalLink size={13} aria-hidden="true" /></a> : <code>{identity.transaction}</code>}</dd></div>}
      </dl>
    </details>
  </section>;
}
