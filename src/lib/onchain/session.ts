import type { Operation, ReleaseClient, Snapshot, StoragePort, WalletProvider } from "./client.ts";
import { operationArgs, transactionStorageKey } from "./client.ts";
import type { ReleaseConfig } from "./config.ts";
import { DEFAULT_SUPPORT_MON, sameAddress, supportAmount, type PreparedRelease } from "./model.ts";

type Client = Pick<ReleaseClient, "load" | "verify" | "connect" | "execute" | "recover" | "retry" | "destroy">;
type Ports = { wallet: () => WalletProvider | undefined; storage: () => StoragePort; account?: () => string };
export type ReleaseState = {
  releaseId: string; snapshot?: Snapshot; account: string; accepted: boolean;
  loading: boolean; busy: Operation | "connect" | "recover" | "retry" | null;
  pending: boolean; receipt: string; notice: string; error: string;
};
const explain = (error: unknown) => {
  const failure = error as { code?: string | number; message?: string; error?: { message?: string }; info?: { error?: { message?: string } } } | null;
  const code = failure?.code;
  if (code === "ACTION_REJECTED") return "You declined the wallet request. Review the action and try again when ready.";
  const details = [failure?.message, failure?.error?.message, failure?.info?.error?.message].join(" ");
  if (code === "INSUFFICIENT_FUNDS" || /insufficient (?:balance|funds)/i.test(details))
    return "This wallet needs test MON for gas and any support amount. After funding, reconnect. Check any saved action before choosing Retry saved action.";
  if (code === "NETWORK_ERROR" || code === "TIMEOUT") return "The testnet connection was interrupted. Refresh the release and check any saved action.";
  if (code === "UNKNOWN_ERROR" || typeof code === "number") return "The wallet could not confirm this action. Check any saved action before retrying.";
  return error instanceof Error ? error.message : "This action could not be confirmed. Check the saved result before trying again.";
};

