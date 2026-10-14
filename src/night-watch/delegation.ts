import type { KeyObject } from "node:crypto";
import { denyAllPolicyRules, nightWatchSessionPolicy } from "../privy/policy.ts";
import { createPrivyRest, PrivyApiError, type PrivyRest, type PrivyWallet } from "../privy/rest.ts";
import { FundingConfigError, loadFundingConfig, type FundingConfig } from "../x402/config.ts";
import { BASE_SEPOLIA, TOP_UP } from "../x402/ids.ts";
import {
  NIGHT_WATCH_ROOM,
  type ConsentTerms,
  type CreateSessionRequest,
  type CreateSessionResponse,
  type JobSummary,
  type MeResponse,
  type SessionResponse,
  type SessionView,
} from "./api-types.ts";
import { NightWatchError } from "./http.ts";
import { JOB_ID_PATTERN, jobPath, type JobRecord } from "./job-types.ts";
import { findEmbeddedWallet, findPrivyMaker, type Maker } from "./maker.ts";
import { authorizationKey, privyCredentials, readPrivySetup } from "./privy-setup.ts";
import { MAX_SESSION_HOURS, newSession, SESSION_ID_PATTERN, sessionPath, sessionSummary, type DelegationSession } from "./session.ts";
import { fileNightWatchStore, type NightWatchStore } from "./store.ts";

/**
 * The maker's side of a Night Watch: authorize a session (a per-session Privy policy the maker's
 * wallet attaches to the app's signer), confirm that Privy shows exactly that signer and policy, and
 * revoke. The app's own refusal (the session state) changes first and never depends on Privy.
 */

export const MIN_SESSION_HOURS = 0.25;
/** An authorization signed just before the deadline may stay valid for its own short lifetime. */
export const VALID_BEFORE_GRACE_SECONDS = 150;
export const RUNNER_HEARTBEAT = "runner/heartbeat";
const RUNNER_FRESH_MS = 15_000;
const MAX_JOBS_SHOWN = 50;
const SETUP_HINT = "Run node --env-file-if-exists=.env.local scripts/night-watch-privy.ts setup on this machine first.";

/** The app's Night Watch signer: the key quorum makers add, and the key that owns session policies. */
export type NightWatchSigner = { keyQuorumId: string; authorizationKey: KeyObject };

export type DelegationDeps = {
  store: NightWatchStore;
  /** Null when Privy is not configured on this machine; revocation still works locally. */
  privy: Pick<PrivyRest, "appId" | "createPolicy" | "getWallet" | "updatePolicy" | "userByCustomAuthId"> | null;
  /** Null before the Privy setup ran on this machine. */
  signer: () => Promise<NightWatchSigner | null>;
  /** The local x402 door's opt-ins; null when this machine has none. */
  fundingConfig: () => Promise<FundingConfig | null>;
  now: () => Date;
};

export async function loadNightWatchSigner(store: NightWatchStore, appId: string): Promise<NightWatchSigner | null> {
  const setup = await readPrivySetup(store);
  if (!setup) return null;
  if (setup.appId !== appId) {
    throw new NightWatchError(503, "privy_setup", "The saved Night Watch signer belongs to another Privy app. Set Privy up again for this app.");
  }
  let key: Awaited<ReturnType<typeof authorizationKey>>;
  try {
    key = await authorizationKey(store);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    throw new NightWatchError(503, "privy_setup", "The Night Watch authorization key is missing from this machine; restore it or set Privy up again.");
  }
  if (key.publicKey !== setup.publicKey) {
    throw new NightWatchError(503, "privy_setup", "The saved key quorum belongs to a different authorization key. Run the Night Watch Privy check.");
  }
  return { keyQuorumId: setup.keyQuorumId, authorizationKey: key.privateKey };
}

/** What the routes use: the local store, Privy over REST when configured, and this machine's x402 door. */
export function localDelegationDeps(env: NodeJS.ProcessEnv = process.env, store: NightWatchStore = fileNightWatchStore()): DelegationDeps {
  const credentials = privyCredentials(env);
  return {
    store,
    privy: credentials ? createPrivyRest(credentials) : null,
    signer: async () => (credentials ? loadNightWatchSigner(store, credentials.appId) : null),
    fundingConfig: () => loadFundingConfig(),
    now: () => new Date(),
  };
}

