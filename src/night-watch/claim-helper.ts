import type { KeyObject } from "node:crypto";
import { getAddress, Interface, isAddress, ZeroHash, type AbstractProvider, type TransactionReceipt } from "ethers";
import { releaseAbi } from "../lib/onchain/abi.ts";
import { ReleaseClient } from "../lib/onchain/client.ts";
import { releaseConfig, type ReleaseConfig } from "../lib/onchain/config.ts";
import { createPrivyRest, type PrivyRest } from "../privy/rest.ts";
import type { ClaimView } from "./api-types.ts";
import { NightWatchError } from "./http.ts";
import { advance, explorerTx, MonadTxRefused, prepareCall, signPrepared, walletLockName, type TxState } from "./monad-tx.ts";
import { authorizationKey, privyCredentials, readPrivySetup } from "./privy-setup.ts";
import { LockTimeoutError, type NightWatchStore } from "./store.ts";

/**
 * The claim helper: a developer-owned Privy server wallet that pays gas to trigger
 * `claim(releaseId, beneficiary)` on the existing release contract. The contract sends the share to
 * the release's frozen beneficiary, so the helper can only deliver funds, never redirect them.
 *
 * The helper asks Privy to sign, checks the signed transaction is exactly the claim it asked for,
 * and broadcasts it itself; the saved raw transaction is re-sent rather than re-signed after a lost
 * answer, so a retry cannot claim twice or skip a nonce.
 */

const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const releaseInterface = new Interface(releaseAbi);
const NOTHING_LEFT = "This wallet has nothing left to claim from the release. No transaction was sent.";

export type ClaimState = TxState;

export type ClaimRecord = {
  version: 1;
  releaseId: string;
  beneficiary: string;
  helper: string;
  amountWei: string;
  rawTransaction: string;
  hash: string;
  nonce: number;
  state: ClaimState;
  createdAt: string;
  updatedAt: string;
  block?: number;
  finalizedBlock?: number;
  claimedWei?: string;
  beneficiaryBalanceBefore?: string;
  beneficiaryBalanceAfter?: string;
  error?: string;
};

export class ClaimRefused extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ClaimRefused";
    this.code = code;
  }
}

export type ClaimHelper = {
  config: ReleaseConfig;
  walletId: string;
  address: string;
  authorizationKey: KeyObject;
  privy: Pick<PrivyRest, "signTransaction">;
  provider?: AbstractProvider;
  /** A ready client, used instead of building one from `config` and `provider`. */
  client?: ReleaseClient;
  store: NightWatchStore;
  now?: () => Date;
  timing?: { receiptTimeoutMs?: number; finalizedTimeoutMs?: number; pollMs?: number };
};

export type ClaimPreview = {
  releaseId: string;
  beneficiary: string;
  beneficiaries: string[];
  /** Claimable at the finalized block. */
  claimableWei: bigint;
  /** Claimable at the latest block; an in-flight claim shows here first. */
  latestClaimableWei: bigint;
  receivedWei: bigint;
  paidWei: bigint;
  finalizedBlock: number;
};

const claimName = (releaseId: string, beneficiary: string) => `claims/${releaseId.slice(2, 18).toLowerCase()}-${beneficiary.slice(2).toLowerCase()}`;

function clientOf(helper: ClaimHelper) {
  return helper.client ?? new ReleaseClient(helper.config, helper.provider);
}

async function previewWith(client: ReleaseClient, releaseIdInput: unknown, beneficiaryInput: unknown): Promise<ClaimPreview> {
  if (typeof releaseIdInput !== "string" || !BYTES32.test(releaseIdInput)) throw new ClaimRefused("invalid_release", "That is not a release id.");
  if (typeof beneficiaryInput !== "string" || !isAddress(beneficiaryInput)) throw new ClaimRefused("invalid_beneficiary", "That is not a wallet address.");
  const releaseId = releaseIdInput.toLowerCase();
  const beneficiary = getAddress(beneficiaryInput);
  try {
    await client.verify();
  } catch {
    throw new ClaimRefused("contract_unverified", "The release contract on Monad testnet could not be verified right now. No transaction was sent.");
  }
  const finalized = await client.provider.getBlock("finalized");
  if (!finalized) throw new ClaimRefused("chain_unavailable", "Monad testnet did not report a finalized block. No transaction was sent.");
  const at = { blockTag: finalized.number };
  const [release, claimableWei, latestClaimableWei] = await Promise.all([
    client.contract.getRelease(releaseId, at) as Promise<[string, string, string, bigint, bigint, string[]]>,
    client.contract.claimable(releaseId, beneficiary, at) as Promise<bigint>,
    client.contract.claimable(releaseId, beneficiary) as Promise<bigint>,
  ]);
  if (release[0] === ZeroHash) throw new ClaimRefused("unknown_release", "That release is not frozen on the contract yet. No transaction was sent.");
  const beneficiaries = release[5].map((address) => getAddress(address));
  if (!beneficiaries.includes(beneficiary)) {
    throw new ClaimRefused("not_beneficiary", "That wallet is not a frozen recipient of this release. No transaction was sent.");
  }
  return {
    releaseId,
    beneficiary,
    beneficiaries,
    claimableWei: BigInt(claimableWei),
    latestClaimableWei: BigInt(latestClaimableWei),
    receivedWei: BigInt(release[3]),
    paidWei: BigInt(release[4]),
    finalizedBlock: finalized.number,
  };
}

