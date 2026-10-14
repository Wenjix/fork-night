import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { KeyObject } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAddress } from "viem";
import { denyAllPolicyRules, nightWatchSessionPolicy } from "../../src/privy/policy.ts";
import { generateAuthorizationKey, parseAuthorizationKey, PrivyApiError, type PrivyWallet } from "../../src/privy/rest.ts";
import {
  beginSession,
  confirmSession,
  describeMaker,
  listSessions,
  parseCreateSessionRequest,
  revokeSession,
  RUNNER_HEARTBEAT,
  sessionView,
  VALID_BEFORE_GRACE_SECONDS,
  type DelegationDeps,
} from "../../src/night-watch/delegation.ts";
import { NightWatchError } from "../../src/night-watch/http.ts";
import { jobPath, type JobRecord } from "../../src/night-watch/job-types.ts";
import { embeddedWalletFor, findEmbeddedWallet } from "../../src/night-watch/maker.ts";
import {
  newSession,
  paymentsUsed,
  remainingAllowance,
  reservePayment,
  SESSION_ID_PATTERN,
  sessionPath,
  SessionRefused,
  updateReservation,
  type DelegationSession,
  type NewSessionInput,
} from "../../src/night-watch/session.ts";
import { fileNightWatchStore, type NightWatchStore } from "../../src/night-watch/store.ts";
import { FundingConfigError, type FundingConfig } from "../../src/x402/config.ts";
import { BASE_SEPOLIA, MAX_TIMEOUT_SECONDS, TESTNET_USDC, TOP_UP } from "../../src/x402/ids.ts";

// Test identities and public test addresses only; no request leaves this process.
const MAKER = { id: "95000000-0000-4000-8000-0000000000aa", displayName: "Wenjie" };
const OTHER_MAKER = { id: "95000000-0000-4000-8000-0000000000bb", displayName: "Another maker" };
const STEWARD = "95000000-0000-4000-8000-000000000001";
const PRIVY_USER = "did:privy:night-watch-maker";
const WALLET_ID = "wallet0000000000000000001";
const WALLET = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const OTHER = "0x000000000000000000000000000000000000dEaD";
const PAY_TO = "0x4A6DE1347E9b2E466e5EAe6ba18dd63d7080BfdE";
const REF = "ref_midnight_signal_aaaaaa";
const QUORUM = "quorum000000000000000001";
const KEY = parseAuthorizationKey(generateAuthorizationKey());
const NOW = new Date("2026-10-13T22:00:00.000Z");
const HOUR = 3_600_000;
const JOB_A = `nwj_${"a".repeat(32)}`;
const JOB_B = `nwj_${"b".repeat(32)}`;
const JOB_C = `nwj_${"c".repeat(32)}`;
const TX = `0x${"cd".repeat(32)}`;

async function scratchStore(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "night-watch-session-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, store: fileNightWatchStore(root) };
}

function draftSession(overrides: Partial<NewSessionInput> = {}) {
  return newSession({
    makerProfileId: MAKER.id,
    roomId: "midnight-signal",
    fundingRef: REF,
    payTo: PAY_TO.toLowerCase(),
    privy: { userId: PRIVY_USER, walletId: WALLET_ID, walletAddress: WALLET.toLowerCase(), signerId: QUORUM, policyId: "policy-1" },
    hours: 2,
    maxPayments: 1,
    attemptAllowance: 2,
    now: NOW,
    ...overrides,
  });
}

async function savedSession(store: NightWatchStore, overrides: Partial<NewSessionInput> = {}, changes: Partial<DelegationSession> = { state: "active" }) {
  const session: DelegationSession = { ...draftSession(overrides), ...changes };
  await store.write(sessionPath(session.id), session);
  return session;
}

const reserve = (store: NightWatchStore, sessionId: string, jobId: string, amountAtomic: string = TOP_UP.atomic, now = NOW) =>
  reservePayment(store, sessionId, { jobId, amountAtomic, now });

async function refused(promise: Promise<unknown>, code: string, label = code) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof SessionRefused, `${label}: ${String(error)}`);
    assert.equal(error.code, code, label);
    return true;
  });
}

async function answered(promise: Promise<unknown>, status: number, code: string, label = code) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof NightWatchError, `${label}: ${String(error)}`);
    assert.equal(error.status, status, `${label}: ${error.message}`);
    assert.equal(error.code, code, `${label}: ${error.message}`);
    return true;
  });
}

