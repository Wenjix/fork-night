import { test } from "node:test";
import assert from "node:assert/strict";
import { createPublicKey, generateKeyPairSync, verify, type KeyObject } from "node:crypto";
import { getAddress } from "viem";
import {
  claimHelperPolicy,
  denyAllPolicyRules,
  IDENTITY_REGISTER_ABI,
  nightWatchSessionPolicy,
  RELEASE_CLAIM_ABI,
  toPrivyTransferTypedData,
  TRANSFER_WITH_AUTHORIZATION_TYPES,
} from "../../src/privy/policy.ts";
import {
  authorizationSignature,
  canonicalJson,
  createPrivyRest,
  generateAuthorizationKey,
  parseAuthorizationKey,
  PrivyApiError,
  type EthereumTypedData,
  type SignedMethod,
} from "../../src/privy/rest.ts";
import { DelegationRefused, privyX402Signer, type DelegatedTransferBounds } from "../../src/privy/x402-signer.ts";
import { BASE_SEPOLIA, MAX_TIMEOUT_SECONDS, TESTNET_USDC } from "../../src/x402/ids.ts";

// Public test addresses only; nothing here reaches Privy or a chain.
const WALLET = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const PAY_TO = "0x4A6DE1347E9b2E466e5EAe6ba18dd63d7080BfdE";
const OTHER = "0x000000000000000000000000000000000000dEaD";
const TOKEN = TESTNET_USDC[BASE_SEPOLIA];
const NOW = 1_800_000_000;
const NONCE = `0x${"AB".repeat(32)}`;
const SIGNATURE = `0x${"12".repeat(65)}`;
const APP = { appId: "app-night-watch", appSecret: "secret-not-real" };

const spkiOf = (publicKey: string) => createPublicKey({ key: Buffer.from(publicKey, "base64"), format: "der", type: "spki" });

/** The payload Privy documents for `privy-authorization-signature`, rebuilt independently of rest.ts. */
function signedPayload(request: { method: string; url: string; body: unknown; appId: string; idempotencyKey?: string }) {
  const headers: Record<string, string> = { "privy-app-id": request.appId };
  if (request.idempotencyKey) headers["privy-idempotency-key"] = request.idempotencyKey;
  return Buffer.from(canonicalJson({ version: 1, method: request.method, url: request.url.replace(/\/+$/, ""), body: request.body, headers }));
}

/** The request an x402 v2 client hands its signer: bigints, and no EIP712Domain entry in `types`. */
function x402Request() {
  return {
    domain: { name: "USDC", version: "2", chainId: 84532, verifyingContract: TOKEN } as Record<string, unknown>,
    types: { TransferWithAuthorization: TRANSFER_WITH_AUTHORIZATION_TYPES.TransferWithAuthorization.map((field) => ({ ...field })) } as Record<string, unknown>,
    primaryType: "TransferWithAuthorization",
    message: {
      from: WALLET.toLowerCase(),
      to: PAY_TO.toLowerCase(),
      value: 1_000_000n,
      validAfter: 0n,
      validBefore: BigInt(NOW + MAX_TIMEOUT_SECONDS),
      nonce: NONCE,
    } as Record<string, unknown>,
  };
}
type X402Request = ReturnType<typeof x402Request>;

test("canonical JSON sorts keys at every depth, escapes like JSON and drops undefined members", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [1, { z: true, y: null }], c: "x" } }), '{"a":{"c":"x","d":[1,{"y":null,"z":true}]},"b":1}');
  // RFC 8785 orders by UTF-16 code units, not by insertion or numeric value.
  assert.equal(canonicalJson({ é: 5, a: 4, B: 3, "9": 2, "10": 1 }), '{"10":1,"9":2,"B":3,"a":4,"é":5}');
  assert.equal(
    canonicalJson({ s: 'quote " backslash \\ slash / newline \n tab \t bell \u0007 é  ' }),
    '{"s":"quote \\" backslash \\\\ slash / newline \\n tab \\t bell \\u0007 é  "}',
  );
  assert.equal(canonicalJson({ gone: undefined, list: [undefined, 1], kept: false }), '{"kept":false,"list":[null,1]}');
  assert.equal(canonicalJson([0, -0, 1e21, 0.1, 100, -5]), "[0,0,1e+21,0.1,100,-5]");
  assert.equal(canonicalJson(null), "null");
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, 1n]) {
    assert.throws(() => canonicalJson({ value }), TypeError, String(value));
  }
});

