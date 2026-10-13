import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { loadMppAdapter } from "../src/mpp/adapter.ts";
import { loadMppConfig, mppConfigPath, mppRoomFor, type MppDoorConfig } from "../src/mpp/config.ts";
import { MPP_COMMANDS } from "../src/mpp/ids.ts";
import { fundMppRoom, resumeMppAttempt, type MppFundingSummary } from "../src/mpp/payer.ts";
import { mppSigner, mppWalletDirectory } from "../src/mpp/wallets.ts";
import { agentTokenPath, fundingConfigPath, loadFundingConfig, readAgentToken, type FundingConfig } from "../src/x402/config.ts";

// The local patron agent for the testnet MPP room top-up on Tempo Moderato. It signs at most one payment
// per run (through the isolated adapter in vendor/mpp-adapter) and saves it under .local/mpp/payments/ before
// sending; --resume re-sends that payment, never a new one.
const USAGE = `Usage: ${MPP_COMMANDS.fund} [--room <roomId>] [--url <funding url> | --port <port>]
       ${MPP_COMMANDS.fund} --resume <record file>`;
const HEADLINE: Record<MppFundingSummary["outcome"], string> = {
  credited: "Credited",
  pending: "Pending",
  rejected: "Rejected",
  expired: "Expired",
  refused: "Refused",
  unknown: "Unknown",
  declined: "Declined",
  "not-offered": "No offer",
};
export const paymentDirectory = () => resolve(process.env.MPP_PAYMENT_DIR ?? ".local/mpp/payments");

function report(summary: MppFundingSummary) {
  console.log(`${HEADLINE[summary.outcome]}: ${summary.message}`);
  if (summary.transaction) console.log(`Transaction: ${summary.transaction}`);
  if (summary.explorerUrl) console.log(`Explorer: ${summary.explorerUrl}`);
  if (summary.recordFile) console.log(`Record: ${summary.recordFile}`);
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = summary.outcome === "credited" ? 0 : 1;
}

async function agentToken() {
  const token = await readAgentToken();
  if (!token) throw new Error(`No valid agent token at ${agentTokenPath()}. Run npm run x402:setup -- init first; nothing was signed.`);
  return token;
}

/** The room named by --room, or the only room opted in to both the x402 link and the MPP limit. */
export function chooseMppRoom(funding: FundingConfig | null, door: MppDoorConfig | null, roomId: string | undefined): [string, string] {
  const rooms = funding && door
    ? Object.keys(funding.rooms).flatMap((ref) => { const room = mppRoomFor(funding, door, ref); return room ? [[ref, room.roomId] as [string, string]] : []; })
    : [];
  const ids = [...new Set(rooms.map(([, id]) => id))].join(", ");
  if (!rooms.length)
    throw new Error(`No room is opted in to MPP top-ups (${mppConfigPath()} and ${fundingConfigPath()}); run ${MPP_COMMANDS.setup} init --room <roomId> or pass --url. Nothing was signed.`);
  if (roomId === undefined) {
    if (rooms.length === 1) return rooms[0];
    throw new Error(`Several rooms are opted in (${ids}); pass --room <roomId>. Nothing was signed.`);
  }
  const matches = rooms.filter(([, id]) => id === roomId);
  if (matches.length === 1) return matches[0];
  throw new Error(matches.length
    ? `Room ${roomId} has several funding links; pass --url. Nothing was signed.`
    : `Room ${roomId} is not opted in to MPP top-ups (configured: ${ids}). Nothing was signed.`);
}

async function main(argv: string[]) {
  const args = argv[0] === "--" ? argv.slice(1) : argv; // pnpm forwards the separator
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      room: { type: "string" },
      url: { type: "string" },
      port: { type: "string" },
      resume: { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }
  if (values.resume) {
    report(await resumeMppAttempt(resolve(values.resume), { agentToken: await agentToken() }));
    return;
  }
  const port = values.port ?? "3005";
  if (!/^[0-9]{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error("--port must be a TCP port.");
  if (values.url !== undefined && values.room !== undefined) throw new Error("Pass --room or --url, not both.");
  const token = await agentToken();
  const [funding, door] = await Promise.all([loadFundingConfig(), loadMppConfig()]);
  let url: string, roomId: string | undefined;
  if (values.url !== undefined) {
    url = values.url;
    const ref = url.split(/[?#]/)[0].split("/").pop() ?? "";
    roomId = funding && door ? mppRoomFor(funding, door, ref)?.roomId : undefined;
  } else {
    const [ref, id] = chooseMppRoom(funding, door, values.room);
    url = `http://127.0.0.1:${port}/api/mpp/fund/${ref}`;
    roomId = id;
  }
  const adapter = await loadMppAdapter();
  let account: Awaited<ReturnType<typeof mppSigner>>;
  try {
    account = await mppSigner(adapter, "payer");
  } catch (error) {
    throw new Error(`No usable Tempo Moderato payer wallet in ${mppWalletDirectory()}: ${(error as Error).message}`);
  }
  const expected = door ? { payTo: door.recipient, currency: door.currency } : {};
  console.log(`Funding ${roomId ? `room ${roomId}` : "a room missing from the MPP config"} at ${url} on Tempo Moderato as ${account.address}${
    door ? `, paying only ${door.recipient}` : " (no MPP config: the recipient is not checked)"}.`);
  report(await fundMppRoom({ url, recordDir: paymentDirectory(), agentToken: token, adapter, account, expected }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}
