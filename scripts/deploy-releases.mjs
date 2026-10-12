import { readFile, mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { ContractFactory, FetchRequest, getAddress, getCreateAddress, JsonRpcProvider, keccak256, Wallet, ZeroAddress } from "ethers";
import { compileContracts } from "./compile-contracts.mjs";

export function resolveDeploymentCurator(deployerAddress, configuredAddress) {
  let curator;
  try { curator = getAddress(configuredAddress?.trim() || deployerAddress); }
  catch { throw new Error("NEXT_PUBLIC_MONAD_CURATOR_ADDRESS must be a valid Ethereum address."); }
  if (curator === ZeroAddress) throw new Error("NEXT_PUBLIC_MONAD_CURATOR_ADDRESS cannot be the zero address.");
  return curator;
}

async function main() {
  const privateKey = process.env.MONAD_DEPLOYER_PRIVATE_KEY;
  if (!privateKey) throw new Error("Set MONAD_DEPLOYER_PRIVATE_KEY locally to a funded Monad testnet wallet. Never paste it into chat or public configuration.");
  let signer;
  try { signer = new Wallet(privateKey); } catch { throw new Error("The local deployer key is invalid."); }
  const curator = resolveDeploymentCurator(signer.address, process.env.NEXT_PUBLIC_MONAD_CURATOR_ADDRESS);
  const artifact = await compileContracts();
  const request = new FetchRequest(process.env.MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz");
  request.timeout = 10000;
  const provider = new JsonRpcProvider(request);
  try {
    const chainId = (await provider.getNetwork()).chainId;
    if (chainId !== 10143n) throw new Error("Deployment is restricted to Monad testnet (10143).");
    const wallet = signer.connect(provider);
    const factory = new ContractFactory(artifact.abi, artifact.bytecode, wallet);
    const predicted = await factory.getDeployTransaction();
    const gas = await provider.estimateGas({ ...predicted, from: wallet.address });
    const fees = await provider.getFeeData();
    const feeCap = fees.maxFeePerGas ?? fees.gasPrice;
    if (feeCap === null || await provider.getBalance(wallet.address) < gas * feeCap) throw new Error("The deployer wallet needs enough test MON for deployment gas.");
    const nonce = await provider.getTransactionCount(wallet.address, "pending");
    const intended = { chainId: 10143, deployer: wallet.address, curator, nonce, predictedAddress: getCreateAddress({ from: wallet.address, nonce }), runtimeHash: keccak256(artifact.deployedBytecode) };
    await mkdir(".local/contracts", { recursive: true });
    await writeFile(".local/contracts/monad-deployment.pending.json", JSON.stringify(intended, null, 2) + "\n", { flag: "wx" });
    const contract = await factory.deploy({ nonce });
    const submitted = { ...intended, transactionHash: contract.deploymentTransaction().hash };
    await writeFile(".local/contracts/monad-deployment.pending.json", JSON.stringify(submitted, null, 2) + "\n");
    const receipt = await contract.deploymentTransaction().wait(1, 60000);
    if (!receipt || receipt.status !== 1) throw new Error("Deployment is unconfirmed. Check the deployer's wallet history before retrying.");
    const address = await contract.getAddress();
    const runtimeHash = keccak256(await provider.getCode(address));
    if (runtimeHash !== keccak256(artifact.deployedBytecode)) throw new Error("The deployed bytecode did not match the compiled contract.");
    const record = { chainId: 10143, address, curator, transactionHash: receipt.hash,
      blockNumber: receipt.blockNumber, compiler: artifact.compiler, runtimeHash, gasUsed: receipt.gasUsed.toString(), sourceVerification: "pending" };
    await mkdir(".local/contracts", { recursive: true });
    await writeFile(".local/contracts/monad-deployment.json", JSON.stringify(record, null, 2) + "\n", { flag: "wx" });
    // Public addresses only. Existing application secrets/configuration are never edited by this script.
    await writeFile(".local/contracts/public-settings.env", `NEXT_PUBLIC_MONAD_CHAIN_ID=10143\nNEXT_PUBLIC_MONAD_RELEASE_ADDRESS=${address}\nNEXT_PUBLIC_MONAD_CURATOR_ADDRESS=${curator}\n`, { flag: "wx" });
    console.log(JSON.stringify(record, null, 2));
  } finally { provider.destroy(); }
}
// A prior deployment receipt stops a repeat before a new wallet transaction is created.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
try {
  let existing;
  try { existing = await readFile(".local/contracts/monad-deployment.json", "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
  let pending;
  try { pending = await readFile(".local/contracts/monad-deployment.pending.json", "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (existing || pending) throw new Error("A deployment intent or receipt already exists. Review its predicted address and transaction before creating another contract.");
  await main();
} catch (error) {
  const safe = error instanceof Error && !error.code ? error.message : "Deployment did not complete. Check the network, local wallet configuration and test MON balance; inspect wallet history before retrying.";
  console.error(safe);
  process.exitCode = 1;
}
}