test("authorization keys are P-256 PKCS#8 with Privy's prefix, and parse to the SPKI key Privy registers", () => {
  const value = generateAuthorizationKey();
  assert.match(value, /^wallet-auth:[A-Za-z0-9+/=]+$/);
  const parsed = parseAuthorizationKey(value);
  assert.match(parsed.publicKey, /^MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE/, "base64 SPKI DER of a P-256 key");
  assert.equal(parseAuthorizationKey(value.slice("wallet-auth:".length)).publicKey, parsed.publicKey);
  assert.equal(parseAuthorizationKey(`  ${value}\n`).publicKey, parsed.publicKey);
  const secp256k1 = generateKeyPairSync("ec", { namedCurve: "secp256k1" }).privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
  assert.throws(() => parseAuthorizationKey(secp256k1), /P-256/);
});

test("an authorization signature verifies with the SPKI key and covers the method, URL, body, app and idempotency key", () => {
  const key = parseAuthorizationKey(generateAuthorizationKey());
  const spki = spkiOf(key.publicKey);
  const request = {
    method: "POST" as SignedMethod,
    url: "https://api.privy.io/v1/wallets/wallet-1/rpc",
    body: { method: "eth_signTypedData_v4", params: { b: 2, a: 1 } } as unknown,
    appId: APP.appId,
    idempotencyKey: "nw-sign-1" as string | undefined,
  };
  const signature = authorizationSignature(request, key.privateKey);
  assert.ok(verify("sha256", signedPayload(request), spki, Buffer.from(signature, "base64")));
  // A trailing slash is not part of the signed URL.
  const slashed = authorizationSignature({ ...request, url: `${request.url}/` }, key.privateKey);
  assert.ok(verify("sha256", signedPayload(request), spki, Buffer.from(slashed, "base64")));

  const variants: [string, typeof request][] = [
    ["body", { ...request, body: { method: "eth_signTypedData_v4", params: { a: 1, b: 3 } } }],
    ["url", { ...request, url: "https://api.privy.io/v1/wallets/wallet-2/rpc" }],
    ["idempotency key", { ...request, idempotencyKey: "nw-sign-2" }],
    ["no idempotency key", { ...request, idempotencyKey: undefined }],
    ["method", { ...request, method: "PATCH" }],
    ["app", { ...request, appId: "another-app" }],
  ];
  for (const [name, changed] of variants) {
    const own = authorizationSignature(changed, key.privateKey);
    assert.ok(verify("sha256", signedPayload(changed), spki, Buffer.from(own, "base64")), `${name}: its own signature verifies`);
    assert.equal(verify("sha256", signedPayload(changed), spki, Buffer.from(signature, "base64")), false, `${name}: the original signature does not cover it`);
  }
  const stranger = spkiOf(parseAuthorizationKey(generateAuthorizationKey()).publicKey);
  assert.equal(verify("sha256", signedPayload(request), stranger, Buffer.from(signature, "base64")), false, "another key does not verify it");
});

type SeenRequest = { url: string; method: string; headers: Record<string, string>; body: unknown };

function fakeFetch(answer: (request: SeenRequest) => Response = () => Response.json({})) {
  const seen: SeenRequest[] = [];
  const fetchImpl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const request = {
      url: String(input),
      method: init.method ?? "GET",
      headers: { ...(init.headers as Record<string, string>) },
      body: init.body === undefined ? undefined : JSON.parse(String(init.body)),
    };
    seen.push(request);
    return answer(request);
  }) as typeof fetch;
  return { seen, fetchImpl };
}

function verifiesWith(request: SeenRequest, keys: KeyObject[], idempotencyKey?: string) {
  const signatures = request.headers["privy-authorization-signature"]?.split(",") ?? [];
  assert.equal(signatures.length, keys.length);
  const payload = signedPayload({ method: request.method, url: request.url, body: request.body, appId: APP.appId, idempotencyKey });
  keys.forEach((key, index) => {
    assert.ok(verify("sha256", payload, createPublicKey(key), Buffer.from(signatures[index], "base64")), `signature ${index + 1} verifies`);
  });
}