test("a new session waits for the maker's signer, with limits derived only from the maker's choices", () => {
  const session = draftSession({ maxPayments: 2, attemptAllowance: 3 });
  assert.match(session.id, SESSION_ID_PATTERN);
  assert.equal(session.state, "awaiting_signer");
  assert.equal(session.deadline, new Date(NOW.getTime() + 2 * HOUR).toISOString());
  assert.equal(session.privy.walletAddress, getAddress(WALLET));
  assert.deepEqual(session.limits, {
    network: BASE_SEPOLIA,
    chainId: 84532,
    token: getAddress(TESTNET_USDC[BASE_SEPOLIA]),
    payTo: getAddress(PAY_TO),
    maxPaymentAtomic: TOP_UP.atomic,
    totalAllowanceAtomic: "2000000",
    maxPayments: 2,
    attemptAllowance: 3,
    authorizationLifetimeSeconds: MAX_TIMEOUT_SECONDS,
  });
  assert.deepEqual(session.reservations, []);
  const invalid: [string, Partial<NewSessionInput>][] = [
    ["no time", { hours: 0 }],
    ["over twelve hours", { hours: 12.5 }],
    ["three top-ups", { maxPayments: 3 }],
    ["half a top-up", { maxPayments: 0.5 }],
    ["no attempts", { attemptAllowance: 0 }],
    ["four attempts", { attemptAllowance: 4 }],
  ];
  for (const [name, overrides] of invalid) assert.throws(() => draftSession(overrides), SessionRefused, name);
  // The maker sees an expired session as expired, whatever its stored state.
  assert.equal(sessionView({ ...session, state: "active" }, new Date(Date.parse(session.deadline))).state, "expired");
  assert.equal(sessionView({ ...session, state: "active" }, NOW).state, "active");
});

test("reservations stop at the payment count, the single-payment cap, the total, the deadline and revocation", async (t) => {
  const { store } = await scratchStore(t);
  const session = await savedSession(store);
  const first = await reserve(store, session.id, JOB_A);
  assert.equal(first.reservation.state, "reserved");
  assert.equal(remainingAllowance(first.session), 0n);
  await refused(reserve(store, session.id, JOB_A), "payment_in_flight", "a reserved payment is in flight for the job");
  await updateReservation(store, session.id, first.reservation.id, { state: "signed", recordFile: "payments/attempt.json" }, NOW);
  await refused(reserve(store, session.id, JOB_A), "payment_in_flight", "a signed payment is in flight for the job");
  await refused(reserve(store, session.id, JOB_B), "payment_count_exhausted", "another job may not buy a second top-up");
  await updateReservation(store, session.id, first.reservation.id, { state: "settled", transaction: TX }, NOW);
  await refused(reserve(store, session.id, JOB_B), "payment_count_exhausted", "a settled top-up still counts");

  const two = await savedSession(store, { maxPayments: 2 });
  await refused(reserve(store, two.id, JOB_A, "1000001"), "over_single_limit");
  await refused(reserve(store, two.id, JOB_A, "0"), "over_single_limit", "a zero payment");

  // The running total is the app's own guard: a per-signature Privy policy cannot hold one.
  const limits = { ...draftSession({ maxPayments: 2 }).limits, totalAllowanceAtomic: "1500000" };
  const total = await savedSession(store, { maxPayments: 2 }, { state: "active", limits });
  await reserve(store, total.id, JOB_A);
  await refused(reserve(store, total.id, JOB_B), "allowance_exhausted");

  await refused(reserve(store, two.id, JOB_B, TOP_UP.atomic, new Date(Date.parse(two.deadline))), "expired");
  const waiting = await savedSession(store, {}, { state: "awaiting_signer" });
  await refused(reserve(store, waiting.id, JOB_A), "not_active");
  const revoked = await savedSession(store, {}, { state: "revoked", revokedAt: NOW.toISOString() });
  await refused(reserve(store, revoked.id, JOB_A), "revoked");
  await refused(reserve(store, `nws_${"0".repeat(32)}`, JOB_A), "missing_session");
});

test("a released reservation gives its allowance back; a settled one never goes back", async (t) => {
  const { store } = await scratchStore(t);
  const session = await savedSession(store);
  const { reservation } = await reserve(store, session.id, JOB_A);
  const released = await updateReservation(store, session.id, reservation.id, { state: "released", note: "the door refused" }, NOW);
  assert.equal(remainingAllowance(released), BigInt(TOP_UP.atomic));
  assert.equal(paymentsUsed(released), 0);
  await refused(updateReservation(store, session.id, reservation.id, { state: "signed" }, NOW), "released", "released is final");

  const again = await reserve(store, session.id, JOB_A);
  await updateReservation(store, session.id, again.reservation.id, { state: "signed" }, NOW);
  await refused(updateReservation(store, session.id, again.reservation.id, { state: "reserved" }, NOW), "backwards");
  const settled = await updateReservation(
    store,
    session.id,
    again.reservation.id,
    { state: "settled", transaction: TX, explorerUrl: `https://sepolia.basescan.org/tx/${TX}`, creditsAdded: TOP_UP.credits },
    NOW,
  );
  for (const state of ["released", "signed", "reserved"] as const) {
    await refused(updateReservation(store, session.id, again.reservation.id, { state }, NOW), "settled", `settled cannot become ${state}`);
  }
  await updateReservation(store, session.id, again.reservation.id, { state: "settled", note: "receipt saved" }, NOW);
  assert.equal(remainingAllowance(settled), 0n);
  await refused(updateReservation(store, session.id, "no-such-reservation", { state: "released" }, NOW), "missing_reservation");
  assert.deepEqual(
    sessionView(settled, NOW).payments.map(({ state, transaction, creditsAdded }) => [state, transaction, creditsAdded]),
    [["released", null, null], ["settled", TX, TOP_UP.credits]],
  );
});

