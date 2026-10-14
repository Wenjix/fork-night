"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Check, ChevronDown, Download, ExternalLink, Layers3, RefreshCw, Wallet } from "lucide-react";
import { formatEther, getAddress, ZeroAddress } from "ethers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../lib/supabase/database.types.ts";
import type { PilotMoment } from "../lib/pilot.ts";
import { releaseConfig, type ReleaseConfig } from "../lib/onchain/config.ts";
import { DEFAULT_SUPPORT_MON, ORIGINAL_ROOM, prepareRelease, RELEASE_TERMS, type PreparedRelease } from "../lib/onchain/model.ts";
import { ReleaseClient, type WalletProvider, type Operation } from "../lib/onchain/client.ts";
import { releaseJourney, shortAddress, walletBylines } from "../lib/onchain/journey.ts";
import { ReleaseSession } from "../lib/onchain/session.ts";
import { whileVisible } from "../lib/visible-interval.ts";
import { ReleaseScenes } from "./release-scenes.tsx";
import { browserWallet, usePilotAccount } from "./pilot-account.tsx";
import { WalletRequests } from "./wallet-requests.tsx";
import { PrivyMark } from "./auth-branding.tsx";

export function TestnetRelease({ roomId, moments, tipId, makerId, makerName, client, onInspect, onChoosePath, onBusyChange }: {
  roomId: string; moments: PilotMoment[]; tipId: string; makerId?: string; makerName?: string;
  client?: SupabaseClient<Database>; onInspect?: (id: string) => void; onBusyChange?: (busy: boolean) => void;
  onChoosePath: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const config = useMemo(releaseConfig, []);
  const prepared = useMemo(() => {
    if (roomId !== ORIGINAL_ROOM || !tipId || !config) return { value: null, error: "" };
    try { return { value: prepareRelease(moments, roomId, tipId, config.curator), error: "" }; }
    catch (error) { return { value: null, error: error instanceof Error ? error.message : "This story's release could not be prepared." }; }
  }, [roomId, moments, tipId, config]);
  if (roomId !== ORIGINAL_ROOM || !tipId) return null;
  return <section className="pilot-release" aria-label="Story release and support">
    {prepared.value && config ? <ReleaseControls key={prepared.value.projectId} prepared={prepared.value} config={config} moments={moments} makerId={makerId} makerName={makerName} client={client} onInspect={onInspect} onChoosePath={onChoosePath} onBusyChange={onBusyChange} open={open} onToggle={() => setOpen(!open)} /> : <>
      <button className="pilot-release-toggle" type="button" aria-expanded={open} aria-controls="payout-body" onClick={() => setOpen(!open)}><Layers3 size={21} aria-hidden="true" /><span><strong>Release and support this story</strong><span>Making a moment never requires a wallet.</span></span><ChevronDown size={18} aria-hidden="true" /></button>
      {open && <p id="payout-body" className="pilot-release-empty" role={prepared.error ? "alert" : undefined}>{prepared.error || "Testnet releases are awaiting setup. You can keep making and reading in this room."}</p>}
    </>}
  </section>;
}

function ReleaseControls({ prepared, config, moments, makerId, makerName, client, onInspect, onChoosePath, onBusyChange, open, onToggle }: {
  prepared: PreparedRelease; config: ReleaseConfig; moments: PilotMoment[]; makerId?: string; makerName?: string;
  client?: SupabaseClient<Database>; onInspect?: (id: string) => void; onBusyChange?: (busy: boolean) => void;
  open: boolean; onToggle: () => void;
  onChoosePath: (id: string) => void;
}) {
  const identity = usePilotAccount();
  const selectedProvider = identity?.walletMode === "embedded" ? identity.wallet.provider : identity ? identity.externalProvider : browserWallet();
  const walletRef = useRef<WalletProvider | undefined>(selectedProvider);
  walletRef.current = selectedProvider;
  const session = useMemo(() => new ReleaseSession(prepared, config, new ReleaseClient(config), { wallet: () => walletRef.current, storage: () => window.localStorage }), [config, prepared.projectId]);
  const current = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const state = current.releaseId === prepared.id ? current : { ...current, snapshot: undefined, accepted: false, loading: true };
  const { snapshot, account, accepted, loading, busy, pending, receipt, notice, error } = state;
  const [amount, setAmount] = useState(DEFAULT_SUPPORT_MON);
  const [requestWorking, setRequestWorking] = useState(false);
  const journey = releaseJourney(prepared, snapshot, account, config.curator, makerId);
  const approvedWallets = [...new Set(snapshot?.scenes.filter(scene => scene.maker !== ZeroAddress).map(scene => scene.maker.toLowerCase()))];
  const walletBusy = !!busy || requestWorking;
  const blocked = walletBusy || pending || !snapshot;
  useEffect(() => { session.start(); return () => session.stop(); }, [session]);
  useEffect(() => { session.syncWallet(); }, [session, selectedProvider]);
  useEffect(() => { session.setPrepared(prepared); }, [session, prepared.id]);
  useEffect(() => {
    if (!open) return;
    void session.refresh();
    return whileVisible(() => void session.refresh(), 8000);
  }, [session, open]);
  useEffect(() => { onBusyChange?.(walletBusy); return () => onBusyChange?.(false); }, [walletBusy, onBusyChange]);
  const perform = (operation: Operation, index = 0, address = "") => { void session.perform(operation, index, address, amount); };
  const ownUnregistered = snapshot?.scenes.some(scene => !scene.registered && account && scene.maker.toLowerCase() === account.toLowerCase());
  const consentNeeded = !journey.released && !!account && (ownUnregistered || journey.role === "Maker approval pending" || journey.curator && snapshot?.curator === ZeroAddress);
  function download() {
    const blob = new Blob([JSON.stringify({ manifest: prepared.manifest, manifestHash: prepared.hash, releaseId: prepared.id, chainId: config.chainId, contract: config.address, terms: RELEASE_TERMS }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = "fork-night-release.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <>
    <button className="pilot-release-toggle" type="button" aria-expanded={open} aria-controls="payout-body" onClick={onToggle}>
      <Layers3 size={21} aria-hidden="true" /><span><strong>{journey.released ? "Support this released story" : "Release and support this story"}</strong><span>{prepared.scenes.length} {prepared.scenes.length === 1 ? "scene" : "scenes"} in the chosen path · {walletBusy ? "Wallet action in progress" : "Monad testnet"}</span></span><ChevronDown size={18} aria-hidden="true" />
    </button>
    <div id="payout-body" hidden={!open} className="pilot-release-body" aria-busy={walletBusy}>
      <div className="pilot-release-heading"><div><h2>{journey.title}</h2><p>Equal shares per distinct registered wallet. The released split stays fixed.</p></div><button className="pilot-icon-button" type="button" disabled={walletBusy} onClick={() => void session.refresh()} aria-label="Refresh onchain release"><RefreshCw size={18} aria-hidden="true" /></button></div>
      <ol className="pilot-release-steps" aria-label="Release stages">{["Wallets", "Scenes", "Release", "Support", "Claims"].map((label, index) => {
        const stage = ["project", "wallets"].includes(journey.stage) ? 0 : journey.stage === "scenes" ? 1 : journey.stage === "release" ? 2 : journey.stage === "support" ? 3 : 4;
        return <li key={label} aria-current={stage === index ? "step" : undefined} data-complete={index < stage || journey.stage === "claimed"}>{index < stage || journey.stage === "claimed" ? <Check size={14} aria-hidden="true" /> : <span aria-hidden="true">{index + 1}</span>}{label}</li>;
      })}</ol>
      <div className="pilot-release-wallet">
        <Wallet size={21} aria-hidden="true" /><div><strong>{journey.role}</strong><span>{account ? <span title={account}>{shortAddress(account)} · {config.name}</span> : "A wallet is only needed for testnet actions."}{makerName && <span>Making as {makerName}</span>}</span></div>
        <div className="pilot-wallet-connect">
        {identity?.user?.is_anonymous === false && <div className="pilot-wallet-options" role="group" aria-label="Choose a release wallet">
          <button type="button" className="text-button" disabled={walletBusy || pending} aria-pressed={identity.walletMode === "embedded"} onClick={() => identity.chooseWallet("embedded")}>In-app wallet <PrivyMark /></button>
          <button type="button" className="text-button" disabled={walletBusy || pending} aria-pressed={identity.walletMode === "external"} onClick={() => identity.chooseWallet("external")}>Use a browser wallet</button>
        </div>}
        {identity?.walletMode === "external" && !!identity.browserWallets?.some(wallet => wallet.chain === "ethereum") && <label className="pilot-release-provider">Browser wallet
          <select disabled={walletBusy || pending} value={identity.browserWallets.find(wallet => wallet.chain === "ethereum" && wallet.provider === selectedProvider)?.id ?? ""} onChange={event => {
            const choice = identity.browserWallets?.find(wallet => wallet.id === event.target.value);
            if (choice?.chain === "ethereum") identity.selectBrowserWallet?.(choice);
          }}><option value="" disabled>Choose an EVM wallet</option>{identity.browserWallets.filter(wallet => wallet.chain === "ethereum").map(wallet => <option value={wallet.id} key={wallet.id}>{wallet.name}</option>)}</select>
        </label>}
        <button className={`button ${account ? "secondary" : "primary"}`} type="button" disabled={walletBusy || identity?.walletMode === "embedded" && !selectedProvider} onClick={() => void session.connect()}>{busy === "connect" ? "Connecting…" : account ? "Reconnect wallet" : identity?.walletMode === "embedded" ? "Use my in-app wallet" : "Connect testnet wallet"}</button>
        {identity?.walletMode === "embedded" && !selectedProvider && <small role="status">{identity.wallet.error || "Preparing your in-app wallet…"}</small>}
        </div>
      </div>
      {account && <p className="pilot-release-wallet-help">Reconnecting or changing wallets keeps your storyteller identity.</p>}
      {error && <p role="alert" className="pilot-release-error">{error}</p>}
      {notice && <p role="status" className="pilot-release-notice"><Check size={16} aria-hidden="true" />{notice}</p>}
      {busy && <p role="status" className="pilot-release-working"><RefreshCw size={16} aria-hidden="true" />Wallet action in progress. Check your wallet for confirmation.</p>}
      {loading && <p role="status" className="pilot-release-loading">Reading the recorded path…</p>}
      {pending && <div className="pilot-release-recovery"><strong>Check your saved action first</strong><p>It may already be recorded. A retry keeps the original payment key.</p><div className="button-row"><button className="button secondary" type="button" disabled={walletBusy} onClick={() => void session.recover()}>Check saved action</button><button className="text-button" type="button" disabled={walletBusy} onClick={() => void session.recover(true)}>Retry saved action</button></div></div>}
      {open && account && <WalletRequests prepared={prepared} snapshot={snapshot} config={config} moments={moments} account={account} makerId={makerId} provider={selectedProvider} client={client} blocked={!!busy || pending || !snapshot || snapshot.curator === ZeroAddress} sessionError={error} onApprove={(index, address) => session.perform("approve", index, address)} onChoosePath={onChoosePath} onWorking={setRequestWorking} onFeedback={message => session.feedback(message)} />}
      {consentNeeded && <label className="pilot-release-consent"><input type="checkbox" checked={accepted} disabled={walletBusy || pending} onChange={event => session.accept(event.target.checked)} /><span>I can include this original or permitted work and accept equal shares for its registered maker wallets. The curator approves the byline-to-wallet links.</span></label>}
      {snapshot && snapshot.curator === ZeroAddress && <div className="pilot-release-next"><p>{journey.curator ? "Record this original story before approving its maker wallets." : "The curator opens this story for testnet releases."}</p>{journey.curator && <button className="button primary" type="button" disabled={blocked || !accepted} onClick={() => perform("create")}>Start the testnet project</button>}</div>}
      {snapshot && snapshot.curator !== ZeroAddress && <>
        <details className="pilot-release-makers" key={prepared.id + String(journey.released)} open={!journey.released}>
          <summary><span>The makers in this path</span><span>{journey.registered} of {prepared.scenes.length} scenes registered</span></summary>
          <ReleaseScenes prepared={prepared} snapshot={snapshot} account={account} accepted={accepted} busy={walletBusy} pending={pending} onAction={perform} client={client} onInspect={onInspect} />
        </details>
        {!journey.released && <div className="pilot-release-next"><p>{journey.registered === prepared.scenes.length ? `${journey.wallets} registered wallets will share this release equally.` : "Each approved wallet registers its scenes after their parents."}</p>{journey.curator ? <button className="button primary" type="button" disabled={blocked || journey.registered !== prepared.scenes.length} onClick={() => perform("release")}>Freeze this release</button> : <span>The curator freezes the release once every scene is registered.</span>}</div>}
      </>}
      {snapshot?.release.exists && <section className="pilot-release-support" aria-labelledby="support-title">
        {journey.ownShare && <div className="pilot-release-claim"><div><strong>Your registered wallet's share</strong><span>{formatEther(journey.ownShare.claimed)} test MON claimed so far</span></div><button className={`button ${journey.ownShare.claimable > 0n ? "primary" : "secondary"}`} type="button" disabled={blocked || journey.ownShare.claimable === 0n} onClick={() => perform("claim", 0, account)}>{journey.ownShare.claimable > 0n ? `Claim my ${formatEther(journey.ownShare.claimable)} test MON` : "No share waiting to claim"}</button></div>}
        <div className="pilot-release-section-title"><h3 id="support-title">Support the story</h3><span>{formatEther(snapshot.release.received)} test MON received</span></div>
        <p>One equal share for each of these {snapshot.release.beneficiaries.length} wallets. Curating or funding alone earns no share.</p>
        <ul>{snapshot.release.beneficiaries.map(item => <li key={item.address}><div><strong>{walletBylines(prepared, snapshot, item.address).join(", ")}</strong><span title={item.address}>{shortAddress(item.address)}</span></div><span>{formatEther(item.claimable)} test MON claimable</span></li>)}</ul>
        <form onSubmit={event => { event.preventDefault(); perform("support"); }}><label>Test MON amount<input inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} required disabled={blocked} /></label><button className={`button ${journey.ownShare?.claimable ? "secondary" : "primary"}`} type="submit" disabled={blocked || !account}>Support this release</button></form>
      </section>}
      <details className="pilot-release-details"><summary>Terms, addresses and release record</summary><p>{RELEASE_TERMS}</p><p>Amounts and claims come from the contract. Wallets can belong to the same person. Test MON has no redemption value.</p>
        <dl className="pilot-release-addresses">
          {account && <div><dt>Connected wallet</dt><dd><code>{account}</code></dd></div>}
          <div><dt>Configured curator</dt><dd><code>{config.curator}</code></dd></div>
          <div><dt>Payout contract</dt><dd><code>{config.address}</code></dd></div>
          {snapshot && approvedWallets.map(address => <div key={address}><dt>{walletBylines(prepared, snapshot, address).join(", ")} · approved wallet</dt><dd><code>{getAddress(address)}</code></dd></div>)}
        </dl>
        <div className="pilot-release-record"><button className="button secondary" type="button" onClick={download}><Download size={16} aria-hidden="true" />Download exact release record</button>{config.explorer && <a href={`${config.explorer}/address/${config.address}`} target="_blank" rel="noreferrer">Payout contract <ExternalLink size={14} aria-hidden="true" /></a>}</div></details>
      {receipt && config.explorer && <a className="pilot-release-receipt" href={`${config.explorer}/tx/${receipt}`} target="_blank" rel="noreferrer">View last transaction <ExternalLink size={14} aria-hidden="true" /></a>}
    </div>
  </>;
}