/** `sessionSummary` typed for the API: its state is always a session state or "expired". */
export function sessionView(session: DelegationSession, now: Date): SessionView {
  const summary = sessionSummary(session, now);
  return { ...summary, state: summary.state === "expired" ? "expired" : session.state };
}

const invalid = (message: string) => new NightWatchError(400, "invalid_request", message);

export function parseCreateSessionRequest(raw: unknown): CreateSessionRequest {
  const input = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const { hours, maxPayments, attemptAllowance } = input;
  if (typeof hours !== "number" || !Number.isFinite(hours) || hours < MIN_SESSION_HOURS || hours > MAX_SESSION_HOURS) {
    throw invalid(`Choose a Night Watch between ${MIN_SESSION_HOURS} and ${MAX_SESSION_HOURS} hours long.`);
  }
  if (maxPayments !== 0 && maxPayments !== 1 && maxPayments !== 2) throw invalid("A Night Watch may buy zero, one or two room top-ups.");
  if (attemptAllowance !== 1 && attemptAllowance !== 2 && attemptAllowance !== 3) throw invalid("A Night Watch prepares one to three candidates.");
  return { hours, maxPayments, attemptAllowance };
}

function requirePrivy(deps: DelegationDeps) {
  if (deps.privy) return deps.privy;
  throw new NightWatchError(503, "privy_not_configured", "Privy is not configured on this machine (NEXT_PUBLIC_PRIVY_APP_ID and PRIVY_APP_SECRET).");
}

async function requireSigner(deps: DelegationDeps) {
  const signer = await deps.signer();
  if (signer) return signer;
  throw new NightWatchError(503, "privy_setup", `The Night Watch signer is not set up. ${SETUP_HINT}`);
}

/** Runs one Privy call, turning its failure into an answer the page can show. Nothing is signed by these calls. */
async function askPrivy<T>(action: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof PrivyApiError) throw new NightWatchError(502, "privy_error", `Privy could not ${action}: ${error.message.slice(0, 240)}`);
    throw new NightWatchError(502, "privy_unreachable", `Privy did not answer while trying to ${action}.`);
  }
}

/** The room door this session may pay: the local x402 opt-in for Midnight Signal and its Base Sepolia recipient. */
async function roomDoor(deps: DelegationDeps): Promise<{ fundingRef: string; payTo: string }> {
  let config: FundingConfig | null;
  try {
    config = await deps.fundingConfig();
  } catch (error) {
    if (!(error instanceof FundingConfigError)) throw error;
    throw new NightWatchError(503, "door_config", "The local x402 door configuration could not be read; run npm run x402:setup -- check.");
  }
  const fundingRef = Object.entries(config?.rooms ?? {}).find(([, room]) => room.roomId === NIGHT_WATCH_ROOM)?.[0];
  if (!config || !fundingRef) {
    throw new NightWatchError(
      409,
      "room_not_opted_in",
      `${NIGHT_WATCH_ROOM} is not opted into the local x402 door yet; run npm run x402:setup -- init --room ${NIGHT_WATCH_ROOM} --steward <profileUuid> --max-top-ups <n> first.`,
    );
  }
  const payTo = config.payTo[BASE_SEPOLIA];
  if (!payTo) throw new NightWatchError(409, "door_not_on_base", "The local x402 door has no Base Sepolia receiving address; run npm run x402:setup -- check.");
  return { fundingRef, payTo };
}

/**
 * The session's own Privy policy, owned by the app's key quorum so the server can turn it off. A
 * session that may not buy top-ups gets a policy that refuses everything rather than one the app
 * alone would have to hold back.
 */
