// A local supporter wallet for the Night Watch morning edition. Monad testnet only; never prints the key.
//
//   node --env-file-if-exists=.env.local scripts/night-watch-supporter.ts init
//        # creates .local/night-watch/wallets/supporter.json (mode 600) if absent and prints its address
//   node --env-file-if-exists=.env.local scripts/night-watch-supporter.ts status
//   node --env-file-if-exists=.env.local scripts/night-watch-supporter.ts support --release <id> [--amount 0.5] [--confirm]
//        # supportRelease(releaseId, paymentId) with test MON, then waits for Monad's finalized block.
//        # Without --confirm it checks everything and sends nothing.
//
// Funding the supporter with a little test MON (from the deployer) is a separate, manual step.
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { formatEther, getAddress, id, Interface, JsonRpcProvider, parseEther, Transaction, Wallet, ZeroHash, type TransactionReceipt } from "ethers";
import { releaseAbi } from "../src/lib/onchain/abi.ts";
import { ReleaseClient } from "../src/lib/onchain/client.ts";
import { releaseConfig, type ReleaseConfig } from "../src/lib/onchain/config.ts";
import { supportAmount } from "../src/lib/onchain/model.ts";
import { advance, errorText, explorerAddress, explorerTx, finalizedBlockNumber, MonadTxRefused, prepareCall, revertData, type TxProgress } from "../src/night-watch/monad-tx.ts";
import { fileNightWatchStore } from "../src/night-watch/store.ts";

type SupporterFile = { version: 1; address: string; privateKey: string; createdAt: string };

type SupportRecord = TxProgress & {
  version: 1;
  releaseId: string;
  paymentId: string;
  amountWei: string;
  from: string;
  createdAt: string;
  receivedWei?: string;
};

const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const MONAD_RESERVE_WEI = parseEther("10");
const releaseInterface = new Interface(releaseAbi);
const store = fileNightWatchStore();
const walletPath = join(store.root, "wallets", "supporter.json");
const command = process.argv[2];

function option(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
}

