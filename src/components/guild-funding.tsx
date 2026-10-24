"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Check, ChevronRight, Copy, ExternalLink } from "lucide-react";
import {
  copyFundingAddress,
  closeGuildFundingVisit,
  formatFundingUsdc,
  fundingExplorerUrl,
  getRecordedGuildFunding,
  watchGuildFundingVisit,
  type FundingReceipt,
  type RecordedGuildFunding,
} from "../lib/guild-funding";
import { getRoomNetworkShowcase } from "../lib/room-networks";
import { CurrencyChip, NetworkRow, RoomNetworkPlate } from "./room-network-plate";
import { BrandBadge } from "./brand-badge";
import { PilotDialog } from "./pilot-dialog";
import { Button } from "./ui/button";

function ReceiptLinks({ receipts, approved = false }: {
  receipts: readonly FundingReceipt[];
  approved?: boolean;
}) {
  if (!receipts.length) return <p className="guild-funding-note">No receipt recorded for this step.</p>;
  return (
    <ul className="guild-funding-receipts" aria-label={approved ? "Recorded approvals" : "Chain receipts"}>
      {receipts.map((receipt) => (
        <li key={receipt.signature}>
          <Button asChild variant="link" className="guild-funding-link">
            <a href={fundingExplorerUrl(receipt.signature)} target="_blank" rel="noreferrer">
              {approved && <Check size={16} aria-hidden="true" />}
              {receipt.label}{approved ? " recorded" : ""}
              <ExternalLink size={16} aria-hidden="true" />
              <span className="sr-only"> (opens Solana devnet explorer in a new tab)</span>
            </a>
          </Button>
        </li>
      ))}
    </ul>
  );
}

function FundingStep({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <li className="guild-funding-step">
      <span className="guild-funding-step-number" aria-hidden="true">{number}</span>
      <div>
        <h3>{title}</h3>
        {children}
      </div>
    </li>
  );
}

function FundingAccount({ label, address }: { label: string; address: string }) {
  const [copyStatus, setCopyStatus] = useState("");
  return (
    <div className="guild-funding-account">
      <dt>{label}</dt>
      <dd>
        <code>{address}</code>
        <div className="guild-funding-account-actions">
          <Button variant="link" className="guild-funding-link" aria-label={`Copy ${label.toLowerCase()} address`}
            onClick={async () => setCopyStatus(await copyFundingAddress(address))}>
            <Copy size={16} aria-hidden="true" /> Copy address
          </Button>
          <Button asChild variant="link" className="guild-funding-link">
            <a href={fundingExplorerUrl(address, "address")} target="_blank" rel="noreferrer">
              View account <ExternalLink size={16} aria-hidden="true" />
              <span className="sr-only"> (opens Solana devnet explorer in a new tab)</span>
            </a>
          </Button>
        </div>
        <p className="guild-funding-copy-status" role="status">{copyStatus}</p>
      </dd>
    </div>
  );
}

const utcTime = (value: string) => `${new Intl.DateTimeFormat("en", {
  dateStyle: "medium", timeStyle: "medium", timeZone: "UTC",
}).format(new Date(value))} UTC`;

