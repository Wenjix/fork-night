import { Contract, getAddress, Interface, JsonRpcProvider, type AbstractProvider, type TransactionReceipt } from "ethers";
import type { IdentityResponse } from "./api-types.ts";
import {
  advance,
  explorerAddress,
  explorerTx,
  feesOf,
  MONAD_TESTNET_CHAIN_ID,
  prepareCall,
  signPrepared,
  walletLockName,
  type MonadSigner,
  type TxProgress,
} from "./monad-tx.ts";
import { readPrivySetup } from "./privy-setup.ts";
import { fileNightWatchStore, type NightWatchStore } from "./store.ts";
import { CURRENT_KIT } from "./world-kit.ts";

/**
 * The Night Watch's ERC-8004 calling card on Monad testnet: one `register(agentURI)` on the
 * IdentityRegistry, signed by the claim helper's Privy server wallet (its policy allows exactly this
 * call) and broadcast by this app. ERC-8004 is a draft standard; a registration names the companion
 * and its service. It is not proof of quality, ownership or trust.
 */

/** The Monad testnet IdentityRegistry (the address listed in Monad's guide has no code on testnet). */
export const IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
export const IDENTITY_RECORD = "identity";
export const NIGHT_WATCH_SERVICE = "http://127.0.0.1:3005/night-watch";
export const REGISTRATION_TYPE = "https://eips.ethereum.org/EIPS/eip-8004#registration-v1";
export const IDENTITY_NOTE = "An identity registration on a draft standard. It does not prove quality, ownership or trust.";
export const NIGHT_WATCH_CAPABILITIES = [
  "can plan a night with Kimi K3 and have it check its own plan against the world kit (via TokenRouter); otherwise it uses the plain prompts",
  "prepares private candidates",
  "buys one capped room top-up with a maker-approved Privy signer",
  "pays gas to deliver release claims",
];
export const DEFAULT_STEWARD = "Wenjie";

export const identityInterface = new Interface([
  "function register(string agentURI) returns (uint256 agentId)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
]);

export type RegistrationFile = {
  type: typeof REGISTRATION_TYPE;
  name: string;
  description: string;
  image?: string;
  services: { name: string; endpoint: string }[];
  x402Support: boolean;
  active: boolean;
  supportedTrust: string[];
};

export type IdentityRecord = TxProgress & {
  version: 1;
  chainId: number;
  registry: string;
  /** The registering wallet; ERC-8004 makes it the token owner and the default agent wallet. */
  owner: string;
  walletId: string;
  agentURI: string;
  /** From the Registered event once the registration is mined. */
  agentId: string | null;
  steward: string;
  createdAt: string;
};

export class IdentityRefused extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "IdentityRefused";
    this.code = code;
  }
}

export function registrationFile(options: { image?: string; endpoint?: string } = {}): RegistrationFile {
  return {
    type: REGISTRATION_TYPE,
    name: "Night Watch",
    description:
      "A testnet companion for The Midnight Signal on Fork Night. While its maker is away it prepares private candidates from the creator's world kit, may buy one capped room top-up of test credits with a maker-approved Privy signer, and pays test MON gas to deliver release claims. It never publishes and never closes an edition.",
    ...(options.image ? { image: options.image } : {}),
    services: [{ name: "web", endpoint: options.endpoint ?? NIGHT_WATCH_SERVICE }],
    x402Support: false,
    active: true,
    supportedTrust: ["reputation"],
  };
}

export const agentUri = (file: RegistrationFile) => `data:application/json;base64,${Buffer.from(JSON.stringify(file), "utf8").toString("base64")}`;

export function decodeAgentUri(uri: string): RegistrationFile | null {
  const prefix = "data:application/json;base64,";
  if (!uri.startsWith(prefix)) return null;
  try {
    const file = JSON.parse(Buffer.from(uri.slice(prefix.length), "base64").toString("utf8")) as RegistrationFile;
    return file && file.type === REGISTRATION_TYPE && typeof file.name === "string" && Array.isArray(file.services) ? file : null;
  } catch {
    return null;
  }
}