async function readSupporter(): Promise<SupporterFile | null> {
  try {
    const file = JSON.parse(await readFile(walletPath, "utf8")) as SupporterFile;
    if (file.version !== 1 || !/^0x[0-9a-fA-F]{64}$/.test(file.privateKey)) throw new Error("The supporter wallet file is not readable. Nothing was sent.");
    return file;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function chain(): { config: ReleaseConfig; provider: JsonRpcProvider; client: ReleaseClient } {
  const config = releaseConfig();
  if (!config) throw new Error("The Monad release contract is not configured (NEXT_PUBLIC_MONAD_RELEASE_ADDRESS / NEXT_PUBLIC_MONAD_CURATOR_ADDRESS). Nothing was sent.");
  const provider = new JsonRpcProvider(config.rpcUrl, config.chainId, { staticNetwork: true, batchMaxCount: 1 });
  return { config, provider, client: new ReleaseClient(config, provider) };
}

async function init() {
  const existing = await readSupporter();
  if (existing) {
    console.log(`The supporter wallet already exists: ${existing.address}`);
    return;
  }
  const wallet = Wallet.createRandom();
  const file: SupporterFile = { version: 1, address: wallet.address, privateKey: wallet.privateKey, createdAt: new Date().toISOString() };
  await mkdir(dirname(walletPath), { recursive: true, mode: 0o700 });
  const handle = await open(walletPath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(file, null, 2)}\n`);
  } finally {
    await handle.close();
  }
  console.log(`Created the supporter wallet ${wallet.address} (key saved with mode 600, not printed).`);
  console.log("Next: send it a little test MON (the support amount plus about 0.02 MON for gas), then run status.");
}

async function status() {
  const supporter = await readSupporter();
  if (!supporter) {
    console.log("No supporter wallet yet. Run init.");
    return;
  }
  console.log(`Supporter: ${supporter.address}`);
  const { config, provider } = chain();
  try {
    const finalized = await finalizedBlockNumber(provider);
    const [latest, settled, nonce] = await Promise.all([
      provider.getBalance(supporter.address),
      finalized === null ? Promise.resolve(null) : provider.getBalance(supporter.address, finalized),
      provider.getTransactionCount(supporter.address, "latest"),
    ]);
    console.log(`Balance: ${formatEther(latest)} test MON (latest)${settled === null ? "" : `, ${formatEther(settled)} at finalized block ${finalized}`}; nonce ${nonce}`);
    console.log(`Release contract: ${config.address} on ${config.name}`);
    console.log(`Explorer: ${explorerAddress(supporter.address)}`);
  } finally {
    provider.destroy();
  }
  for (const name of await store.list("supporter")) {
    const record = await store.read<SupportRecord>(`supporter/${name}`);
    if (record) console.log(`Support ${record.releaseId.slice(0, 18)}…: ${formatEther(BigInt(record.amountWei))} test MON, ${record.state} — ${explorerTx(record.hash)}`);
  }
}

function supported(receipt: TransactionReceipt, contract: string): Partial<SupportRecord> {
  for (const log of receipt.logs) {
    if (getAddress(log.address) !== getAddress(contract)) continue;
    const parsed = releaseInterface.parseLog({ topics: [...log.topics], data: log.data });
    if (parsed?.name === "ReleaseSupported") return { receivedWei: (parsed.args[4] as bigint).toString() };
  }
  return {};
}

async function finish(provider: JsonRpcProvider, config: ReleaseConfig, record: SupportRecord, name: string) {
  const settled = await advance(provider, record, {
    from: record.from,
    save: (next) => store.write(name, next),
    fromReceipt: (receipt) => supported(receipt, config.address),
    receiptTimeoutMs: 60_000,
    finalizedTimeoutMs: 30_000,
  });
  console.log(`Support ${settled.state}: ${formatEther(BigInt(settled.amountWei))} test MON — ${explorerTx(settled.hash)}`);
  if (settled.receivedWei) console.log(`The release has now received ${formatEther(BigInt(settled.receivedWei))} test MON in total.`);
  if (settled.state === "failed") process.exitCode = 1;
  if (settled.state === "broadcast" || settled.state === "confirmed") console.log("Not final yet. Run the same command again to keep waiting; it re-sends the same signed transaction and never signs a second one.");
}

async function support() {
  const releaseId = option("release")?.toLowerCase();
  if (!releaseId || !BYTES32.test(releaseId)) throw new Error("Pass --release <0x… release id>. Nothing was sent.");
  const amountWei = supportAmount(option("amount") ?? "0.5");
  const confirm = process.argv.includes("--confirm");
  const supporter = await readSupporter();
  if (!supporter) throw new Error("No supporter wallet yet. Run init and fund it first. Nothing was sent.");
  const { config, provider, client } = chain();
  try {
    await client.verify();
    const wallet = new Wallet(supporter.privateKey, provider);
    const name = `supporter/${releaseId.slice(2, 18)}`;
    const saved = await store.read<SupportRecord>(name);
    if (saved && (saved.state === "signed" || saved.state === "broadcast" || saved.state === "confirmed")) {
      console.log(`Resuming the saved support ${saved.hash}; nothing new will be signed.`);
      if (confirm) await finish(provider, config, saved, name);
      else console.log("Add --confirm to re-send and wait for it.");
      return;
    }
    if (saved?.state === "finalized" && !process.argv.includes("--again")) {
      throw new Error(`This wallet already supported the release (${explorerTx(saved.hash)}). Pass --again to send another support. Nothing was sent.`);
    }

    const finalized = await finalizedBlockNumber(provider);
    if (finalized === null) throw new Error("Monad testnet did not report a finalized block. Nothing was sent.");
    const release = (await client.contract.getRelease(releaseId, { blockTag: finalized })) as [string, string, string, bigint, bigint, string[]];
    if (release[0] === ZeroHash) throw new Error("That release is not frozen at Monad's finalized block yet. Nothing was sent.");
    const balance = await provider.getBalance(wallet.address);
    if (balance <= amountWei) {
      throw new Error(`The supporter holds ${formatEther(balance)} test MON; it needs ${formatEther(amountWei)} plus gas. Fund ${wallet.address} first. Nothing was sent.`);
    }
    const paymentId = id(randomUUID());
    try {
      await client.contract.getFunction("supportRelease").staticCall(releaseId, paymentId, { value: amountWei, from: wallet.address });
    } catch (error) {
      const data = revertData(error);
      const reason = data ? releaseInterface.parseError(data)?.name : undefined;
      throw new Error(`The contract would refuse this support right now${reason ? ` (${reason})` : ""}. Nothing was sent.`);
    }
    const data = releaseInterface.encodeFunctionData("supportRelease", [releaseId, paymentId]);
    const prepared = await prepareCall(provider, wallet.address, { to: config.address, data, value: amountWei }, { chainId: config.chainId, gasMarginPercent: 10 });

    console.log(`Release ${releaseId} (${release[5].length} frozen recipients, ${formatEther(BigInt(release[3]))} test MON received so far)`);
    console.log(`Support: ${formatEther(amountWei)} test MON from ${wallet.address}; gas at most ${formatEther(prepared.maxCostWei - amountWei)} test MON`);
    if (prepared.balanceWei - prepared.maxCostWei < MONAD_RESERVE_WEI) {
      console.log("Note: Monad keeps a 10 MON reserve. A value transfer that leaves less than that can revert unless this wallet sent nothing in the previous few blocks.");
    }
    if (!confirm) {
      console.log("The contract accepts this support (static call). Nothing was sent. Add --confirm to send it.");
      return;
    }

    const raw = await wallet.signTransaction({
      type: 2,
      to: config.address,
      data,
      value: amountWei,
      chainId: config.chainId,
      nonce: prepared.nonce,
      gasLimit: prepared.gasLimit,
      maxFeePerGas: prepared.maxFeePerGas,
      maxPriorityFeePerGas: prepared.maxPriorityFeePerGas,
    });
    const at = new Date().toISOString();
    const record: SupportRecord = {
      version: 1,
      releaseId,
      paymentId,
      amountWei: amountWei.toString(),
      from: wallet.address,
      rawTransaction: raw,
      hash: Transaction.from(raw).hash!,
      nonce: prepared.nonce,
      state: "signed",
      createdAt: at,
      updatedAt: at,
    };
    // Saved before the first broadcast, so a rerun re-sends these bytes instead of paying twice.
    await store.write(name, record);
    await finish(provider, config, record, name);
  } finally {
    provider.destroy();
  }
}

try {
  if (command === "init") await init();
  else if (command === "status") await status();
  else if (command === "support") await support();
  else {
    console.error("Usage: night-watch-supporter init | status | support --release <id> [--amount 0.5] [--confirm] [--again]");
    process.exitCode = 2;
  }
} catch (error) {
  console.error(error instanceof MonadTxRefused ? error.message : errorText(error));
  process.exitCode = 1;
}
