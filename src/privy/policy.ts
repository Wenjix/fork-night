import { getAddress } from "viem";
import type { EthereumTypedData } from "./rest.ts";

/**
 * Privy wallet policies for the Night Watch.
 *
 * Privy evaluates an `ethereum_typed_data_message` condition only when the policy's `types` map is
 * identical to the request's, including `EIP712Domain` and field order. The signer adapter sends
 * exactly `TRANSFER_WITH_AUTHORIZATION_TYPES`, so the policy and the request cannot drift apart.
 * https://docs.privy.io/controls/policies/example-policies/ethereum
 */

export const EIP712_DOMAIN_TYPE = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
] as const;

export const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  EIP712Domain: EIP712_DOMAIN_TYPE.map((field) => ({ ...field })),
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
};

export type SessionPolicyInput = {
  /** Night Watch session id; names the policy so it can be found in the Privy dashboard. */
  sessionId: string;
  chainId: number;
  /** The EIP-3009 token contract (testnet USDC). */
  token: string;
  /** The room door's x402 receiving address. */
  payTo: string;
  /** The largest single authorization the signer may sign, in token base units. */
  maxAmount: bigint;
  /** Unix seconds. Privy refuses new signatures at or after this time. */
  deadline: number;
  /** Unix seconds. The longest authorization lifetime the signer may sign. */
  latestValidBefore: number;
};

function typedMessageCondition(field: string, operator: "eq" | "lte" | "gte" | "lt", value: string) {
  return {
    field_source: "ethereum_typed_data_message",
    typed_data: { types: TRANSFER_WITH_AUTHORIZATION_TYPES, primary_type: "TransferWithAuthorization" },
    field,
    operator,
    value,
  };
}

/**
 * One ALLOW rule; Privy denies everything a policy does not allow. The rule permits only an EIP-3009
 * `TransferWithAuthorization` on one chain and token, to one recipient, at or under one amount,
 * with a bounded lifetime, before the session deadline.
 */
export function nightWatchSessionPolicy(input: SessionPolicyInput) {
  if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0) throw new Error("A session policy needs a chain id.");
  if (input.maxAmount <= 0n) throw new Error("A session policy needs a positive maximum amount.");
  if (!Number.isSafeInteger(input.deadline) || !Number.isSafeInteger(input.latestValidBefore)) throw new Error("A session policy needs whole-second times.");
  if (input.latestValidBefore < input.deadline) throw new Error("Authorizations must be allowed to outlive the signing deadline by their own lifetime.");
  return {
    version: "1.0" as const,
    name: `Night Watch ${input.sessionId}`.slice(0, 50),
    chain_type: "ethereum" as const,
    rules: [
      {
        name: "One capped room top-up to the room door",
        method: "eth_signTypedData_v4",
        action: "ALLOW",
        conditions: [
          { field_source: "ethereum_typed_data_domain", field: "chainId", operator: "eq", value: String(input.chainId) },
          { field_source: "ethereum_typed_data_domain", field: "verifyingContract", operator: "eq", value: getAddress(input.token) },
          typedMessageCondition("to", "eq", getAddress(input.payTo)),
          typedMessageCondition("value", "lte", `0x${input.maxAmount.toString(16)}`),
          typedMessageCondition("validBefore", "lte", String(input.latestValidBefore)),
          { field_source: "system", field: "current_unix_timestamp", operator: "lt", value: String(input.deadline) },
        ],
      },
    ],
  };
}

export type ClaimHelperPolicyInput = { chainId: number; releaseContract: string; identityRegistry?: string };

/** Turns a policy into a refusal of everything; used to revoke a Night Watch session from the server. */
export function denyAllPolicyRules() {
  return [{ name: "Revoked by the maker", method: "*", conditions: [], action: "DENY" }];
}

export const IDENTITY_REGISTER_ABI = [
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentURI", type: "string" }],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
] as const;

