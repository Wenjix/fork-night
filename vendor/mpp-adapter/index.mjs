// Isolated MPP adapter for the local, testnet-only Fork Night room top-up on Tempo Moderato.
// The only place mppx 0.13.4 and viem 2.57.3 are loaded for the MPP door: this folder has its own
// package.json and lockfile and is installed on its own, so the app's root dependency tree (viem 2.56.5,
// @x402/evm, Privy) never changes. src/mpp loads this file at run time, after the route's gate, through
// import(/* turbopackIgnore: true */ fileUrl). Only plain data and adapter-made objects cross the boundary;
// no viem object from the app ever reaches mppx, and no mppx object reaches the app.
import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import { Challenge, Credential, Errors, Receipt } from "mppx";
import { tempo as tempoClient } from "mppx/client";
import { Mppx, Store, tempo as tempoServer } from "mppx/server";
import { createClient, custom, http, keccak256, stringToBytes } from "viem";
import { generatePrivateKey as newPrivateKey, privateKeyToAccount } from "viem/accounts";
import { Transaction } from "viem/tempo";
import { tempoModerato } from "viem/tempo/chains";

export const adapterVersion = 1;
const installed = (name) => JSON.parse(readFileSync(new URL(`./node_modules/${name}/package.json`, import.meta.url), "utf8")).version;
/** The versions actually loaded; src/mpp refuses any other. */
export const versions = { mppx: installed("mppx"), viem: installed("viem") };
export const chainId = tempoModerato.id;
export const rpcUrl = tempoModerato.rpcUrls.default.http[0];

/** The caller's EIP-1193 request function (offline tests) or Moderato over HTTP, never retried and never redirected. */
const transportFor = (request) => (request
  ? custom({ request }, { retryCount: 0 })
  : http(rpcUrl, { retryCount: 0, timeout: 30_000, fetchOptions: { redirect: "error" } }));

/** viem's short message never repeats raw call arguments or the signed transaction. */
const shortMessage = (error) => String(error?.shortMessage ?? error?.message ?? error).split("\n")[0].slice(0, 300);

/** Plain data for any failure: what kind it is decides the door's answer, not the class identity. */
function classify(error) {
  const name = String(error?.name ?? "Error");
  const kind = error instanceof Errors.PaymentExpiredError ? "expired"
    : error instanceof Errors.PaymentError ? "payment"
    : name === "CallExecutionError" && /revert/i.test(shortMessage(error)) ? "revert"
    : "other";
  return { kind, name, message: shortMessage(error) };
}

export const keccakUtf8 = (value) => keccak256(stringToBytes(String(value)));

/** A signed Tempo transaction: sender, chain, deadline, sponsorship, calls and the hash it will have on chain. */
export async function decodeTransaction(signed) {
  const decoded = Transaction.deserialize(signed);
  const hash = keccak256(await Transaction.serialize(decoded));
  return {
    type: decoded.type ?? null,
    from: typeof decoded.from === "string" ? decoded.from : null,
    chainId: typeof decoded.chainId === "number" ? decoded.chainId : null,
    validBefore: Number.isInteger(decoded.validBefore) ? decoded.validBefore : null,
    // Any fee-payer slot counts, including the null "a fee payer will sign" form: ox then reads `from` from the
    // envelope instead of recovering it from the signature.
    sponsored: decoded.feePayerSignature !== undefined,
    calls: (decoded.calls ?? []).map((call) => ({ to: call.to ?? null, data: call.data ?? "0x" })),
    hash: hash.toLowerCase(),
  };
}

/** Null when the header has no Payment scheme; throws when the credential cannot be decoded. */
export function readCredential(authorization) {
  const scheme = Credential.extractPaymentScheme(String(authorization));
  return scheme ? Credential.deserialize(scheme) : null;
}

/** The first Payment challenge of a WWW-Authenticate value; throws when there is none. */
export const parseChallengeHeader = (header) => Challenge.deserialize(String(header));

/** Payment-Receipt as plain data, or null. */
export function readReceiptHeader(header) {
  try { return header ? Receipt.deserialize(header) : null; } catch { return null; }
}

/**
 * The door's seller: one pull-mode Tempo charge in one currency, no fee sponsor, an explicit realm and
 * no route scope. mppx's stock request handler is never used: validate and broadcast are called apart,
 * so the door can write its intent in between. A transport hook records whether the transaction left
 * this process, the only reliable sign that a failure may have moved money.
 */
