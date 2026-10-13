import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isUuid } from "../lib/pilot.ts";
import { BASE_SEPOLIA, isTestnet, type Testnet } from "./ids.ts";

/** A steward's opt-in: which room an opaque funding reference tops up, and how often. */
export type FundingRoom = { roomId: string; stewardProfileId: string; maxTopUps: number };
export type FundingConfig = {
  facilitatorUrl: string;
  payTo: Partial<Record<Testnet, string>>;
  rooms: Record<string, FundingRoom>;
};

export const DEFAULT_FACILITATOR_URL = "https://x402.org/facilitator";
export const FUNDING_REF_PATTERN = /^[A-Za-z0-9_-]{22,64}$/;
export const ROOM_PATTERN = /^[a-z0-9-]{1,100}$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export class FundingConfigError extends Error {}

const fail = (message: string): never => {
  throw new FundingConfigError(`x402 funding config: ${message}`);
};
const record = (value: unknown, name: string) =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fail(`${name} must be an object`);

/** Local operator configuration. Testnets only; any other network is refused. */
export function parseFundingConfig(raw: unknown): FundingConfig {
  const input = record(raw, "the file");
  if (input.version !== 1) fail("version must be 1");
  const facilitatorUrl = input.facilitatorUrl ?? DEFAULT_FACILITATOR_URL;
  if (typeof facilitatorUrl !== "string") fail("facilitatorUrl must be a string");
  let url: URL | undefined;
  try { url = new URL(facilitatorUrl as string); } catch { fail("facilitatorUrl must be a URL"); }
  if (url!.protocol !== "https:" || url!.username || url!.password || url!.search || url!.hash)
    fail("facilitatorUrl must be a plain https URL");
  const payTo: FundingConfig["payTo"] = {};
  for (const [network, address] of Object.entries(record(input.payTo, "payTo"))) {
    if (!isTestnet(network)) fail(`payTo network ${network} is not an accepted testnet`);
    const pattern = network === BASE_SEPOLIA ? EVM_ADDRESS : SOLANA_ADDRESS;
    if (typeof address !== "string" || !pattern.test(address)) fail(`payTo address for ${network} is invalid`);
    payTo[network as Testnet] = address as string;
  }
  if (!Object.keys(payTo).length) fail("payTo needs at least one testnet");
  const rooms: FundingConfig["rooms"] = {};
  for (const [reference, value] of Object.entries(record(input.rooms, "rooms"))) {
    if (!FUNDING_REF_PATTERN.test(reference)) fail("funding references must be 22–64 URL-safe characters");
    const room = record(value, `rooms.${reference.slice(0, 6)}…`);
    if (typeof room.roomId !== "string" || !ROOM_PATTERN.test(room.roomId)) fail("roomId is invalid");
    if (!isUuid(room.stewardProfileId)) fail("stewardProfileId must be a guest profile UUID");
    if (!Number.isInteger(room.maxTopUps) || (room.maxTopUps as number) < 1 || (room.maxTopUps as number) > 20)
      fail("maxTopUps must be an integer from 1 to 20");
    rooms[reference] = {
      roomId: room.roomId as string,
      stewardProfileId: (room.stewardProfileId as string).toLowerCase(),
      maxTopUps: room.maxTopUps as number,
    };
  }
  return { facilitatorUrl: (facilitatorUrl as string).replace(/\/+$/, ""), payTo, rooms };
}

// The opt-out keeps Turbopack from tracing the project (and the private config) into the route bundle.
export const fundingConfigPath = () =>
  resolve(/*turbopackIgnore: true*/ process.env.X402_FUNDING_CONFIG ?? ".local/x402/funding.json");

/** A local secret the agent payer sends, so Host or forwarding headers alone never open the route. */
export const AGENT_TOKEN_HEADER = "x-fork-night-agent";
export const AGENT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const agentTokenPath = () =>
  resolve(/*turbopackIgnore: true*/ process.env.X402_AGENT_TOKEN_FILE ?? ".local/x402/agent-token");

/** Null when no valid token has been created on this machine. */
export async function readAgentToken(path = agentTokenPath()): Promise<string | null> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const token = text.trim();
  return AGENT_TOKEN_PATTERN.test(token) ? token : null;
}

/** Null when the operator has not opted in on this machine. */
export async function loadFundingConfig(path = fundingConfigPath()): Promise<FundingConfig | null> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { fail("the file is not valid JSON"); }
  return parseFundingConfig(raw);
}
