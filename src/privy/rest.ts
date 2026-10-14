import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, type KeyObject } from "node:crypto";

/**
 * A small server-side client for the Privy wallet API.
 *
 * It implements Privy's documented request signing directly (RFC 8785 JSON, ECDSA P-256 over
 * SHA-256, base64 DER) instead of adding @privy-io/node, so the shared lockfile does not move.
 * https://docs.privy.io/controls/authorization-keys/using-owners/sign/direct-implementation
 */

export const PRIVY_API_URL = "https://api.privy.io";
const AUTHORIZATION_KEY_PREFIX = "wallet-auth:";

export type PrivyCredentials = { appId: string; appSecret: string };

/** One parsed P-256 authorization key and its public key in the base64 DER form Privy registers. */
export type AuthorizationKey = { privateKey: KeyObject; publicKey: string };

/** RFC 8785 canonical JSON for the plain JSON values Privy request bodies contain. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON cannot encode a non-finite number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  throw new TypeError(`Canonical JSON cannot encode a ${typeof value}.`);
}

/** Creates a new authorization key in Privy's `wallet-auth:` PKCS#8 format. */
export function generateAuthorizationKey(): string {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return AUTHORIZATION_KEY_PREFIX + privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
}

export function parseAuthorizationKey(value: string): AuthorizationKey {
  const body = value.trim().startsWith(AUTHORIZATION_KEY_PREFIX) ? value.trim().slice(AUTHORIZATION_KEY_PREFIX.length) : value.trim();
  const privateKey = createPrivateKey({ key: Buffer.from(body, "base64"), format: "der", type: "pkcs8" });
  if (privateKey.asymmetricKeyType !== "ec" || privateKey.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new Error("A Privy authorization key must be a P-256 private key.");
  }
  const publicKey = createPublicKey(privateKey).export({ format: "der", type: "spki" }).toString("base64");
  return { privateKey, publicKey };
}

export type SignedMethod = "POST" | "PUT" | "PATCH" | "DELETE";

/** The `privy-authorization-signature` value for one request. */
export function authorizationSignature(
  request: { method: SignedMethod; url: string; body: unknown; appId: string; idempotencyKey?: string },
  key: KeyObject,
): string {
  const headers: Record<string, string> = { "privy-app-id": request.appId };
  if (request.idempotencyKey) headers["privy-idempotency-key"] = request.idempotencyKey;
  const payload = { version: 1, method: request.method, url: request.url.replace(/\/+$/, ""), body: request.body, headers };
  return sign("sha256", Buffer.from(canonicalJson(payload)), key).toString("base64");
}

export class PrivyApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly body: unknown;

  constructor(status: number, body: unknown, path: string) {
    const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const code = typeof record.code === "string" ? record.code : null;
    const detail = typeof record.error === "string" ? record.error : typeof record.message === "string" ? record.message : "";
    super(`Privy ${path} answered ${status}${code ? ` (${code})` : ""}${detail ? `: ${detail}` : ""}`);
    this.name = "PrivyApiError";
    this.status = status;
    this.code = code;
    this.body = body;
  }

  /** True when Privy refused the request under a wallet policy rather than failing. */
  get policyDenied(): boolean {
    const text = `${this.code ?? ""} ${this.message}`.toLowerCase();
    return this.status === 400 || this.status === 403 ? /polic|denied|not allowed|unauthori[sz]ed signer/.test(text) : false;
  }
}

export type EthereumTypedData = {
  domain: Record<string, unknown>;
  types: Record<string, { name: string; type: string }[]>;
  primary_type: string;
  message: Record<string, unknown>;
};

export type UnsignedEvmTransaction = {
  to: string;
  data?: string;
  value?: string;
  chain_id: number;
  nonce?: number;
  gas_limit?: string;
  max_fee_per_gas?: string;
  max_priority_fee_per_gas?: string;
  type?: 2;
};

export type PrivyWallet = {
  id: string;
  address: string;
  chain_type: string;
  owner_id?: string | null;
  policy_ids?: string[];
  additional_signers?: { signer_id: string; override_policy_ids?: string[] }[];
  created_at?: number;
};

export type PrivyPolicy = { id: string; name: string; version: string; chain_type: string; rules: unknown[] };

export type PrivyRest = ReturnType<typeof createPrivyRest>;

/**
 * Wallet API calls the Night Watch needs. Requests that act on a wallet are signed with the given
 * authorization keys; reads and app-owned resources use only the app secret.
 */
