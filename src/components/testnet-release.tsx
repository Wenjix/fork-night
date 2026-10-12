"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, ChevronDown, Download, ExternalLink, RefreshCw, Wallet } from "lucide-react";
import { formatEther, getAddress, ZeroAddress } from "ethers";
import { releaseConfig, type ReleaseConfig } from "@/lib/onchain/config";
import { operationArgs, ReleaseClient, transactionStorageKey, type Operation, type Snapshot, type WalletProvider } from "@/lib/onchain/client";
import { ORIGINAL_ROOM, prepareRelease, RELEASE_TERMS, sameAddress, supportAmount, type PreparedRelease } from "@/lib/onchain/model";
import type { PilotMoment } from "@/lib/pilot";

function walletProvider() { return (window as Window & { ethereum?: WalletProvider }).ethereum; }
const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
function explain(error: unknown) {
  const e = error as { code?: string; revert?: { name?: string }; message?: string };
  if (e.code === "ACTION_REJECTED" || e.code === "4001") return "You declined the wallet request. No new transaction was sent.";
  if (e.code === "INSUFFICIENT_FUNDS") return "This wallet needs test MON for the payment and network fee. Add test funds, then try again.";
  if (e.revert) return "The contract rejected this action. Refresh the recorded path and review its maker accounts before trying again.";
  if (error instanceof Error && !e.code) return error.message;
  return "The transaction could not be confirmed. Check the saved action and your wallet history before sending again.";
}

export function TestnetRelease({ roomId, moments, tipId, makerId }: { roomId: string; moments: PilotMoment[]; tipId: string; makerId?: string }) {
  const [open, setOpen] = useState(false);
  const config = useMemo(releaseConfig, []);
  if (roomId !== ORIGINAL_ROOM || !tipId) return null;
  return <section className="pilot-release" aria-labelledby="payout-title">
    <button className="pilot-release-toggle" type="button" aria-expanded={open} aria-controls="payout-body" onClick={() => setOpen(!open)}>
      <span><strong id="payout-title">Make this path a shared release</strong><span>Its registered makers keep a claim on every testnet payment.</span></span><ChevronDown size={20} aria-hidden="true" />
    </button>
    {open && <div id="payout-body">{config ? <ConfiguredRelease config={config} moments={moments} tipId={tipId} makerId={makerId} /> : <p className="pilot-release-empty">Testnet payouts are awaiting setup. You can keep making and reading in this room. Payouts use test MON; generation credits remain separate.</p>}</div>}
  </section>;
}

function ConfiguredRelease({ config, moments, tipId, makerId }: { config: ReleaseConfig; moments: PilotMoment[]; tipId: string; makerId?: string }) {
  const prepared = useMemo(() => {
    try { return { value: prepareRelease(moments, ORIGINAL_ROOM, tipId, config.curator), error: "" }; }
    catch (error) { return { value: null, error: explain(error) }; }
  }, [moments, tipId, config.curator]);
  return prepared.value ? <ReleaseControls key={prepared.value.id} prepared={prepared.value} config={config} makerId={makerId} /> : <p role="alert">{prepared.error}</p>;
}

