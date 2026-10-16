// Hosted Wren's scoped signer. The reviewed general adapter and its pins stay
// unchanged. Imports resolve only through this folder's pinned dependency tree.
import { Credential } from "mppx";
import { tempo as tempoClient } from "mppx/client";
import { createClient, custom, decodeFunctionData, http } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import { getBlock, getTransaction, getTransactionReceipt, readContract } from "viem/actions";
import { Abis, Account, Actions, Addresses } from "viem/tempo";
import { tempoModerato } from "viem/tempo/chains";
import { decodeTransaction } from "./index.mjs";

const PATHUSD = "0x20c0000000000000000000000000000000000000";
const STEWARD = "0x951c8D90d0D1e81351ED802178823C60cce3BD98";
const PAY_TO = "0x3B02f4be77C010d872Ace7149051003AB9855Ca1";
const SELECTOR = "0x95777d59";
const same = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();

function exactScopes(scopes) {
  if (!Array.isArray(scopes) || scopes.length !== 1 || !same(scopes[0].target, PATHUSD)) return false;
  const rules = scopes[0].selectorRules;
  return Array.isArray(rules) && rules.length === 1 && same(rules[0].selector, SELECTOR)
    && Array.isArray(rules[0].recipients) && rules[0].recipients.length === 1 && same(rules[0].recipients[0], PAY_TO);
}

/** Pure checks run before any signer is created or RPC request is made. */
export function assertWrenChallenge(challenge, policy, now = Date.now()) {
  const expires = Date.parse(String(challenge?.expires ?? ""));
  const request = challenge?.request ?? {}, details = request.methodDetails ?? {};
  if (challenge?.realm !== "fork-night-mpp-door" || challenge.method !== "tempo" || challenge.intent !== "charge"
      || details.chainId !== 42431 || request.amount !== "1000000" || !same(request.currency, PATHUSD)
      || !same(request.recipient, PAY_TO) || JSON.stringify(details.supportedModes) !== '["pull"]'
      || details.feePayer || details.splits || !Number.isFinite(expires) || expires <= now || expires > now + 15 * 60000)
    throw new Error("The offer is outside Wren's fixed testnet payment scope.");
  const authorized = Date.parse(policy.authorized_at), expiry = Date.parse(policy.expires_at);
  if (policy.enabled !== true || policy.room_id !== "kessler-ward" || policy.network !== "eip155:42431"
      || !same(policy.steward, STEWARD) || !same(policy.pay_to, PAY_TO) || !same(policy.currency, PATHUSD)
      || policy.allowance_atomic !== 2000000 || policy.period_seconds !== 86400 || policy.topups_per_day !== 1
      || !Number.isFinite(authorized) || !Number.isFinite(expiry) || authorized > now || expiry <= now || expiry > authorized + 86400000)
    throw new Error("Wren has no current fixed testnet allowance.");
}

/**
 * Reads the original confirmed authorization and current keychain state before
 * signing. The operator must authorize a new scoped key explicitly; this module
 * has no root wallet, authorization, faucet, renewal or broadcast function.
 */
export async function createWrenPayment({ key, policy, challenge, request, now = Date.now() }) {
  assertWrenChallenge(challenge, policy, now);
  let keyAddress;
  try { keyAddress = privateKeyToAddress(key); } catch { throw new Error("Wren's scoped signer is unavailable."); }
  if (!same(keyAddress, policy.access_key)) throw new Error("Wren's signer does not match the authorized access key.");
  const transport = request ? custom({ request }, { retryCount: 0 })
    : http("https://rpc.moderato.tempo.xyz", { retryCount: 0, timeout: 30000, fetchOptions: { redirect: "error" } });
  const client = createClient({ chain: tempoModerato.extend({ feeToken: PATHUSD }), transport });
  const [metadata, limit, scope, authorization, receipt] = await Promise.all([
    Actions.accessKey.getMetadata(client, { account: STEWARD, accessKey: keyAddress }),
    Actions.accessKey.getRemainingLimit(client, { account: STEWARD, accessKey: keyAddress, token: PATHUSD }),
    readContract(client, { address: Addresses.accountKeychain, abi: Abis.accountKeychain,
      functionName: "getAllowedCalls", args: [STEWARD, keyAddress] }),
    getTransaction(client, { hash: policy.authorization_tx }),
    getTransactionReceipt(client, { hash: policy.authorization_tx }),
  ]);
  if (!same(metadata.address, keyAddress) || metadata.keyType !== "secp256k1" || metadata.isRevoked
      || metadata.spendPolicy !== "limited" || Number(metadata.expiry) * 1000 !== Date.parse(policy.expires_at)
      || Number(metadata.expiry) * 1000 <= now || limit.remaining <= 1000000n || limit.remaining > 2000000n
      || !limit.periodEnd || Number(limit.periodEnd) * 1000 <= now || Number(limit.periodEnd) * 1000 > now + 86400000
      || !scope[0] || !exactScopes(scope[1]))
    throw new Error("The live access key cannot cover this exact payment and its fees.");
  if (receipt.status !== "success" || !same(receipt.from, STEWARD) || !same(authorization.from, STEWARD))
    throw new Error("Wren's original allowance authorization could not be confirmed.");
  const authorizationBlock = await getBlock(client, { blockHash: receipt.blockHash });
  const minedAt = Number(authorizationBlock.timestamp) * 1000;
  if (!Number.isFinite(minedAt) || Date.parse(policy.expires_at) > minedAt + 86400000
      || Math.abs(Date.parse(policy.authorized_at) - minedAt) > 60000)
    throw new Error("The original allowance was not authorized for this exact 24-hour window.");
  const calls = authorization.calls ?? [{ to: authorization.to, data: authorization.input }];
  const grants = calls.filter((call) => same(call.to, Addresses.accountKeychain)).flatMap((call) => {
    try {
      const decoded = decodeFunctionData({ abi: Abis.accountKeychain, data: call.data ?? call.input });
      return decoded.functionName === "authorizeKey" ? [decoded.args] : [];
    } catch { return []; }
  });
  const grant = grants.find((args) => same(args[0], keyAddress));
  const config = grant?.[2], limits = config?.limits;
  if (!grant || grant[1] !== 0 || typeof config !== "object" || config.enforceLimits !== true
      || Number(config.expiry) * 1000 !== Date.parse(policy.expires_at) || config.allowAnyCalls !== false
      || !Array.isArray(limits) || limits.length !== 1 || !same(limits[0].token, PATHUSD)
      || limits[0].amount !== 2000000n || Number(limits[0].period) !== 86400 || !exactScopes(config.allowedCalls))
    throw new Error("The recorded authorization does not prove the unchanged 2.00 daily scoped allowance.");
  const account = Account.fromSecp256k1(key, { access: STEWARD });
  const credential = await tempoClient.charge({
    account, mode: "pull", expectedChainId: 42431, allowedChainIds: [42431], expectedRecipients: [PAY_TO], getClient: () => client,
  }).createCredential({ challenge, context: {} });
  const payload = Credential.deserialize(credential).payload;
  if (!credential.startsWith("Payment ") || payload?.type !== "transaction" || typeof payload.signature !== "string")
    throw new Error("Wren did not produce one pull-mode payment.");
  const decoded = await decodeTransaction(payload.signature);
  if (!same(decoded.from, STEWARD) || decoded.chainId !== 42431 || decoded.sponsored || decoded.calls.length !== 1)
    throw new Error("Wren did not produce the fixed testnet transfer.");
  return credential;
}
