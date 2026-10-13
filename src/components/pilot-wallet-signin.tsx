"use client";

import { useState } from "react";
import { Wallet } from "lucide-react";
import { usePilotAccount } from "./pilot-account.tsx";

export function WalletSignInButton({ disabled = false }: { disabled?: boolean }) {
  const account = usePilotAccount();
  const [error, setError] = useState("");
  async function signIn() {
    if (!account?.client || account.authenticatingWallet) return;
    setError("");
    try { await account.signInWallet(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Wallet sign-in did not finish. Try again."); }
  }
  return <div className="pilot-wallet-signin">
    <button className="button secondary" type="button" disabled={disabled || !account?.client || account.loading} onClick={() => void signIn()}>
      <Wallet size={17} aria-hidden="true" />{account?.authenticatingWallet ? "Confirm sign-in in your wallet…" : "Sign in with wallet"}
    </button>
    {error && <p role="alert">{error}</p>}
  </div>;
}