test("the Privy client authenticates every call and signs only wallet actions, including the idempotency key", async () => {
  const first = parseAuthorizationKey(generateAuthorizationKey());
  const second = parseAuthorizationKey(generateAuthorizationKey());
  const { seen, fetchImpl } = fakeFetch((request) =>
    request.url.endsWith("/rpc") ? Response.json({ data: { signature: SIGNATURE } }) : Response.json({ id: "policy-1", address: WALLET }),
  );
  const privy = createPrivyRest(APP, { fetch: fetchImpl });
  const basic = `Basic ${Buffer.from(`${APP.appId}:${APP.appSecret}`).toString("base64")}`;

  await privy.getWallet("wallet/1");
  const [read] = seen;
  assert.equal(read.url, "https://api.privy.io/v1/wallets/wallet%2F1");
  assert.equal(read.method, "GET");
  assert.deepEqual(read.headers, { authorization: basic, "privy-app-id": APP.appId });
  assert.equal(read.body, undefined);

  const typedData = toPrivyTransferTypedData(x402Request());
  assert.equal(await privy.signTypedData("wallet-1", typedData, [first.privateKey], "nw-sign-abc"), SIGNATURE);
  const rpc = seen[1];
  assert.equal(rpc.url, "https://api.privy.io/v1/wallets/wallet-1/rpc");
  assert.equal(rpc.method, "POST");
  assert.equal(rpc.headers.authorization, basic);
  assert.equal(rpc.headers["privy-app-id"], APP.appId);
  assert.equal(rpc.headers["content-type"], "application/json");
  assert.equal(rpc.headers["privy-idempotency-key"], "nw-sign-abc");
  assert.deepEqual(rpc.body, { method: "eth_signTypedData_v4", params: { typed_data: typedData } });
  verifiesWith(rpc, [first.privateKey], "nw-sign-abc");

  // A request signed by two keys carries one signature per key, comma-separated.
  await privy.updatePolicy("policy-1", { rules: denyAllPolicyRules() }, [first.privateKey, second.privateKey]);
  const patch = seen[2];
  assert.equal(patch.method, "PATCH");
  assert.equal(patch.url, "https://api.privy.io/v1/policies/policy-1");
  assert.deepEqual(patch.body, { rules: denyAllPolicyRules() });
  assert.equal(patch.headers["privy-idempotency-key"], undefined);
  verifiesWith(patch, [first.privateKey, second.privateKey]);

  // App-owned resources and lookups use the app secret alone.
  await privy.createPolicy({ version: "1.0", name: "Night Watch test", chain_type: "ethereum", rules: [], owner_id: "quorum-1" });
  await privy.userByCustomAuthId("maker-1");
  for (const request of seen.slice(3)) {
    assert.equal(request.method, "POST");
    assert.equal(request.headers.authorization, basic);
    assert.equal(request.headers["privy-authorization-signature"], undefined, request.url);
  }
  assert.equal(seen[4].url, "https://api.privy.io/v1/users/custom_auth/id");
  assert.deepEqual(seen[4].body, { custom_user_id: "maker-1" });
});

async function privyError(promise: Promise<unknown>): Promise<PrivyApiError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof PrivyApiError, String(error));
    return error;
  }
  assert.fail("Privy answered without an error.");
}

test("Privy failures keep their status and code, and a policy refusal is recognizable", async () => {
  const answers: Response[] = [];
  const { fetchImpl } = fakeFetch(() => answers.shift() ?? Response.json({}));
  const privy = createPrivyRest(APP, { fetch: fetchImpl });
  const key = parseAuthorizationKey(generateAuthorizationKey()).privateKey;
  const typedData = toPrivyTransferTypedData(x402Request());

  answers.push(Response.json({ code: "policy_violation", error: "Request denied by policy" }, { status: 400 }));
  const denied = await privyError(privy.signTypedData("wallet-1", typedData, [key]));
  assert.equal(denied.status, 400);
  assert.equal(denied.code, "policy_violation");
  assert.equal(denied.policyDenied, true);
  assert.match(denied.message, /answered 400 \(policy_violation\): Request denied by policy/);

  answers.push(Response.json({ error: "Wallet is not allowed to sign this request" }, { status: 403 }));
  assert.equal((await privyError(privy.signTypedData("wallet-1", typedData, [key]))).policyDenied, true);

  for (const [status, body] of [[500, { error: "Policy service unavailable" }], [400, { error: "Invalid typed data" }], [429, { error: "Too many requests" }]] as const) {
    answers.push(Response.json(body, { status }));
    const failed = await privyError(privy.signTypedData("wallet-1", typedData, [key]));
    assert.equal(failed.policyDenied, false, `${status} ${body.error}`);
  }

  answers.push(new Response("<html>gateway</html>", { status: 502 }));
  const gateway = await privyError(privy.getWallet("wallet-1"));
  assert.deepEqual(gateway.body, { error: "<html>gateway</html>" });

  answers.push(Response.json({ data: {} }));
  await assert.rejects(privy.signTypedData("wallet-1", typedData, [key]), /no typed-data signature/);

  answers.push(Response.json({ error: "User not found" }, { status: 404 }));
  assert.equal(await privy.userByCustomAuthId("unknown-maker"), null);
  answers.push(Response.json({ error: "Internal" }, { status: 500 }));
  await assert.rejects(privy.userByCustomAuthId("maker-1"), PrivyApiError);
});

