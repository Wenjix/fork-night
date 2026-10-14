"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Check, Copy, ExternalLink } from "lucide-react";
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
import { getRoomNetworkShowcase, NETWORK_BRANDS } from "../lib/room-networks";
import { NetworkBrandMark, RoomNetworkPlate } from "./room-network-plate";
import { PilotDialog } from "./pilot-dialog";
import { Badge } from "./ui/badge";
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
              <ExternalLink size={15} aria-hidden="true" />
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
              View account <ExternalLink size={15} aria-hidden="true" />
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
        <p className="guild-funding-context">{record.roomTitle} · Solana devnet · founder-operated rehearsal</p>
        <p className="guild-funding-intro">{approvalsComplete ? "The stewards approved a limited withdrawal. A separate payer then used that funding to add shared room credits." : "This history records a limited withdrawal and a separate payer’s room payment. Some approval evidence is missing."}</p>
        {!approvalsComplete && <p className="guild-funding-note">Approval receipts are incomplete in this view. Check the available receipts before relying on this history.</p>}
        <ol className="guild-funding-timeline" aria-label="Recorded funding sequence">
          <FundingStep number={1} title="Treasury funded">
            <p>A patron deposited <strong>{usdc(amounts.deposit)}</strong> into the guild vault.</p>
            <ReceiptLinks receipts={[receipts.deposit]} />
          </FundingStep>
          <FundingStep number={2} title="Allowance approved">
            <p>{approvalsComplete ? <><strong>{governance.threshold} of {governance.stewardWallets} steward wallets</strong> approved a </> : <>The recorded policy requires <strong>{governance.threshold} of {governance.stewardWallets} steward wallets</strong> to approve a </>}<strong>{usdc(amounts.allowance)}</strong> allowance, with no periodic reset. Only the authorized payer could draw, and only to its own wallet.</p>
            <ReceiptLinks receipts={receipts.approvals} approved />
            <ReceiptLinks receipts={[receipts.proposal, receipts.allowance]} />
          </FundingStep>
          <FundingStep number={3} title="Payer funded">
            <p>The authorized payer withdrew <strong>{usdc(amounts.draw)}</strong>. The recorded vault balance went from 5 to 4 test USDC; unused allowance went from 3 to 2.</p>
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
          <p>On <time dateTime={cleanup.recordedDate}>October 13, 2026</time>, a second 2-of-3 vote removed the allowance with <strong>{usdc(cleanup.unusedPermission)}</strong> of unused permission. This was permission to spend, not a token refund. The vault held <strong>{usdc(cleanup.vaultAtCleanup)}</strong> at cleanup.</p>
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
            <li>{approvalsComplete ? "The onchain approval and spending limit worked." : "The approval receipts are incomplete in this view."} All three steward keys were held by the founder.</li>
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

export function GuildFundingSummary({ record }: { record: RecordedGuildFunding }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => watchGuildFundingVisit(window, record.roomId, setOpen), [record.roomId]);

  function close() {
    setOpen(false);
    closeGuildFundingVisit(window);
  }

  return (
    <aside className="guild-funding-summary fn-network-card" aria-label="Recorded guild funding">
      <div className="guild-funding-featured">
        <div className="guild-funding-summary-heading">
          <NetworkBrandMark network="solana" />
          <div>
            <h2>Guild funding rehearsal</h2>
            <p>{record.protocol} · {record.governance.threshold} of {record.governance.stewardWallets} steward wallets approved</p>
            <div className="fn-network-brand guild-funding-meta">
              <Badge variant="outline" className="fn-network-testnet">Solana Devnet</Badge>
              <span className="fn-network-currency">
                <img src="/brands/networks/usdc.svg" width={32} height={32} alt="" />
                {record.token.label}
              </span>
              <strong>Recorded addition: +{record.appCredit.added} room credits</strong>
            </div>
            <p className="guild-funding-environment">Solana devnet · founder-operated rehearsal</p>
          </div>
        </div>
        <Button ref={trigger} type="button" className="guild-funding-open" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
          See how this room was funded <ArrowRight size={17} aria-hidden="true" />
        </Button>
      </div>
      <section className="guild-funding-other" aria-label="Other recorded funding">
        <h3>Other recorded funding</h3>
        <ul className="fn-network-list">
          {getRoomNetworkShowcase(record.roomId).map((demo) => {
            const brand = NETWORK_BRANDS[demo.network];
            return (
              <li key={demo.network} className="fn-network-row">
                <NetworkBrandMark network={demo.network} />
                <div className="fn-network-copy">
                  <Button asChild variant="link" className="fn-network-link fn-network-proof">
                    <a href={demo.proof.href} target="_blank" rel="noreferrer">
                      <span className="fn-network-brand">
                        <strong className="fn-network-name">{brand.name}</strong>
                        <Badge variant="outline" className="fn-network-testnet">{brand.testnet}</Badge>
                        <span className="fn-network-currency">
                          {brand.currency === "test USDC" && <img src="/brands/networks/usdc.svg" width={32} height={32} alt="" />}
                          {brand.currency}
                        </span>
                      </span>
                      <span className="fn-network-summary">
                        {demo.summary}{" "}
                        <span className="fn-network-proof-label">{demo.proof.label} <ExternalLink size={16} aria-hidden="true" /></span>
                        <span className="sr-only"> (opens in a new tab)</span>
                      </span>
                    </a>
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
      {open && <GuildFundingHistory record={record} onClose={close} returnFocus={() => trigger.current} />}
    </aside>
  );
}

export function PilotRoomFunding({ roomId, loadedRoom }: { roomId: string; loadedRoom: string }) {
  if (!roomId || loadedRoom !== roomId) return null;
  const record = getRecordedGuildFunding(roomId);
  return record
    ? <GuildFundingSummary key={roomId} record={record} />
    : <RoomNetworkPlate roomId={roomId} />;
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
          Open the funding rehearsal <ArrowRight size={17} aria-hidden="true" />
          <span className="sr-only"> (opens in a new tab; uses your shared-room storyteller account)</span>
        </a>
      </Button>
    </section>
  );
}
