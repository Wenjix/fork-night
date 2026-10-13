import { ZeroAddress } from "ethers";
import type { Snapshot } from "./client.ts";
import { sameAddress, type PreparedRelease } from "./model.ts";

export function registrationReason({ prepared, snapshot, index, account, accepted, busy, pending }: {
  prepared: PreparedRelease; snapshot: Snapshot; index: number; account: string;
  accepted: boolean; busy: boolean; pending: boolean;
}) {
  const scene = snapshot.scenes[index];
  if (!scene || scene.maker === ZeroAddress) return "The curator needs to approve this maker's wallet first.";
  if (!sameAddress(scene.maker, account)) return "Connect this scene's approved wallet to register it.";
  if (scene.registered) return "This scene is already registered.";
  if (pending) return "Check the saved action before registering another scene.";
  if (busy) return "Waiting for the current wallet action.";
  if (!accepted) return "Accept the release terms to register this scene.";
  if (index > 0 && !snapshot.scenes[index - 1]?.registered)
    return `Register ${prepared.scenes[index - 1].moment.maker_label}’s scene first.`;
  return "";
}

export function walletBylines(prepared: PreparedRelease, snapshot: Snapshot, account: string) {
  const makers = new Set<string>();
  return prepared.scenes.filter((scene, index) => {
    if (!account || !sameAddress(snapshot.scenes[index]?.maker ?? "", account) || makers.has(scene.makerId)) return false;
    makers.add(scene.makerId);
    return true;
  }).map(scene => scene.moment.maker_label);
}

export function releaseJourney(prepared: PreparedRelease, snapshot: Snapshot | undefined, account: string, curatorAddress: string, guestId?: string) {
  const curator = !!account && sameAddress(account, curatorAddress);
  const bylines = snapshot ? walletBylines(prepared, snapshot, account) : [];
  const awaitingApproval = !!guestId && prepared.scenes.some((scene, index) => scene.moment.maker_id === guestId && snapshot?.scenes[index]?.maker === ZeroAddress);
  const role = !account ? "No wallet connected" : !snapshot ? "Connected wallet" : curator ? bylines.length ? "Curator and maker wallet" : "Curator wallet" : bylines.length ? "Maker wallet" : awaitingApproval ? "Maker approval pending" : "Supporter wallet";
  const registered = snapshot?.scenes.filter(scene => scene.matches).length ?? 0;
  const approved = snapshot?.scenes.filter(scene => scene.maker !== ZeroAddress).length ?? 0;
  const ownShare = snapshot?.release.beneficiaries.find(item => sameAddress(item.address, account));
  const wallets = new Set(snapshot?.scenes.map(scene => scene.maker).filter(address => address !== ZeroAddress).map(address => address.toLowerCase()));
  const released = !!snapshot?.release.exists;
  const stage = !snapshot || snapshot.curator === ZeroAddress ? "project" : released ? snapshot.release.received === 0n ? "support" : snapshot.release.paid === snapshot.release.received ? "claimed" : "claim" : approved < prepared.scenes.length ? "wallets" : registered < prepared.scenes.length ? "scenes" : "release";
  const title = !snapshot ? "Checking this story's release" : stage === "project" ? "Open this story on the testnet" : stage === "wallets" ? "Confirm the makers' wallets" : stage === "scenes" ? "Register the story, scene by scene" : stage === "release" ? "This path is ready to release" : stage === "support" ? "This story is ready for support" : stage === "claimed" ? "Every recorded share is claimed" : ownShare?.claimable ? "Your share is ready to claim" : "Support recorded for this story";
  return { curator, bylines, role, registered, approved, ownShare, wallets: wallets.size, released, stage, title };
}

export const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