export class ReleaseSession {
  private state: ReleaseState;
  private prepared: PreparedRelease;
  private listeners = new Set<() => void>();
  private active = false;
  private readVersion = 0;
  private read?: { releaseId: string; promise: Promise<void> };
  private loadError = "";
  private wallet?: WalletProvider;
  private walletVersion = 0;
  private accountVersion = 0;
  private inFlight = false;
  private disposal?: ReturnType<typeof setTimeout>;
  private config: ReleaseConfig;
  private client: Client;
  private ports: Ports;
  constructor(prepared: PreparedRelease, config: ReleaseConfig, client: Client, ports: Ports) {
    this.config = config;
    this.client = client;
    this.ports = ports;
    this.prepared = prepared;
    this.state = { releaseId: prepared.id, account: "", accepted: false, loading: true, busy: null, pending: false, receipt: "", notice: "", error: "" };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(next: Partial<ReleaseState>) {
    if (!this.active) return;
    this.state = { ...this.state, ...next };
    this.listeners.forEach(listener => listener());
  }
  start() {
    clearTimeout(this.disposal);
    this.active = true;
    this.bindWallet(this.ports.wallet());
    void this.syncAccount(this.ports.account?.() ?? "");
    void this.refresh();
  }
  private bindWallet(wallet: WalletProvider | undefined) {
    if (wallet === this.wallet) return;
    this.wallet?.removeListener?.("accountsChanged", this.walletChanged);
    this.wallet?.removeListener?.("chainChanged", this.walletChanged);
    this.wallet = wallet;
    this.wallet?.on?.("accountsChanged", this.walletChanged);
    this.wallet?.on?.("chainChanged", this.walletChanged);
  }
  stop() {
    this.active = false;
    this.readVersion++;
    this.read = undefined;
    this.loadError = "";
    this.wallet?.removeListener?.("accountsChanged", this.walletChanged);
    this.wallet?.removeListener?.("chainChanged", this.walletChanged);
    this.wallet = undefined;
    this.disposal = setTimeout(() => { if (!this.active && !this.inFlight) this.client.destroy(); }, 0);
  }
  private walletChanged = () => {
    this.walletVersion++;
    const account = this.ports.account?.() ?? "";
    this.update({ account: "", accepted: false, pending: false, receipt: "", notice: account ? "Wallet changed. Checking the signed-in wallet for this release." : "Wallet changed. Sign in again before sending a release action." });
    void this.syncAccount(account, true);
  };
  private async syncAccount(account: string, fresh = false) {
    const next = account.trim();
    const version = ++this.accountVersion;
    if (!next) {
      this.update({ account: "", accepted: false, pending: false, receipt: fresh ? "" : this.state.receipt });
      return;
    }
    const wallet = this.wallet;
    try {
      if (wallet) {
        const accounts = await wallet.request({ method: "eth_accounts" });
        if (version !== this.accountVersion || wallet !== this.wallet) return;
        if (Array.isArray(accounts) && accounts.length && !accounts.some(value => typeof value === "string" && sameAddress(value, next))) {
          this.update({ account: "", accepted: false, pending: false, notice: "Choose the wallet you signed in with before sending a release action." });
          return;
        }
      }
      this.update({ account: next, pending: this.pending(next), error: this.state.error === "Reconnect your wallet to continue." ? "" : this.state.error });
    } catch {
      // Some embedded wallets do not expose eth_accounts until their bridge is ready. The
      // page-level account still identifies the role; sending will require a provider.
      if (version === this.accountVersion) this.update({ account: next, pending: this.pending(next) });
    }
  }
  syncWallet(account = this.ports.account?.() ?? "") {
    const next = this.ports.wallet();
    const changed = next !== this.wallet;
    this.bindWallet(next);
    if (changed && this.state.account && !account) this.walletChanged();
    else void this.syncAccount(account);
  }
  setPrepared(prepared: PreparedRelease) {
    this.prepared = prepared;
    if (prepared.id === this.state.releaseId) return;
    this.readVersion++;
    this.loadError = "";
    const next = { releaseId: prepared.id, snapshot: undefined, accepted: false, loading: true, receipt: "", notice: "", error: "" };
    if (!this.active) { this.state = { ...this.state, ...next }; return; }
    this.update(next);
    void this.refresh();
  }
  accept(accepted: boolean) {
    if (this.state.account && !this.state.busy && !this.state.pending) this.update({ accepted });
  }
  feedback(notice: string, error = "") { this.update({ notice, error }); }
  private pending(account = this.state.account) {
    if (!account) return false;
    try { return !!this.ports.storage().getItem(transactionStorageKey(this.config, account, this.prepared.projectId)); }
    catch {
      this.update({ error: "This browser cannot save wallet actions. Enable browser storage before sending a transaction." });
      return true;
    }
  }
  private finish() {
    this.inFlight = false;
    this.update({ busy: null, pending: this.pending() });
    if (!this.active) this.client.destroy();
  }
  refresh(fresh = false) {
    if (!this.active) return Promise.resolve();
    if (!fresh && this.read?.releaseId === this.prepared.id) return this.read.promise;
    const version = ++this.readVersion, prepared = this.prepared;
    const promise = (async () => {
      try {
        const snapshot = await this.client.load(prepared);
        if (version === this.readVersion && this.prepared.id === prepared.id) {
          this.update({ snapshot, loading: false, error: this.state.error === this.loadError ? "" : this.state.error });
          this.loadError = "";
        }
      } catch (error) {
        if (version === this.readVersion) {
          this.loadError = explain(error);
          this.update({ snapshot: undefined, loading: false, error: this.loadError });
        }
      }
    })();
    this.read = { releaseId: prepared.id, promise };
    void promise.finally(() => { if (this.read?.promise === promise) this.read = undefined; });
    return promise;
  }
  async connect() {
    if (!this.active || this.state.busy) return;
    this.inFlight = true;
    this.update({ busy: "connect", account: "", accepted: false, receipt: "", pending: false, error: "", notice: "" });
    try {
      const wallet = this.ports.wallet();
      if (!wallet) throw new Error("Open this page in a browser with an Ethereum-compatible wallet extension enabled.");
      this.bindWallet(wallet);
      await this.client.verify();
      const { account } = await this.client.connect(wallet);
      const version = this.walletVersion;
      const [accounts, chain] = await Promise.all([wallet.request({ method: "eth_accounts" }), wallet.request({ method: "eth_chainId" })]);
      if (wallet !== this.ports.wallet() || version !== this.walletVersion || !Array.isArray(accounts) || !accounts[0] || !sameAddress(accounts[0], account) || Number(chain) !== this.config.chainId)
        throw new Error("The selected wallet or network changed. Reconnect and review it before continuing.");
      this.update({ account, accepted: false, receipt: "", pending: this.pending(account), notice: "Wallet connected. Your guest name stays the same; this wallet selects your testnet role." });
      await this.refresh(true);
    } catch (error) { this.update({ error: explain(error) }); }
    finally { this.finish(); }
  }
  async perform(operation: Operation, index = 0, walletAddress = "", amount = DEFAULT_SUPPORT_MON) {
    const { account, snapshot, busy, pending, accepted } = this.state;
    if (!this.active || !account || !snapshot || busy || pending) return;
    if ((operation === "register" || operation === "create") && !accepted) {
      this.update({ error: "Accept the testnet release terms before registering your work." });
      return;
    }
    const prepared = this.prepared;
    this.inFlight = true;
    this.update({ busy: operation, error: "", notice: "" });
    try {
      const wallet = this.ports.wallet();
      if (!wallet) throw new Error("Reconnect your wallet to continue.");
      const hash = await this.client.execute(prepared, wallet, account, this.ports.storage(), operation,
        operationArgs(prepared, operation, index, walletAddress), operation === "support" ? supportAmount(amount) : 0n);
      this.update({ receipt: hash, notice: this.prepared.id !== prepared.id ? "The action on your previous story is confirmed. Its receipt is available below." : operation === "claim" ? "Claim recorded for the registered wallet." : operation === "support" ? "Support recorded for every included maker wallet." : operation === "release" ? "Release frozen. Its registered wallets and split are fixed." : "Recorded on the test network." });
      await this.refresh(true);
      return hash;
    } catch (error) { this.update({ error: explain(error) }); }
    finally { this.finish(); }
  }
  async recover(retry = false) {
    const { account, busy } = this.state;
    if (!this.active || !account || busy) return;
    const prepared = this.prepared;
    this.inFlight = true;
    this.update({ busy: retry ? "retry" : "recover", error: "", notice: "" });
    try {
      if (retry) {
        const wallet = this.ports.wallet();
        if (!wallet) throw new Error("Reconnect the wallet that sent the saved action.");
        const hash = await this.client.retry(prepared, wallet, account, this.ports.storage());
        this.update({ receipt: hash ?? "", notice: "The saved action is confirmed. Its original payment key prevents collecting support twice." });
      } else {
        const result = await this.client.recover(prepared, account, this.ports.storage());
        this.update({ receipt: result.hash ?? "", notice: result.complete ? "The saved action is confirmed. No action was sent again." : result.hash
          ? "The saved transaction is not confirmed yet. Check its receipt and wallet status, then check again."
          : "No confirmation was found for the saved action. Review your wallet history; after funding and reconnecting if needed, choose Retry saved action for a new wallet confirmation." });
      }
      await this.refresh(true);
    } catch (error) { this.update({ error: explain(error) }); }
    finally { this.finish(); }
  }
}
