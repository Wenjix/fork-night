import type { AnchorHTMLAttributes } from "react";

/** The Fork Night wordmark for any page header: the handwritten name and the fork glyph, linking to the lobby. */
export function ForkNightMark({ href = "/", size = "md", tone = "night", className = "", ...rest }: {
  size?: "sm" | "md";
  /** `night` is light ink on the navy header; `paper` is dark ink on a cream surface. */
  tone?: "night" | "paper";
} & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "children">) {
  const [width, height] = size === "sm" ? [20, 23] : [28, 32];
  return (
    <a aria-label="Fork Night, return to the lobby" {...rest} className={`fn-mark ${className}`.trim()} href={href} data-size={size} data-tone={tone}>
      Fork Night
      <svg aria-hidden="true" width={width} height={height} viewBox="0 0 28 32" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
        <path d="M14 28V15M14 15 4 5M14 15 24 5M14 15V3" />
      </svg>
    </a>
  );
}
