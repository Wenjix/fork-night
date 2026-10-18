import { Children, type CSSProperties, type ReactNode } from "react";
import { ExternalLink, Fingerprint, type LucideIcon } from "lucide-react";
import { BRANDS, type Brand, type BrandId } from "@/lib/brands";

/** Brands without an official mark in the repo that read better as a drawn glyph than as letters. */
const GLYPHS: Partial<Record<BrandId, LucideIcon>> = { erc8004: Fingerprint };

export type BrandSize = "sm" | "md" | "lg";

/** The square (or, for tokens, round) tile that carries a brand's mark. */
export function BrandTile({ brand, size = "sm" }: { brand: BrandId; size?: BrandSize }) {
  const entry: Brand = BRANDS[brand];
  const Glyph = GLYPHS[brand];
  const lockup = entry.lockup;
  const style = { ...(entry.accent ? { "--badge-accent": entry.accent } : {}), ...(lockup ? { "--lockup-ratio": lockup.width / lockup.height } : {}) } as CSSProperties;
  return (
    <span className="fn-badge-tile" data-fit={entry.fit} data-lockup={lockup?.plate} data-mono={entry.mark ? undefined : "true"} data-size={size} data-round={entry.kind === "token" ? "true" : undefined} style={style} aria-hidden="true">
      {entry.mark ? <img src={entry.mark} alt="" width={lockup?.width ?? 24} height={lockup?.height ?? 24} loading={entry.lazy ? "lazy" : undefined} /> : Glyph ? <Glyph strokeWidth={2.1} /> : <b>{entry.monogram ?? entry.name.slice(0, 2)}</b>}
    </span>
  );
}

/** "Testnet", "Devnet": the one place a test network is named, so every chain badge discloses it the same way. */
export function NetFlag({ children }: { children: ReactNode }) {
  return <span className="fn-net">{children}</span>;
}

type BadgeProps = {
  brand: BrandId;
  size?: BrandSize;
  /** What the brand does here, in a word or two: "releases", "wallets". */
  role?: string;
  /** Replaces the brand name, e.g. "Tempo receipt". */
  label?: string;
  /** Chains show their network (Testnet, Devnet...) unless set to `false` or replaced with other text. */
  net?: string | false;
  /** Makes the badge a link. External links open in a new tab and get an icon. */
  href?: string;
  className?: string;
};

export function BrandBadge({ brand, size = "sm", role, label, net, href, className = "" }: BadgeProps) {
  const entry: Brand = BRANDS[brand];
  const status = net === false ? null : typeof net === "string" ? net : label ? null : entry.net ?? null;
  const external = !!href && /^https?:\/\//.test(href);
  const text = label ?? entry.name;
  // A logotype stands in for the name, so only what follows it (a model version such as "K3") is drawn as text.
  const lockup = entry.lockup;
  const rest = lockup ? text.replace(new RegExp(`^${lockup.word}\\s*`, "i"), "") : "";
  const body = (
    <>
      <BrandTile brand={brand} size={size} />
      {lockup ? <>{rest !== text && <span className="fn-badge-name">{text.slice(0, text.length - rest.length)}</span>}{rest && <span className="fn-badge-version">{rest}</span>}</> : <span className="fn-badge-name">{text}</span>}
      {role && <span className="fn-badge-role">{role}</span>}
      {status && <NetFlag>{status}</NetFlag>}
      {external && <ExternalLink className="fn-badge-out" size={14} aria-hidden="true" />}
      {external && <span className="sr-only"> (opens in a new tab)</span>}
    </>
  );
  const bare = !!lockup && !rest && !role && !status && !external;
  const props = { className: `fn-badge ${className}`.trim(), "data-size": size, "data-kind": entry.kind, "data-lockup": lockup ? "true" : undefined, "data-bare": bare ? "true" : undefined };
  return href
    ? <a {...props} href={href} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}>{body}</a>
    : <span {...props}>{body}</span>;
}

/** A chip for a topic that has no brand behind it ("Shared branching story"), drawn the same way as a brand badge. */
export function Chip({ icon: Icon, size = "sm", children, className = "" }: { icon?: LucideIcon; size?: BrandSize; children: ReactNode; className?: string }) {
  return (
    <span className={`fn-badge ${className}`.trim()} data-size={size} data-kind="feature" data-plain={Icon ? undefined : "true"}>
      {Icon && <span className="fn-badge-tile" data-mono="true" data-size={size} aria-hidden="true"><Icon strokeWidth={2.1} /></span>}
      <span className="fn-badge-name">{children}</span>
    </span>
  );
}

/** A row of badges that belong together, such as the tools behind one room. Each child becomes a list item. */
export function BrandStrip({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <ul className={`fn-badges ${className}`.trim()} aria-label={label}>
      {Children.toArray(children).map((child, index) => <li key={index}>{child}</li>)}
    </ul>
  );
}
