// Privy setup and checks for the local Night Watch. Testnet only; never prints secrets.
//
//   npm run night-watch:privy -- setup       # authorization key (mode 600), key quorum, claim helper wallet + policy
//   npm run night-watch:privy -- check       # reads back every resource and the helper's test MON balance
//   npm run night-watch:privy -- refusals --session <id>
//                                            # asks Privy to sign out-of-policy transfers; nothing is broadcast
import { randomBytes } from "node:crypto";
import { JsonRpcProvider, formatEther, getAddress } from "ethers";
import { releaseConfig } from "../src/lib/onchain/config.ts";
import { claimHelperPolicy, TRANSFER_WITH_AUTHORIZATION_TYPES } from "../src/privy/policy.ts";

// ERC-8004 IdentityRegistry on Monad testnet (the mainnet address in Monad's guide has no code there).
const IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
import { createPrivyRest, PrivyApiError, type EthereumTypedData } from "../src/privy/rest.ts";
import { authorizationKey, privyCredentials, readPrivySetup, SETUP_RECORD, type PrivySetup } from "../src/night-watch/privy-setup.ts";
import { sessionPath, type DelegationSession } from "../src/night-watch/session.ts";
import { fileNightWatchStore } from "../src/night-watch/store.ts";

const command = process.argv[2];
const store = fileNightWatchStore();
const credentials = privyCredentials();
if (!credentials) {
  console.error("Set NEXT_PUBLIC_PRIVY_APP_ID and PRIVY_APP_SECRET in .env.local first. Nothing was changed.");
  process.exit(2);
}
const privy = createPrivyRest(credentials);

function option(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
}

async function setup() {
  const key = await authorizationKey(store, { create: true });
  console.log(key.created ? "Created the Night Watch authorization key (mode 600, not printed)." : "Using the existing Night Watch authorization key.");
  let record = await readPrivySetup(store);
  if (record && record.publicKey !== key.publicKey) throw new Error("The saved key quorum belongs to a different authorization key. Stop and check .local/night-watch/privy.");
  if (!record) {
    const quorum = await privy.createKeyQuorum({ publicKeys: [key.publicKey], threshold: 1, displayName: "Fork Night Night Watch" });
    record = { version: 1, appId: credentials!.appId, keyQuorumId: quorum.id, publicKey: key.publicKey, createdAt: new Date().toISOString() };
    await store.write(SETUP_RECORD, record);
    console.log(`Registered key quorum ${quorum.id}.`);
  } else {
    console.log(`Key quorum ${record.keyQuorumId} already registered.`);
  }
  const release = releaseConfig();
  if (!release) throw new Error("The Monad release contract is not configured (NEXT_PUBLIC_MONAD_RELEASE_ADDRESS / NEXT_PUBLIC_MONAD_CURATOR_ADDRESS).");
  if (!record.claimHelper) {
    const policy = await privy.createPolicy({ ...claimHelperPolicy({ chainId: release.chainId, releaseContract: release.address, identityRegistry: IDENTITY_REGISTRY }), owner_id: record.keyQuorumId });
    const wallet = await privy.createWallet({ owner_id: record.keyQuorumId, policy_ids: [policy.id], idempotencyKey: `nw-claim-helper-${record.keyQuorumId}` });
    record = { ...record, claimHelper: { walletId: wallet.id, address: getAddress(wallet.address), policyId: policy.id, createdAt: new Date().toISOString() } };
    await store.write(SETUP_RECORD, record);
    console.log(`Created the claim helper wallet ${record.claimHelper!.address} with policy ${policy.id}.`);
  } else {
    console.log(`Claim helper wallet ${record.claimHelper.address} already exists.`);
  }
  console.log("Next: fund the claim helper with a little test MON for gas, then run the check.");
}

