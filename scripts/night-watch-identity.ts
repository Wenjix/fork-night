// The Night Watch's ERC-8004 identity on Monad testnet. Testnet only; never prints secrets.
//
//   node --env-file-if-exists=.env.local scripts/night-watch-identity.ts plan
//        # prints the registration file and a gas estimate; sends nothing
//   node --env-file-if-exists=.env.local scripts/night-watch-identity.ts register --confirm [--steward <name>]
//        # the claim helper's Privy wallet signs register(agentURI) once; this machine broadcasts it.
//        # Refuses when a registration is already saved and final; resumes one still in flight.
//   node --env-file-if-exists=.env.local scripts/night-watch-identity.ts status
import { formatEther, formatUnits } from "ethers";
import { createPrivyRest, PrivyApiError } from "../src/privy/rest.ts";
import {
  IDENTITY_NOTE,
  IDENTITY_REGISTRY,
  IdentityRefused,
  monadProvider,
  planIdentity,
  readIdentity,
  readIdentityRecord,
  registerIdentity,
} from "../src/night-watch/identity.ts";
import { errorText, explorerTx, MonadTxRefused } from "../src/night-watch/monad-tx.ts";
import { authorizationKey, privyCredentials, readPrivySetup } from "../src/night-watch/privy-setup.ts";
import { fileNightWatchStore } from "../src/night-watch/store.ts";

const command = process.argv[2];
const store = fileNightWatchStore();

function option(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
}

async function plan() {
  const provider = monadProvider();
  try {
    const helper = (await readPrivySetup(store))?.claimHelper?.address ?? null;
    const planned = await planIdentity(provider, helper);
    console.log("Registration file (sent as a base64 data: URI in register(agentURI)):");
    console.log(JSON.stringify(planned.file, null, 2));
    console.log(`agentURI: ${planned.agentURI.length} characters`);
    console.log(`Registry: ${IDENTITY_REGISTRY} on Monad testnet (chain ${planned.chainId})`);
    console.log(`From: ${helper ?? "(no claim helper yet; run night-watch-privy setup) — estimated without a sender"}`);
    console.log(
      `Gas: estimate ${planned.gasEstimate}, limit ${planned.gasLimit} at up to ${formatUnits(planned.maxFeePerGas, "gwei")} gwei, so at most ${formatEther(planned.maxCostWei)} test MON (Monad charges the whole limit)`,
    );
    if (planned.balanceWei !== null) {
      const enough = planned.balanceWei >= planned.maxCostWei;
      console.log(`Helper balance: ${formatEther(planned.balanceWei)} test MON${enough ? "" : " — not enough; fund the helper before registering"}`);
    }
    const saved = await readIdentityRecord(store);
    if (saved) console.log(`Saved registration: ${saved.state}${saved.agentId ? `, agent ${saved.agentId}` : ""} — ${explorerTx(saved.hash)}`);
    console.log("Nothing was sent.");
  } finally {
    provider.destroy();
  }
}

async function register() {
  if (!process.argv.includes("--confirm")) {
    console.error("Add --confirm to register. Run plan first to see exactly what will be sent. Nothing was sent.");
    process.exitCode = 2;
    return;
  }
  const credentials = privyCredentials();
  if (!credentials) throw new Error("Set NEXT_PUBLIC_PRIVY_APP_ID and PRIVY_APP_SECRET in .env.local first. Nothing was sent.");
  const setup = await readPrivySetup(store);
  if (!setup?.claimHelper) throw new Error("The claim helper wallet is not set up. Run night-watch-privy setup first. Nothing was sent.");
  const key = await authorizationKey(store);
  if (key.publicKey !== setup.publicKey) throw new Error("The saved key quorum belongs to a different authorization key. Nothing was sent.");
  const provider = monadProvider();
  try {
    const record = await registerIdentity({
      store,
      provider,
      signer: { walletId: setup.claimHelper.walletId, address: setup.claimHelper.address, authorizationKey: key.privateKey, privy: createPrivyRest(credentials) },
      steward: option("steward"),
      timing: { receiptTimeoutMs: 60_000, finalizedTimeoutMs: 30_000 },
    });
    console.log(`Registration ${record.state}${record.agentId ? `: agent ${record.agentId}` : ""} — ${explorerTx(record.hash)}`);
    if (record.state === "broadcast" || record.state === "confirmed") console.log("Not final yet. Run register --confirm again to keep waiting; it never signs a second registration.");
    if (record.state === "failed") process.exitCode = 1;
    console.log(IDENTITY_NOTE);
  } finally {
    provider.destroy();
  }
}

async function status() {
  const provider = monadProvider();
  try {
    const helperAddress = (await readPrivySetup(store))?.claimHelper?.address ?? null;
    const identity = await readIdentity({ store, provider, helperAddress });
    console.log(JSON.stringify({ ...identity, agentURI: identity.agentURI ? `${identity.agentURI.slice(0, 48)}…` : null }, null, 2));
  } finally {
    provider.destroy();
  }
}

try {
  if (command === "plan") await plan();
  else if (command === "register") await register();
  else if (command === "status") await status();
  else {
    console.error("Usage: night-watch-identity plan | register --confirm [--steward <name>] | status");
    process.exitCode = 2;
  }
} catch (error) {
  if (error instanceof PrivyApiError && error.policyDenied) {
    console.error(`Privy refused to sign: ${error.message}. The claim helper's policy must allow register() on ${IDENTITY_REGISTRY}. Nothing was sent.`);
  } else {
    console.error(error instanceof IdentityRefused || error instanceof MonadTxRefused ? error.message : errorText(error));
  }
  process.exitCode = 1;
}
