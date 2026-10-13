import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  agentTokenPath,
  fundingConfigPath,
  loadFundingConfig,
  readAgentToken,
  type FundingConfig,
  type FundingRoom,
} from "../src/x402/config.ts";
import { BASE_SEPOLIA, SOLANA_DEVNET } from "../src/x402/ids.ts";
import { fundRoom, resumeAttempt, type FundingSummary, type PayerSigner } from "../src/x402/payer.ts";
import { evmSigner, solanaSigner, walletDirectory } from "../src/x402/wallets.ts";

// The local agent payer for the testnet room top-up. It signs at most one payment per run and
// saves it under .local/x402/payments/ before sending; --resume re-sends that payment, never a new one.
const USAGE = `Usage: npm run x402:fund -- --network solana|base [--room <roomId>] [--url <funding url> | --port <port>]
       npm run x402:fund -- --resume <record file>`;
const NETWORKS = { solana: SOLANA_DEVNET, base: BASE_SEPOLIA } as const;
const HEADLINE: Record<FundingSummary["outcome"], string> = {
  credited: "Credited",
  pending: "Pending",
  rejected: "Rejected",
  expired: "Expired",
  refused: "Refused",
  unknown: "Unknown",
  declined: "Declined",
  "not-offered": "No offer",
};

function report(summary: FundingSummary) {
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

/** The room named by --room, or the only room configured. */
function chooseRoom(config: FundingConfig | null, roomId: string | undefined): [string, FundingRoom] {
  const rooms = Object.entries(config?.rooms ?? {});
  const ids = [...new Set(rooms.map(([, room]) => room.roomId))].join(", ");
  if (!rooms.length)
    throw new Error(`No funded room is configured at ${fundingConfigPath()}; run npm run x402:setup -- init --room <roomId> --steward <profileUuid> or pass --url. Nothing was signed.`);
  if (roomId === undefined) {
    if (rooms.length === 1) return rooms[0];
    throw new Error(`Several rooms are opted in (${ids}); pass --room <roomId>. Nothing was signed.`);
  }
  const matches = rooms.filter(([, room]) => room.roomId === roomId);
  if (matches.length === 1) return matches[0];
  throw new Error(matches.length
    ? `Room ${roomId} has several funding links in ${fundingConfigPath()}; pass --url. Nothing was signed.`
    : `Room ${roomId} is not opted in at ${fundingConfigPath()} (configured: ${ids}). Nothing was signed.`);
}

try {
  const args = process.argv.slice(2);
  if (args[0] === "--") args.shift(); // pnpm forwards the separator
  const { values } = parseArgs({
    args,
    options: {
      network: { type: "string" },
      room: { type: "string" },
      url: { type: "string" },
      port: { type: "string" },
      resume: { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(USAGE);
  } else if (values.resume) {
    report(await resumeAttempt(resolve(values.resume), { agentToken: await agentToken() }));
  } else {
    const network = Object.hasOwn(NETWORKS, values.network ?? "")
      ? NETWORKS[values.network as keyof typeof NETWORKS]
      : null;
    if (!network) throw new Error(`Pass --network solana or --network base.\n${USAGE}`);
    const port = values.port ?? "3005";
    if (!/^[0-9]{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error("--port must be a TCP port.");
    if (values.url !== undefined && values.room !== undefined) throw new Error("Pass --room or --url, not both.");
    const token = await agentToken();
    const config = await loadFundingConfig();
    let url: string, roomId: string | undefined;
    if (values.url !== undefined) {
      url = values.url;
      const ref = url.split(/[?#]/)[0].split("/").pop() ?? "";
      roomId = config && Object.hasOwn(config.rooms, ref) ? config.rooms[ref].roomId : undefined;
    } else {
      const [ref, room] = chooseRoom(config, values.room);
      url = `http://127.0.0.1:${port}/api/x402/fund/${ref}`;
      roomId = room.roomId;
    }
    let payer: PayerSigner;
    try {
      payer = network === BASE_SEPOLIA
        ? { network, signer: await evmSigner("payer") }
        : { network, signer: await solanaSigner("payer") };
    } catch (error) {
      throw new Error(`No usable ${network} payer wallet in ${walletDirectory()}: ${(error as Error).message}`);
    }
    const payTo = config?.payTo[network];
    console.log(`Funding ${roomId ? `room ${roomId}` : "a room missing from the funding config"} at ${url} on ${network} as ${payer.signer.address}${
      payTo ? `, paying only ${payTo}` : " (no funding config: payTo is not checked)"}.`);
    report(await fundRoom({ ...payer, url, recordDir: resolve(".local/x402/payments"), agentToken: token, expected: { payTo } }));
  }
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