/** The agent id from the registry's Registered event for `owner`, if the receipt has one. */
export function registeredAgentId(receipt: Pick<TransactionReceipt, "logs">, owner: string): string | null {
  for (const log of receipt.logs) {
    if (getAddress(log.address) !== getAddress(IDENTITY_REGISTRY)) continue;
    const parsed = identityInterface.parseLog({ topics: [...log.topics], data: log.data });
    if (parsed?.name === "Registered" && getAddress(String(parsed.args.owner)) === getAddress(owner)) return (parsed.args.agentId as bigint).toString();
  }
  return null;
}

/** What a registration would send and cost, without signing anything. */
export async function planIdentity(provider: AbstractProvider, from: string | null) {
  const file = registrationFile();
  const agentURI = agentUri(file);
  const data = identityInterface.encodeFunctionData("register", [agentURI]);
  const sender = from ? getAddress(from) : null;
  const [network, gasEstimate, fees, balanceWei] = await Promise.all([
    provider.getNetwork(),
    // An unfunded helper can make some nodes refuse the estimate; the gas is the same from any sender.
    provider.estimateGas({ ...(sender ? { from: sender } : {}), to: IDENTITY_REGISTRY, data }).catch((error) => {
      if (!sender) throw error;
      return provider.estimateGas({ to: IDENTITY_REGISTRY, data });
    }),
    feesOf(provider),
    sender ? provider.getBalance(sender) : Promise.resolve(null),
  ]);
  const gasLimit = (gasEstimate * 110n) / 100n;
  return {
    file,
    agentURI,
    chainId: Number(network.chainId),
    from: sender,
    gasEstimate,
    gasLimit,
    maxFeePerGas: fees.maxFeePerGas,
    maxCostWei: gasLimit * fees.maxFeePerGas,
    balanceWei,
  };
}

export type IdentityDeps = {
  store: NightWatchStore;
  provider: AbstractProvider;
  signer: MonadSigner;
  steward?: string;
  now?: () => Date;
  timing?: { receiptTimeoutMs?: number; finalizedTimeoutMs?: number; pollMs?: number };
};

/**
 * Registers the Night Watch once. A saved registration still in flight is resumed (its signed bytes
 * are re-sent, never re-signed); a finalized or reverted one is refused without sending anything.
 */
export async function registerIdentity(deps: IdentityDeps): Promise<IdentityRecord> {
  const now = deps.now ?? (() => new Date());
  const owner = getAddress(deps.signer.address);
  return deps.store.withLock("identity-register", async () => {
    const record = await deps.store.read<IdentityRecord>(IDENTITY_RECORD);
    if (record?.state === "finalized") {
      throw new IdentityRefused("already_registered", `The Night Watch is already registered as agent ${record.agentId ?? "(unknown id)"}. Nothing was sent.`);
    }
    if (record?.state === "failed" && record.block !== undefined) {
      throw new IdentityRefused("reverted", `The saved registration ${record.hash} reverted on chain. Review it before registering again; nothing was sent.`);
    }
    if (record && getAddress(record.owner) !== owner) {
      throw new IdentityRefused("other_owner", "The saved registration belongs to a different wallet. Nothing was sent.");
    }
    const follow = (saved: IdentityRecord) =>
      advance(deps.provider, saved, {
        from: owner,
        save: (next) => deps.store.write(IDENTITY_RECORD, next),
        now,
        fromReceipt: (receipt) => ({ agentId: registeredAgentId(receipt, owner) }),
        ...deps.timing,
      });
    if (record && record.state !== "failed") return follow(record);

    // The helper wallet also sends claims; one new transaction at a time keeps their nonces apart.
    return deps.store.withLock(
      walletLockName(owner),
      async () => {
        const agentURI = agentUri(registrationFile());
        const data = identityInterface.encodeFunctionData("register", [agentURI]);
        const prepared = await prepareCall(deps.provider, owner, { to: IDENTITY_REGISTRY, data }, { chainId: MONAD_TESTNET_CHAIN_ID, gasMarginPercent: 10 });
        const signed = await signPrepared(deps.signer, prepared, "identity");
        const at = now().toISOString();
        const fresh: IdentityRecord = {
          version: 1,
          chainId: MONAD_TESTNET_CHAIN_ID,
          registry: IDENTITY_REGISTRY,
          owner,
          walletId: deps.signer.walletId,
          agentURI,
          agentId: null,
          steward: deps.steward?.trim() || DEFAULT_STEWARD,
          rawTransaction: signed.rawTransaction,
          hash: signed.hash,
          nonce: prepared.nonce,
          state: "signed",
          createdAt: at,
          updatedAt: at,
        };
        // Saved before the first broadcast: from here on a retry re-sends these bytes.
        await deps.store.write(IDENTITY_RECORD, fresh);
        return follow(fresh);
      },
      { waitMs: 60_000 },
    );
  });
}

