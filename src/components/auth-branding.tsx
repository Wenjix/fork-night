import type { ButtonHTMLAttributes } from "react";
import { BrandBadge, BrandTile } from "./brand-badge";

/** Google's own neutral button, with the G on the shared brand tile so it sits the same as every other mark. */
export function GoogleButton({ children, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={`pilot-google-button ${className}`}>
    <BrandTile brand="google" size="md" />
    <span>{children}</span>
  </button>;
}

export function PrivyMark({ className = "" }: { className?: string }) {
  return <BrandBadge brand="privy" className={`pilot-privy-mark ${className}`.trim()} />;
}

export function WalletProviderNote() {
  return <span className="pilot-wallet-provider">In-app wallet by <PrivyMark /></span>;
}