export const RELEASE_CLAIM_ABI = [
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [
      { name: "releaseId", type: "bytes32" },
      { name: "beneficiary", type: "address" },
    ],
    outputs: [],
  },
] as const;

/**
 * The helper's only permissions on one chain: sign a `claim(releaseId, beneficiary)` call to the
 * release contract (the contract pays the frozen beneficiary, never the caller) and, optionally,
 * sign the companion's one-time ERC-8004 `register(agentURI)`.
 */
export function claimHelperPolicy(input: ClaimHelperPolicyInput) {
  const chain = { field_source: "ethereum_transaction", field: "chain_id", operator: "eq", value: String(input.chainId) };
  const claim = [
    chain,
    { field_source: "ethereum_transaction", field: "to", operator: "eq", value: getAddress(input.releaseContract) },
    { field_source: "ethereum_calldata", field: "function_name", abi: RELEASE_CLAIM_ABI, operator: "eq", value: "claim" },
  ];
  const rules: unknown[] = [{ name: "Sign release claims", method: "eth_signTransaction", action: "ALLOW", conditions: claim }];
  if (input.identityRegistry) {
    rules.push({
      name: "Sign the companion registration",
      method: "eth_signTransaction",
      action: "ALLOW",
      conditions: [
        chain,
        { field_source: "ethereum_transaction", field: "to", operator: "eq", value: getAddress(input.identityRegistry) },
        { field_source: "ethereum_calldata", field: "function_name", abi: IDENTITY_REGISTER_ABI, operator: "eq", value: "register" },
      ],
    });
  }
  return { version: "1.0" as const, name: "Night Watch claim helper", chain_type: "ethereum" as const, rules };
}

/** Converts an x402 client's typed-data request into the exact JSON shape the policy expects. */
export function toPrivyTransferTypedData(request: {
  domain: Record<string, unknown>;
  types: Record<string, unknown>;
  primaryType: string;
  message: Record<string, unknown>;
}): EthereumTypedData {
  if (request.primaryType !== "TransferWithAuthorization") throw new Error(`The Night Watch signs only TransferWithAuthorization, not ${request.primaryType}.`);
  const fields = (request.types as Record<string, { name: string; type: string }[]>).TransferWithAuthorization;
  const expected = TRANSFER_WITH_AUTHORIZATION_TYPES.TransferWithAuthorization;
  if (
    !Array.isArray(fields) ||
    fields.length !== expected.length ||
    fields.some((field, index) => field.name !== expected[index].name || field.type !== expected[index].type) ||
    Object.keys(request.types).some((name) => name !== "TransferWithAuthorization" && name !== "EIP712Domain")
  ) {
    throw new Error("The typed data is not the EIP-3009 TransferWithAuthorization schema.");
  }
  const { domain, message } = request;
  const domainKeys = Object.keys(domain).sort().join(",");
  if (domainKeys !== "chainId,name,verifyingContract,version") throw new Error("The typed-data domain must be name, version, chainId and verifyingContract.");
  const uint = (value: unknown, label: string) => {
    if (typeof value === "bigint") return value.toString(10);
    if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
    if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)) return value;
    throw new Error(`The typed-data ${label} is not an unsigned integer.`);
  };
  if (typeof message.nonce !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(message.nonce)) throw new Error("The typed-data nonce must be 32 bytes.");
  return {
    domain: {
      name: String(domain.name),
      version: String(domain.version),
      chainId: Number(uint(domain.chainId, "chain id")),
      verifyingContract: getAddress(String(domain.verifyingContract)),
    },
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primary_type: "TransferWithAuthorization",
    message: {
      from: getAddress(String(message.from)),
      to: getAddress(String(message.to)),
      value: uint(message.value, "value"),
      validAfter: uint(message.validAfter, "validAfter"),
      validBefore: uint(message.validBefore, "validBefore"),
      nonce: message.nonce.toLowerCase(),
    },
  };
}
