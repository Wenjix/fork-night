"use client";

import { useEffect, useState } from "react";
import { SectionPlate } from "../visual-plates";
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Coins,
  ExternalLink,
  KeyRound,
  ShieldCheck,
  Target,
  Wallet,
} from "lucide-react";
import {
  WREN,
  WREN_ALLOWANCE,
  WREN_TOP_UPS,
  addressUrl,
  allowanceExpired,
  shortHex,
  txUrl,
} from "@/lib/agents/wren";
import { momentHref } from "./agent-bits";
import { NetworkBrandMark } from "../room-network-plate";

const mppSteps = (topUp: typeof WREN_ALLOWANCE.topUp) => [
  "Wren ran out of credits",
  `paid ${topUp.price} over MPP`,
  `room got +${topUp.credits} credits`,
  "Wren published the next scene",
];

/**
 * Whether Wren's allowance has expired. It starts as expired, so the server
 * HTML never claims a key that may have lapsed, and reads the clock after
 * mount, so hydration always matches.
 */
export function useAllowanceExpired() {
  const [expired, setExpired] = useState(true);
  useEffect(() => {
    setExpired(allowanceExpired(Date.now()));
  }, []);
  return expired;
}

function HexLink({ href, value }: { href: string; value: string }) {
  return (
    <a
      className="ag-mono ag-hex"
      href={href}
      target="_blank"
      rel="noreferrer"
      title={value}
    >
      <span className="ag-hex-full">{value}</span>
      <span className="ag-hex-short">{shortHex(value, 8, 6)}</span>
      <ExternalLink size={13} aria-hidden="true" />
    </a>
  );
}

export function WrenAllowance() {
  const a = WREN_ALLOWANCE;
  const expired = useAllowanceExpired();
  const rules = [
    { icon: Coins, label: "Limit", value: a.limit, hint: a.limitNote },
    { icon: KeyRound, label: "Allowed call", value: a.allowedCall, hint: "No other kind of call", mono: true },
    { icon: Target, label: "Only to", value: a.recipientLabel, hint: a.recipient, href: addressUrl(a.recipient) },
    expired
      ? { icon: CalendarClock, label: "Recorded Oct 12 · allowance has since expired", value: a.expiresAt, hint: "Since then the key can no longer pay" }
      : { icon: CalendarClock, label: "Expires", value: a.expiresAt, hint: "After that the key can no longer pay" },
  ] as { icon: typeof Coins; label: string; value: string; hint: string; mono?: boolean; href?: string }[];
  return (
    <section
      className="ag-section"
      id="allowance"
      aria-labelledby="allowance-title"
    >
      <SectionPlate className="ag-section-head" icon={Wallet} tone="butter" headingId="allowance-title" title={<span className="fn-network-allowance-heading"><NetworkBrandMark network="tempo" /><span>Wren paid for more room on Tempo, by itself</span></span>}
        description={<p>
          Machine Payments Protocol (MPP) · {a.network}
        </p>} />

      <ol className="ag-mpp-strip" aria-label="Wren's recorded MPP top-up flow">
        {mppSteps(a.topUp).map((step) => (
          <li key={step}>
            <CheckCircle2 size={17} aria-hidden="true" />
            <span>{step}</span>
            <ArrowRight size={15} aria-hidden="true" />
          </li>
        ))}
      </ol>

      <div className="ag-allowance">
        <div className="ag-rules">
          <p className="ag-rules-lead">
            <ShieldCheck size={18} aria-hidden="true" />
            <span>
              <strong>Tempo enforces these rules on chain.</strong> The limit,
              the allowed call, the recipient and the expiry are checked by
              the network itself, so they hold even if Wren gets something
              wrong.
            </span>
          </p>
          <ul>
            {rules.map(({ icon: Icon, label, value, hint, mono, href }) => (
              <li key={label}>
                <Icon size={18} aria-hidden="true" />
                <span>
                  <small>{label}</small>
                  <strong className={mono ? "ag-mono" : undefined}>
                    {value}
                  </strong>
                  {href ? (
                    <HexLink href={href} value={hint} />
                  ) : (
                    hint && <em>{hint}</em>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <p className="ag-topup-price">
            One top-up costs <strong>{a.topUp.price}</strong> and adds{" "}
            <strong>{a.topUp.credits} test credits</strong> and{" "}
            <strong>{a.topUp.attempts} guest attempts</strong> to the room.
          </p>
        </div>

        <div className="ag-keys">
          <dl>
            <div>
              <dt>
                <Wallet size={15} aria-hidden="true" /> Steward’s account
              </dt>
              <dd>
                <HexLink href={addressUrl(a.steward)} value={a.steward} />
              </dd>
            </div>
            <div>
              <dt>
                <KeyRound size={15} aria-hidden="true" /> Wren’s access key
              </dt>
              <dd>
                <HexLink href={addressUrl(a.accessKey)} value={a.accessKey} />
              </dd>
            </div>
            <div>
              <dt>
                <ShieldCheck size={15} aria-hidden="true" /> Authorized
              </dt>
              <dd>
                <span className="ag-when">{a.authorizedAt}</span>
                <HexLink href={txUrl(a.authorizationTx)} value={a.authorizationTx} />
              </dd>
            </div>
          </dl>

          <div className="ag-topups">
            <h3>Top-ups</h3>
            {WREN_TOP_UPS.length === 0 ? (
              <p className="ag-empty ag-empty-small">
                No top-up yet. Wren pays only when the room is out of credits
                or Wren has used its attempts.
              </p>
            ) : (
              <ol>
                {WREN_TOP_UPS.map((topUp) => (
                  <li key={topUp.txHash}>
                    <span className="ag-topup-line">
                      <strong>{topUp.amount}</strong>
                      <span>
                        +{topUp.credits} test credits · +{topUp.attempts} guest
                        attempts
                      </span>
                    </span>
                    <span className="ag-when">{topUp.at}</span>
                    <HexLink href={txUrl(topUp.txHash)} value={topUp.txHash} />
                    {topUp.momentId && (
                      <a
                        className="ag-topup-scene"
                        href={momentHref(WREN.roomId, topUp.momentId)}
                      >
                        The scene from that turn{" "}
                        <ArrowRight size={14} aria-hidden="true" />
                      </a>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