test("a session policy allows one capped transfer to the door, with exactly the signer's typed-data schema", () => {
  const sessionId = `nws_${"a".repeat(32)}`;
  const deadline = NOW + 7_200;
  const policy = nightWatchSessionPolicy({
    sessionId,
    chainId: 84532,
    token: TOKEN.toLowerCase(),
    payTo: PAY_TO.toLowerCase(),
    maxAmount: 1_000_000n,
    deadline,
    latestValidBefore: deadline + 150,
  });
  assert.equal(policy.version, "1.0");
  assert.equal(policy.chain_type, "ethereum");
  assert.equal(policy.name, `Night Watch ${sessionId}`);
  assert.ok(policy.name.length <= 50);
  assert.equal(policy.rules.length, 1);
  const [rule] = policy.rules;
  assert.equal(rule.method, "eth_signTypedData_v4");
  assert.equal(rule.action, "ALLOW");
  const conditions = rule.conditions as Record<string, unknown>[];
  assert.equal(conditions.length, 6);
  for (const condition of conditions) assert.equal(typeof condition.value, "string", String(condition.field));
  const find = (source: string, field: string) => {
    const found = conditions.find((condition) => condition.field_source === source && condition.field === field);
    assert.ok(found, `${source}.${field}`);
    return { operator: found.operator, value: found.value };
  };
  assert.deepEqual(find("ethereum_typed_data_domain", "chainId"), { operator: "eq", value: "84532" });
  assert.deepEqual(find("ethereum_typed_data_domain", "verifyingContract"), { operator: "eq", value: getAddress(TOKEN) });
  assert.deepEqual(find("ethereum_typed_data_message", "to"), { operator: "eq", value: getAddress(PAY_TO) });
  assert.deepEqual(find("ethereum_typed_data_message", "value"), { operator: "lte", value: "0xf4240" });
  assert.deepEqual(find("ethereum_typed_data_message", "validBefore"), { operator: "lte", value: String(deadline + 150) });
  assert.deepEqual(find("system", "current_unix_timestamp"), { operator: "lt", value: String(deadline) });

  // Privy evaluates message conditions only when the types map equals the request's exactly.
  const signed = toPrivyTransferTypedData(x402Request());
  for (const condition of conditions.filter((item) => item.field_source === "ethereum_typed_data_message")) {
    assert.deepEqual(condition.typed_data, { types: TRANSFER_WITH_AUTHORIZATION_TYPES, primary_type: "TransferWithAuthorization" });
    assert.deepEqual((condition.typed_data as { types: unknown }).types, signed.types);
  }

  const input = { sessionId, chainId: 84532, token: TOKEN, payTo: PAY_TO, maxAmount: 1_000_000n, deadline, latestValidBefore: deadline + 150 };
  assert.throws(() => nightWatchSessionPolicy({ ...input, maxAmount: 0n }), /positive maximum/);
  assert.throws(() => nightWatchSessionPolicy({ ...input, latestValidBefore: deadline - 1 }), /outlive/);
  assert.throws(() => nightWatchSessionPolicy({ ...input, chainId: 0 }), /chain id/);
  assert.throws(() => nightWatchSessionPolicy({ ...input, deadline: deadline + 0.5 }), /whole-second/);
  assert.throws(() => nightWatchSessionPolicy({ ...input, payTo: "not-an-address" }));
});

