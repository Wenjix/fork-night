"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Check, Download, ExternalLink, Layers3, RefreshCw, Wallet } from "lucide-react";
import { formatEther, getAddress, ZeroAddress } from "ethers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../lib/supabase/database.types.ts";
import { pilotPath, type PilotMoment } from "../lib/pilot.ts";
import { releaseConfig, type ReleaseConfig } from "../lib/onchain/config.ts";
import { DEFAULT_SUPPORT_MON, prepareRelease, releaseByline, releaseRoom, RELEASE_TERMS, sameAddress, TERMS_HASH, type PreparedRelease } from "../lib/onchain/model.ts";
import { MIDNIGHT_SIGNAL_RELEASE_TIP_ID } from "../lib/onchain/records.ts";
import { ReleaseClient, type WalletProvider, type Operation, type Snapshot } from "../lib/onchain/client.ts";
import { preparedWorkApproval, releaseJourney, shortAddress, walletBylines } from "../lib/onchain/journey.ts";
import { ReleaseSession } from "../lib/onchain/session.ts";
import { whileVisible } from "../lib/visible-interval.ts";
import { ReleaseScenes } from "./release-scenes.tsx";
import { browserWallet, usePilotAccount } from "./pilot-account.tsx";
import { WalletRequests } from "./wallet-requests.tsx";
import { GoogleButton, PrivyMark } from "./auth-branding.tsx";
import { PilotDialog } from "./pilot-dialog.tsx";
import { walletAccountIdentity } from "../lib/supabase/wallet-login.ts";

export function TestnetRelease({ roomId, moments, tipId, makerId, makerName, client, onInspect, onChoosePath, onBusyChange }: {
  roomId: string; moments: PilotMoment[]; tipId: string; makerId?: string; makerName?: string;
  client?: SupabaseClient<Database>; onInspect?: (id: string) => void; onBusyChange?: (busy: boolean) => void;
  onChoosePath: (id: string) => void;
}) {
  const config = useMemo(releaseConfig, []);
  const prepared = useMemo(() => {
    if (!releaseRoom(roomId) || !tipId || !config) return { value: null, error: "" };
    try { return { value: prepareRelease(moments, roomId, tipId, config.curator), error: "" }; }
    catch (error) { return { value: null, error: error instanceof Error ? error.message : "This story's release could not be prepared." }; }
  }, [roomId, moments, tipId, config]);
  if (!releaseRoom(roomId) || !tipId) return null;
  return <section className="pilot-release" aria-label="Story release and support">
    {prepared.value && config ? <ReleaseControls key={prepared.value.projectId} prepared={prepared.value} config={config} moments={moments} makerId={makerId} makerName={makerName} client={client} onInspect={onInspect} onChoosePath={onChoosePath} onBusyChange={onBusyChange} /> : <p className="pilot-release-empty" role={prepared.error ? "alert" : undefined}>{prepared.error || "Testnet releases are awaiting setup. You can keep making and reading in this room."}</p>}
  </section>;
}

export function releaseDisplayTipId(roomId: string, moments: PilotMoment[], tipId: string) {
  void roomId; void moments; void MIDNIGHT_SIGNAL_RELEASE_TIP_ID; void pilotPath;
  return tipId;
}

