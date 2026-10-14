"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, RefreshCw, ShieldCheck, Wallet } from "lucide-react";
import { getAddress, ZeroAddress } from "ethers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../lib/supabase/database.types.ts";
import type { PilotMoment } from "../lib/pilot.ts";
import type { Snapshot, WalletProvider } from "../lib/onchain/client.ts";
import type { ReleaseConfig } from "../lib/onchain/config.ts";
import { sameAddress, type PreparedRelease } from "../lib/onchain/model.ts";
import { shortAddress } from "../lib/onchain/journey.ts";
import { denialMessage, requestMessage, signWalletMessage, walletRequestApi, type WalletRequest, type WalletRequestProof } from "../lib/onchain/wallet-requests.ts";
import { whileVisible } from "../lib/visible-interval.ts";
import { PilotDialog } from "./pilot-dialog.tsx";

export function WalletReviewDialog({ request, action, config, busy, disabled = false, error, motion, onClose, onConfirm, returnFocus }: {
  request: WalletRequest; action: "approve" | "deny"; config: ReleaseConfig;
  busy: boolean; disabled?: boolean; error: string; motion: boolean; onClose: () => void; onConfirm: () => void;
  returnFocus?: () => HTMLElement | null;
}) {
  const [copied, setCopied] = useState(false);
  const address = getAddress(request.wallet_address);
  return <PilotDialog title={`${action === "approve" ? "Approve" : "Deny"} ${request.maker_label}'s wallet request`} onClose={onClose} dismissible={!busy} returnFocus={returnFocus} className={`pilot-wallet-review ${motion ? "" : "pilot-dialog-instant"}`}>
    <p className="pilot-wallet-review-scene">{request.moment_title}</p>
    <dl className="pilot-wallet-review-details">
      <div><dt>Storyteller</dt><dd>{request.maker_label}</dd></div>
      <div><dt>Network</dt><dd>{config.name}</dd></div>
      <div><dt>Requested wallet</dt><dd><code>{address}</code><button type="button" className="text-button" onClick={async () => { try { await navigator.clipboard.writeText(address); setCopied(true); } catch { setCopied(false); } }}><Copy size={15} aria-hidden="true" />{copied ? "Copied" : "Copy address"}</button></dd></div>
    </dl>
    <p className="pilot-wallet-verified"><ShieldCheck size={17} aria-hidden="true" />The maker signed this wallet request.</p>
    <p className="pilot-wallet-review-warning">{action === "approve"
      ? "Double-check the full address. Approval permanently sets this byline's payout wallet for the project. Each distinct wallet counts once in the release split."
      : "The maker can review their address and send a new request. Denying a request does not revoke an approval already recorded onchain."}</p>
    {error && <p className="pilot-release-error" role="alert">{error}</p>}
    {busy && <p role="status" className="pilot-release-working"><RefreshCw size={16} aria-hidden="true" />Check your wallet to confirm. {action === "approve" ? "Approval uses test MON for gas." : "This signed decision uses no gas."}</p>}
    {disabled && !busy && <p role="status" className="pilot-release-loading">Wait for the saved wallet action and recorded path to finish checking.</p>}
    <footer><button className="button secondary" type="button" disabled={busy} onClick={onClose}>Cancel</button><button className={`button ${action === "approve" ? "primary" : "danger"}`} type="button" disabled={busy || disabled} onClick={onConfirm}>{busy ? "Waiting for confirmation…" : action === "approve" ? "Approve this address" : "Deny this request"}</button></footer>
  </PilotDialog>;
}

export function WalletRequestList({ requests, busy, onReview }: {
  requests: WalletRequest[]; busy: boolean; onReview: (request: WalletRequest, action: "approve" | "deny", motion: boolean) => void;
}) {
  return <ul className="pilot-wallet-request-list">{requests.map(request => <li key={request.id}>
    <div><strong>{request.maker_label}</strong><p>{request.moment_title}</p><span className="pilot-request-address"><Wallet size={14} aria-hidden="true" /><code title={request.wallet_address}>{shortAddress(request.wallet_address)}</code><span><ShieldCheck size={14} aria-hidden="true" />Signed request</span></span></div>
    <div className="pilot-request-actions"><button type="button" className="button secondary" disabled={busy} onClick={event => onReview(request, "approve", event.detail > 0)}>Approve</button><button type="button" className="text-button" disabled={busy} onClick={event => onReview(request, "deny", event.detail > 0)}>Deny</button></div>
  </li>)}</ul>;
}