/** What a claim would deliver, read at the finalized block, without sending anything. */
export async function previewClaim(helper: ClaimHelper, releaseIdInput: string, beneficiaryInput: string): Promise<ClaimPreview> {
  const client = clientOf(helper);
  try {
    return await previewWith(client, releaseIdInput, beneficiaryInput);
  } finally {
    if (!helper.client && !helper.provider) client.destroy();
  }
}

function claimedAmount(receipt: TransactionReceipt, contract: string, releaseId: string, beneficiary: string): string | undefined {
  for (const log of receipt.logs) {
    if (getAddress(log.address) !== getAddress(contract)) continue;
    const parsed = releaseInterface.parseLog({ topics: [...log.topics], data: log.data });
    if (parsed?.name === "Claimed" && String(parsed.args[0]).toLowerCase() === releaseId && getAddress(String(parsed.args[1])) === beneficiary) {
      return (parsed.args[2] as bigint).toString();
    }
  }
  return undefined;
}

/** Turns a lower-level refusal into the claim's own words; the route answers 409 for these. */
function claimRefusal(error: unknown): unknown {
  if (error instanceof LockTimeoutError) return new ClaimRefused("in_flight", "A claim for this wallet is already being delivered. Check again in a moment.");
  if (!(error instanceof MonadTxRefused)) return error;
  if (error.code === "would_revert") {
    const reason = error.revertData ? releaseInterface.parseError(error.revertData)?.name : undefined;
    if (reason === "NothingToClaim") return new ClaimRefused("nothing_to_claim", NOTHING_LEFT);
    if (reason === "UnknownRelease") return new ClaimRefused("unknown_release", "That release is not frozen on the contract yet. No transaction was sent.");
    return new ClaimRefused("claim_would_revert", "The contract would refuse this claim right now, so nothing was signed or sent.");
  }
  if (error.code === "unfunded") return new ClaimRefused("helper_unfunded", "The claim helper has no test MON for gas right now. No transaction was sent.");
  if (error.code === "signature_mismatch") return new ClaimRefused("signature_mismatch", "Privy signed a different transaction than the claim requested. Nothing was sent.");
  return new ClaimRefused(error.code, error.message);
}

const inFlight = (record: ClaimRecord | null): record is ClaimRecord =>
  record?.state === "signed" || record?.state === "broadcast" || record?.state === "confirmed";

/** Sends the saved claim (never re-signing it) and follows it to the finalized block. */
async function settle(helper: ClaimHelper, provider: AbstractProvider, record: ClaimRecord, name: string, now: () => Date): Promise<ClaimRecord> {
  const settled = await advance(provider, record, {
    from: record.helper,
    save: (next) => helper.store.write(name, next),
    now,
    fromReceipt: (receipt) => ({ claimedWei: claimedAmount(receipt, helper.config.address, record.releaseId, record.beneficiary) }),
    atFinalized: async (block) => ({ beneficiaryBalanceAfter: (await provider.getBalance(record.beneficiary, block)).toString() }),
    receiptTimeoutMs: 20_000,
    finalizedTimeoutMs: 15_000,
    ...helper.timing,
  });
  if (settled.state === "finalized") {
    await helper.store.appendEvent("claims/events", {
      event: "finalized",
      releaseId: settled.releaseId,
      beneficiary: settled.beneficiary,
      hash: settled.hash,
      claimedWei: settled.claimedWei,
    });
  }
  return settled;
}

