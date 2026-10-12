import { AbstractProvider, BrowserProvider, Contract, getAddress, id, JsonRpcProvider, keccak256, ZeroAddress, ZeroHash, type Eip1193Provider } from "ethers";
import { releaseAbi, releaseRuntimeHash } from "./abi.ts";
import { POLICY_HASH, sameAddress, sourceKey, TERMS_HASH, type PreparedRelease } from "./model.ts";
import type { ReleaseConfig } from "./config.ts";

export type WalletProvider = Eip1193Provider & { on?: (event: string, listener: (...args: unknown[]) => void) => void; removeListener?: (event: string, listener: (...args: unknown[]) => void) => void };
export type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type Operation = "create" | "approve" | "register" | "release" | "support" | "claim";
export type PendingTransaction = { version: 1; chainId: number; address: string; account: string; projectId: string;
  operation: Operation; args: string[]; value: string; calldataHash: string; hash?: string; claimedBefore?: string };
export type Snapshot = { block: number; curator: string; root: string; termsMatch: boolean;
  scenes: { id: string; maker: string; registered: boolean; matches: boolean }[];
  release: { exists: boolean; received: bigint; paid: bigint; beneficiaries: { address: string; claimable: bigint; claimed: bigint }[] } };
const bytes32 = /^0x[a-f0-9]{64}$/i;
const methods: Record<Operation, string> = { create: "createProject", approve: "approveMaker", register: "registerMoment", release: "publishRelease", support: "supportRelease", claim: "claim" };
const arities: Record<Operation, number> = { create: 4, approve: 3, register: 6, release: 3, support: 2, claim: 2 };
export const transactionStorageKey = (config: ReleaseConfig, account: string, projectId: string) => `fork-night:chain:${config.chainId}:${config.address.toLowerCase()}:${account.toLowerCase()}:${projectId}`;

export function parseTransaction(raw: string, config: ReleaseConfig, account: string, projectId: string): PendingTransaction {
  const p = JSON.parse(raw) as PendingTransaction;
  if (!p || p.version !== 1 || p.chainId !== config.chainId || !sameAddress(p.address ?? "", config.address) ||
    !sameAddress(p.account ?? "", account) || p.projectId !== projectId || !Object.hasOwn(methods, p.operation) ||
    !Array.isArray(p.args) || p.args.length !== arities[p.operation] || !p.args.every(v => typeof v === "string" && /^0x[a-f0-9]+$/i.test(v)) ||
    !bytes32.test(p.calldataHash) || (p.hash !== undefined && !bytes32.test(p.hash)) || !/^\d+$/.test(p.value) ||
    (p.operation !== "support" && p.value !== "0") || (p.claimedBefore !== undefined && !/^\d+$/.test(p.claimedBefore))) {
    throw new Error("The saved transaction is incomplete. Check your wallet history before sending another payment.");
  }
  if (["approve", "register", "release"].includes(p.operation) && p.args[0] !== projectId) throw new Error("The saved action belongs to a different project.");
  return p;
}

