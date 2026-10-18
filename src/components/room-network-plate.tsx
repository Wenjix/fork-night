import { ArrowRight, ExternalLink } from "lucide-react";
import { getRoomNetworkShowcase, NETWORK_BRANDS, type NetworkBrand, type RoomNetworkDemo } from "@/lib/room-networks";
import { BrandBadge, type BrandSize } from "./brand-badge";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";

/** The standalone chain mark. Rooms show a chain with BrandBadge; the agents page still draws this one. */
export function NetworkBrandMark({ network }: { network: NetworkBrand }) {
  return (
    <span className="fn-network-mark-mount">
      <img className="fn-network-mark" src={NETWORK_BRANDS[network].mark} width={42} height={42} alt="" />
    </span>
  );
}

/** A test currency as a chip beside its chain. USDC carries its own mark; the other tokens are named in words. */
export function CurrencyChip({ label }: { label: string }) {
  const usdc = label === "test USDC";
  return (
    <span className="fn-network-currency fn-badge" data-kind="token" data-plain={usdc ? undefined : "true"}>
      {usdc && <img src="/brands/networks/usdc.svg" width={32} height={32} alt="" />}
      {label}
    </span>
  );
}

/** One recorded proof: the chain as a badge that names its test network, the currency, what happened, and the receipt link. */
export function NetworkRow({ demo, size = "md", newTab = false }: { demo: RoomNetworkDemo; size?: BrandSize; newTab?: boolean }) {
  const brand = NETWORK_BRANDS[demo.network];
  const external = newTab || demo.proof.href.startsWith("https://");
  const labelIncludesExternalGlyph = demo.proof.label.includes("↗");
  return (
    <li className="fn-network-row">
      <div className="fn-network-copy">
        <Button asChild variant="link" className="fn-network-link fn-network-proof">
          <a href={demo.proof.href} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}>
            <span className="fn-network-brand">
              <BrandBadge brand={demo.network} size={size} />
              <CurrencyChip label={brand.currency} />
            </span>
            <span className="fn-network-summary">
              {demo.summary}{" "}
              <span className="fn-network-proof-label">
                {demo.proof.label}{" "}
                {!labelIncludesExternalGlyph && (external ? <ExternalLink size={16} aria-hidden="true" /> : <ArrowRight size={16} aria-hidden="true" />)}
              </span>
              {newTab && <span className="sr-only"> (opens in a new tab)</span>}
            </span>
          </a>
        </Button>
        {demo.related && (
          <Button asChild variant="link" className="fn-network-link fn-network-related">
            <a href={demo.related.href}>
              {demo.related.label} <ArrowRight size={16} aria-hidden="true" />
            </a>
          </Button>
        )}
      </div>
    </li>
  );
}

export function RoomNetworkPlate({
  roomId,
  className = "",
  compact = false,
}: {
  roomId: string;
  className?: string;
  compact?: boolean;
}) {
  const networks = getRoomNetworkShowcase(roomId);
  if (!networks.length) return null;

  return (
    <aside className={`fn-network-plate ${compact ? "fn-network-compact" : ""} ${className}`} aria-label="Testnet activity for this room">
      <Card className="fn-network-card">
        <CardContent className="fn-network-content">
          <ul className="fn-network-list">
            {networks.map((demo) => <NetworkRow key={demo.network} demo={demo} size={compact ? "sm" : "lg"} />)}
          </ul>
          <p className="fn-network-footnote">
            Testnet demo. Images use the operator’s budget.
          </p>
        </CardContent>
      </Card>
    </aside>
  );
}
