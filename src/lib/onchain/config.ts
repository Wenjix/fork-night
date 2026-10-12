import { getAddress, isAddress, ZeroAddress } from "ethers";

export type ReleaseConfig = { chainId: 10143 | 31337; rpcUrl: string; address: string; curator: string; explorer: string; name: string };
export function releaseConfig(): ReleaseConfig | null {
  const address = process.env.NEXT_PUBLIC_MONAD_RELEASE_ADDRESS;
  const curator = process.env.NEXT_PUBLIC_MONAD_CURATOR_ADDRESS;
  const chainId = Number(process.env.NEXT_PUBLIC_MONAD_CHAIN_ID ?? "10143");
  if (!address || !curator || !isAddress(address) || !isAddress(curator) || address === ZeroAddress || curator === ZeroAddress || ![10143, 31337].includes(chainId)) return null;
  const rpcUrl = process.env.NEXT_PUBLIC_MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz";
  let parsed: URL;
  try { parsed = new URL(rpcUrl); } catch { return null; }
  if (parsed.username || parsed.password || !(parsed.protocol === "https:" || (chainId === 31337 && parsed.protocol === "http:" && ["127.0.0.1", "localhost"].includes(parsed.hostname)))) return null;
  return { chainId: chainId as 10143 | 31337, rpcUrl, address: getAddress(address), curator: getAddress(curator),
    explorer: chainId === 10143 ? "https://testnet.monadscan.com" : "", name: chainId === 10143 ? "Monad testnet" : "Local test network" };
}