test("concurrent reservations from two processes sharing the directory: exactly one wins", async (t) => {
  const { root, store } = await scratchStore(t);
  // Separate handles keep separate in-process queues, so only the file lock stands between them.
  const web = fileNightWatchStore(root);
  const runner = fileNightWatchStore(root);
  const single = await savedSession(store);
  const results = await Promise.allSettled([reserve(web, single.id, JOB_A), reserve(runner, single.id, JOB_B)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const losers = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  assert.equal(losers.length, 1);
  assert.ok(losers[0].reason instanceof SessionRefused && losers[0].reason.code === "payment_count_exhausted");
  assert.equal((await store.read<DelegationSession>(sessionPath(single.id)))?.reservations.length, 1);

  const sameJob = await savedSession(store, { maxPayments: 2 });
  const twice = await Promise.allSettled([reserve(web, sameJob.id, JOB_C), reserve(runner, sameJob.id, JOB_C)]);
  assert.equal(twice.filter((result) => result.status === "fulfilled").length, 1, "one payment in flight per job");
  const duplicate = twice.find((result): result is PromiseRejectedResult => result.status === "rejected");
  assert.ok(duplicate?.reason instanceof SessionRefused && duplicate.reason.code === "payment_in_flight");

  const two = await savedSession(store, { maxPayments: 2 });
  const jobs = Array.from({ length: 6 }, (_, index) => `nwj_${String(index).repeat(32)}`);
  const many = await Promise.allSettled(jobs.map((jobId, index) => reserve(index % 2 ? web : runner, two.id, jobId)));
  assert.equal(many.filter((result) => result.status === "fulfilled").length, 2);
  assert.equal((await store.read<DelegationSession>(sessionPath(two.id)))?.reservations.length, 2);
});

function linkedAccounts(makerId: string, wallet: Record<string, unknown> = {}): Record<string, unknown>[] {
  return [
    { type: "custom_auth", custom_user_id: makerId, verified_at: 1 },
    {
      type: "wallet",
      id: WALLET_ID,
      address: WALLET.toLowerCase(),
      chain_type: "ethereum",
      wallet_client: "privy",
      wallet_client_type: "privy",
      connector_type: "embedded",
      recovery_method: "privy-v2",
      delegated: false,
      imported: false,
      wallet_index: 0,
      ...wallet,
    },
  ];
}

type FakePrivy = NonNullable<DelegationDeps["privy"]>;
type PolicyBody = Parameters<FakePrivy["createPolicy"]>[0];

function fakePrivy() {
  const calls: string[] = [];
  const policies: { id: string; body: PolicyBody }[] = [];
  const updates: { id: string; patch: { rules: unknown[] }; keys: KeyObject[] }[] = [];
  const state = {
    accounts: linkedAccounts(MAKER.id) as Record<string, unknown>[] | null,
    wallet: { id: WALLET_ID, address: WALLET.toLowerCase(), chain_type: "ethereum", additional_signers: [] } as PrivyWallet,
    failUpdate: null as Error | null,
  };
  const privy: FakePrivy = {
    appId: "app-night-watch",
    async userByCustomAuthId(customUserId) {
      calls.push(`user ${customUserId}`);
      return state.accounts ? { id: PRIVY_USER, linked_accounts: state.accounts } : null;
    },
    async createPolicy(body) {
      calls.push("createPolicy");
      const id = `policy${String(policies.length + 1).padStart(18, "0")}`;
      policies.push({ id, body });
      return { id, name: body.name, version: body.version, chain_type: body.chain_type, rules: body.rules };
    },
    async getWallet(id) {
      calls.push(`getWallet ${id}`);
      return structuredClone(state.wallet);
    },
    async updatePolicy(id, patch, keys) {
      calls.push(`updatePolicy ${id}`);
      if (state.failUpdate) throw state.failUpdate;
      updates.push({ id, patch, keys });
      return { id, name: "Night Watch", version: "1.0", chain_type: "ethereum", rules: patch.rules };
    },
  };
  return { privy, calls, policies, updates, state };
}

const doorConfig = (roomId = "midnight-signal"): FundingConfig => ({
  facilitatorUrl: "https://x402.org/facilitator",
  payTo: { [BASE_SEPOLIA]: PAY_TO },
  rooms: { [REF]: { roomId, stewardProfileId: STEWARD, maxTopUps: 2 } },
});

function delegationDeps(store: NightWatchStore, privy: FakePrivy | null, overrides: Partial<DelegationDeps> = {}): DelegationDeps {
  return {
    store,
    privy,
    signer: async () => ({ keyQuorumId: QUORUM, authorizationKey: KEY.privateKey }),
    fundingConfig: async () => doorConfig(),
    now: () => NOW,
    ...overrides,
  };
}

const twoHours = { hours: 2, maxPayments: 1, attemptAllowance: 2 } as const;
const attach = (fake: ReturnType<typeof fakePrivy>, policyId: string) => {
  fake.state.wallet = { ...fake.state.wallet, additional_signers: [{ signer_id: QUORUM, override_policy_ids: [policyId] }] };
};

test("the maker's embedded wallet is found the way the browser finds it, and only through the maker's own link", async () => {
  assert.deepEqual(embeddedWalletFor(MAKER.id, linkedAccounts(MAKER.id, { delegated: true })), {
    id: WALLET_ID,
    address: getAddress(WALLET),
    delegated: true,
    tee: true,
  });
  assert.equal(embeddedWalletFor(MAKER.id, linkedAccounts(OTHER_MAKER.id)), null, "another maker's custom-auth link");
  assert.equal(embeddedWalletFor("", linkedAccounts("")), null);
  assert.equal(embeddedWalletFor(MAKER.id, linkedAccounts(MAKER.id).slice(1)), null, "no custom-auth link at all");
  assert.equal(embeddedWalletFor(MAKER.id, linkedAccounts(MAKER.id, { recovery_method: "privy" }))?.tee, false, "an on-device wallet");
  const custom = linkedAccounts(MAKER.id)[0];
  const embedded = linkedAccounts(MAKER.id)[1];
  const skipped = [
    { ...embedded, chain_type: "solana", id: "solana-wallet", address: "4uxMGnZdLT6Jz2b4FtdBsB77DiobT5WvJsZp68XpGJsA" },
    { ...embedded, id: "external", wallet_client_type: "metamask", wallet_client: "unknown", connector_type: "injected", address: OTHER },
    { ...embedded, type: "smart_wallet", id: "smart", address: OTHER },
    { ...embedded, id: null, address: OTHER },
    { ...embedded, id: "broken", address: "0x1234" },
  ];
  assert.equal(embeddedWalletFor(MAKER.id, [custom, ...skipped])?.id ?? null, null);
  assert.equal(embeddedWalletFor(MAKER.id, [custom, ...skipped, embedded])?.id, WALLET_ID);

  const fake = fakePrivy();
  assert.equal((await findEmbeddedWallet(fake.privy, MAKER.id))?.address, getAddress(WALLET));
  fake.state.accounts = null;
  assert.equal(await findEmbeddedWallet(fake.privy, MAKER.id), null);
});

test("session requests are validated before anything else", () => {
  assert.deepEqual(parseCreateSessionRequest({ hours: 0.25, maxPayments: 0, attemptAllowance: 3, note: "ignored" }), { hours: 0.25, maxPayments: 0, attemptAllowance: 3 });
  assert.deepEqual(parseCreateSessionRequest({ hours: 12, maxPayments: 2, attemptAllowance: 1 }), { hours: 12, maxPayments: 2, attemptAllowance: 1 });
  const ok = { hours: 2, maxPayments: 1, attemptAllowance: 2 };
  const invalid: [string, unknown][] = [
    ["not an object", null],
    ["a list", [ok]],
    ["no hours", { ...ok, hours: undefined }],
    ["under a quarter hour", { ...ok, hours: 0.2 }],
    ["over twelve hours", { ...ok, hours: 12.01 }],
    ["hours as text", { ...ok, hours: "2" }],
    ["endless", { ...ok, hours: Number.POSITIVE_INFINITY }],
    ["three top-ups", { ...ok, maxPayments: 3 }],
    ["a fractional top-up", { ...ok, maxPayments: 1.5 }],
    ["top-ups as text", { ...ok, maxPayments: "1" }],
    ["no attempts", { ...ok, attemptAllowance: 0 }],
    ["four attempts", { ...ok, attemptAllowance: 4 }],
  ];
  for (const [name, body] of invalid) {
    assert.throws(() => parseCreateSessionRequest(body), (error: unknown) => error instanceof NightWatchError && error.status === 400 && error.code === "invalid_request", name);
  }
});

test("beginning a session creates its own Privy policy, owned by the app's key quorum, and waits for the signer", async (t) => {
  const { store } = await scratchStore(t);
  const fake = fakePrivy();
  const result = await beginSession(delegationDeps(store, fake.privy), { maker: MAKER, ...twoHours });
  const saved = await store.read<DelegationSession>(sessionPath(result.session.id));
  assert.ok(saved);
  assert.deepEqual(fake.calls, [`user ${MAKER.id}`, "createPolicy"]);
  const [{ id: policyId, body }] = fake.policies;
  const deadline = Math.floor((NOW.getTime() + 2 * HOUR) / 1000);
  assert.deepEqual(body, {
    ...nightWatchSessionPolicy({
      sessionId: saved.id,
      chainId: 84532,
      token: TESTNET_USDC[BASE_SEPOLIA],
      payTo: PAY_TO,
      maxAmount: BigInt(TOP_UP.atomic),
      deadline,
      latestValidBefore: deadline + VALID_BEFORE_GRACE_SECONDS,
    }),
    owner_id: QUORUM,
  });
  assert.equal(saved.state, "awaiting_signer");
  assert.equal(saved.makerProfileId, MAKER.id);
  assert.equal(saved.roomId, "midnight-signal");
  assert.equal(saved.fundingRef, REF);
  assert.deepEqual(saved.privy, { userId: PRIVY_USER, walletId: WALLET_ID, walletAddress: getAddress(WALLET), signerId: QUORUM, policyId });
  assert.deepEqual(result.signer, { signerId: QUORUM, policyIds: [policyId], address: getAddress(WALLET) });
  assert.deepEqual(result.session, sessionView(saved, NOW));
  assert.equal(result.session.remainingAtomic, TOP_UP.atomic);

  const { purpose, revocation, ...terms } = result.consent;
  assert.deepEqual(terms, {
    roomId: "midnight-signal",
    network: BASE_SEPOLIA,
    token: getAddress(TESTNET_USDC[BASE_SEPOLIA]),
    payTo: getAddress(PAY_TO),
    maxPaymentAtomic: TOP_UP.atomic,
    totalAllowanceAtomic: TOP_UP.atomic,
    maxPayments: 1,
    attemptAllowance: 2,
    deadline: saved.deadline,
  });
  assert.match(purpose, /up to 2 private candidates for the Midnight Signal room \(midnight-signal\)/);
  assert.match(purpose, /operator-paid inference/);
  assert.match(purpose, /up to 1 room top-up of 1\.00 test USDC each on Base Sepolia/);
  assert.match(purpose, /adds 5 test credits to the room/);
  assert.match(purpose, /cannot sign anything else, publish a moment or close an edition/);
  assert.match(revocation, /^Revoke at any time/);
  for (const text of [purpose, revocation]) assert.doesNotMatch(text, /real money|mainnet|funded credits|patron paid|audited/i);
});

test("a session that may not buy top-ups gets a Privy policy that refuses everything", async (t) => {
  const { store } = await scratchStore(t);
  const fake = fakePrivy();
  const result = await beginSession(delegationDeps(store, fake.privy), { maker: MAKER, hours: 1, maxPayments: 0, attemptAllowance: 1 });
  const [{ body }] = fake.policies;
  assert.equal(body.owner_id, QUORUM);
  assert.ok(body.rules.length > 0);
  for (const rule of body.rules as { method: string; action: string; conditions: unknown[] }[]) {
    assert.deepEqual([rule.method, rule.action, rule.conditions], ["*", "DENY", []]);
  }
  assert.equal(result.consent.totalAllowanceAtomic, "0");
  assert.equal(result.session.remainingAtomic, "0");
  assert.match(result.consent.purpose, /may not buy room top-ups/);
});

test("beginning refuses before creating any policy when the door, the wallet or the signer is missing", async (t) => {
  const { store } = await scratchStore(t);
  const fake = fakePrivy();
  const begin = (deps: DelegationDeps) => beginSession(deps, { maker: MAKER, ...twoHours });

  await assert.rejects(begin(delegationDeps(store, fake.privy, { fundingConfig: async () => doorConfig("paper-moon") })), (error: unknown) => {
    assert.ok(error instanceof NightWatchError && error.status === 409 && error.code === "room_not_opted_in");
    assert.match(error.message, /^midnight-signal is not opted into the local x402 door yet; run npm run x402:setup -- init --room midnight-signal/);
    return true;
  });
  await answered(begin(delegationDeps(store, fake.privy, { fundingConfig: async () => null })), 409, "room_not_opted_in", "no door on this machine");
  await answered(
    begin(delegationDeps(store, fake.privy, { fundingConfig: async () => { throw new FundingConfigError("x402 funding config: version must be 1"); } })),
    503,
    "door_config",
  );
  await answered(begin(delegationDeps(store, fake.privy, { fundingConfig: async () => ({ ...doorConfig(), payTo: {} }) })), 409, "door_not_on_base");
  await answered(begin(delegationDeps(store, fake.privy, { signer: async () => null })), 503, "privy_setup");
  await answered(begin(delegationDeps(store, null)), 503, "privy_not_configured");

  fake.state.accounts = null;
  await answered(begin(delegationDeps(store, fake.privy)), 409, "no_wallet", "Privy never saw this maker");
  fake.state.accounts = linkedAccounts(OTHER_MAKER.id);
  await answered(begin(delegationDeps(store, fake.privy)), 409, "no_wallet", "a Privy user linked to someone else");
  fake.state.accounts = linkedAccounts(MAKER.id, { id: null });
  await answered(begin(delegationDeps(store, fake.privy)), 409, "no_wallet", "a wallet Privy does not hold server-side");
  fake.state.accounts = linkedAccounts(MAKER.id, { recovery_method: "privy" });
  await answered(begin(delegationDeps(store, fake.privy)), 409, "wallet_not_tee");

  const down = fakePrivy();
  down.privy.userByCustomAuthId = async () => { throw new PrivyApiError(500, { error: "unavailable" }, "/v1/users/custom_auth/id"); };
  await answered(begin(delegationDeps(store, down.privy)), 502, "privy_error");
  const unreachable = fakePrivy();
  unreachable.privy.createPolicy = async () => { throw new TypeError("fetch failed"); };
  await answered(begin(delegationDeps(store, unreachable.privy)), 502, "privy_unreachable");

  assert.equal(fake.policies.length + down.policies.length, 0);
  assert.deepEqual(await store.list("sessions"), [], "no session was saved");
});

test("confirming requires the Night Watch signer exactly once, limited by exactly this session's policy", async (t) => {
  const { store } = await scratchStore(t);
  const fake = fakePrivy();
  const deps = delegationDeps(store, fake.privy);
  const begun = await beginSession(deps, { maker: MAKER, ...twoHours });
  const id = begun.session.id;
  const [policyId] = begun.signer.policyIds;

  const refusals: [string, PrivyWallet["additional_signers"], string][] = [
    ["no signer yet", [], "signer_missing"],
    ["only another app's signer", [{ signer_id: "someone-else", override_policy_ids: [policyId] }], "signer_missing"],
    ["the signer without a policy, which could sign anything", [{ signer_id: QUORUM }], "signer_policy"],
    ["the signer with another policy", [{ signer_id: QUORUM, override_policy_ids: ["policy-from-elsewhere"] }], "signer_policy"],
    ["the signer with an extra policy", [{ signer_id: QUORUM, override_policy_ids: [policyId, "policy-wider"] }], "signer_policy"],
    ["the signer added twice", [{ signer_id: QUORUM, override_policy_ids: [policyId] }, { signer_id: QUORUM, override_policy_ids: ["older"] }], "signer_duplicated"],
  ];
  for (const [name, signers, code] of refusals) {
    fake.state.wallet = { ...fake.state.wallet, additional_signers: signers };
    await answered(confirmSession(deps, MAKER, id), 409, code, name);
    assert.equal((await store.read<DelegationSession>(sessionPath(id)))?.state, "awaiting_signer", name);
  }
  fake.state.wallet = { ...fake.state.wallet, address: OTHER, additional_signers: [{ signer_id: QUORUM, override_policy_ids: [policyId] }] };
  await answered(confirmSession(deps, MAKER, id), 409, "wallet_mismatch");

  fake.state.wallet = { id: WALLET_ID, address: WALLET, chain_type: "ethereum", additional_signers: [{ signer_id: "other-app" }, { signer_id: QUORUM, override_policy_ids: [policyId] }] };
  for (const [name, maker, sessionId] of [
    ["another maker", OTHER_MAKER, id],
    ["a malformed id", MAKER, "nws_../../privy/setup"],
    ["an unknown id", MAKER, `nws_${"f".repeat(32)}`],
  ] as const) {
    await answered(confirmSession(deps, maker, sessionId), 404, "not_found", name);
  }

  const confirmed = await confirmSession(deps, MAKER, id);
  assert.equal(confirmed.session.state, "active");
  const saved = await store.read<DelegationSession>(sessionPath(id));
  assert.equal(saved?.state, "active");
  assert.equal(saved?.confirmedAt, NOW.toISOString());
  const reads = fake.calls.filter((call) => call.startsWith("getWallet")).length;
  assert.deepEqual(await confirmSession(deps, MAKER, id), confirmed, "a repeat is harmless");
  assert.equal(fake.calls.filter((call) => call.startsWith("getWallet")).length, reads, "and does not ask Privy again");
  await reserve(store, id, JOB_A);

  const late = await beginSession(deps, { maker: MAKER, ...twoHours });
  attach(fake, late.signer.policyIds[0]);
  await answered(confirmSession({ ...deps, now: () => new Date(Date.parse(late.session.deadline)) }, MAKER, late.session.id), 409, "expired");
});

test("revoking stops the app at once and turns the session's Privy policy into a refusal of everything", async (t) => {
  const { store } = await scratchStore(t);
  const fake = fakePrivy();
  const deps = delegationDeps(store, fake.privy);
  const begun = await beginSession(deps, { maker: MAKER, ...twoHours });
  const [policyId] = begun.signer.policyIds;
  attach(fake, policyId);
  await confirmSession(deps, MAKER, begun.session.id);

  await answered(revokeSession(deps, OTHER_MAKER, begun.session.id), 404, "not_found", "another maker");
  await answered(revokeSession(deps, MAKER, "nws_nope"), 404, "not_found", "a malformed id");
  assert.equal(fake.updates.length, 0);
  assert.equal((await store.read<DelegationSession>(sessionPath(begun.session.id)))?.state, "active");

  const revoked = await revokeSession(deps, MAKER, begun.session.id);
  assert.equal(revoked.session.state, "revoked");
  assert.equal(revoked.session.revokedAt, NOW.toISOString());
  assert.equal(revoked.privyPolicyRevoked, true);
  assert.match(revoked.message, /Privy now refuses every request/);
  assert.deepEqual(fake.updates, [{ id: policyId, patch: { rules: denyAllPolicyRules() }, keys: [KEY.privateKey] }]);
  await refused(reserve(store, begun.session.id, JOB_A), "revoked");

  const later = new Date(NOW.getTime() + 60_000);
  const again = await revokeSession({ ...deps, now: () => later }, MAKER, begun.session.id);
  assert.equal(again.session.revokedAt, NOW.toISOString(), "the first revocation time stays");
  assert.equal(fake.updates.length, 2, "a repeat asks Privy again");
  await answered(confirmSession(deps, MAKER, begun.session.id), 409, "revoked");
});

test("revocation holds locally even when Privy fails, is not configured, or the app key is missing", async (t) => {
  const { store } = await scratchStore(t);
  const fake = fakePrivy();
  const deps = delegationDeps(store, fake.privy);

  const first = await beginSession(deps, { maker: MAKER, ...twoHours });
  fake.state.failUpdate = new PrivyApiError(503, { error: "unavailable" }, `/v1/policies/${first.signer.policyIds[0]}`);
  const failed = await revokeSession(deps, MAKER, first.session.id);
  assert.equal(failed.session.state, "revoked");
  assert.equal(failed.privyPolicyRevoked, false);
  assert.match(failed.message, /could not be changed \(Privy .* answered 503: unavailable\)/);
  assert.match(failed.message, /Remove the Night Watch signer from your wallet/);
  assert.equal((await store.read<DelegationSession>(sessionPath(first.session.id)))?.state, "revoked");
  await refused(reserve(store, first.session.id, JOB_A), "revoked");

  const second = await beginSession(deps, { maker: MAKER, ...twoHours });
  const offline = await revokeSession({ ...deps, privy: null }, MAKER, second.session.id);
  assert.equal(offline.session.state, "revoked");
  assert.match(offline.message, /Privy is not configured/);

  const third = await beginSession(deps, { maker: MAKER, ...twoHours });
  const keyless = await revokeSession({ ...deps, signer: async () => null }, MAKER, third.session.id);
  assert.equal(keyless.session.state, "revoked");
  assert.equal(keyless.privyPolicyRevoked, false);
});

function jobRecord(fields: Pick<JobRecord, "id" | "makerId" | "createdAt"> & Partial<JobRecord>): JobRecord {
  const forkPoint = { id: "10000000-0000-4000-8000-000000000001", title: "The lighthouse wakes", makerLabel: "Wenjie" };
  return {
    version: 1,
    makerLabel: "Wenjie",
    sessionId: `nws_${"1".repeat(32)}`,
    roomId: "midnight-signal",
    forkPointId: forkPoint.id,
    forkPoint,
    brief: "The paper boat returns carrying a reply.",
    attempts: 2,
    kit: { id: "midnight-signal", version: "1", digest: "0".repeat(64) },
    state: "scheduled",
    message: "Scheduled.",
    runAfter: fields.createdAt,
    updatedAt: fields.createdAt,
    capacity: { neededCredits: 2, availableAtCheck: null, charged: 0, refunded: 0 },
    reservationId: null,
    paymentRecordFile: null,
    candidates: [],
    publishedMomentId: null,
    ...fields,
  };
}

test("the maker sees only their own sessions and jobs, newest first, with Privy and runner status", async (t) => {
  const quiet = t.mock.method(console, "error", () => undefined);
  const { store } = await scratchStore(t);
  const fake = fakePrivy();
  const older = await beginSession(delegationDeps(store, fake.privy), { maker: MAKER, ...twoHours });
  const newer = await beginSession(delegationDeps(store, fake.privy, { now: () => new Date(NOW.getTime() + 60_000) }), { maker: MAKER, ...twoHours });
  fake.state.accounts = linkedAccounts(OTHER_MAKER.id);
  await beginSession(delegationDeps(store, fake.privy), { maker: OTHER_MAKER, ...twoHours });
  fake.state.accounts = linkedAccounts(MAKER.id, { delegated: true });

  const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString();
  const mine = jobRecord({ id: JOB_A, makerId: MAKER.id, sessionId: older.session.id, createdAt: at(1_000), state: "ready", message: "Two candidates are ready." });
  const latest = jobRecord({ id: JOB_C, makerId: MAKER.id, sessionId: newer.session.id, createdAt: at(2_000) });
  await store.write(jobPath(JOB_A), mine);
  await store.write(jobPath(JOB_B), jobRecord({ id: JOB_B, makerId: OTHER_MAKER.id, createdAt: at(3_000) }));
  await store.write(jobPath(JOB_C), latest);
  await store.appendEvent(`${jobPath(JOB_A)}-events`, { step: "checking", detail: "an event log is not a job" });
  await store.write(RUNNER_HEARTBEAT, { at: at(-5_000), pid: 1 });

  const me = await describeMaker(delegationDeps(store, fake.privy), MAKER);
  assert.deepEqual(me.maker, MAKER);
  assert.deepEqual(me.privy, { configured: true, wallet: { id: WALLET_ID, address: getAddress(WALLET), delegated: true, tee: true }, signerId: QUORUM });
  assert.deepEqual(me.sessions.map((session) => session.id), [newer.session.id, older.session.id]);
  assert.deepEqual(me.jobs, [latest, mine].map((job) => ({
    id: job.id,
    state: job.state,
    sessionId: job.sessionId,
    forkPointId: job.forkPointId,
    createdAt: job.createdAt,
    runAfter: job.runAfter,
    updatedAt: job.updatedAt,
    message: job.message,
  })));
  assert.deepEqual(me.runner, { lastSeen: at(-5_000), alive: true });

  await store.write(RUNNER_HEARTBEAT, { at: at(-20_000) });
  assert.deepEqual((await describeMaker(delegationDeps(store, fake.privy), MAKER)).runner, { lastSeen: at(-20_000), alive: false });

  // Without Privy on this machine, or with Privy down, the page still gets everything else.
  const bare = await describeMaker(delegationDeps(store, null), MAKER);
  assert.deepEqual(bare.privy, { configured: false, wallet: null, signerId: null });
  assert.equal(bare.sessions.length, 2);
  const down = fakePrivy();
  down.privy.userByCustomAuthId = async () => { throw new TypeError("fetch failed"); };
  const degraded = await describeMaker(delegationDeps(store, down.privy), MAKER);
  assert.deepEqual(degraded.privy, { configured: true, wallet: null, signerId: QUORUM });
  const unsetup = await describeMaker(delegationDeps(store, fake.privy, { signer: async () => { throw new NightWatchError(503, "privy_setup", "mismatched key"); } }), MAKER);
  assert.equal(unsetup.privy.configured, false);
  assert.ok(quiet.mock.callCount() >= 2, "failures are logged for the operator");

  const empty = await scratchStore(t);
  const nothing = await describeMaker(delegationDeps(empty.store, fake.privy), OTHER_MAKER);
  assert.deepEqual([nothing.sessions, nothing.jobs, nothing.runner], [[], [], { lastSeen: null, alive: false }]);
  assert.deepEqual(await listSessions(store, OTHER_MAKER.id, NOW).then((views) => views.length), 1);
});

test("marking a payment signed re-checks revocation under the same lock (no sign after Revoke)", async (t) => {
  const { store } = await scratchStore(t);
  const session = await savedSession(store);
  const { reservation } = await reserve(store, session.id, JOB_A);
  // The maker revokes between the runner's reservation and the moment it would sign.
  await store.update<DelegationSession>(sessionPath(session.id), (current) => ({ ...current!, state: "revoked", revokedAt: NOW.toISOString() }));
  await refused(updateReservation(store, session.id, reservation.id, { state: "signed", note: "nonce=0x01" }, NOW, { requireOpen: true }), "revoked");
  const saved = await store.read<DelegationSession>(sessionPath(session.id));
  assert.equal(saved!.reservations[0].state, "reserved", "the reservation was never marked signed");
  // Expiry is refused the same way.
  const other = await savedSession(store);
  const second = (await reserve(store, other.id, JOB_B)).reservation;
  await refused(updateReservation(store, other.id, second.id, { state: "signed" }, new Date(NOW.getTime() + 3 * HOUR), { requireOpen: true }), "expired");
  // Without the option (bookkeeping after a send), a revoked session can still record its outcome.
  const settled = await updateReservation(store, session.id, reservation.id, { state: "released", note: "never sent" }, NOW);
  assert.equal(settled.reservations[0].state, "released");
});
