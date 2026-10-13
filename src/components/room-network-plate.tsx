import { ArrowRight, ExternalLink } from "lucide-react";
import { getRoomNetworkShowcase, NETWORK_BRANDS, type NetworkBrand } from "@/lib/room-networks";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";

export function NetworkBrandMark({ network }: { network: NetworkBrand }) {
  return (
    <span className="fn-network-mark-mount">
      <img className="fn-network-mark" src={NETWORK_BRANDS[network].mark} width={42} height={42} alt="" />
    </span>
  );
}

export function RoomNetworkPlate({
  roomId,
  className = "",
}: {
  roomId: string;
  className?: string;
}) {
  const networks = getRoomNetworkShowcase(roomId);
  if (!networks.length) return null;

  return (
    <aside className={`fn-network-plate ${className}`} aria-label="Testnet activity for this room">
      <Card className="fn-network-card">
        <CardContent className="fn-network-content">
          <ul className="fn-network-list">
            {networks.map((demo) => {
              const brand = NETWORK_BRANDS[demo.network];
              const external = demo.proof.href.startsWith("https://");
              return (
                <li key={demo.network} className="fn-network-row">
                  <NetworkBrandMark network={demo.network} />
                  <div className="fn-network-copy">
                    <Button asChild variant="link" className="fn-network-link fn-network-proof">
                      <a href={demo.proof.href} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}>
                        <span className="fn-network-brand">
                          <strong className="fn-network-name">{brand.name}</strong>
                          <Badge variant="outline" className="fn-network-testnet">{brand.testnet}</Badge>
                          <span className="fn-network-currency">
                            {brand.currency === "test USDC" && (
                              <img src="/brands/networks/usdc.svg" width={32} height={32} alt="" />
                            )}
                            {brand.currency}
                          </span>
                        </span>
                        <span className="fn-network-summary">
                          {demo.summary}{" "}
                          <span className="fn-network-proof-label">
                            {demo.proof.label}{" "}
                            {external ? <ExternalLink size={16} aria-hidden="true" /> : <ArrowRight size={16} aria-hidden="true" />}
                          </span>
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
            })}
          </ul>
          <p className="fn-network-footnote">
            Testnet demo. Images use the operator’s budget.
          </p>
        </CardContent>
      </Card>
    </aside>
  );
}