export function PreparedWorkWallet({ prepared, snapshot, config, account, blocked, onApprove }: {
  prepared: PreparedRelease; snapshot: Snapshot; config: ReleaseConfig; account: string; blocked: boolean;
  onApprove: (index: number, address: string) => Promise<string | undefined>;
}) {
  const [wallet, setWallet] = useState("");
  const [rights, setRights] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const index = prepared.scenes.findIndex(scene => scene.moment.maker_id === null && scene.moment.source_kind === "fixture");
  if (!releaseRoom(prepared.scenes[0].moment.room_id)?.preparedLabel || index < 0 ||
    account.toLowerCase() !== config.curator.toLowerCase() || snapshot.curator.toLowerCase() !== config.curator.toLowerCase() ||
    snapshot.scenes[index]?.maker !== ZeroAddress) return null;
  async function approve() {
    if (blocked || working) return;
    try {
      const approval = preparedWorkApproval(prepared, snapshot, account, config.curator, wallet, rights);
      setWorking(true); setError("");
      await onApprove(approval.index, approval.address);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The prepared-work wallet could not be approved."); }
    finally { setWorking(false); }
  }
  return <section className="pilot-my-wallet-request" aria-label="Prepared story wallet" aria-busy={working}>
    <strong>Prepared story wallet</strong>
    <p>Sam, Priya, Jules and Wren are sample bylines in this authored opening. They do not represent four verified creators. Approve one actual rights holder’s wallet for the prepared story; its distinct wallet counts once in a release.</p>
    <p>This permanently binds the prepared-work identity for this project. The approved wallet must accept the terms and register each scene after its parent.</p>
    <label className="pilot-release-consent"><input type="checkbox" checked={rights} disabled={blocked || working} onChange={event => setRights(event.target.checked)} /><span>I have checked the rights holder and their payout wallet for this prepared story.</span></label>
    <form onSubmit={event => { event.preventDefault(); void approve(); }}>
      <label>Rights holder’s EVM wallet<input value={wallet} autoComplete="off" spellCheck={false} maxLength={42} disabled={blocked || working} onChange={event => setWallet(event.target.value)} placeholder="0x…" required /></label>
      <button className="button secondary" type="submit" disabled={blocked || working || !rights || !wallet.trim()}>{working ? "Waiting for approval…" : "Approve prepared-work wallet"}</button>
    </form>
    {error && <p className="pilot-release-error" role="alert">{error}</p>}
  </section>;
}

function ReleaseControls({ prepared, config, moments, makerId, makerName, client, onInspect, onChoosePath, onBusyChange }: {
  prepared: PreparedRelease; config: ReleaseConfig; moments: PilotMoment[]; makerId?: string; makerName?: string;
  client?: SupabaseClient<Database>; onInspect?: (id: string) => void; onBusyChange?: (busy: boolean) => void;
  onChoosePath: (id: string) => void;
}) {
  const identity = usePilotAccount();
  const signInWallet = walletAccountIdentity(identity?.user);
  const sharedAccount = identity?.walletMode === "embedded"
    ? identity.wallet.address
    : signInWallet?.chain === "ethereum" ? signInWallet.address : "";
  const selectedProvider = identity?.walletMode === "embedded" ? identity.wallet.provider : identity?.externalProvider ?? browserWallet();
  const walletRef = useRef<WalletProvider | undefined>(selectedProvider);
  const accountRef = useRef(sharedAccount);
  walletRef.current = selectedProvider;
  accountRef.current = sharedAccount;
  const session = useMemo(() => new ReleaseSession(prepared, config, new ReleaseClient(config), { wallet: () => walletRef.current, storage: () => window.localStorage, account: () => accountRef.current }), [config, prepared.projectId]);
  const current = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const state = current.releaseId === prepared.id ? current : { ...current, snapshot: undefined, accepted: false, loading: true };
  const { snapshot, account, loading, busy, pending, receipt, notice, error } = state;
  const [amount, setAmount] = useState(DEFAULT_SUPPORT_MON);
  const [confirm, setConfirm] = useState<{ operation: Operation; index: number; address?: string; title: string; body: string; terms: boolean } | null>(null);
  const [confirmTerms, setConfirmTerms] = useState(false);
  const [signInWorking, setSignInWorking] = useState(false);
  const [requestWorking, setRequestWorking] = useState(false);
  const journey = releaseJourney(prepared, snapshot, account, config.curator, makerId);
  const approvedWallets = [...new Set(snapshot?.scenes.filter(scene => scene.maker !== ZeroAddress).map(scene => scene.maker.toLowerCase()))];
  const walletBusy = !!busy || requestWorking;
  const blocked = walletBusy || pending || !snapshot;
  useEffect(() => { session.start(); return () => session.stop(); }, [session]);
  useEffect(() => { session.syncWallet(sharedAccount); }, [session, selectedProvider, sharedAccount]);
  useEffect(() => { session.setPrepared(prepared); }, [session, prepared.id]);
  useEffect(() => {
    void session.refresh();
    return whileVisible(() => void session.refresh(), 8000);
  }, [session]);
  useEffect(() => { onBusyChange?.(walletBusy); return () => onBusyChange?.(false); }, [walletBusy, onBusyChange]);
  const perform = (operation: Operation, index = 0, address = "") => { void session.perform(operation, index, address, amount); };
  const ownUnregisteredIndex = snapshot?.scenes.findIndex(scene => !scene.registered && !!account && sameAddress(scene.maker, account)) ?? -1;
  const allRegistered = !!snapshot && journey.registered === prepared.scenes.length;
  const rememberedTerms = account ? releaseTermsAccepted(account) : false;
  useEffect(() => { setConfirmTerms(false); }, [confirm?.operation, account]);
  function download() {
    const blob = new Blob([JSON.stringify({ manifest: prepared.manifest, manifestHash: prepared.hash, releaseId: prepared.id, chainId: config.chainId, contract: config.address, terms: RELEASE_TERMS }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = "fork-night-release.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function signInWithGoogle() {
    if (!identity || signInWorking) return;
    setSignInWorking(true);
    try { await identity.signIn("return"); }
    catch (reason) { session.feedback("", reason instanceof Error ? reason.message : "Google sign-in could not start. Try again."); setSignInWorking(false); }
  }
  const requiresProvider = account && !selectedProvider && !pending;
  const progress = `${journey.registered} of ${prepared.scenes.length} scenes registered`;
  const progressPercent = prepared.scenes.length ? Math.round(journey.registered / prepared.scenes.length * 100) : 0;
  const ownScene = ownUnregisteredIndex >= 0 ? prepared.scenes[ownUnregisteredIndex] : undefined;
  const nextAction = !account
    ? { label: "Sign in to take part", onClick: () => void signInWithGoogle(), disabled: !identity?.enabled || signInWorking }
    : requiresProvider
      ? { label: "Sign in with Google (no extension needed)", onClick: () => void signInWithGoogle(), disabled: !identity?.enabled || signInWorking }
      : pending
        ? { label: "Check saved action", onClick: () => void session.recover(), disabled: walletBusy }
        : !snapshot
          ? { label: "Reading release state…", onClick: () => void session.refresh(true), disabled: true }
          : snapshot.curator === ZeroAddress && journey.curator
            ? { label: "Open release on Monad", onClick: () => setConfirm(confirmCopy("create", 0, prepared)), disabled: blocked }
            : ownScene
              ? { label: "Register my scene", onClick: () => setConfirm(confirmCopy("register", ownUnregisteredIndex, prepared)), disabled: blocked }
              : !journey.released && journey.curator && allRegistered
                ? { label: "Lock this release", onClick: () => setConfirm(confirmCopy("release", 0, prepared)), disabled: blocked }
                : snapshot.release.exists && journey.ownShare?.claimable
                  ? { label: `Claim my ${formatEther(journey.ownShare.claimable)} test MON`, onClick: () => setConfirm(confirmCopy("claim", 0, prepared, account)), disabled: blocked }
                  : snapshot.release.exists
                    ? { label: "Support this release", onClick: () => setConfirm(confirmCopy("support", 0, prepared)), disabled: blocked }
                    : { label: "Add a scene to join the next release", onClick: () => onChoosePath(prepared.scenes.at(-1)!.moment.id), disabled: false };
  async function confirmAction() {
    if (!confirm || !account) return;
    if (confirm.terms && !rememberedTerms && !confirmTerms) return;
    if (confirm.terms && !rememberedTerms) rememberReleaseTerms(account);
    session.accept(true);
    perform(confirm.operation, confirm.index, confirm.address ?? "");
    setConfirm(null);
  }
  return <>
    <div className="pilot-release-card" aria-busy={walletBusy}>
      <div className="pilot-release-card-top">
        <div>
          <p className="pilot-release-kicker">Story release on Monad</p>
          <h2>{journey.ownShare?.claimable ? "Your next step" : journey.released ? "Story release on Monad" : ownScene ? "Your next step" : "Midnight Signal"}</h2>
          <div className="pilot-release-badges"><span>Monad testnet</span>{account && <span title={account}>Signed in · {shortAddress(account)}</span>}{makerName && <span>Making as {makerName}</span>}</div>
        </div>
        <button className="pilot-icon-button" type="button" disabled={walletBusy} onClick={() => void session.refresh(true)} aria-label="Refresh onchain release"><RefreshCw size={18} aria-hidden="true" /></button>
      </div>
      <p className="pilot-release-progress-copy">{progress} · then Lock → Support → Claim</p>
      <div className="pilot-release-progress" aria-hidden="true"><span style={{ width: `${progressPercent}%` }} /></div>
      <p className="pilot-release-card-copy">{actionCopy({ journey, snapshot, ownScene, prepared })}</p>
      <div className="pilot-release-actions"><button className="button primary" type="button" disabled={nextAction.disabled} onClick={nextAction.onClick}>{nextAction.label}</button><a href={config.explorer ? `${config.explorer}/address/${config.address}` : "#"} target={config.explorer ? "_blank" : undefined} rel={config.explorer ? "noreferrer" : undefined}>Details on MonadScan <ExternalLink size={14} aria-hidden="true" /></a></div>
      {identity?.user?.is_anonymous === false && <div className="pilot-wallet-options" role="group" aria-label="Choose release wallet">
        <button type="button" className="text-button" disabled={walletBusy || pending} aria-pressed={identity.walletMode === "embedded"} onClick={() => identity.chooseWallet("embedded")}>In-app wallet <PrivyMark /></button>
        <button type="button" className="text-button" disabled={walletBusy || pending} aria-pressed={identity.walletMode === "external"} onClick={() => identity.chooseWallet("external")}>Use browser sign-in wallet</button>
      </div>}
      {identity?.walletMode === "embedded" && account && !selectedProvider && <p role="status" className="pilot-release-loading">{identity.wallet.error || "Preparing your in-app wallet…"}</p>}
      {loading && <p role="status" className="pilot-release-loading">Reading the recorded path…</p>}
      {busy && <p role="status" className="pilot-release-working"><RefreshCw size={16} aria-hidden="true" />{operationLabel(busy)} on Monad… You can keep reading.</p>}
      {receipt && config.explorer && <a className="pilot-release-receipt" href={`${config.explorer}/tx/${receipt}`} target="_blank" rel="noreferrer">View transaction on MonadScan <ExternalLink size={14} aria-hidden="true" /></a>}
      {notice && <p role="status" className="pilot-release-notice"><Check size={16} aria-hidden="true" />{notice}</p>}
      {error && !/Ethereum-compatible wallet/.test(error) && <p role="alert" className="pilot-release-error">{error}</p>}
      {pending && <div className="pilot-release-recovery"><strong>Still waiting for Monad?</strong><p>Check again resumes the saved action and never sends twice.</p><div className="button-row"><button className="button secondary" type="button" disabled={walletBusy} onClick={() => void session.recover()}>Check again</button><button className="text-button" type="button" disabled={walletBusy} onClick={() => void session.recover(true)}>Retry saved action</button></div></div>}
      <details className="pilot-release-details"><summary>Details</summary><p>{RELEASE_TERMS}</p><p>Amounts and claims come from the contract. Wallets can belong to the same person. Test MON has no redemption value.</p>
        <dl className="pilot-release-addresses">
          {account && <div><dt>Connected wallet</dt><dd><code>{account}</code></dd></div>}
          <div><dt>Configured curator</dt><dd><code>{config.curator}</code></dd></div>
          <div><dt>Payout contract</dt><dd><code>{config.address}</code></dd></div>
          {snapshot && approvedWallets.map(address => <div key={address}><dt>{walletBylines(prepared, snapshot, address).join(", ")} · approved wallet</dt><dd><code>{getAddress(address)}</code></dd></div>)}
        </dl>
        {account && <WalletRequests prepared={prepared} snapshot={snapshot} config={config} moments={moments} account={account} makerId={makerId} provider={selectedProvider} client={client} blocked={!!busy || pending || !snapshot || snapshot.curator === ZeroAddress} sessionError={error} onApprove={(index, address) => session.perform("approve", index, address)} onChoosePath={onChoosePath} onWorking={setRequestWorking} onFeedback={message => session.feedback(message)} />}
        {snapshot && snapshot.curator !== ZeroAddress && <><PreparedWorkWallet key={prepared.projectId + account} prepared={prepared} snapshot={snapshot} config={config} account={account} blocked={blocked} onApprove={(index, address) => session.perform("approve", index, address)} />
          <details className="pilot-release-makers" key={prepared.id + String(journey.released)}>
            <summary><span>The makers in this path</span><span>{journey.registered} of {prepared.scenes.length} scenes registered</span></summary>
            <ReleaseScenes prepared={prepared} snapshot={snapshot} account={account} accepted={true} busy={true} pending={pending} onAction={() => {}} client={client} onInspect={onInspect} explorer={config.explorer} actions={false} />
          </details></>}
        {snapshot?.release.exists && <section className="pilot-release-support" aria-labelledby="support-title">
          <div className="pilot-release-section-title"><h3 id="support-title">Support and claims</h3><span>{formatEther(snapshot.release.received)} test MON received</span></div>
          <p>One equal share for each of these {snapshot.release.beneficiaries.length} wallets. Curating or funding alone earns no share.</p>
          <ul>{snapshot.release.beneficiaries.map(item => <li key={item.address}><div><strong>{walletBylines(prepared, snapshot, item.address).join(", ")}</strong><span title={item.address}>{shortAddress(item.address)}</span></div><span>{formatEther(item.claimable)} test MON claimable · {formatEther(item.claimed)} claimed</span></li>)}</ul>
          <form onSubmit={event => { event.preventDefault(); setConfirm(confirmCopy("support", 0, prepared)); }}><label>Test MON amount<input inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} required disabled={blocked} /></label><button className="button secondary" type="submit" disabled={blocked || !account}>Support this release</button></form>
        </section>}
        <div className="pilot-release-record"><button className="button secondary" type="button" onClick={download}><Download size={16} aria-hidden="true" />Download exact release record</button>{config.explorer && <a href={`${config.explorer}/address/${config.address}`} target="_blank" rel="noreferrer">Payout contract <ExternalLink size={14} aria-hidden="true" /></a>}</div></details>
    </div>
    {confirm && <PilotDialog title={confirm.title} className="pilot-release-confirm" dismissible={!walletBusy} onClose={() => { if (!walletBusy) setConfirm(null); }}>
      <p>{confirm.body}</p>
      {confirm.terms && !rememberedTerms ? <label className="pilot-release-consent"><input type="checkbox" checked={confirmTerms} onChange={event => setConfirmTerms(event.target.checked)} /><span>I made this scene or have permission to use it, and I accept the <a href="#release-terms">release terms</a>.</span></label> : confirm.terms ? <p className="pilot-release-notice"><Check size={16} aria-hidden="true" />Release terms already accepted for this wallet.</p> : null}
      <p className="pilot-release-loading">Network fee uses test MON · Wallet {account ? shortAddress(account) : "not signed in"}</p>
      <footer className="button-row"><button className="button primary" type="button" disabled={walletBusy || confirm.terms && !rememberedTerms && !confirmTerms} onClick={() => void confirmAction()}>{operationButton(confirm.operation)}</button><button className="button secondary" type="button" disabled={walletBusy} onClick={() => setConfirm(null)}>Cancel</button></footer>
    </PilotDialog>}
  </>;
}

function releaseTermsKey(account: string) {
  return `fork-night:release-terms:${TERMS_HASH}:${account.toLowerCase()}`;
}
function releaseTermsAccepted(account: string) {
  if (typeof window === "undefined") return false;
  try { return window.localStorage.getItem(releaseTermsKey(account)) === "1"; }
  catch { return false; }
}
function rememberReleaseTerms(account: string) {
  try { window.localStorage.setItem(releaseTermsKey(account), "1"); }
  catch { /* A blocked store just means the next confirmation will ask again. */ }
}
function operationLabel(operation: ReleaseStateOperation) {
  return operation === "register" ? "Registering" : operation === "release" ? "Locking release" : operation === "support" ? "Supporting" : operation === "claim" ? "Claiming" : operation === "create" ? "Opening release" : "Checking";
}
type ReleaseStateOperation = Operation | "connect" | "recover" | "retry";
function operationButton(operation: Operation) {
  return operation === "register" ? "Register on Monad" : operation === "release" ? "Lock on Monad" : operation === "support" ? "Support on Monad" : operation === "claim" ? "Claim on Monad" : "Open on Monad";
}
function confirmCopy(operation: Operation, index: number, prepared: PreparedRelease, address = "") {
  const scene = prepared.scenes[index];
  if (operation === "register") return {
    operation, index, title: "Register this scene on Monad?",
    body: `"${scene.moment.title}" by ${releaseByline(scene.moment)}. This can't be undone. Each wallet that registers a scene in this path gets an equal share of support.`,
    terms: true,
  };
  if (operation === "release") return { operation, index, title: "Lock this release on Monad?", body: "This freezes the registered scene list and the equal-wallet split for this story.", terms: true };
  if (operation === "create") return { operation, index, title: "Open this story on Monad?", body: "This creates the release project so maker wallets can register their scenes.", terms: true };
  if (operation === "claim") return { operation, index, address, title: "Claim your share?", body: "The claim goes to the registered wallet for this release. Anyone can submit the transaction, but the destination cannot be changed.", terms: false };
  return { operation, index, title: "Support this release?", body: "Your test MON support is split equally across the registered wallet list for this frozen release.", terms: false };
}
function actionCopy({ journey, snapshot, ownScene, prepared }: {
  journey: ReturnType<typeof releaseJourney>; snapshot?: Snapshot; ownScene?: PreparedRelease["scenes"][number]; prepared: PreparedRelease;
}) {
  if (!snapshot) return "Reading the story's Monad release record.";
  if (ownScene) return `"${ownScene.moment.title}" is ready to register. Register it and the story can move toward lock, support and claims.`;
  if (snapshot.curator === ZeroAddress && journey.curator) return "Open the release project before approving maker wallets.";
  if (!journey.released && journey.curator && journey.registered === prepared.scenes.length) return `${journey.wallets} registered wallets will share this release equally.`;
  if (journey.ownShare?.claimable) return "Your registered wallet has a claim ready.";
  if (snapshot.release.exists) return "This release is locked. Supporters can send test MON and registered wallets can claim their shares.";
  return "Once every scene in this selected path is on Monad, the story can be locked and supported.";
}
