"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { PrivyProvider, useCreateWallet, usePrivy, useSubscribeToJwtAuthWithFlag, useWallets } from "@privy-io/react-auth";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "../lib/supabase/database.types.ts";
import { createEmbeddedWalletIfCurrent, embeddedAddressForMaker, isSavedAccount, walletAuthToken } from "../lib/supabase/onboarding.ts";
import { sameAddress } from "../lib/onchain/model.ts";
import type { EmbeddedWalletState } from "./pilot-account.tsx";

type Props = { client: SupabaseClient<Database>; user?: User; loading: boolean; onWallet: (wallet: EmbeddedWalletState) => void; signOut?: RefObject<(() => Promise<void>) | undefined>; logoutOnly?: boolean };
// Network and native-token display follow Monad's Next.js/Privy template.
const monadTestnet = {
  id: 10143, name: "Monad Testnet",
  nativeCurrency: { name: "Test MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [process.env.NEXT_PUBLIC_MONAD_RPC_URL || "https://testnet-rpc.monad.xyz"] } },
  blockExplorers: { default: { name: "MonadScan", url: "https://testnet.monadscan.com" } },
} as const;

export default function PilotPrivy(props: Props) {
  return <PrivyProvider appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!} clientId={process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID || undefined} config={{
    defaultChain: monadTestnet, supportedChains: [monadTestnet],
    appearance: { theme: "dark", accentColor: "#6941f6" },
    embeddedWallets: { ethereum: { createOnLogin: "off" }, showWalletUIs: true, priceDisplay: { primary: "native-token", secondary: null } },
  }}><WalletBridge {...props} /></PrivyProvider>;
}

function WalletBridge({ client, user, loading, onWallet, signOut, logoutOnly }: Props) {
  const { ready, authenticated, user: privyUser, logout } = usePrivy();
  const { ready: walletsReady, wallets } = useWallets();
  const { createWallet } = useCreateWallet();
  const creation = useRef(createWallet);
  creation.current = createWallet;
  const [completedCreation, setCompletedCreation] = useState(0);
  const owner = isSavedAccount(user) ? user!.id : "";
  const current = useRef(owner);
  current.current = owner;
  const attempted = useRef("");
  const creating = useRef(false);
  // A bridge mounted only to end a sign-out never signs in to Privy or opens the wallet.
  const signingOut = useRef(!!logoutOnly);
  const failure = useCallback((error: Error) => {
    if (current.current) onWallet({ owner: current.current, address: "", loading: false, error: error.message, prepare: () => window.location.reload() });
  }, [onWallet]);
  const getExternalJwt = useCallback(async () => {
    if (!owner || signingOut.current) return undefined;
    try { return await walletAuthToken(client, owner); }
    catch (reason) {
      if (current.current === owner) failure(reason instanceof Error ? reason : new Error("Wallet sign-in could not be checked. Refresh to try again."));
      return undefined;
    }
  }, [client, owner, failure]);
  const { state } = useSubscribeToJwtAuthWithFlag({
    isLoading: loading, isAuthenticated: !!owner,
    getExternalJwt,
    onError: () => failure(new Error("Your Google account is saved. Wallet sign-in could not finish; check the Privy JWT integration, then refresh.")),
  });
  // Privy stores tokens when its init refresh or an in-flight JWT sign-in resolves,
  // so a logout before then would clear nothing.
  const settled = useRef(false);
  settled.current = ready && state.status !== "loading";
  // Sign-out ends the Privy session through this still-mounted bridge. The logout
  // re-runs Privy's JWT sync, which must not sign the departing account back in.
  useEffect(() => {
    if (!signOut) return;
    const end = async () => {
      signingOut.current = true;
      const until = Date.now() + 3000;
      while (!settled.current && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 50));
      await logout();
    };
    signOut.current = end;
    return () => { if (signOut.current === end) signOut.current = undefined; };
  }, [signOut, logout]);
  const subjectMatches = !!owner && privyUser?.linkedAccounts.some(account => account.type === "custom_auth" && account.customUserId === owner);
  const address = embeddedAddressForMaker(owner, privyUser?.linkedAccounts ?? []);
  const embedded = address ? wallets.find(wallet => wallet.walletClientType === "privy" && sameAddress(wallet.address, address)) : undefined;
  useEffect(() => {
    if (!owner || !ready || loading) return;
    if (state.status === "not-enabled") failure(new Error("Your Google account is saved. The operator needs to enable Privy's JWT integration before your in-app wallet can open."));
    else if (state.status === "done" && authenticated && !subjectMatches) failure(new Error("The wallet belongs to a different storyteller account. Refresh to reconnect your own account."));
  }, [owner, ready, loading, state.status, authenticated, subjectMatches, failure]);
  useEffect(() => {
    if (logoutOnly || !owner || !ready || !authenticated || !walletsReady || !subjectMatches) return;
    let active = true;
    if (embedded) {
      onWallet({ owner, address: embedded.address, loading: true, error: "" });
      void embedded.getEthereumProvider().then(async provider => {
        const accounts = await provider.request({ method: "eth_accounts" });
        if (!Array.isArray(accounts) || !accounts.some(account => typeof account === "string" && sameAddress(account, embedded.address))) throw new Error("Wallet address differs from the saved account.");
        if (active && current.current === owner) onWallet({ owner, address: embedded.address, provider, loading: false, error: "" });
      }).catch(() => { if (active && current.current === owner) failure(new Error("Your wallet could not be opened. Refresh to reconnect.")); });
    } else if (!address && !creating.current && attempted.current !== owner) {
      attempted.current = owner;
      creating.current = true;
      onWallet({ owner, address: "", loading: true, error: "" });
      void createEmbeddedWalletIfCurrent(getExternalJwt, () => creation.current(), () => active && current.current === owner).catch(() => {
        if (active && current.current === owner) failure(new Error("Your account is saved, but its wallet could not be created. Refresh to try again."));
      }).finally(() => { creating.current = false; if (active && current.current === owner) setCompletedCreation(value => value + 1); });
    }
    return () => { active = false; };
  }, [logoutOnly, owner, ready, authenticated, walletsReady, subjectMatches, embedded?.address, address, completedCreation, getExternalJwt, onWallet, failure]);
  return null;
}