export class ReleaseClient {
  readonly provider: AbstractProvider;
  readonly contract: Contract;
  readonly config: ReleaseConfig;
  constructor(config: ReleaseConfig, provider?: AbstractProvider) {
    this.config = config;
    this.provider = provider ?? new JsonRpcProvider(config.rpcUrl, undefined, { batchMaxCount: 1, cacheTimeout: -1 });
    this.contract = new Contract(config.address, releaseAbi, this.provider);
  }
  async verify() {
    const network = await this.provider.getNetwork();
    if (network.chainId !== BigInt(this.config.chainId)) throw new Error("The payout connection is on a different network. Reconnect before continuing.");
    const code = await this.provider.getCode(this.config.address);
    if (code === "0x" || keccak256(code) !== releaseRuntimeHash || await this.contract.POLICY() !== POLICY_HASH) {
      throw new Error("The configured payout contract could not be verified. No transaction was sent.");
    }
  }
  async load(prepared: PreparedRelease): Promise<Snapshot> {
    await this.verify();
    const block = await this.provider.getBlockNumber(), options = { blockTag: block };
    const [project, release, scenes] = await Promise.all([
      this.contract.projects(prepared.projectId, options), this.contract.getRelease(prepared.id, options),
      Promise.all(prepared.scenes.map(async scene => {
        const [moment, maker] = await Promise.all([this.contract.moments(scene.id, options), this.contract.makers(prepared.projectId, scene.makerId, options)]);
        const registered = moment.beneficiary !== ZeroAddress;
        const matches = registered && moment.projectId === prepared.projectId && moment.parentId === scene.parentId &&
          moment.manifestHash === scene.hash && moment.makerId === scene.makerId && sameAddress(moment.beneficiary, maker);
        return { id: scene.id, maker: String(maker), registered, matches };
      })),
    ]);
    if (project.curator !== ZeroAddress && (!sameAddress(project.curator, this.config.curator) || project.termsHash !== TERMS_HASH)) {
      throw new Error("This project's recorded curator or release terms differ from this rehearsal. No payment can be sent.");
    }
    if (project.curator !== ZeroAddress && project.root !== prepared.scenes[0].id) throw new Error("The recorded opening differs from this story. Keep the registered version and review the source before continuing.");
    if (scenes.some(scene => scene.registered && !scene.matches)) throw new Error("A registered scene differs from this published version. Its payout record has been preserved; select the registered version.");
    const exists = release.projectId !== ZeroHash;
    if (exists && (release.projectId !== prepared.projectId || release.tipId !== prepared.tipId || release.manifestHash !== prepared.hash)) throw new Error("The release does not match this selected path.");
    const beneficiaries = await Promise.all((release.beneficiaries as string[]).map(async address => ({ address,
      claimable: BigInt(await this.contract.claimable(prepared.id, address, options)), claimed: BigInt(await this.contract.claimed(prepared.id, address, options)) })));
    return { block, curator: String(project.curator), root: String(project.root), termsMatch: project.termsHash === TERMS_HASH,
      scenes, release: { exists, received: BigInt(release.received), paid: BigInt(release.paid), beneficiaries } };
  }
  async connect(wallet: WalletProvider) {
    let chainId = Number(await wallet.request({ method: "eth_chainId" }));
    if (chainId !== this.config.chainId) {
      try { await wallet.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${this.config.chainId.toString(16)}` }] }); }
      catch (error) {
        if ((error as { code?: number }).code !== 4902) throw error;
        await wallet.request({ method: "wallet_addEthereumChain", params: [{ chainId: `0x${this.config.chainId.toString(16)}`,
          chainName: this.config.name, nativeCurrency: { name: "Test MON", symbol: "MON", decimals: 18 },
          rpcUrls: [this.config.rpcUrl], ...(this.config.explorer ? { blockExplorerUrls: [this.config.explorer] } : {}) }] });
        await wallet.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${this.config.chainId.toString(16)}` }] });
      }
      chainId = Number(await wallet.request({ method: "eth_chainId" }));
    }
    if (chainId !== this.config.chainId) throw new Error("Choose the test network in your wallet before continuing.");
    const browser = new BrowserProvider(wallet);
    const accounts = await browser.send("eth_requestAccounts", []);
    if (!Array.isArray(accounts) || !accounts.length) throw new Error("Choose a wallet account to continue.");
    return { browser, account: getAddress(accounts[0]) };
  }
  async execute(prepared: PreparedRelease, wallet: WalletProvider, account: string, storage: StoragePort, operation: Operation, args: string[], value = 0n) {
    await this.verify();
    const key = transactionStorageKey(this.config, account, prepared.projectId);
    if (storage.getItem(key)) throw new Error("Check the saved transaction before sending another action.");
    const { browser, account: active } = await this.connect(wallet);
    if (!sameAddress(active, account)) throw new Error("Your wallet account changed. Reconnect and review the selected account.");
    const signer = await browser.getSigner(account), contract = this.contract.connect(signer);
    const method = contract.getFunction(methods[operation]);
    await method.staticCall(...args, { value });
    const data = this.contract.interface.encodeFunctionData(methods[operation], args);
    const pending: PendingTransaction = { version: 1, chainId: this.config.chainId, address: this.config.address,
      account, projectId: prepared.projectId, operation, args, value: value.toString(), calldataHash: keccak256(data),
      ...(operation === "claim" ? { claimedBefore: String(await this.contract.claimed(args[0], args[1])) } : {}) };
    storage.setItem(key, JSON.stringify(pending));
    try {
      const tx = await method(...args, { value });
      pending.hash = tx.hash;
      storage.setItem(key, JSON.stringify(pending));
      const receipt = await tx.wait(1, 45000);
      if (!receipt || receipt.status !== 1) throw new Error("The transaction has not been confirmed. Check its saved receipt.");
      storage.removeItem(key);
      return receipt.hash as string;
    } catch (error) {
      const e = error as { code?: string; receipt?: { status?: number } };
      if (e.code === "ACTION_REJECTED" || e.receipt?.status === 0) storage.removeItem(key);
      throw error;
    }
  }
  async recover(prepared: PreparedRelease, account: string, storage: StoragePort) {
    await this.verify();
    const key = transactionStorageKey(this.config, account, prepared.projectId), raw = storage.getItem(key);
    if (!raw) return { complete: true, hash: undefined };
    const p = parseTransaction(raw, this.config, account, prepared.projectId);
    if (keccak256(this.contract.interface.encodeFunctionData(methods[p.operation], p.args)) !== p.calldataHash) throw new Error("The saved action does not match its receipt. Check your wallet history.");
    if (p.hash) {
      const [receipt, tx] = await Promise.all([this.provider.getTransactionReceipt(p.hash), this.provider.getTransaction(p.hash)]);
      if (receipt) {
        if (!tx || !sameAddress(tx.from, account) || !sameAddress(tx.to ?? "", this.config.address) || keccak256(tx.data) !== p.calldataHash || tx.value.toString() !== p.value) {
          throw new Error("This receipt belongs to a different transaction. Check your wallet history.");
        }
        storage.removeItem(key);
        if (receipt.status !== 1) throw new Error("The transaction reverted. No release payment was collected; you can review and try again.");
        return { complete: true, hash: p.hash };
      }
    }
    // Repricing can replace the original hash. Exact settled state still proves the saved action.
    let complete = false;
    if (p.operation === "create") {
      const project = await this.contract.projects(prepared.projectId);
      complete = sameAddress(project.curator, account) && project.termsHash === p.args[1] &&
        project.root === await this.contract.momentKey(prepared.projectId, p.args[2], p.args[3]) &&
        prepared.projectId === await this.contract.projectKey(account, p.args[0]);
    }
    if (p.operation === "approve") complete = sameAddress(await this.contract.makers(p.args[0], p.args[1]), p.args[2]);
    if (p.operation === "register") {
      const moment = await this.contract.moments(await this.contract.momentKey(p.args[0], p.args[3], p.args[1]));
      complete = sameAddress(moment.beneficiary, account) && moment.projectId === p.args[0] && moment.parentId === p.args[2] &&
        moment.makerId === p.args[3] && moment.manifestHash === p.args[4];
    }
    if (p.operation === "release") complete = (await this.contract.getRelease(await this.contract.releaseKey(...p.args))).manifestHash === p.args[2];
    if (p.operation === "support") {
      const payment = await this.contract.payments(account, p.args[1]);
      complete = payment.releaseId === p.args[0] && BigInt(payment.amount) === BigInt(p.value);
    }
    if (p.operation === "claim") complete = BigInt(await this.contract.claimed(p.args[0], p.args[1])) > BigInt(p.claimedBefore ?? "0");
    if (complete) storage.removeItem(key);
    return { complete, hash: complete ? undefined : p.hash };
  }
  async retry(prepared: PreparedRelease, wallet: WalletProvider, account: string, storage: StoragePort) {
    const key = transactionStorageKey(this.config, account, prepared.projectId);
    const raw = storage.getItem(key);
    if (!raw) throw new Error("There is no saved action to retry.");
    const p = parseTransaction(raw, this.config, account, prepared.projectId);
    const recovered = await this.recover(prepared, account, storage);
    if (recovered.complete) return recovered.hash;
    const equal = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v.toLowerCase() === b[i]?.toLowerCase());
    const matches = p.operation === "create" ? equal(p.args, operationArgs(prepared, "create"))
      : p.operation === "register" ? prepared.scenes.some((_, i) => equal(p.args, operationArgs(prepared, "register", i)))
      : p.operation === "release" ? equal(p.args, operationArgs(prepared, "release"))
      : p.operation === "approve" ? p.args[0] === prepared.projectId && prepared.scenes.some(scene => scene.makerId === p.args[1]) && p.args[2] !== ZeroAddress
      : p.operation === "support" ? p.args[0] === prepared.id && bytes32.test(p.args[1]) && BigInt(p.value) > 0n && BigInt(p.value) <= 10n ** 19n
      : p.args[0] === prepared.id && sameAddress(p.args[1], account);
    if (!matches) throw new Error("Return to the saved action's original story path before retrying it.");
    const { browser, account: active } = await this.connect(wallet);
    if (!sameAddress(active, account)) throw new Error("Reconnect the wallet that sent the saved action.");
    const signer = await browser.getSigner(account), method = this.contract.connect(signer).getFunction(methods[p.operation]);
    await method.staticCall(...p.args, { value: BigInt(p.value) });
    // A retry retains the original payment ID. Only one such payment can settle, even if both transactions arrive.
    const tx = await method(...p.args, { value: BigInt(p.value) });
    p.hash = tx.hash; storage.setItem(key, JSON.stringify(p));
    const receipt = await tx.wait(1, 45000);
    if (!receipt || receipt.status !== 1) throw new Error("The saved action still needs its confirmed receipt.");
    storage.removeItem(key);
    return receipt.hash as string;
  }
  destroy() { this.provider.destroy(); }
}

export function operationArgs(prepared: PreparedRelease, operation: Operation, index = 0, wallet = "") {
  const scene = prepared.scenes[index];
  if (operation === "create") return [sourceKey(scene.moment.room_id), TERMS_HASH, prepared.scenes[0].makerId, prepared.scenes[0].sourceKey];
  if (operation === "approve") return [prepared.projectId, scene.makerId, getAddress(wallet)];
  if (operation === "register") return [prepared.projectId, scene.sourceKey, scene.parentId, scene.makerId, scene.hash, TERMS_HASH];
  if (operation === "release") return [prepared.projectId, prepared.tipId, prepared.hash];
  if (operation === "support") return [prepared.id, id(crypto.randomUUID())];
  return [prepared.id, getAddress(wallet)];
}
