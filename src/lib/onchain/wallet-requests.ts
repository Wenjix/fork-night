import { BrowserProvider, getAddress, isAddress, verifyMessage, ZeroAddress } from "ethers";
import type { ReleaseConfig } from "./config.ts";
import type { WalletProvider } from "./client.ts";
import { ORIGINAL_ROOM, projectKey, sameAddress, TERMS_HASH } from "./model.ts";

export type WalletRequest = {
  id: string; room_id: string; project_id: string; moment_id: string; maker_id: string;
  maker_label: string; moment_title: string; wallet_address: string;
  state: "pending" | "approved" | "denied"; created_at: string; decided_at: string | null;
};
export type WalletRequestProof = {
  id: string; moment_id: string; maker_id: string; wallet_address: string; issued_at: number;
};
export const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export class RequestProblem extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
export function requestDomain(config: ReleaseConfig) {
  return `Fork Night\nNetwork: ${config.chainId}\nContract: ${getAddress(config.address)}\nProject: ${projectKey(config.curator, ORIGINAL_ROOM)}\nTerms: ${TERMS_HASH}`;
}
export function requestMessage(proof: WalletRequestProof, config: ReleaseConfig) {
  return `${requestDomain(config)}\nAction: Request my payout wallet\nRequest: ${proof.id}\nScene: ${proof.moment_id}\nMaker: ${proof.maker_id}\nWallet: ${getAddress(proof.wallet_address)}\nIssued: ${proof.issued_at}\nThis signature sends a wallet request. It does not spend MON or approve a payout link.`;
}
export function denialMessage(request: WalletRequest, issuedAt: number, config: ReleaseConfig) {
  return `${requestDomain(config)}\nAction: Deny this wallet request\nRequest: ${request.id}\nMaker: ${request.maker_id}\nWallet: ${getAddress(request.wallet_address)}\nIssued: ${issuedAt}\nThis decision closes the pending request. It does not revoke an onchain wallet approval.`;
}
function fresh(issuedAt: unknown, now: number) {
  if (!Number.isSafeInteger(issuedAt) || Number(issuedAt) > now + 30 || Number(issuedAt) < now - 300)
    throw new RequestProblem("This wallet confirmation expired. Review the request and sign again.");
}
export function verifyWalletRequest(proof: WalletRequestProof, signature: string, config: ReleaseConfig, actor: string, now = Math.floor(Date.now() / 1000)) {
  if (!proof || ![proof.id, proof.moment_id, proof.maker_id].every(value => typeof value === "string" && uuid.test(value)) ||
    typeof proof.wallet_address !== "string" || !isAddress(proof.wallet_address) || sameAddress(proof.wallet_address, ZeroAddress))
    throw new RequestProblem("Choose your published scene and connected wallet before requesting approval.");
  if (proof.maker_id !== actor) throw new RequestProblem("You can only request a wallet for your own published byline.", 403);
  fresh(proof.issued_at, now);
  let signer: string;
  try { signer = verifyMessage(requestMessage(proof, config), signature); }
  catch { throw new RequestProblem("The wallet signature could not be verified. Reconnect and try again.", 403); }
  if (!sameAddress(signer, proof.wallet_address)) throw new RequestProblem("The signature belongs to another wallet. Reconnect your requested wallet.", 403);
  return { ...proof, wallet_address: getAddress(proof.wallet_address) };
}
export function verifyDenial(request: WalletRequest, issuedAt: number, signature: string, config: ReleaseConfig, now = Math.floor(Date.now() / 1000)) {
  fresh(issuedAt, now);
  let signer: string;
  try { signer = verifyMessage(denialMessage(request, issuedAt, config), signature); }
  catch { throw new RequestProblem("The curator signature could not be verified. Reconnect and try again.", 403); }
  if (!sameAddress(signer, config.curator)) throw new RequestProblem("Only the project's curator can deny a wallet request.", 403);
}
export async function signWalletMessage(wallet: WalletProvider, account: string, message: string, chainId: number) {
  const [accounts, chain] = await Promise.all([wallet.request({ method: "eth_accounts" }), wallet.request({ method: "eth_chainId" })]);
  if (!Array.isArray(accounts) || !sameAddress(String(accounts[0]), account) || Number(chain) !== chainId)
    throw new Error("Your wallet or network changed. Reconnect before sending this request.");
  const browser = new BrowserProvider(wallet);
  try { return await (await browser.getSigner(account)).signMessage(message); }
  catch { throw new Error("The wallet confirmation did not finish. Review the request and try again."); }
  finally { browser.destroy(); }
}
export async function walletRequestApi(input?: unknown, token?: string, signal?: AbortSignal): Promise<WalletRequest[]> {
  const response = await fetch(`/api/pilot/wallet-requests${input ? "" : `?room=${ORIGINAL_ROOM}`}`, {
    method: input ? "POST" : "GET", signal, cache: "no-store",
    headers: { ...(input ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(input ? { body: JSON.stringify(input) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Wallet requests are unavailable. Try checking again.");
  return result.requests;
}