async function deliver(helper: ClaimHelper, client: ReleaseClient, preview: ClaimPreview, name: string, now: () => Date): Promise<ClaimRecord> {
  const { store } = helper;
  const provider = client.provider;
  const helperAddress = getAddress(helper.address);
  const saved = await store.read<ClaimRecord>(name);
  if (inFlight(saved)) return settle(helper, provider, saved, name, now);
  if (preview.claimableWei === 0n || preview.latestClaimableWei === 0n) throw new ClaimRefused("nothing_to_claim", NOTHING_LEFT);

  const busy = (error: unknown): never => {
    throw error instanceof LockTimeoutError ? new ClaimRefused("helper_busy", "The claim helper is still delivering another transaction. Try again in a moment; nothing was sent.") : error;
  };
  return store.withLock(
    walletLockName(helperAddress),
    async () => {
      const current = await store.read<ClaimRecord>(name);
      if (inFlight(current)) return settle(helper, provider, current, name, now);
      const data = releaseInterface.encodeFunctionData("claim", [preview.releaseId, preview.beneficiary]);
      const prepared = await prepareCall(provider, helperAddress, { to: helper.config.address, data }, { chainId: helper.config.chainId, gasMarginPercent: 15 });
      const signed = await signPrepared(
        { walletId: helper.walletId, address: helperAddress, authorizationKey: helper.authorizationKey, privy: helper.privy },
        prepared,
        "claim",
      );
      const at = now().toISOString();
      const record: ClaimRecord = {
        version: 1,
        releaseId: preview.releaseId,
        beneficiary: preview.beneficiary,
        helper: helperAddress,
        amountWei: preview.claimableWei.toString(),
        rawTransaction: signed.rawTransaction,
        hash: signed.hash,
        nonce: prepared.nonce,
        state: "signed",
        createdAt: at,
        updatedAt: at,
        beneficiaryBalanceBefore: (await provider.getBalance(preview.beneficiary)).toString(),
      };
      // Saved before the first broadcast: from here on a retry re-sends these bytes.
      await store.write(name, record);
      await store.appendEvent("claims/events", { event: "signed", releaseId: record.releaseId, beneficiary: record.beneficiary, hash: record.hash });
      return settle(helper, provider, record, name, now);
    },
    { waitMs: 45_000 },
  ).catch(busy);
}

/**
 * Claims one beneficiary's share. Refuses before signing when the wallet is not a frozen recipient or
 * nothing is claimable at the finalized block, and resumes a saved claim (re-sending its signed bytes)
 * instead of signing a new one. One claim per release and wallet runs at a time.
 */
export async function runClaim(helper: ClaimHelper, releaseIdInput: string, beneficiaryInput: string): Promise<ClaimRecord> {
  const now = helper.now ?? (() => new Date());
  const client = clientOf(helper);
  try {
    const preview = await previewWith(client, releaseIdInput, beneficiaryInput);
    const name = claimName(preview.releaseId, preview.beneficiary);
    return await helper.store.withLock(`claim-${name.slice("claims/".length)}`, () => deliver(helper, client, preview, name, now), { waitMs: 2_000 });
  } catch (error) {
    throw claimRefusal(error);
  } finally {
    if (!helper.client && !helper.provider) client.destroy();
  }
}

export async function readClaim(store: NightWatchStore, releaseId: string, beneficiary: string) {
  return store.read<ClaimRecord>(claimName(releaseId.toLowerCase(), getAddress(beneficiary)));
}

/** Every saved claim for one release. */
export async function listClaims(store: NightWatchStore, releaseId: string): Promise<ClaimRecord[]> {
  const id = releaseId.toLowerCase();
  const names = (await store.list("claims")).filter((name) => name.startsWith(`${id.slice(2, 18)}-`));
  const records = await Promise.all(names.map((name) => store.read<ClaimRecord>(`claims/${name}`)));
  return records.filter((record): record is ClaimRecord => !!record && record.releaseId === id);
}

export function claimView(record: ClaimRecord): ClaimView {
  return {
    releaseId: record.releaseId,
    beneficiary: record.beneficiary,
    state: record.state,
    hash: record.hash,
    amountWei: record.amountWei,
    claimedWei: record.claimedWei ?? null,
    explorerUrl: explorerTx(record.hash),
    updatedAt: record.updatedAt,
  };
}

/** The claim helper as this machine is set up: Privy credentials, the saved helper wallet and the app key. */
export async function localClaimHelper(store: NightWatchStore): Promise<ClaimHelper> {
  const config = releaseConfig();
  if (!config) throw new NightWatchError(503, "release_unconfigured", "The Monad release contract is not configured on this machine.");
  const credentials = privyCredentials();
  const setup = await readPrivySetup(store);
  if (!credentials || !setup?.claimHelper) throw new NightWatchError(503, "helper_unconfigured", "The Night Watch claim helper is not set up on this machine.");
  const key = await authorizationKey(store).catch(() => null);
  if (!key || key.publicKey !== setup.publicKey) {
    throw new NightWatchError(503, "helper_unconfigured", "The Night Watch authorization key on this machine does not match its setup.");
  }
  return {
    config,
    walletId: setup.claimHelper.walletId,
    address: setup.claimHelper.address,
    authorizationKey: key.privateKey,
    privy: createPrivyRest(credentials),
    store,
  };
}