async function check() {
  const record = await readPrivySetup(store);
  if (!record) throw new Error("Run setup first.");
  const key = await authorizationKey(store);
  const rows: [string, boolean, string][] = [];
  rows.push(["authorization key matches the saved quorum key", key.publicKey === record.publicKey, ""]);
  const quorum = await privy.getKeyQuorum(record.keyQuorumId).catch((error) => error as Error);
  rows.push(["key quorum readable", !(quorum instanceof Error), quorum instanceof Error ? quorum.message : record.keyQuorumId]);
  if (record.claimHelper) {
    const wallet = await privy.getWallet(record.claimHelper.walletId).catch((error) => error as Error);
    const ok = !(wallet instanceof Error) && getAddress(wallet.address) === record.claimHelper.address && wallet.owner_id === record.keyQuorumId &&
      (wallet.policy_ids ?? []).includes(record.claimHelper.policyId);
    rows.push(["claim helper owned by the quorum with its policy", ok, wallet instanceof Error ? wallet.message : `${wallet.address} owner ${wallet.owner_id}`]);
    const release = releaseConfig();
    if (release) {
      const provider = new JsonRpcProvider(release.rpcUrl, undefined, { batchMaxCount: 1 });
      const balance = await provider.getBalance(record.claimHelper.address);
      rows.push(["claim helper holds test MON for gas", balance >= 10n ** 16n, `${formatEther(balance)} MON`]);
    }
  } else {
    rows.push(["claim helper created", false, "run setup"]);
  }
  for (const [label, ok, detail] of rows) console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (rows.some(([, ok]) => !ok)) process.exitCode = 1;
}

/** Each case asks Privy to sign one out-of-policy authorization. A signature would mean the policy is too wide. */
async function refusals() {
  const id = option("session");
  if (!id) throw new Error("Pass --session <id>.");
  const session = await store.read<DelegationSession>(sessionPath(id));
  if (!session) throw new Error("No such session.");
  const key = await authorizationKey(store);
  const now = Math.floor(Date.now() / 1000);
  const base = (): EthereumTypedData => ({
    domain: { name: "USDC", version: "2", chainId: session.limits.chainId, verifyingContract: session.limits.token },
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primary_type: "TransferWithAuthorization",
    message: {
      from: session.privy.walletAddress,
      to: session.limits.payTo,
      value: session.limits.maxPaymentAtomic,
      validAfter: "0",
      validBefore: String(now + 60),
      nonce: `0x${randomBytes(32).toString("hex")}`,
    },
  });
  const cases: [string, (data: EthereumTypedData) => EthereumTypedData][] = [
    ["recipient other than the room door", (d) => ({ ...d, message: { ...d.message, to: "0x000000000000000000000000000000000000dEaD" } })],
    ["token other than test USDC", (d) => ({ ...d, domain: { ...d.domain, verifyingContract: "0x4200000000000000000000000000000000000006" } })],
    ["amount above the single-payment cap", (d) => ({ ...d, message: { ...d.message, value: (BigInt(session.limits.maxPaymentAtomic) + 1n).toString() } })],
    ["another chain", (d) => ({ ...d, domain: { ...d.domain, chainId: 8453 } })],
    ["authorization outliving the session", (d) => ({ ...d, message: { ...d.message, validBefore: String(Math.floor(Date.parse(session.deadline) / 1000) + 3_600) } })],
  ];
  let failures = 0;
  for (const [label, mutate] of cases) {
    try {
      await privy.signTypedData(session.privy.walletId, mutate(base()), [key.privateKey]);
      failures += 1;
      console.log(`FAIL  ${label}: Privy signed it (the signature was discarded, never sent).`);
    } catch (error) {
      const refused = error instanceof PrivyApiError && error.status >= 400 && error.status < 500;
      if (!refused) failures += 1;
      console.log(`${refused ? "PASS" : "FAIL"}  ${label}: ${error instanceof Error ? error.message.slice(0, 160) : String(error)}`);
    }
  }
  // A different method entirely: the policy allows only typed data, so a plain message is refused too.
  try {
    await privy.rpc(session.privy.walletId, { method: "personal_sign", params: { message: "Night Watch refusal check", encoding: "utf-8" } }, [key.privateKey]);
    failures += 1;
    console.log("FAIL  personal_sign: Privy signed it (the signature was discarded).");
  } catch (error) {
    const refused = error instanceof PrivyApiError && error.status >= 400 && error.status < 500;
    if (!refused) failures += 1;
    console.log(`${refused ? "PASS" : "FAIL"}  another signing method: ${error instanceof Error ? error.message.slice(0, 160) : String(error)}`);
  }
  console.log(failures ? `${failures} case(s) were not refused.` : "Every out-of-policy request was refused. Nothing was broadcast.");
  if (failures) process.exitCode = 1;
}

try {
  if (command === "setup") await setup();
  else if (command === "check") await check();
  else if (command === "refusals") await refusals();
  else {
    console.error("Usage: night-watch-privy setup | check | refusals --session <id>");
    process.exitCode = 2;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