export function WalletRequests({ prepared, snapshot, config, moments, account, makerId, provider, client, blocked, sessionError, onApprove, onChoosePath, onWorking, onFeedback }: {
  prepared: PreparedRelease; snapshot?: Snapshot; config: ReleaseConfig; moments: PilotMoment[];
  account: string; makerId?: string; provider?: WalletProvider; client?: SupabaseClient<Database>;
  blocked: boolean; sessionError: string; onApprove: (index: number, address: string) => Promise<string | undefined>;
  onChoosePath: (id: string) => void; onWorking: (working: boolean) => void; onFeedback: (message: string) => void;
}) {
  const [requests, setRequests] = useState<WalletRequest[]>([]);
  const [loading, setLoading] = useState(true), [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [review, setReview] = useState<{ id: string; action: "approve" | "deny"; motion: boolean }>();
  const active = useRef(true), sequence = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const context = useRef({ account, makerId, provider }); context.current = { account, makerId, provider };
  const savedSubmission = useRef<{ action: "submit"; proof: WalletRequestProof; signature: string } | undefined>(undefined);
  const curator = sameAddress(account, config.curator);
  const makerIndex = prepared.scenes.findIndex(scene => scene.moment.maker_id === makerId);
  const makerApproved = makerIndex >= 0 && !!snapshot?.scenes[makerIndex] && snapshot.scenes[makerIndex].maker !== ZeroAddress;
  const effective = (request: WalletRequest) => {
    const index = prepared.scenes.findIndex(scene => scene.moment.maker_id === request.maker_id);
    return index >= 0 && sameAddress(snapshot?.scenes[index]?.maker ?? "", request.wallet_address) ? "approved" : request.state;
  };
  const pending = requests.filter(request => effective(request) === "pending");
  const own = requests.find(request => request.maker_id === makerId);
  const selected = requests.find(request => request.id === review?.id);
  const reviewIndex = selected ? prepared.scenes.findIndex(scene => scene.moment.maker_id === selected.maker_id) : -1;
  async function refresh() {
    const version = ++sequence.current;
    try {
      const result = await walletRequestApi();
      if (active.current && sequence.current === version) { setRequests(result); setError(""); }
    } catch (reason) { if (active.current && sequence.current === version) setError(reason instanceof Error ? reason.message : "Wallet requests could not be checked."); }
    finally { if (active.current && sequence.current === version) setLoading(false); }
  }
  useEffect(() => {
    active.current = true; void refresh();
    const stop = whileVisible(() => void refresh(), 8000);
    return () => { active.current = false; sequence.current++; stop(); };
  }, [prepared.projectId]);
  useEffect(() => { onWorking(working); return () => onWorking(false); }, [working, onWorking]);
  useEffect(() => { setReview(undefined); savedSubmission.current = undefined; }, [account, makerId, provider]);
  function stillCurrent(captured: typeof context.current) {
    if (!active.current || context.current.account !== captured.account || context.current.makerId !== captured.makerId || context.current.provider !== captured.provider)
      throw new Error("Your account or wallet changed. Review the request again.");
  }
  async function send() {
    if (!client || !provider || !makerId || makerIndex < 0 || blocked || working) return;
    const captured = context.current;
    setWorking(true); setError("");
    try {
      const fresh = await walletRequestApi();
      stillCurrent(captured);
      const pendingOwn = fresh.find(row => row.maker_id === makerId && row.state === "pending");
      if (pendingOwn) { setRequests(fresh); return; }
      let submission = savedSubmission.current;
      if (!submission || submission.proof.maker_id !== makerId || !sameAddress(submission.proof.wallet_address, account) || submission.proof.issued_at < Math.floor(Date.now() / 1000) - 240) {
        const proof: WalletRequestProof = { id: crypto.randomUUID(), maker_id: makerId, moment_id: prepared.scenes[makerIndex].moment.id, wallet_address: getAddress(account), issued_at: Math.floor(Date.now() / 1000) };
        const signature = await signWalletMessage(provider, account, requestMessage(proof, config), config.chainId);
        stillCurrent(captured);
        submission = { action: "submit", proof, signature }; savedSubmission.current = submission;
      }
      const { data } = await client.auth.getSession();
      stillCurrent(captured);
      if (!data.session || data.session.user.id !== makerId) throw new Error("Return to the account that published this scene before sending a request.");
      const result = await walletRequestApi(submission, data.session.access_token);
      stillCurrent(captured); setRequests(result); savedSubmission.current = undefined;
      onFeedback("Wallet request sent. The curator can review your address in this room.");
    } catch (reason) { if (active.current) setError(reason instanceof Error ? reason.message : "The request could not be confirmed. Check the request before sending again."); }
    finally { if (active.current) setWorking(false); }
  }
  function openReview(request: WalletRequest, action: "approve" | "deny", motion: boolean) {
    setError("");
    onFeedback("");
    if (!moments.some(moment => moment.id === request.moment_id)) { setError("This scene has not loaded yet. Check the room, then review its request."); return; }
    if (action === "approve" && !prepared.scenes.some(scene => scene.moment.maker_id === request.maker_id)) onChoosePath(request.moment_id);
    setReview({ id: request.id, action, motion });
  }
  async function decide() {
    if (!selected || !review || !provider || working || blocked || !curator) return;
    const captured = context.current;
    setWorking(true); setError("");
    try {
      const latest = await walletRequestApi();
      stillCurrent(captured);
      const row = latest.find(request => request.id === selected.id);
      if (!row || row.state !== "pending" || !sameAddress(row.wallet_address, selected.wallet_address)) {
        setRequests(latest); setReview(undefined); throw new Error("This request was already reviewed. Its current status is shown in the room.");
      }
      if (review.action === "approve") {
        if (reviewIndex < 0) throw new Error("Open this maker's published scene before approving its wallet.");
        const hash = await onApprove(reviewIndex, row.wallet_address);
        if (!hash) return;
        try { const result = await walletRequestApi({ action: "confirm", id: row.id }); if (active.current) setRequests(result); }
        catch { onFeedback("The wallet approval is recorded onchain. Check the request status again if needed."); }
      } else {
        const issuedAt = Math.floor(Date.now() / 1000);
        const signature = await signWalletMessage(provider, account, denialMessage(row, issuedAt, config), config.chainId);
        stillCurrent(captured);
        const result = await walletRequestApi({ action: "deny", id: row.id, issuedAt, signature });
        if (active.current) setRequests(result);
        onFeedback("Wallet request denied. The maker can review it and send a new request.");
      }
      if (active.current) setReview(undefined);
    } catch (reason) { if (active.current) setError(reason instanceof Error ? reason.message : "The decision could not be confirmed. Check the request again."); }
    finally { if (active.current) setWorking(false); }
  }
  const disabled = blocked || working;
  return <section className="pilot-wallet-requests" aria-label={curator ? "Curator wallet requests" : "Your wallet request"} aria-busy={working}>
    {curator && <><div className="pilot-request-heading"><div><h3 ref={heading} tabIndex={-1}>Wallet requests</h3><p>{pending.length ? `${pending.length} ${pending.length === 1 ? "maker is" : "makers are"} waiting for your review` : "New requests from published makers appear here."}</p></div><button className="pilot-icon-button" type="button" disabled={disabled} onClick={() => void refresh()} aria-label="Check wallet requests"><RefreshCw size={17} aria-hidden="true" /></button></div>
      <WalletRequestList requests={pending} busy={disabled} onReview={openReview} />
      {!loading && !pending.length && !error && <p className="pilot-request-empty"><Check size={16} aria-hidden="true" />No wallet requests waiting.</p>}
    </>}
    {makerId && account && makerIndex >= 0 && !makerApproved && <div className="pilot-my-wallet-request">
      <strong>{own?.state === "pending" ? "Your request is with the curator" : own?.state === "denied" ? "Your wallet request was denied" : "Link your wallet to your byline"}</strong>
      <p>{own?.state === "pending" ? "The curator will review this address. After approval, you can register your scene." : "Send your connected wallet with your published byline. You’ll confirm ownership with a signature; no gas is used. Your byline and requested address are visible in this room."}</p>
      <code>{getAddress(own?.state === "pending" ? own.wallet_address : account)}</code>
      {own?.state !== "pending" && <button className="button secondary" type="button" disabled={disabled || loading || !provider} onClick={() => void send()}>{working ? "Sending wallet request…" : own?.state === "denied" ? "Send a new wallet request" : "Request wallet approval"}</button>}
      {own?.state === "pending" && <button className="text-button" type="button" disabled={disabled} onClick={() => void refresh()}>Check my request</button>}
    </div>}
    {loading && <p role="status" className="pilot-request-empty">Checking wallet requests…</p>}
    {working && !review && <p role="status" className="pilot-release-working">Confirm the wallet request in your wallet. No test MON is spent.</p>}
    {error && !review && <div><p className="pilot-release-error" role="alert">{error}</p><button className="text-button" type="button" disabled={disabled} onClick={() => void refresh()}>Check wallet requests again</button></div>}
    {curator && selected && review && (review.action === "deny" || reviewIndex >= 0) && <WalletReviewDialog request={selected} action={review.action} config={config} busy={working} disabled={blocked} error={error || sessionError} motion={review.motion} returnFocus={() => heading.current} onClose={() => { if (!working) setReview(undefined); }} onConfirm={() => void decide()} />}
  </section>;
}
