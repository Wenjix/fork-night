import type { ReactNode, ToggleEvent } from "react";
import { ChevronRight } from "lucide-react";

/** One expander for the whole product: a native details element with a chevron that turns when it opens. */
export function Disclosure({ summary, children, defaultOpen, onToggle, id, className = "" }: {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  onToggle?: (event: ToggleEvent<HTMLDetailsElement>) => void;
  id?: string;
  className?: string;
}) {
  return (
    <details className={`fn-disclosure ${className}`.trim()} id={id} open={defaultOpen} onToggle={onToggle}>
      <summary className="fn-disclosure-summary">
        <ChevronRight className="fn-disclosure-chevron" size={16} aria-hidden="true" />
        <span>{summary}</span>
      </summary>
      <div className="fn-disclosure-body">{children}</div>
    </details>
  );
}