function ReleaseControls({ prepared, config, makerId }: { prepared: PreparedRelease; config: ReleaseConfig; makerId?: string }) {
  const client = useMemo(() => new ReleaseClient(config), [config]);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [account, setAccount] = useState("");
  const [wallets, setWallets] = useState<Record<string, string>>({});
  const [accepted, setAccepted] = useState(false);
  const [amount, setAmount] = useState("0.01");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [receipt, setReceipt] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const active = useRef(true), inFlight = useRef(false);
  const curator = account && sameAddress(account, config.curator);
  const key = account ? transactionStorageKey(config, account, prepared.projectId) : "";
  async function refresh() {
    try { const next = await client.load(prepared); if (active.current) { setSnapshot(next); setError(""); } }
    catch (error) { if (active.current) { setSnapshot(undefined); setError(explain(error)); } }
    finally { if (active.current) setLoading(false); }
  }
  useEffect(() => {
    active.current = true;
    void refresh();
    const wallet = walletProvider();
    const changed = () => { setAccount(""); setAccepted(false); setReceipt(""); setPending(false); setNotice("Reconnect to review the selected wallet and network."); };
    wallet?.on?.("accountsChanged", changed); wallet?.on?.("chainChanged", changed);
    return () => { active.current = false; wallet?.removeListener?.("accountsChanged", changed); wallet?.removeListener?.("chainChanged", changed); setTimeout(() => { if (!active.current) client.destroy(); }, 0); };
  }, [client]);
  useEffect(() => {
    try { setPending(!!key && !!localStorage.getItem(key)); }
    catch { setError("Saved receipts are unavailable in this browser. Enable local storage before sending a payment."); }
  }, [key]);
  async function connect() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const wallet = walletProvider();
      if (!wallet) throw new Error("Open this page in a wallet browser, or enable an Ethereum-compatible wallet extension.");
      await client.verify();
      const connected = await client.connect(wallet);
      if (active.current) { setAccount(connected.account); setAccepted(false); setNotice("Wallet connected. Accept the release terms to register scenes approved for this wallet."); }
      await refresh();
    } catch (error) { if (active.current) setError(explain(error)); }
    finally { inFlight.current = false; if (active.current) setBusy(false); }
  }
  async function perform(operation: Operation, index = 0, walletAddress = "") {
    if (inFlight.current || !account || !snapshot || pending) return;
    inFlight.current = true; setBusy(true); setError(""); setNotice("");
    try {
      if ((operation === "register" || operation === "create") && !accepted) throw new Error("Accept the testnet release terms before registering your work.");
      const wallet = walletProvider(); if (!wallet) throw new Error("Reconnect your wallet to continue.");
      const args = operationArgs(prepared, operation, index, walletAddress);
      const hash = await client.execute(prepared, wallet, account, localStorage, operation, args, operation === "support" ? supportAmount(amount) : 0n);
      if (active.current) { setReceipt(hash); setNotice(operation === "claim" ? "Your testnet share reached its registered wallet." : operation === "support" ? "Support recorded. Every included maker's claim has accrued." : "Recorded on the test network."); }
      await refresh();
    } catch (error) { if (active.current) setError(explain(error)); }
    finally {
      inFlight.current = false;
      if (active.current) { setBusy(false); setPending(!!localStorage.getItem(key)); }
    }
  }
  async function recover() {
    if (inFlight.current || !account) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const result = await client.recover(prepared, account, localStorage);
      if (active.current) { setPending(!result.complete); if (result.hash) setReceipt(result.hash); setNotice(result.complete ? "The saved action is confirmed in the contract. No action was sent again." : "Nothing is confirmed yet. Check the pending request in your wallet, then check again."); }
      await refresh();
    } catch (error) { if (active.current) { setError(explain(error)); setPending(!!localStorage.getItem(key)); } }
    finally { inFlight.current = false; if (active.current) setBusy(false); }
  }
  async function retry() {
    if (inFlight.current || !account) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const wallet = walletProvider(); if (!wallet) throw new Error("Reconnect the wallet that sent the saved action.");
      const hash = await client.retry(prepared, wallet, account, localStorage);
      if (active.current) { if (hash) setReceipt(hash); setPending(false); setNotice("The saved action is confirmed. Its original payment key prevents collecting the payment twice."); }
      await refresh();
    } catch (error) { if (active.current) setError(explain(error)); }
    finally { inFlight.current = false; if (active.current) { setBusy(false); setPending(!!localStorage.getItem(key)); } }
  }
  const ownShare = snapshot?.release.beneficiaries.find(item => sameAddress(item.address, account));
  const blocked = busy || pending || !snapshot;
  const download = () => {
    const blob = new Blob([JSON.stringify({ manifest: prepared.manifest, manifestHash: prepared.hash, releaseId: prepared.id,
      chainId: config.chainId, contract: config.address, terms: RELEASE_TERMS }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = "fork-night-release.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <div className="pilot-release-body" aria-busy={busy}>
    <div className="pilot-release-heading"><div><h2>Made together. Claimed individually.</h2><p>{config.name} · test MON has no redemption value.</p></div><button className="button secondary" type="button" disabled={busy} onClick={() => void refresh()} aria-label="Refresh onchain release"><RefreshCw size={16} /></button></div>
    <p className="pilot-release-rule">The full selected path earns equal shares for each distinct registered wallet. Curating and funding alone earn no share. The released split stays fixed. Wallet approval links a byline to its recipient; scene registration records the work and its parent.</p>
    {error && <p role="alert" className="pilot-release-error">{error}</p>}
    {notice && <p role="status" className="pilot-release-notice"><Check size={16} aria-hidden="true" />{notice}</p>}
    {loading && <p role="status">Reading the recorded path…</p>}
    <div className="pilot-release-wallet"><button className="button secondary" type="button" onClick={() => void connect()} disabled={busy}><Wallet size={17} />{account ? `Connected: ${shortAddress(account)}` : "Connect testnet wallet"}</button>{config.explorer && <a href={`${config.explorer}/address/${config.address}`} target="_blank" rel="noreferrer">Payout contract <ExternalLink size={14} /></a>}</div>
    {account && <label className="pilot-release-consent"><input type="checkbox" checked={accepted} disabled={busy || pending} onChange={event => setAccepted(event.target.checked)} /><span>I can include this original or permitted work in the testnet release and accept equal shares for its registered maker wallets. The curator approves the byline-to-wallet links.</span></label>}
    {pending && <div className="pilot-release-recovery"><p>A submitted action is waiting for confirmation. Check it first. Retrying keeps its original payment key.</p><button className="button secondary" type="button" disabled={busy} onClick={() => void recover()}>Check saved action</button><button className="button secondary" type="button" disabled={busy} onClick={() => void retry()}>Retry saved action</button></div>}
    {snapshot && snapshot.curator === ZeroAddress && <p>{curator ? <button className="button primary" type="button" disabled={blocked || !accepted} onClick={() => void perform("create")}>Start the testnet project <ArrowRight size={16} /></button> : "The curator will open this path for testnet releases."}</p>}
    {snapshot && snapshot.curator !== ZeroAddress && <>
      {curator && snapshot.scenes.some(scene => scene.maker === ZeroAddress) && <p>Approving a wallet permanently fixes this maker's recipient for this project. Confirm it with the maker first.</p>}
      <ol className="pilot-release-path">{prepared.scenes.map((scene, index) => {
        const record = snapshot.scenes[index], isSeed = scene.moment.parent_id === null;
        const own = isSeed ? sameAddress(record.maker, account) : scene.moment.maker_id === makerId;
        const approved = record.maker !== ZeroAddress;
        const registrationReason = pending ? "Check the saved action before registering another scene."
          : busy ? "Waiting for the current wallet action."
          : !accepted ? "Accept the release terms above to register this scene."
          : index > 0 && !snapshot.scenes[index - 1].registered ? `Register ${prepared.scenes[index - 1].moment.maker_label}’s scene first.` : "";
        const registrationHelpId = `${scene.id}-registration-help`;
        return <li key={scene.id}><div><strong>{scene.moment.title}</strong><span>{scene.moment.maker_label}{isSeed ? " · prepared opening, explicit seed maker" : ""}</span><span>{record.registered ? `Scene registered · ${shortAddress(record.maker)}` : approved ? `Wallet approved · scene not registered · ${shortAddress(record.maker)}` : "Awaiting maker wallet approval"}</span></div>
          {!approved && curator && <form onSubmit={event => { event.preventDefault(); void perform("approve", index, wallets[scene.id] ?? ""); }}><label>{isSeed ? "Original opening's maker wallet" : "Maker wallet"}<input aria-label={`Wallet for ${scene.moment.maker_label}`} placeholder="0x…" value={wallets[scene.id] ?? ""} required onChange={event => setWallets(current => ({ ...current, [scene.id]: event.target.value }))} /></label><button className="button secondary" disabled={blocked} type="submit">Approve wallet</button></form>}
          {approved && !record.registered && sameAddress(record.maker, account) && <div className="pilot-release-registration">
            <button className="button secondary" type="button" disabled={!!registrationReason} aria-describedby={registrationReason ? registrationHelpId : undefined} onClick={() => void perform("register", index)}>Register scene</button>
            {registrationReason && <span id={registrationHelpId} role="status">{registrationReason}</span>}
          </div>}
          {!approved && own && !curator && account && <button className="button secondary" type="button" disabled={busy} onClick={() => { void navigator.clipboard.writeText(`${scene.moment.maker_label}\nMaker ID: ${scene.moment.maker_id}\nWallet: ${getAddress(account)}`).then(() => setNotice("Wallet request copied. Share it with the curator for this byline."), () => setError("Copy the connected wallet address and share it with the curator.")); }}>Copy my wallet request</button>}
        </li>;
      })}</ol>
      {!snapshot.release.exists && <p>{curator ? <button className="button primary" type="button" disabled={blocked || !snapshot.scenes.every(scene => scene.matches)} onClick={() => void perform("release")}>Freeze this release <ArrowRight size={16} /></button> : "The curator can release this path after every included maker registers their scene."}</p>}
    </>}
    {snapshot?.release.exists && <section className="pilot-release-support" aria-labelledby="support-title"><h3 id="support-title">Support this finished path</h3><p>{formatEther(snapshot.release.received)} test MON received · {snapshot.release.beneficiaries.length} registered maker wallets</p><ul>{snapshot.release.beneficiaries.map(item => <li key={item.address}><span>{shortAddress(item.address)}</span><span>{formatEther(item.claimable)} test MON claimable</span></li>)}</ul><form onSubmit={event => { event.preventDefault(); void perform("support"); }}><label>Test MON amount<input inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} required disabled={blocked} /></label><button className="button primary" type="submit" disabled={blocked || !account}>Support this release</button></form>{ownShare && <button className="button secondary" type="button" disabled={blocked || ownShare.claimable === 0n} onClick={() => void perform("claim", 0, account)}>Claim my {formatEther(ownShare.claimable)} test MON</button>}</section>}
    <div className="pilot-release-record"><button className="button secondary" type="button" onClick={download}><Download size={16} />Download exact release record</button>{receipt && config.explorer && <a href={`${config.explorer}/tx/${receipt}`} target="_blank" rel="noreferrer">View transaction <ExternalLink size={14} /></a>}</div>
    <details><summary>Release terms and identity</summary><p>{RELEASE_TERMS}</p><p>Amounts and claims come from the contract. The curator attests who controls each byline; wallets can belong to the same person. Prepared artwork and example activity do not establish independent traction.</p></details>
  </div>;
}
