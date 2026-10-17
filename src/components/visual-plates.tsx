import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Card, CardAction, CardContent, CardDescription } from "./ui/card";

type PlateTone = "night" | "paper" | "lavender" | "butter";

export function SectionPlate({
  title,
  description,
  icon: Icon,
  tone = "paper",
  action,
  level = 2,
  headingId,
  className = "",
  variant = "plate",
}: {
  title: ReactNode;
  description?: ReactNode;
  icon: LucideIcon;
  tone?: PlateTone;
  action?: ReactNode;
  level?: 2 | 3;
  headingId?: string;
  className?: string;
  /** `inline` is a heading row for use inside a panel: no card, no tile. Top-level sections keep the plate. */
  variant?: "plate" | "inline";
}) {
  const Heading = level === 3 ? "h3" : "h2";
  return (
    <Card className={`fn-section-plate ${className}`} data-tone={tone} data-variant={variant}>
      <span className="fn-plate-mount" aria-hidden="true">
        <Icon size={variant === "inline" ? 20 : 24} strokeWidth={1.75} />
      </span>
      <CardContent className="fn-plate-copy">
        <Heading id={headingId} className="fn-plate-heading">
          {title}
        </Heading>
        {description && (
          <CardDescription className="fn-plate-description">{description}</CardDescription>
        )}
      </CardContent>
      {action && <CardAction className="fn-plate-action">{action}</CardAction>}
    </Card>
  );
}

export function ContextPlate({
  icon: Icon,
  tone = "paper",
  children,
  className = "",
}: {
  icon: LucideIcon;
  tone?: PlateTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={`fn-context-plate ${className}`} data-tone={tone}>
      <span className="fn-plate-mount" aria-hidden="true">
        <Icon size={24} strokeWidth={1.75} />
      </span>
      <CardContent className="fn-plate-copy">{children}</CardContent>
    </Card>
  );
}
