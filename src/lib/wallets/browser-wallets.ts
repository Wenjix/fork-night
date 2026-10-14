import type { SolanaWallet } from "@supabase/supabase-js";
import type { WalletProvider } from "../onchain/client.ts";

export type SolanaProvider = Omit<SolanaWallet, "signMessage"> & {
  connect?: () => Promise<unknown>;
  signMessage?: (message: Uint8Array, encoding?: string) => Promise<Uint8Array | { signature: Uint8Array }>;
};
export type BrowserSignInWallet =
  | { id: string; name: string; chain: "ethereum"; provider: WalletProvider }
  | { id: string; name: string; chain: "solana"; provider: SolanaProvider };

type InjectedEvm = WalletProvider & { providers?: InjectedEvm[]; isMetaMask?: boolean; isPhantom?: boolean; isCoinbaseWallet?: boolean };
export type WalletWindow = EventTarget & {
  ethereum?: InjectedEvm;
  phantom?: { ethereum?: InjectedEvm; solana?: SolanaProvider };
  solana?: SolanaProvider; solflare?: SolanaProvider; braveSolana?: SolanaProvider;
};

function isEvmProvider(provider: unknown): provider is WalletProvider {
  return !!provider && typeof (provider as WalletProvider).request === "function";
}
function isSolanaProvider(provider: SolanaProvider | undefined): provider is SolanaProvider {
  return !!provider && (typeof provider.signIn === "function" || typeof provider.signMessage === "function");
}
function evmName(provider: InjectedEvm) {
  return provider.isPhantom ? "Phantom" : provider.isCoinbaseWallet ? "Coinbase Wallet" : provider.isMetaMask ? "MetaMask" : "Browser wallet";
}

export function discoverBrowserWallets(host: WalletWindow, onChange: (wallets: BrowserSignInWallet[]) => void) {
  const announced = new Map<string, BrowserSignInWallet>();
  function publish() {
    const wallets = [...announced.values()];
    function add(wallet: BrowserSignInWallet) {
      if (!wallets.some(existing => existing.chain === wallet.chain && existing.provider === wallet.provider)) wallets.push(wallet);
    }
    const evm = Array.isArray(host.ethereum?.providers) ? host.ethereum.providers.filter(isEvmProvider) : [];
    if (!evm.length && isEvmProvider(host.ethereum)) evm.push(host.ethereum);
    if (isEvmProvider(host.phantom?.ethereum)) evm.push(host.phantom.ethereum);
    evm.forEach((provider, index) => add({ id: `evm-injected-${index}`, name: evmName(provider), chain: "ethereum", provider }));
    const solana = [["phantom", "Phantom", host.phantom?.solana], ["solflare", "Solflare", host.solflare], ["brave", "Brave Wallet", host.braveSolana], ["injected", "Solana wallet", host.solana]] as const;
    for (const [id, name, provider] of solana) {
      if (isSolanaProvider(provider)) add({ id: `solana-${id}`, name, chain: "solana", provider });
    }
    onChange(wallets);
  }
  function announce(event: Event) {
    const detail = (event as CustomEvent).detail;
    if (typeof detail?.info?.uuid !== "string" || typeof detail.info.name !== "string" || !isEvmProvider(detail.provider)) return;
    announced.set(detail.info.uuid, { id: `evm-${detail.info.uuid}`, name: detail.info.name.slice(0, 80), chain: "ethereum", provider: detail.provider });
    publish();
  }
  host.addEventListener("eip6963:announceProvider", announce);
  publish();
  host.dispatchEvent(new Event("eip6963:requestProvider"));
  return () => host.removeEventListener("eip6963:announceProvider", announce);
}
