import type { CSSProperties, ReactNode } from "react";
import { ChevronRight, ExternalLink } from "lucide-react";
import { shortHex } from "@/lib/agents/wren";
import { BrandBadge } from "../brand-badge";

/** A step's number in its tile; the word "Step" is there for screen readers only. */
export function StepNumber({ n }: { n: number }) {
  return (
    <span className="ag-num">
      <span className="sr-only">Step </span>
      {n}
    </span>
  );
}

export type StepItem = {
  id: string;
  title: ReactNode;
  body?: ReactNode;
  /** An in-page link: the whole step jumps to that section. */
  href?: string;
};

/**
 * The one way the agent pages show a sequence: an ordered list of numbered steps.
 * `flow` runs across from 721px and stacks below it with a chevron between steps (none after the last);
 * `list` is a numbered column for steps that carry longer copy, in two columns when `columns` is 2.
 */
export function StepStrip({ label, steps, variant = "flow", tone = "agent", columns = 1, titleAs: Title = "strong", className = "" }: {
  label: string;
  steps: readonly StepItem[];
  variant?: "flow" | "list";
  tone?: "agent" | "paper";
  columns?: 1 | 2;
  /** `h3` when the steps are a section's own sub-headings, so the heading outline keeps them. */
  titleAs?: "strong" | "h3";
  className?: string;
}) {
  const rows = columns === 2 ? Math.ceil(steps.length / 2) : 0;
  const style = rows ? ({ "--rows": rows } as CSSProperties) : undefined;
  return (
    <ol className={`ag-strip ${className}`.trim()} aria-label={label} data-variant={variant} data-tone={tone} data-columns={columns} style={style}>
      {steps.map((step, index) => {
        const content = (
          <>
            <StepNumber n={index + 1} />
            <span className="ag-step-text">
              <Title>{step.title}</Title>
              {step.body && <span className="ag-step-body">{step.body}</span>}
            </span>
          </>
        );
        return (
          <li key={step.id} data-lead={rows && index % rows === 0 ? "true" : undefined}>
            {step.href ? <a className="ag-step" href={step.href}>{content}</a> : <span className="ag-step">{content}</span>}
            {variant === "flow" && index < steps.length - 1 && <ChevronRight className="ag-strip-link" size={16} aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * An address or transaction on the Tempo testnet explorer: the full mono value (the short form on phones), an external-link
 * icon, the full value in the tooltip, and a row that is 44px tall where fingers are. `chain` adds the Tempo badge, which names the network;
 * `inline` is for a link inside a sentence, which keeps the line height of the text around it.
 */
export function AddressLink({ href, value, chain = false, inline = false }: { href: string; value: string; chain?: boolean; inline?: boolean }) {
  return (
    <span className="ag-address" data-inline={inline ? "true" : undefined}>
      <a className="ag-address-link" href={href} target="_blank" rel="noreferrer" title={value}>
        <code className="ag-hex-full">{value}</code>
        <code className="ag-hex-short" aria-hidden="true">{shortHex(value, 8, 6)}</code>
        <ExternalLink size={16} aria-hidden="true" />
        <span className="sr-only"> (opens the Tempo explorer)</span>
      </a>
      {chain && <BrandBadge brand="tempo" />}
    </span>
  );
}
