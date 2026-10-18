"use client";

import { useEffect, useState } from "react";
import { SectionPlate } from "../visual-plates";
import {
  ArrowRight,
  CalendarClock,
  Coins,
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
  txUrl,
} from "@/lib/agents/wren";
import { momentHref } from "./agent-bits";
import { BrandBadge, BrandStrip } from "../brand-badge";
import { AddressLink, StepStrip } from "./agent-ui";

const mppSteps = (topUp: typeof WREN_ALLOWANCE.topUp) => [
  { id: "out", title: "Wren ran out of credits" },
  { id: "paid", title: `paid ${topUp.price} over MPP` },
  { id: "credits", title: `room got +${topUp.credits} credits` },
  { id: "published", title: "Wren published the next scene" },
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
      <SectionPlate className="ag-section-head" icon={Wallet} tone="butter" headingId="allowance-title" title="Wren paid for more room on Tempo, by itself"
        description={<>
          <p>
            Machine Payments Protocol (MPP) · {a.network}
          </p>
          <BrandStrip label="Payment tools" className="ag-tools">
            <BrandBadge brand="tempo" size="md" />
            <BrandBadge brand="mpp" />
            <BrandBadge brand="pathusd" net="test" />
          </BrandStrip>
        </>} />

      <StepStrip className="ag-allowance-flow" label="Wren's recorded MPP top-up flow" steps={mppSteps(a.topUp)} />

      <p className="ag-callout" data-tone="success">
        <ShieldCheck size={20} aria-hidden="true" />
        <span>
          <strong>Tempo enforces these rules on chain.</strong> The limit,
          the allowed call, the recipient and the expiry are checked by
          the network itself, so they hold even if Wren gets something
          wrong.
        </span>
      </p>

      <div className="ag-allowance">
        <div className="ag-rules">
          <ul>
            {rules.map(({ icon: Icon, label, value, hint, mono, href }) => (
              <li key={label}>
                <Icon size={20} aria-hidden="true" />
                <span>
                  <small>{label}</small>
                  <strong className={mono ? "ag-mono" : undefined}>
                    {value}
                  </strong>
                  {href ? (
                    <AddressLink href={href} value={hint} />
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
                <Wallet size={16} aria-hidden="true" /> Steward’s account
              </dt>
              <dd>
                <AddressLink href={addressUrl(a.steward)} value={a.steward} />
              </dd>
            </div>
            <div>
              <dt>
                <KeyRound size={16} aria-hidden="true" /> Wren’s access key
              </dt>
              <dd>
                <AddressLink href={addressUrl(a.accessKey)} value={a.accessKey} />
              </dd>
            </div>
            <div>
              <dt>
                <ShieldCheck size={16} aria-hidden="true" /> Authorized
              </dt>
              <dd>
                <span className="ag-when">{a.authorizedAt}</span>
                <AddressLink href={txUrl(a.authorizationTx)} value={a.authorizationTx} />
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
                    <AddressLink href={txUrl(topUp.txHash)} value={topUp.txHash} />
                    {topUp.momentId && (
                      <a
                        className="ag-topup-scene"
                        href={momentHref(WREN.roomId, topUp.momentId)}
                      >
                        The scene from that turn{" "}
                        <ArrowRight size={16} aria-hidden="true" />
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