export async function readIdentityRecord(store: NightWatchStore) {
  return store.read<IdentityRecord>(IDENTITY_RECORD);
}

/** The calling card, from the saved registration and, when it is minted, the registry itself. */
export async function readIdentity(deps: { store: NightWatchStore; provider?: AbstractProvider | null; helperAddress?: string | null }): Promise<IdentityResponse> {
  const record = await readIdentityRecord(deps.store);
  const file = (record && decodeAgentUri(record.agentURI)) || registrationFile();
  const wallet = record?.owner ?? deps.helperAddress ?? null;
  const minted = !!record?.agentId && (record.state === "confirmed" || record.state === "finalized");
  const evidence = [
    ...(record ? [{ label: "Registration transaction", url: explorerTx(record.hash) }] : []),
    { label: "ERC-8004 IdentityRegistry on Monad testnet", url: explorerAddress(IDENTITY_REGISTRY) },
    ...(wallet ? [{ label: "Night Watch helper wallet", url: explorerAddress(wallet) }] : []),
  ];
  let registered = minted;
  let note = IDENTITY_NOTE;
  if (minted && deps.provider) {
    try {
      const network = await deps.provider.getNetwork();
      if (network.chainId !== BigInt(MONAD_TESTNET_CHAIN_ID)) throw new Error("wrong network");
      const registry = new Contract(IDENTITY_REGISTRY, identityInterface, deps.provider);
      const [owner, uri] = await Promise.all([registry.ownerOf(record!.agentId) as Promise<string>, registry.tokenURI(record!.agentId) as Promise<string>]);
      registered = getAddress(owner) === getAddress(record!.owner) && uri === record!.agentURI;
    } catch {
      note = `${IDENTITY_NOTE} The registry could not be re-checked just now.`;
    }
  }
  return {
    registered,
    chainId: MONAD_TESTNET_CHAIN_ID,
    registry: IDENTITY_REGISTRY,
    agentId: minted ? record!.agentId : null,
    owner: minted ? record!.owner : null,
    agentURI: minted ? record!.agentURI : null,
    card: {
      name: file.name,
      description: file.description,
      steward: record?.steward ?? DEFAULT_STEWARD,
      service: file.services[0]?.endpoint ?? NIGHT_WATCH_SERVICE,
      kitVersion: `${CURRENT_KIT.id}@${CURRENT_KIT.version}`,
      capabilities: [...NIGHT_WATCH_CAPABILITIES],
      evidence,
    },
    transaction: record?.hash ?? null,
    explorerUrl: record ? explorerTx(record.hash) : null,
    note,
  };
}

export function monadRpcUrl(env: NodeJS.ProcessEnv = process.env) {
  return env.MONAD_RPC_URL?.trim() || env.NEXT_PUBLIC_MONAD_RPC_URL?.trim() || "https://testnet-rpc.monad.xyz";
}

export function monadProvider(env: NodeJS.ProcessEnv = process.env) {
  return new JsonRpcProvider(monadRpcUrl(env), MONAD_TESTNET_CHAIN_ID, { staticNetwork: true, batchMaxCount: 1 });
}

/** GET /api/night-watch/identity on this machine. */
export async function localIdentity(): Promise<IdentityResponse> {
  const store = fileNightWatchStore();
  const provider = monadProvider();
  try {
    const helperAddress = (await readPrivySetup(store))?.claimHelper?.address ?? null;
    return await readIdentity({ store, provider, helperAddress });
  } finally {
    provider.destroy();
  }
}
