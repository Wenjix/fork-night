import { ZeroAddress } from "ethers";
import { pilotAdmin } from "../../generation/client.ts";
import { ReleaseClient } from "./client.ts";
import { releaseConfig, type ReleaseConfig } from "./config.ts";
import { makerKey, ORIGINAL_ROOM, projectKey, releaseRoom, sameAddress } from "./model.ts";
import { RequestProblem, uuid, verifyDenial, verifyWalletRequest, type WalletRequest, type WalletRequestProof } from "./wallet-requests.ts";

const fields = "id,room_id,project_id,moment_id,maker_id,maker_label,moment_title,wallet_address,state,created_at,decided_at" as const;
export type RequestStore = {
  open: () => Promise<boolean>;
  list: () => Promise<WalletRequest[]>;
  get: (id: string) => Promise<WalletRequest | null>;
  submit: (proof: WalletRequestProof, signature: string) => Promise<WalletRequest>;
  decide: (id: string, state: "approved" | "denied", signature?: string) => Promise<WalletRequest>;
};
export type RequestPorts = {
  config: ReleaseConfig; store: RequestStore; roomId?: string;
  actor: (token: string) => Promise<string | null>;
  maker: (makerId: string) => Promise<string>;
  now?: () => number;
};
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export function createWalletRequestHandler(ports: RequestPorts) {
  const roomId = ports.roomId ?? ORIGINAL_ROOM;
  return async (request: Request) => {
    try {
      const requestedRoom = new URL(request.url).searchParams.get("room");
      if (!releaseRoom(roomId) || requestedRoom !== null && requestedRoom !== roomId)
        throw new RequestProblem("Choose a permitted release room.");
      if (!await ports.store.open()) throw new RequestProblem("This room is unavailable.", 404);
      if (request.method === "GET") {
        if (requestedRoom !== roomId) throw new RequestProblem("Choose a release room to review wallet requests.");
        return reply({ requests: await ports.store.list() });
      }
      if (request.method !== "POST") return reply({ error: "This request method is unavailable." }, 405);
      const text = await request.text();
      if (text.length > 4096) throw new RequestProblem("The wallet request is too large.", 413);
      let input;
      try { input = JSON.parse(text); } catch { throw new RequestProblem("Review the wallet request and try again."); }
      if (!input || typeof input !== "object") throw new RequestProblem("Review the wallet request and try again.");
      const now = ports.now?.() ?? Math.floor(Date.now() / 1000);
      if (input.action === "submit") {
        const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
        const actor = token ? await ports.actor(token) : null;
        if (!actor) throw new RequestProblem("Sign in to your storyteller account before sending a request.", 401);
        const proof = verifyWalletRequest(input.proof, input.signature, ports.config, actor, now, roomId);
        if (!sameAddress(await ports.maker(proof.maker_id), ZeroAddress))
          throw new RequestProblem("This byline already has an approved wallet. Use its recorded address to register.", 409);
        await ports.store.submit(proof, input.signature);
      } else if (input.action === "deny" || input.action === "confirm") {
        if (typeof input.id !== "string" || !uuid.test(input.id)) throw new RequestProblem("Choose a saved wallet request.");
        const row = await ports.store.get(input.id);
        if (!row || row.room_id !== roomId || row.project_id !== projectKey(ports.config.curator, roomId)) throw new RequestProblem("This wallet request is unavailable.", 404);
        if (input.action === "deny") verifyDenial(row, input.issuedAt, input.signature, ports.config, now);
        const recorded = await ports.maker(row.maker_id);
        if (sameAddress(recorded, row.wallet_address)) {
          await ports.store.decide(row.id, "approved");
        } else if (input.action === "confirm") {
          throw new RequestProblem("The wallet approval is not confirmed onchain yet. Check the saved action.", 409);
        } else if (row.state === "pending") {
          await ports.store.decide(row.id, "denied", input.signature);
        } else if (row.state !== "denied") {
          throw new RequestProblem("This request has already been reviewed. Refresh before continuing.", 409);
        }
      } else throw new RequestProblem("Choose a wallet-request action.");
      return reply({ requests: await ports.store.list() });
    } catch (error) {
      if (error instanceof RequestProblem) return reply({ error: error.message }, error.status);
      return reply({ error: "Wallet requests could not be checked. Try again before making another request." }, 503);
    }
  };
}

function servicePorts(config: ReleaseConfig, roomId: string): RequestPorts {
  const admin = pilotAdmin();
  const project = projectKey(config.curator, roomId);
  const query = () => admin.from("pilot_wallet_requests");
  const unwrap = <T,>({ data, error }: { data: T; error: { code?: string; message: string } | null }): T => {
    if (error?.code === "P0001" || error?.code === "23505") throw new RequestProblem("A wallet request already exists or its scene changed. Check the saved request before trying again.", 409);
    if (error) throw new Error("Wallet request storage unavailable");
    return data;
  };
  const projectRows = () => query().select(fields).eq("room_id", roomId).eq("project_id", project);
  return {
    config, roomId,
    actor: async token => { const verified = await admin.auth.getUser(token); return verified.error ? null : verified.data.user?.id ?? null; },
    maker: async id => {
      const client = new ReleaseClient(config);
      try { await client.verify(); return String(await client.contract.makers(project, makerKey(id))); }
      finally { client.destroy(); }
    },
    store: {
      open: async () => !!unwrap(await admin.from("pilot_rooms").select("is_open").eq("id", roomId).maybeSingle())?.is_open,
      list: async () => unwrap(await projectRows().order("created_at", { ascending: false }).limit(100)) as WalletRequest[],
      get: async id => unwrap(await projectRows().eq("id", id).maybeSingle()) as WalletRequest | null,
      submit: async (proof, signature) => unwrap(await admin.rpc("pilot_submit_wallet_request", {
        p_id: proof.id, p_room_id: roomId, p_project_id: project, p_moment_id: proof.moment_id,
        p_actor: proof.maker_id, p_wallet: proof.wallet_address, p_issued_at: proof.issued_at, p_signature: signature,
      })) as WalletRequest,
      decide: async (id, state, signature) => {
        const updated = unwrap(await query().update({ state, decided_at: new Date().toISOString(), ...(signature ? { decision_signature: signature } : {}) })
          .eq("id", id).eq("room_id", roomId).eq("project_id", project).eq("state", "pending").select(fields).maybeSingle());
        return (updated ?? unwrap(await projectRows().eq("id", id).single())) as WalletRequest;
      },
    },
  };
}

export async function handleWalletRequests(request: Request) {
  const roomId = new URL(request.url).searchParams.get("room") ?? ORIGINAL_ROOM;
  if (!releaseRoom(roomId)) return reply({ error: "Choose a permitted release room." }, 400);
  const config = releaseConfig();
  if (!config) return reply({ error: "Wallet requests are awaiting room setup." }, 503);
  try { return await createWalletRequestHandler(servicePorts(config, roomId))(request); }
  catch { return reply({ error: "Wallet requests are unavailable. Try checking again." }, 503); }
}