export function sessionPolicy(session: DelegationSession, ownerId: string) {
  const name = `Night Watch ${session.id}`.slice(0, 50);
  if (session.limits.maxPayments === 0) {
    const rules = [{ name: "No room top-ups allowed", method: "*", conditions: [], action: "DENY" }];
    return { version: "1.0" as const, name, chain_type: "ethereum" as const, rules, owner_id: ownerId };
  }
  const deadline = Math.floor(Date.parse(session.deadline) / 1000);
  const policy = nightWatchSessionPolicy({
    sessionId: session.id,
    chainId: session.limits.chainId,
    token: session.limits.token,
    payTo: session.limits.payTo,
    maxAmount: BigInt(session.limits.maxPaymentAtomic),
    deadline,
    latestValidBefore: deadline + VALID_BEFORE_GRACE_SECONDS,
  });
  return { ...policy, owner_id: ownerId };
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const testUsdc = (atomic: string) => (Number(BigInt(atomic)) / 1_000_000).toFixed(2);

export const REVOCATION_TERMS =
  "Revoke at any time from this page. The app stops signing for this Night Watch at once, its Privy policy is changed to refuse every request, and the Night Watch signer is removed from your wallet. A top-up already signed may still settle. The allowance also ends on its own at the deadline.";

function consentPurpose(maxPayments: number, attempts: number) {
  const drafts = `Night Watch may prepare up to ${plural(attempts, "private candidate")} for the Midnight Signal room (${NIGHT_WATCH_ROOM}) while you are away; the images are operator-paid inference.`;
  if (maxPayments === 0) {
    return `${drafts} It may not buy room top-ups, so Privy refuses every signature it asks for. It cannot publish a moment or close an edition.`;
  }
  const payments = `Only if the room runs short of test credits, it may sign up to ${plural(maxPayments, "room top-up")} of ${testUsdc(TOP_UP.atomic)} test USDC each on Base Sepolia, from your in-app wallet to the room's x402 door; each top-up adds ${TOP_UP.credits} test credits to the room.`;
  return `${drafts} ${payments} It cannot sign anything else, publish a moment or close an edition.`;
}

export function consentTerms(session: DelegationSession): ConsentTerms {
  const { limits } = session;
  return {
    purpose: consentPurpose(limits.maxPayments, limits.attemptAllowance),
    roomId: session.roomId,
    network: limits.network,
    token: limits.token,
    payTo: limits.payTo,
    maxPaymentAtomic: limits.maxPaymentAtomic,
    totalAllowanceAtomic: limits.totalAllowanceAtomic,
    maxPayments: limits.maxPayments,
    attemptAllowance: limits.attemptAllowance,
    deadline: session.deadline,
    revocation: REVOCATION_TERMS,
  };
}

export type BeginSessionInput = CreateSessionRequest & { maker: Maker };

/** Creates the session's Privy policy and saves the session awaiting the maker's signer. Signs nothing. */
export async function beginSession(deps: DelegationDeps, input: BeginSessionInput): Promise<CreateSessionResponse> {
  const request = parseCreateSessionRequest(input);
  const privy = requirePrivy(deps);
  const signer = await requireSigner(deps);
  const door = await roomDoor(deps);
  const found = await askPrivy("find your in-app wallet", () => findPrivyMaker(privy, input.maker.id));
  const wallet = found?.wallet;
  if (!found || !wallet) {
    throw new NightWatchError(409, "no_wallet", "Privy has no in-app wallet for your account yet. Open your in-app wallet on this machine, then authorize again.");
  }
  if (!wallet.tee) {
    throw new NightWatchError(409, "wallet_not_tee", "Your in-app wallet cannot take a Night Watch signer: Privy reports it as an on-device wallet, not a server-side (TEE) wallet.");
  }
  const now = deps.now();
  const draft = newSession({
    makerProfileId: input.maker.id,
    roomId: NIGHT_WATCH_ROOM,
    fundingRef: door.fundingRef,
    payTo: door.payTo,
    privy: { userId: found.userId, walletId: wallet.id, walletAddress: wallet.address, signerId: signer.keyQuorumId, policyId: null },
    hours: request.hours,
    maxPayments: request.maxPayments,
    attemptAllowance: request.attemptAllowance,
    now,
  });
  const policy = await askPrivy("create this Night Watch's policy", () => privy.createPolicy(sessionPolicy(draft, signer.keyQuorumId)));
  if (!policy || typeof policy.id !== "string" || !policy.id) throw new NightWatchError(502, "privy_error", "Privy created the policy without an id.");
  const session: DelegationSession = { ...draft, privy: { ...draft.privy, policyId: policy.id } };
  if (!(await deps.store.create(sessionPath(session.id), session))) throw new Error("A Night Watch session id was reused.");
  return {
    session: sessionView(session, now),
    consent: consentTerms(session),
    signer: { signerId: signer.keyQuorumId, policyIds: [policy.id], address: wallet.address },
  };
}

const sessionNotFound = () => new NightWatchError(404, "not_found", "That Night Watch session does not exist.");

/** Another maker's session answers exactly like a missing one. */
function ownedOrMissing(session: DelegationSession | null, maker: Maker): DelegationSession {
  if (!session || session.makerProfileId !== maker.id) throw sessionNotFound();
  return session;
}

async function ownSession(store: NightWatchStore, maker: Maker, id: string) {
  if (!SESSION_ID_PATTERN.test(id)) throw sessionNotFound();
  return ownedOrMissing(await store.read<DelegationSession>(sessionPath(id)), maker);
}

function refuseClosed(session: DelegationSession, now: Date) {
  if (session.state === "revoked") throw new NightWatchError(409, "revoked", "This Night Watch was revoked. Start a new one to authorize again.");
  if (now.getTime() >= Date.parse(session.deadline)) throw new NightWatchError(409, "expired", "This Night Watch allowance has expired. Start a new one.");
}

/**
 * Why the wallet does not (yet) carry exactly this session's signer, or null. The signer must appear
 * once, limited by this session's policy alone: a signer without an override policy could sign anything.
 */
export function signerProblem(wallet: Pick<PrivyWallet, "address" | "additional_signers">, session: DelegationSession): { code: string; message: string } | null {
  if (String(wallet.address).toLowerCase() !== session.privy.walletAddress.toLowerCase()) {
    return { code: "wallet_mismatch", message: "Privy returned a different wallet than the one this Night Watch was authorized for." };
  }
  const entries = (wallet.additional_signers ?? []).filter((entry) => entry.signer_id === session.privy.signerId);
  if (!entries.length) {
    return { code: "signer_missing", message: "Your wallet does not list the Night Watch signer yet. Add it with this Night Watch's policy, then confirm again." };
  }
  if (entries.length > 1) {
    return { code: "signer_duplicated", message: "Your wallet lists the Night Watch signer more than once. Remove its signers, add the Night Watch signer once, then confirm again." };
  }
  const policies = entries[0].override_policy_ids ?? [];
  if (policies.length !== 1 || policies[0] !== session.privy.policyId) {
    return { code: "signer_policy", message: "The Night Watch signer on your wallet is not limited by this Night Watch's policy. Remove its signers, add it again with this policy, then confirm again." };
  }
  return null;
}

/** Activates the session once Privy shows the signer with this session's policy. Repeats are harmless. */
export async function confirmSession(deps: DelegationDeps, maker: Maker, id: string): Promise<SessionResponse> {
  const session = await ownSession(deps.store, maker, id);
  const now = deps.now();
  if (session.state === "active") return { session: sessionView(session, now) };
  refuseClosed(session, now);
  const privy = requirePrivy(deps);
  if (!session.privy.policyId) throw new NightWatchError(409, "no_policy", "This Night Watch has no Privy policy. Start a new one.");
  const wallet = await askPrivy("read your wallet", () => privy.getWallet(session.privy.walletId));
  const problem = signerProblem(wallet, session);
  if (problem) throw new NightWatchError(409, problem.code, problem.message);
  const confirmed = await deps.store.update<DelegationSession>(sessionPath(session.id), (current) => {
    const mine = ownedOrMissing(current, maker);
    if (mine.state === "active") return mine;
    refuseClosed(mine, now);
    return { ...mine, state: "active", confirmedAt: now.toISOString() };
  });
  return { session: sessionView(confirmed, now) };
}

/** `SessionResponse` plus what happened at Privy; the page may show `message`. */
import type { RevokeSessionResponse } from "./api-types.ts";
export type { RevokeSessionResponse };

/**
 * Revokes locally first (from then on the app refuses to sign for the session), then asks Privy to
 * refuse everything under the session's policy. Repeats keep the first revocation time and retry Privy.
 */
export async function revokeSession(deps: DelegationDeps, maker: Maker, id: string): Promise<RevokeSessionResponse> {
  if (!SESSION_ID_PATTERN.test(id)) throw sessionNotFound();
  const now = deps.now();
  const revoked = await deps.store.update<DelegationSession>(sessionPath(id), (current) => {
    const mine = ownedOrMissing(current, maker);
    return mine.state === "revoked" ? mine : { ...mine, state: "revoked", revokedAt: now.toISOString() };
  });
  return { session: sessionView(revoked, now), ...(await denyPolicy(deps, revoked)) };
}

async function denyPolicy(deps: DelegationDeps, session: DelegationSession) {
  const done = "This Night Watch is revoked and the app will not sign anything more for it";
  const policyId = session.privy.policyId;
  if (!policyId) return { privyPolicyRevoked: false, message: `${done}; it never had a Privy policy.` };
  try {
    if (!deps.privy) throw new Error("Privy is not configured on this machine");
    const signer = await deps.signer();
    if (!signer) throw new Error("the Night Watch key is not set up on this machine");
    await deps.privy.updatePolicy(policyId, { rules: denyAllPolicyRules() }, [signer.authorizationKey]);
    return { privyPolicyRevoked: true, message: `${done}. Privy now refuses every request under its policy.` };
  } catch (error) {
    const reason = (error instanceof Error ? error.message : String(error)).slice(0, 240);
    return {
      privyPolicyRevoked: false,
      message: `${done}, but its Privy policy could not be changed (${reason}). Remove the Night Watch signer from your wallet to be sure.`,
    };
  }
}

/** Logs a failure the page can live without and carries on with null. */
const quietly = (what: string) => (error: unknown): null => {
  console.error(`[night-watch] ${what}:`, error instanceof Error ? error.message : error);
  return null;
};

/** The maker's sessions, newest first. */
export async function listSessions(store: NightWatchStore, makerId: string, now: Date = new Date()): Promise<SessionView[]> {
  const names = (await store.list("sessions")).filter((name) => SESSION_ID_PATTERN.test(name));
  const sessions = await Promise.all(names.map((name) => store.read<DelegationSession>(sessionPath(name)).catch(quietly(`skipped session ${name}`))));
  return sessions
    .filter((session): session is DelegationSession => session !== null && session.makerProfileId === makerId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((session) => sessionView(session, now));
}

export function jobSummary(job: JobRecord): JobSummary {
  return {
    id: job.id,
    state: job.state,
    sessionId: job.sessionId,
    forkPointId: job.forkPointId,
    createdAt: job.createdAt,
    runAfter: job.runAfter,
    updatedAt: job.updatedAt,
    message: job.message,
  };
}

/** The maker's jobs, newest first, read straight from the job records. */
export async function listJobSummaries(store: NightWatchStore, makerId: string): Promise<JobSummary[]> {
  const names = (await store.list("jobs")).filter((name) => JOB_ID_PATTERN.test(name));
  const jobs = await Promise.all(names.map((name) => store.read<JobRecord>(jobPath(name)).catch(quietly(`skipped job ${name}`))));
  return jobs
    .filter((job): job is JobRecord => job !== null && job.makerId === makerId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_JOBS_SHOWN)
    .map(jobSummary);
}

export async function runnerStatus(store: NightWatchStore, now: Date): Promise<MeResponse["runner"]> {
  const heartbeat = await store.read<{ at?: unknown }>(RUNNER_HEARTBEAT).catch(quietly("unreadable runner heartbeat"));
  const at = typeof heartbeat?.at === "string" && Number.isFinite(Date.parse(heartbeat.at)) ? heartbeat.at : null;
  return { lastSeen: at, alive: at !== null && now.getTime() - Date.parse(at) < RUNNER_FRESH_MS };
}

/** GET /me: never fails because Privy is missing or down; the page shows what is known. */
export async function describeMaker(deps: DelegationDeps, maker: Maker): Promise<MeResponse> {
  const now = deps.now();
  const privy = deps.privy;
  const [signer, wallet, sessions, jobs, runner] = await Promise.all([
    privy ? deps.signer().catch(quietly("Night Watch signer unavailable")) : null,
    privy ? findEmbeddedWallet(privy, maker.id).catch(quietly("Privy wallet lookup failed")) : null,
    listSessions(deps.store, maker.id, now),
    listJobSummaries(deps.store, maker.id),
    runnerStatus(deps.store, now),
  ]);
  return {
    maker: { id: maker.id, displayName: maker.displayName },
    privy: {
      configured: signer !== null,
      wallet: wallet ? { id: wallet.id, address: wallet.address, delegated: wallet.delegated, tee: wallet.tee } : null,
      signerId: signer?.keyQuorumId ?? null,
    },
    sessions,
    jobs,
    runner,
  };
}