export function createPrivyRest(credentials: PrivyCredentials, options: { fetch?: typeof fetch; baseUrl?: string } = {}) {
  const doFetch = options.fetch ?? fetch;
  const baseUrl = (options.baseUrl ?? PRIVY_API_URL).replace(/\/+$/, "");
  const basic = Buffer.from(`${credentials.appId}:${credentials.appSecret}`).toString("base64");

  async function call<T>(
    method: "GET" | SignedMethod,
    path: string,
    body?: unknown,
    signing: { keys?: KeyObject[]; idempotencyKey?: string } = {},
  ): Promise<T> {
    const url = `${baseUrl}${path}`;
    const headers: Record<string, string> = {
      authorization: `Basic ${basic}`,
      "privy-app-id": credentials.appId,
    };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (signing.idempotencyKey) headers["privy-idempotency-key"] = signing.idempotencyKey;
    if (signing.keys?.length && method !== "GET") {
      headers["privy-authorization-signature"] = signing.keys
        .map((key) => authorizationSignature({ method, url, body: body ?? {}, appId: credentials.appId, idempotencyKey: signing.idempotencyKey }, key))
        .join(",");
    }
    const response = await doFetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { error: text.slice(0, 300) };
    }
    if (!response.ok) throw new PrivyApiError(response.status, parsed, path);
    return parsed as T;
  }

  return {
    appId: credentials.appId,

    createKeyQuorum(input: { publicKeys: string[]; threshold?: number; displayName?: string }) {
      return call<{ id: string; display_name: string | null; authorization_threshold: number | null }>("POST", "/v1/key_quorums", {
        public_keys: input.publicKeys,
        authorization_threshold: input.threshold ?? 1,
        ...(input.displayName ? { display_name: input.displayName.slice(0, 50) } : {}),
      });
    },

    getKeyQuorum(id: string) {
      return call<{ id: string; authorization_keys?: { public_key: string }[] }>("GET", `/v1/key_quorums/${encodeURIComponent(id)}`);
    },

    /** `owner_id` (a key quorum) makes later rule changes require that quorum's signature. */
    createPolicy(policy: { version: "1.0"; name: string; chain_type: "ethereum"; rules: unknown[]; owner_id?: string }) {
      return call<PrivyPolicy>("POST", "/v1/policies", policy);
    },

    getPolicy(id: string) {
      return call<PrivyPolicy>("GET", `/v1/policies/${encodeURIComponent(id)}`);
    },

    /** Replaces a policy's rules. A policy owned by a key quorum needs that quorum's signature. */
    updatePolicy(id: string, patch: { rules: unknown[]; name?: string }, keys: KeyObject[]) {
      return call<PrivyPolicy>("PATCH", `/v1/policies/${encodeURIComponent(id)}`, patch, { keys });
    },

    /** The Privy user whose custom-auth ID (the Supabase user ID here) matches, or null. */
    async userByCustomAuthId(customUserId: string) {
      try {
        return await call<{ id: string; linked_accounts: Record<string, unknown>[] }>("POST", "/v1/users/custom_auth/id", { custom_user_id: customUserId });
      } catch (error) {
        if (error instanceof PrivyApiError && error.status === 404) return null;
        throw error;
      }
    },

    getWallet(id: string) {
      return call<PrivyWallet>("GET", `/v1/wallets/${encodeURIComponent(id)}`);
    },

    getUser(id: string) {
      return call<{ id: string; linked_accounts: Record<string, unknown>[] }>("GET", `/v1/users/${encodeURIComponent(id)}`);
    },

    createWallet(input: { owner?: { public_key: string } | null; owner_id?: string; policy_ids?: string[]; idempotencyKey?: string }) {
      const { idempotencyKey, ...rest } = input;
      return call<PrivyWallet>("POST", "/v1/wallets", { chain_type: "ethereum", ...rest }, { idempotencyKey });
    },

    updateWallet(id: string, patch: { policy_ids?: string[]; additional_signers?: unknown[] }, keys: KeyObject[]) {
      return call<PrivyWallet>("PATCH", `/v1/wallets/${encodeURIComponent(id)}`, patch, { keys });
    },

    /** A raw wallet RPC request, for checks that must exercise other methods. */
    rpc(walletId: string, body: Record<string, unknown>, keys: KeyObject[], idempotencyKey?: string) {
      return call<Record<string, unknown>>("POST", `/v1/wallets/${encodeURIComponent(walletId)}/rpc`, body, { keys, idempotencyKey });
    },

    async signTypedData(walletId: string, typedData: EthereumTypedData, keys: KeyObject[], idempotencyKey?: string): Promise<string> {
      const result = await call<{ data?: { signature?: string } }>(
        "POST",
        `/v1/wallets/${encodeURIComponent(walletId)}/rpc`,
        { method: "eth_signTypedData_v4", params: { typed_data: typedData } },
        { keys, idempotencyKey },
      );
      const signature = result.data?.signature;
      if (!signature || !/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new Error("Privy returned no typed-data signature.");
      return signature;
    },

    async signTransaction(walletId: string, transaction: UnsignedEvmTransaction, keys: KeyObject[], idempotencyKey?: string): Promise<string> {
      const result = await call<{ data?: { signed_transaction?: string } }>(
        "POST",
        `/v1/wallets/${encodeURIComponent(walletId)}/rpc`,
        { method: "eth_signTransaction", params: { transaction } },
        { keys, idempotencyKey },
      );
      const signed = result.data?.signed_transaction;
      if (!signed || !/^0x[0-9a-fA-F]+$/.test(signed)) throw new Error("Privy returned no signed transaction.");
      return signed;
    },

    async sendTransaction(walletId: string, caip2: `eip155:${number}`, transaction: UnsignedEvmTransaction, keys: KeyObject[], idempotencyKey?: string) {
      const result = await call<{ data?: { hash?: string; caip2?: string; transaction_id?: string } }>(
        "POST",
        `/v1/wallets/${encodeURIComponent(walletId)}/rpc`,
        { method: "eth_sendTransaction", caip2, chain_type: "ethereum", params: { transaction } },
        { keys, idempotencyKey },
      );
      const hash = result.data?.hash;
      if (!hash || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error("Privy returned no transaction hash.");
      return { hash, transactionId: result.data?.transaction_id ?? null };
    },
  };
}
