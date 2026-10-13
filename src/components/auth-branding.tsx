import type { ButtonHTMLAttributes } from "react";

export function GoogleButton({ children, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={`pilot-google-button ${className}`}>
    <img src="/brands/google-g.png" width={20} height={20} alt="" aria-hidden="true" />
    <span>{children}</span>
  </button>;
}

export function PrivyMark({ className = "" }: { className?: string }) {
  return <span className={`pilot-privy-mark ${className}`}><img src="/brands/privy-symbol-black.svg" width={18} height={18} alt="" aria-hidden="true" /><span>Privy</span></span>;
}

export function WalletProviderNote() {
  return <span className="pilot-wallet-provider">In-app wallet by <PrivyMark /></span>;
}