test("the claim helper may sign only claim() to the release contract and register() to the identity registry", () => {
  const release = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
  const registry = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
  const policy = claimHelperPolicy({ chainId: 10143, releaseContract: release, identityRegistry: registry.toLowerCase() });
  assert.equal(policy.version, "1.0");
  assert.equal(policy.chain_type, "ethereum");
  assert.deepEqual(policy.rules, [
    {
      name: "Sign release claims",
      method: "eth_signTransaction",
      action: "ALLOW",
      conditions: [
        { field_source: "ethereum_transaction", field: "chain_id", operator: "eq", value: "10143" },
        { field_source: "ethereum_transaction", field: "to", operator: "eq", value: getAddress(release) },
        { field_source: "ethereum_calldata", field: "function_name", abi: RELEASE_CLAIM_ABI, operator: "eq", value: "claim" },
      ],
    },
    {
      name: "Sign the companion registration",
      method: "eth_signTransaction",
      action: "ALLOW",
      conditions: [
        { field_source: "ethereum_transaction", field: "chain_id", operator: "eq", value: "10143" },
        { field_source: "ethereum_transaction", field: "to", operator: "eq", value: registry },
        { field_source: "ethereum_calldata", field: "function_name", abi: IDENTITY_REGISTER_ABI, operator: "eq", value: "register" },
      ],
    },
  ]);
  const withoutRegistry = claimHelperPolicy({ chainId: 10143, releaseContract: release });
  assert.equal(withoutRegistry.rules.length, 1);
  assert.deepEqual(withoutRegistry.rules[0], policy.rules[0]);

  assert.deepEqual(denyAllPolicyRules(), [{ name: "Revoked by the maker", method: "*", conditions: [], action: "DENY" }]);
});

test("typed data reaches Privy only as the EIP-3009 TransferWithAuthorization schema on a plain domain", () => {
  assert.deepEqual(toPrivyTransferTypedData(x402Request()), {
    domain: { name: "USDC", version: "2", chainId: 84532, verifyingContract: getAddress(TOKEN) },
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primary_type: "TransferWithAuthorization",
    message: {
      from: getAddress(WALLET),
      to: getAddress(PAY_TO),
      value: "1000000",
      validAfter: "0",
      validBefore: String(NOW + MAX_TIMEOUT_SECONDS),
      nonce: NONCE.toLowerCase(),
    },
  });
  // A client that also sends EIP712Domain gets the same canonical shape.
  const withDomain = { ...x402Request(), types: { ...x402Request().types, EIP712Domain: TRANSFER_WITH_AUTHORIZATION_TYPES.EIP712Domain } };
  assert.deepEqual(toPrivyTransferTypedData(withDomain), toPrivyTransferTypedData(x402Request()));

  const fields = TRANSFER_WITH_AUTHORIZATION_TYPES.TransferWithAuthorization;
  const refused: [string, (request: X402Request) => X402Request, RegExp][] = [
    ["Permit2", (r) => ({ ...r, primaryType: "PermitWitnessTransferFrom" }), /only TransferWithAuthorization/],
    ["an extra type", (r) => ({ ...r, types: { ...r.types, Permit: fields } }), /EIP-3009/],
    ["reordered fields", (r) => ({ ...r, types: { TransferWithAuthorization: [fields[1], fields[0], ...fields.slice(2)] } }), /EIP-3009/],
    ["a missing field", (r) => ({ ...r, types: { TransferWithAuthorization: fields.slice(0, 5) } }), /EIP-3009/],
    ["a retyped field", (r) => ({ ...r, types: { TransferWithAuthorization: fields.map((f) => (f.name === "value" ? { ...f, type: "uint128" } : f)) } }), /EIP-3009/],
    ["a salted domain", (r) => ({ ...r, domain: { ...r.domain, salt: `0x${"00".repeat(32)}` } }), /domain/],
    ["a domain without version", (r) => ({ ...r, domain: { name: "USDC", chainId: 84532, verifyingContract: TOKEN } }), /domain/],
    ["a short nonce", (r) => ({ ...r, message: { ...r.message, nonce: `0x${"ab".repeat(31)}` } }), /nonce/],
    ["a hex amount", (r) => ({ ...r, message: { ...r.message, value: "0xf4240" } }), /unsigned integer/],
    ["a fractional amount", (r) => ({ ...r, message: { ...r.message, value: 1.5 } }), /unsigned integer/],
  ];
  for (const [name, mutate, pattern] of refused) assert.throws(() => toPrivyTransferTypedData(mutate(x402Request())), pattern, name);
});

