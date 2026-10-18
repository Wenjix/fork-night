import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Chip } from "../brand-badge";

/**
 * A card's title row. The kind of card it is ("Consent", "Payment receipt", "World kit") is a chip beside the
 * title, where it used to be a small line above it, so the title leads and no card needs a kicker.
 * `lead` is a mark that comes before the title, such as the brain's slow pulse.
 */
export function CardHeading({ id, title, kind, icon, lead }: { id?: string; title: ReactNode; kind: ReactNode; icon: LucideIcon; lead?: ReactNode }) {
  return <div className="nw-card-head nw-card-head-kind">
    {lead}
    <h3 id={id}>{title}</h3>
    <Chip icon={icon}>{kind}</Chip>
  </div>;
}
