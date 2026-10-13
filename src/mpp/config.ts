import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ROOM_PATTERN, type FundingConfig } from "../x402/config.ts";
import { EVM_ADDRESS, MODERATO_TEST_TOKENS, PATHUSD, TEMPO_MODERATO, sameAddress } from "./ids.ts";

/**
 * The MPP door's own local settings: where payments go, in which test token, and each room's
 * MPP top-up limit. Rooms, stewards and funding references stay in the x402 funding config.
 */
export type MppDoorConfig = {
  network: typeof TEMPO_MODERATO;
  recipient: string;
  currency: string;
  rooms: Record<string, { maxTopUps: number }>;
};

/** A room the MPP door may top up: the x402 opt-in plus the MPP rail's own limit. */
export type MppRoom = { roomId: string; stewardProfileId: string; maxTopUps: number };

export class MppConfigError extends Error {}

const fail = (message: string): never => {
  throw new MppConfigError(`MPP door config: ${message}`);
};
const record = (value: unknown, name: string) =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fail(`${name} must be an object`);

/** Testnet only: Tempo Moderato and its faucet test dollars; any other network or token is refused. */
export function parseMppConfig(raw: unknown): MppDoorConfig {
  const input = record(raw, "the file");
  if (input.version !== 1) fail("version must be 1");
  if (input.network !== TEMPO_MODERATO) fail(`network must be ${TEMPO_MODERATO} (Tempo Moderato testnet)`);
  if (typeof input.recipient !== "string" || !EVM_ADDRESS.test(input.recipient)) fail("recipient must be an EVM address");
  if (/^0x0{40}$/i.test(input.recipient as string)) fail("recipient must not be the zero address");
  const currency = input.currency ?? PATHUSD;
  if (!Object.values(MODERATO_TEST_TOKENS).some((token) => sameAddress(token, currency)))
    fail("currency must be a Moderato faucet test token (pathUSD, alphaUSD, betaUSD or thetaUSD)");
  const rooms: MppDoorConfig["rooms"] = {};
  for (const [roomId, value] of Object.entries(record(input.rooms, "rooms"))) {
    if (!ROOM_PATTERN.test(roomId)) fail("room IDs must be lowercase letters, digits and hyphens");
    const room = record(value, `rooms.${roomId}`);
    if (!Number.isInteger(room.maxTopUps) || (room.maxTopUps as number) < 1 || (room.maxTopUps as number) > 20)
      fail("maxTopUps must be an integer from 1 to 20");
    rooms[roomId] = { maxTopUps: room.maxTopUps as number };
  }
  const token = Object.values(MODERATO_TEST_TOKENS).find((item) => sameAddress(item, currency))!;
  return { network: TEMPO_MODERATO, recipient: input.recipient as string, currency: token, rooms };
}

// The opt-outs keep Turbopack from tracing the project (and the private files) into the route bundle.
export const mppConfigPath = () =>
  resolve(/*turbopackIgnore: true*/ process.env.MPP_DOOR_CONFIG ?? ".local/mpp/config.json");
/** The HMAC key that binds every MPP challenge to this server. Created once by setup; never rotated. */
export const challengeKeyPath = () =>
  resolve(/*turbopackIgnore: true*/ process.env.MPP_CHALLENGE_KEY_FILE ?? ".local/mpp/challenge-key");
export const CHALLENGE_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Null when this machine has not opted in to the MPP door. */
export async function loadMppConfig(path = mppConfigPath()): Promise<MppDoorConfig | null> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { fail("the file is not valid JSON"); }
  return parseMppConfig(raw);
}

/** Null when no valid key exists. The key is never printed or recorded. */
export async function readChallengeKey(path = challengeKeyPath()): Promise<string | null> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const key = text.trim();
  return CHALLENGE_KEY_PATTERN.test(key) ? key : null;
}

/** The x402 opt-in for this funding reference, with the MPP rail's own top-up limit; null if either is missing. */
export function mppRoomFor(funding: FundingConfig, door: MppDoorConfig, fundingRef: string): MppRoom | null {
  const room = Object.hasOwn(funding.rooms, fundingRef) ? funding.rooms[fundingRef] : undefined;
  if (!room || !Object.hasOwn(door.rooms, room.roomId)) return null;
  return { roomId: room.roomId, stewardProfileId: room.stewardProfileId, maxTopUps: door.rooms[room.roomId].maxTopUps };
}