const BOUNDS: DelegatedTransferBounds = {
  walletAddress: WALLET,
  chainId: 84532,
  token: TOKEN,
  payTo: PAY_TO,
  maxAmount: 1_000_000n,
  deadline: NOW + 3_600,
  maxLifetimeSeconds: MAX_TIMEOUT_SECONDS,
};

function fakePrivySigner() {
  const calls: { walletId: string; typedData: EthereumTypedData; keys: KeyObject[]; idempotencyKey?: string }[] = [];
  const privy = {
    async signTypedData(walletId: string, typedData: EthereumTypedData, keys: KeyObject[], idempotencyKey?: string) {
      calls.push({ walletId, typedData, keys, idempotencyKey });
      return SIGNATURE;
    },
  };
  return { calls, privy };
}

test("the delegated signer passes the exact typed data to Privy with the app key and a nonce-bound idempotency key", async () => {
  const key = parseAuthorizationKey(generateAuthorizationKey()).privateKey;
  const { calls, privy } = fakePrivySigner();
  const reserved: EthereumTypedData[] = [];
  const signer = privyX402Signer({ privy, walletId: "wallet-1", bounds: BOUNDS, authorizationKey: key, beforeSign: (typed) => void reserved.push(typed), now: () => NOW });
  assert.equal(signer.address, getAddress(WALLET));
  const request = x402Request();
  assert.equal(await signer.signTypedData(request), SIGNATURE);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].walletId, "wallet-1");
  assert.deepEqual(calls[0].typedData, toPrivyTransferTypedData(request));
  assert.deepEqual(calls[0].keys, [key]);
  assert.equal(calls[0].idempotencyKey, `nw-sign-${"ab".repeat(16)}`);
  assert.deepEqual(reserved, [calls[0].typedData], "the reservation hook saw exactly what was signed, before signing");
});

test("the delegated signer refuses anything outside the maker's bounds before Privy is asked", async () => {
  const key = parseAuthorizationKey(generateAuthorizationKey()).privateKey;
  const message = (r: X402Request, change: Record<string, unknown>) => ({ ...r, message: { ...r.message, ...change } });
  const cases: [string, (request: X402Request) => X402Request][] = [
    ["another chain", (r) => ({ ...r, domain: { ...r.domain, chainId: 8453 } })],
    ["another token", (r) => ({ ...r, domain: { ...r.domain, verifyingContract: OTHER } })],
    ["another token domain", (r) => ({ ...r, domain: { ...r.domain, name: "USD Coin" } })],
    ["another recipient", (r) => message(r, { to: OTHER })],
    ["another payer", (r) => message(r, { from: OTHER })],
    ["more than one top-up", (r) => message(r, { value: 1_000_001n })],
    ["a zero amount", (r) => message(r, { value: 0n })],
    ["a longer lifetime", (r) => message(r, { validBefore: BigInt(NOW + MAX_TIMEOUT_SECONDS + 1) })],
    ["valid only later", (r) => message(r, { validAfter: BigInt(NOW + 10) })],
    ["another primary type", (r) => ({ ...r, primaryType: "PermitWitnessTransferFrom" })],
  ];
  for (const [name, mutate] of cases) {
    const { calls, privy } = fakePrivySigner();
    let reserved = 0;
    const signer = privyX402Signer({ privy, walletId: "wallet-1", bounds: BOUNDS, authorizationKey: key, beforeSign: () => void (reserved += 1), now: () => NOW });
    await assert.rejects(signer.signTypedData(mutate(x402Request())), DelegationRefused, name);
    assert.equal(calls.length, 0, `${name}: Privy was not asked`);
    assert.equal(reserved, 0, `${name}: nothing was reserved`);
  }

  // At or after the deadline nothing is signed, even a request inside every other bound.
  const late = fakePrivySigner();
  const expired = privyX402Signer({ privy: late.privy, walletId: "wallet-1", bounds: BOUNDS, authorizationKey: key, now: () => BOUNDS.deadline });
  await assert.rejects(expired.signTypedData(x402Request()), DelegationRefused);
  assert.equal(late.calls.length, 0);

  // A refused reservation stops the signature too.
  const held = fakePrivySigner();
  const refusedHook = privyX402Signer({
    privy: held.privy,
    walletId: "wallet-1",
    bounds: BOUNDS,
    authorizationKey: key,
    beforeSign: () => { throw new Error("reservation refused"); },
    now: () => NOW,
  });
  await assert.rejects(refusedHook.signTypedData(x402Request()), /reservation refused/);
  assert.equal(held.calls.length, 0);
});