export function GuildFundingHistory({ record, onClose, returnFocus }: {
  record: RecordedGuildFunding;
  onClose: () => void;
  returnFocus?: () => HTMLElement | null;
}) {
  const { amounts, receipts, appCredit, cleanup, governance } = record;
  const approvalsComplete = receipts.approvals.length >= governance.threshold;
  const usdc = (units: string) => `${formatFundingUsdc(units)} ${record.token.label}`;
  return (
    <PilotDialog title="How the guild funded this room" onClose={onClose} returnFocus={returnFocus} className="guild-funding-dialog">
      <div className="guild-funding-history">
        <p className="guild-funding-context">{record.roomTitle} · Solana devnet · test run by the founder</p>
        <p className="guild-funding-intro">{approvalsComplete ? "The guild members approved a limited withdrawal. A separate payer then used that funding to add shared room credits." : "This history records a limited withdrawal and a separate payer’s room payment. Some approval evidence is missing."}</p>
        {!approvalsComplete && <p className="guild-funding-note">Approval receipts are incomplete in this view. Check the available receipts before relying on this history.</p>}
        <ol className="guild-funding-timeline" aria-label="Recorded funding sequence">
          <FundingStep number={1} title="Treasury funded">
            <p>A patron deposited <strong>{usdc(amounts.deposit)}</strong> into the guild vault.</p>
            <ReceiptLinks receipts={[receipts.deposit]} />
          </FundingStep>
          <FundingStep number={2} title="Allowance approved">
            <p>{approvalsComplete ? <><strong>{governance.threshold} of {governance.stewardWallets} guild members</strong> approved a </> : <>The recorded policy requires <strong>{governance.threshold} of {governance.stewardWallets} guild members</strong> to approve a</>}<strong>{usdc(amounts.allowance)}</strong> allowance, with no periodic reset. Only the authorized payer could draw, and only to its own wallet.</p>
            <ReceiptLinks receipts={receipts.approvals} approved />
            <ReceiptLinks receipts={[receipts.proposal, receipts.allowance]} />
          </FundingStep>
          <FundingStep number={3} title="Payer funded">
            <p>The authorized payer withdrew <strong>{usdc(amounts.draw)}</strong>. The recorded vault balance went from {formatFundingUsdc(record.balances.vaultBeforeDraw)} to {usdc(record.balances.vaultAfterDraw)}; unused allowance went from {formatFundingUsdc(amounts.allowance)} to {formatFundingUsdc(record.balances.allowanceAfterDraw)}.</p>
            <p className="guild-funding-note">The payer signs the next payment separately. The vault did not pay the room directly.</p>
            <ReceiptLinks receipts={[receipts.draw]} />
          </FundingStep>
          <FundingStep number={4} title="Room payment settled">
            <p>The payer spent <strong>{usdc(amounts.payment)}</strong> through x402 for {record.roomTitle}’s shared credit pool.</p>
            <ReceiptLinks receipts={[receipts.payment]} />
          </FundingStep>
          <FundingStep number={5} title="Credits recorded in the app">
            <p><strong>+{appCredit.added} room credits</strong> were credited once. The historical room snapshot went from {appCredit.historicalBefore} to {appCredit.historicalAfter} credits.</p>
            <p className="guild-funding-note">App ledger entry. Current available credits and generation activity are shown in the room.</p>
            <dl className="guild-funding-times">
              <div><dt>Credit entry recorded</dt><dd><time dateTime={appCredit.recordedAt}>{utcTime(appCredit.recordedAt)}</time></dd></div>
              <div><dt>App record checked</dt><dd><time dateTime={appCredit.checkedAt}>{utcTime(appCredit.checkedAt)}</time></dd></div>
            </dl>
          </FundingStep>
        </ol>
        <section className="guild-funding-cleanup" aria-labelledby="guild-funding-cleanup-title">
          <h3 id="guild-funding-cleanup-title">Allowance closed after the rehearsal</h3>
          <p>On <time dateTime={cleanup.recordedDate}>{new Date(`${cleanup.recordedDate}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" })}</time>, a second {governance.threshold}-of-{governance.stewardWallets} vote removed the allowance with <strong>{usdc(cleanup.unusedPermission)}</strong> of unused permission. This was permission to spend, not a token refund. The vault held <strong>{usdc(cleanup.vaultAtCleanup)}</strong> at cleanup.</p>
          <ReceiptLinks receipts={cleanup.receipts} />
          <p className="guild-funding-note">Cleanup has its own chain receipts; the earlier app record check does not verify it.</p>
        </section>
        <details className="guild-funding-disclosure">
          <summary>Accounts and receipt details</summary>
          <dl className="guild-funding-accounts">
            <FundingAccount label="Multisig" address={record.accounts.multisig} />
            <FundingAccount label="Vault" address={record.accounts.vault} />
            <FundingAccount label="Removed allowance" address={record.accounts.allowance} />
            <FundingAccount label="Authorized payer" address={record.accounts.payer} />
          </dl>
          <ReceiptLinks receipts={[receipts.creation]} />
        </details>
        <details className="guild-funding-disclosure">
          <summary>What this rehearsal proves</summary>
          <ul className="guild-funding-boundaries">
            <li>{approvalsComplete ? "The onchain approval and spending limit worked." : "The approval receipts are incomplete in this view."} All three guild-member keys were held by the founder.</li>
            <li>The allowance restricted withdrawals to the payer wallet. It did not restrict that wallet’s later spending to this room.</li>
            <li>Room credits are pooled. This top-up does not identify which credits paid for a particular scene.</li>
            <li>Test USDC came from a faucet. Images still use the operator’s approved provider budget; this is a test of approvals and payment, not commercial backing.</li>
            <li>This is recorded history. Current treasury balances, new proposals and spending controls remain outside this view.</li>
          </ul>
        </details>
      </div>
    </PilotDialog>
  );
}

export function GuildFundingSummary({ record, creditsAvailable }: { record: RecordedGuildFunding; creditsAvailable?: number }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => watchGuildFundingVisit(window, record.roomId, setOpen), [record.roomId]);

  function close() {
    setOpen(false);
    closeGuildFundingVisit(window);
  }

  const plural = (count: number) => count === 1 ? "credit" : "credits";
  const addedText = `added ${record.appCredit.added} ${plural(record.appCredit.added)}`;
  const creditsText = typeof creditsAvailable === "number"
    ? `${addedText} · ${creditsAvailable} room ${plural(creditsAvailable)} left`
    : addedText;
  const funding = getRoomNetworkShowcase(record.roomId);
  const baseTopUp = funding.find((demo) => demo.network === "base");
  return (
    <aside className="guild-funding-summary fn-network-card" aria-label="Recorded guild funding">
      <details className="guild-funding-drawer">
        <summary className="guild-funding-drawer-summary fn-disclosure-summary">
          <ChevronRight className="fn-disclosure-chevron" size={16} aria-hidden="true" />
          <BrandBadge brand="solana" />
          <span>Guild treasury · {creditsText} · <strong>See how →</strong></span>
        </summary>
        <div className="guild-funding-drawer-body">
          <div className="guild-funding-featured">
            <div className="guild-funding-summary-heading">
              <h2>Guild funding rehearsal</h2>
              <p>{record.governance.threshold} of {record.governance.stewardWallets} steward wallets approved</p>
              <div className="fn-network-brand guild-funding-meta">
                <CurrencyChip label={record.token.label} />
                <strong>Recorded addition: +{record.appCredit.added} room credits</strong>
              </div>
              <p className="guild-funding-environment">Solana devnet · test run by the founder</p>
            </div>
            <Button ref={trigger} type="button" className="guild-funding-open" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
              See how this room was funded <ArrowRight size={16} aria-hidden="true" />
            </Button>
          </div>
          <section className="guild-funding-other" aria-label="Other recorded funding">
            <h3>Other recorded funding</h3>
            <ul className="fn-network-list">
              {funding.filter((demo) => demo.network !== "base").map((demo) => <NetworkRow key={demo.network} demo={demo} newTab />)}
            </ul>
          </section>
        </div>
      </details>
      {baseTopUp && <section className="guild-funding-top-up" aria-label="Separate recorded Base top-up">
        <ul className="fn-network-list">
          <NetworkRow demo={baseTopUp} size="sm" newTab />
        </ul>
      </section>}
      {open && <GuildFundingHistory record={record} onClose={close} returnFocus={() => trigger.current} />}
    </aside>
  );
}

export function PilotRoomFunding({ roomId, loadedRoom, creditsAvailable }: { roomId: string; loadedRoom: string; creditsAvailable?: number }) {
  if (!roomId || loadedRoom !== roomId) return null;
  const record = getRecordedGuildFunding(roomId);
  return record
    ? <GuildFundingSummary key={roomId} record={record} creditsAvailable={creditsAvailable} />
    : <RoomNetworkPlate roomId={roomId} compact />;
}

export function GuildFundingHallEntry() {
  return (
    <section className="guild-funding-hall-entry" aria-labelledby="guild-funding-hall-title">
      <div>
        <h2 id="guild-funding-hall-title">Shared creative budget</h2>
        <p>See a recorded guild allowance fund Paper Moon’s shared credits.</p>
        <p className="guild-funding-environment">Solana devnet · recorded rehearsal</p>
      </div>
      <Button asChild variant="link" className="guild-funding-link">
        <a href="/pilot?room=paper-moon&view=treasury" target="_blank" rel="noreferrer">
          Open the funding rehearsal <ArrowRight size={16} aria-hidden="true" />
          <span className="sr-only"> (opens in a new tab; uses your shared-room storyteller account)</span>
        </a>
      </Button>
    </section>
  );
}