export function createChargeServer({ secretKey, realm, currency, recipient, chainId: expected, request }) {
  if (expected !== chainId) throw new Error(`The MPP adapter serves Tempo Moderato (${chainId}) only.`);
  const attempts = new AsyncLocalStorage();
  const forward = transportFor(request)({ chain: tempoModerato, retryCount: 0 }).request;
  const transport = custom({
    async request({ method, params }) {
      if (method === "eth_sendRawTransactionSync" || method === "eth_sendRawTransaction") {
        const attempt = attempts.getStore();
        const raw = Array.isArray(params) ? params[0] : undefined;
        if (attempt) {
          attempt.attempted = true;
          attempt.sentHash = typeof raw === "string" ? keccak256(raw).toLowerCase() : null;
        }
      }
      return forward({ method, params });
    },
  }, { retryCount: 0 });
  const client = createClient({ chain: tempoModerato, transport });
  const mppx = Mppx.create({
    secretKey,
    realm,
    methods: [tempoServer.charge({
      currencies: [currency],
      recipient,
      chainId,
      testnet: true,
      supportedModes: ["pull"],
      waitForConfirmation: true,
      // Replay markers only; the door's write-once records decide every outcome.
      store: Store.memory(),
      getClient: ({ chainId: id } = {}) => {
        if (id !== undefined && id !== chainId) throw new Error(`Chain ${id} is not Tempo Moderato.`);
        return client;
      },
    })],
  });
  return {
    /** expires defaults to mppx's five minutes; tests pass a past expiry to exercise the expired path. */
    async challenge({ amount, meta, expires }) {
      const challenge = await mppx.challenge.tempo.charge({ amount, meta, ...(expires ? { expires } : {}) });
      return { header: Challenge.serialize(challenge), id: challenge.id, expires: challenge.expires ?? null };
    },
    verifyChallenge(challenge) {
      try { return Challenge.verify(challenge, { secretKey }); } catch { return false; }
    },
    async validate(credential, options) {
      try {
        await mppx.validateCredential(credential, options);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: classify(error) };
      }
    },
    async broadcast(credential, options) {
      const attempt = { attempted: false, sentHash: null };
      try {
        const receipt = await attempts.run(attempt, () => mppx.broadcastCredential(credential, options));
        return {
          ok: true,
          reference: String(receipt.reference ?? "").toLowerCase(),
          status: String(receipt.status ?? ""),
          receipt: { ...receipt },
          receiptHeader: Receipt.serialize(receipt),
          ...attempt,
        };
      } catch (error) {
        return { ok: false, error: classify(error), ...attempt };
      }
    },
  };
}

/**
 * The public Moderato faucet: JSON-RPC tempo_fundAddress mints test pathUSD, alphaUSD, betaUSD, thetaUSD and OUSD
 * to the address (testnet only; no key or sign-up). Returns the faucet's transaction hashes.
 */
export async function faucet({ address, request }) {
  const client = createClient({ chain: tempoModerato, transport: transportFor(request) });
  const result = await client.request({ method: "tempo_fundAddress", params: [address] });
  return (Array.isArray(result) ? result : [result]).filter((hash) => typeof hash === "string" && /^0x[0-9a-fA-F]{64}$/.test(hash));
}

const ACCOUNT = Symbol("fork-night-mpp-account");

/** A throwaway testnet key, generated here so the app's own viem is never used for Tempo. */
export const generatePrivateKey = () => newPrivateKey();
/** The address of a private key; throws for an invalid key without quoting it. */
export function addressOf(privateKey) {
  try { return privateKeyToAccount(privateKey).address; } catch { throw new Error("not a valid secp256k1 private key"); }
}
/** An opaque signer for createPayment: viem keeps the key in a closure; only the address is visible. Errors never quote the key. */
export function accountFromKey(privateKey) {
  let account;
  try { account = privateKeyToAccount(privateKey); } catch { throw new Error("not a valid secp256k1 private key"); }
  return Object.freeze({ address: account.address, [ACCOUNT]: account });
}

/**
 * The patron agent's signature: exactly one pull-mode transfer for this challenge, pinned to Moderato and
 * the expected recipient. mppx does not broadcast it; the door does. mppx.fetch is never used.
 */
export async function createPayment({ account, challenge, expectedRecipient, request }) {
  const signer = account?.[ACCOUNT];
  if (!signer) throw new Error("Pass an account made by accountFromKey.");
  const client = createClient({ chain: tempoModerato, transport: transportFor(request) });
  const method = tempoClient.charge({
    account: signer,
    expectedChainId: chainId,
    allowedChainIds: [chainId],
    expectedRecipients: [expectedRecipient],
    mode: "pull",
    getClient: () => client,
  });
  const credential = await method.createCredential({ challenge, context: {} });
  const payload = Credential.deserialize(credential).payload;
  if (payload?.type !== "transaction" || typeof payload.signature !== "string")
    throw new Error("mppx did not produce a pull-mode transaction credential.");
  const decoded = await decodeTransaction(payload.signature);
  return { credential, transaction: decoded.hash, validBefore: decoded.validBefore, payer: signer.address };
}
