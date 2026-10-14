"use client";

import { useState } from "react";
import { ArrowRight, Wallet } from "lucide-react";
import { usePilotAccount } from "./pilot-account.tsx";
import { PilotDialog } from "./pilot-dialog.tsx";
import type { BrowserSignInWallet } from "../lib/wallets/browser-wallets.ts";

export function WalletSignInDialog({ wallets, busy, selected, error, onSelect, onClose }: {
  wallets: BrowserSignInWallet[]; busy: boolean; selected: string; error: string;
  onSelect: (wallet: BrowserSignInWallet) => void; onClose: () => void;
}) {
  return <PilotDialog title="Sign in with your wallet" className="pilot-wallet-dialog" dismissible={!busy} onClose={onClose}>
    <p>Choose your wallet, then confirm a sign-in message. Signing in uses no gas.</p>
    {(["ethereum", "solana"] as const).map(chain => {
      const available = wallets.filter(wallet => wallet.chain === chain);
      return <section className="pilot-wallet-chain" key={chain} aria-label={chain === "ethereum" ? "Monad testnet wallets" : "Solana devnet wallets"}>
        <h3>{chain === "ethereum" ? "Monad testnet" : "Solana devnet"}</h3>
        {available.length ? <div className="pilot-wallet-list">{available.map(wallet => <button type="button" className="pilot-wallet-choice" key={wallet.id} disabled={busy} onClick={() => onSelect(wallet)}>
          <Wallet size={21} aria-hidden="true" /><span>{wallet.name}</span>{busy && selected === wallet.id ? <span className="pilot-wallet-waiting">Check your wallet…</span> : <ArrowRight size={18} aria-hidden="true" />}
        </button>)}</div> : <p className="pilot-wallet-empty">{chain === "ethereum" ? "Enable MetaMask or another EVM wallet in this browser, then reload this page." : "Enable Phantom or Solflare in this browser, then reload this page."}</p>}
      </section>;
    })}
    {busy && <p role="status">Finish the connection and signature prompts in your wallet.</p>}
    {error && <p className="pilot-wallet-signin-error" role="alert">{error}</p>}
    <small>Story releases and payouts currently use Monad testnet. A Solana sign-in keeps its own storyteller account.</small>
  </PilotDialog>;
}

export function WalletSignInButton({ disabled = false }: { disabled?: boolean }) {
  const account = usePilotAccount();
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState("");
  async function signIn(wallet: BrowserSignInWallet) {
    if (!account?.client || account.authenticatingWallet) return;
    setError(""); setSelected(wallet.id);
    try { await account.signInWallet(wallet); setOpen(false); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Wallet sign-in did not finish. Try again."); }
  }
  return <><div className="pilot-wallet-signin">
    <button className="button secondary" type="button" disabled={disabled || !account?.client || account.loading} onClick={() => { setError(""); setOpen(true); }}>
      <Wallet size={17} aria-hidden="true" />{account?.authenticatingWallet ? "Confirm sign-in in your wallet…" : "Sign in with wallet"}
    </button>
  </div>{open && <WalletSignInDialog wallets={account?.browserWallets ?? []} busy={!!account?.authenticatingWallet} selected={selected} error={error} onSelect={wallet => void signIn(wallet)} onClose={() => setOpen(false)} />}</>;
}
