import { randomUUID } from "node:crypto";
import { getAddress } from "viem";
import { BASE_SEPOLIA, MAX_TIMEOUT_SECONDS, TESTNET_USDC, TOP_UP } from "../x402/ids.ts";
import type { NightWatchStore } from "./store.ts";

/**
 * A Night Watch delegation session: what the maker allowed, until when, and what it has spent.
 *
 * Privy's policy bounds each signature (chain, token, recipient, amount, lifetime, deadline). The
 * cumulative allowance lives here, because a per-signature policy cannot enforce a running total:
 * every payment is reserved under the session lock before it is signed, and a reservation is
 * released only when the payment provably did not settle.
 */

export const BASE_SEPOLIA_CHAIN_ID = 84532;
export const SESSION_ID_PATTERN = /^nws_[a-f0-9]{32}$/;
/** Longest session a maker can authorize in this proof. */
export const MAX_SESSION_HOURS = 12;
/** Longest an authorization Privy may sign can live, in seconds. */
export const AUTHORIZATION_LIFETIME_SECONDS = MAX_TIMEOUT_SECONDS;

export type SessionState = "awaiting_signer" | "active" | "revoked";

export type ReservationState = "reserved" | "signed" | "settled" | "released";

export type Reservation = {
  id: string;
  jobId: string;
  amountAtomic: string;
  state: ReservationState;
  createdAt: string;
  updatedAt: string;
  /** The x402 payer's attempt record, once signed. */
  recordFile?: string;
  transaction?: string | null;
  explorerUrl?: string | null;
  creditsAdded?: number | null;
  note?: string;
};

export type DelegationSession = {
  version: 1;
  id: string;
  makerProfileId: string;
  roomId: string;
  /** Opaque x402 funding reference of the room door this session may pay. */
  fundingRef: string;
  privy: {
    userId: string | null;
    walletId: string;
    walletAddress: string;
    signerId: string;
    policyId: string | null;
  };
  limits: {
    network: typeof BASE_SEPOLIA;
    chainId: number;
    token: string;
    payTo: string;
    maxPaymentAtomic: string;
    totalAllowanceAtomic: string;
    maxPayments: number;
    attemptAllowance: number;
    authorizationLifetimeSeconds: number;
  };
  createdAt: string;
  /** ISO time after which nothing new may be signed. */
  deadline: string;
  state: SessionState;
  confirmedAt?: string;
  revokedAt?: string;
  reservations: Reservation[];
};

export class SessionRefused extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "SessionRefused";
    this.code = code;
  }
}

export const sessionPath = (id: string) => {
  if (!SESSION_ID_PATTERN.test(id)) throw new SessionRefused("invalid_session", "That is not a Night Watch session id.");
  return `sessions/${id}`;
};

export function newSessionId() {
  return `nws_${randomUUID().replace(/-/g, "")}`;
}

/** Atomic units still available to reserve. Released reservations give their amount back. */
export function remainingAllowance(session: DelegationSession): bigint {
  const committed = session.reservations
    .filter((reservation) => reservation.state !== "released")
    .reduce((sum, reservation) => sum + BigInt(reservation.amountAtomic), 0n);
  return BigInt(session.limits.totalAllowanceAtomic) - committed;
}

export function paymentsUsed(session: DelegationSession) {
  return session.reservations.filter((reservation) => reservation.state !== "released").length;
}

/** Why the session cannot sign right now, or null when it can. */
export function sessionBlock(session: DelegationSession, now: Date): { code: string; message: string } | null {
  if (session.state === "revoked") return { code: "revoked", message: "The maker revoked this Night Watch allowance." };
  if (session.state !== "active") return { code: "not_active", message: "The maker has not finished authorizing the Night Watch signer." };
  if (now.getTime() >= Date.parse(session.deadline)) return { code: "expired", message: "This Night Watch allowance has expired." };
  return null;
}

export type NewSessionInput = {
  makerProfileId: string;
  roomId: string;
  fundingRef: string;
  payTo: string;
  privy: DelegationSession["privy"];
  hours: number;
  maxPayments: number;
  attemptAllowance: number;
  now: Date;
};

export function newSession(input: NewSessionInput): DelegationSession {
  if (!(input.hours > 0 && input.hours <= MAX_SESSION_HOURS)) {
    throw new SessionRefused("invalid_deadline", `A Night Watch can be authorized for up to ${MAX_SESSION_HOURS} hours.`);
  }
  if (!Number.isInteger(input.maxPayments) || input.maxPayments < 0 || input.maxPayments > 2) {
    throw new SessionRefused("invalid_allowance", "A Night Watch may buy at most two room top-ups.");
  }
  if (!Number.isInteger(input.attemptAllowance) || input.attemptAllowance < 1 || input.attemptAllowance > 3) {
    throw new SessionRefused("invalid_allowance", "A Night Watch prepares one to three candidate attempts.");
  }
  const deadline = new Date(input.now.getTime() + Math.round(input.hours * 3_600_000));
  return {
    version: 1,
    id: newSessionId(),
    makerProfileId: input.makerProfileId,
    roomId: input.roomId,
    fundingRef: input.fundingRef,
    privy: { ...input.privy, walletAddress: getAddress(input.privy.walletAddress) },
    limits: {
      network: BASE_SEPOLIA,
      chainId: BASE_SEPOLIA_CHAIN_ID,
      token: getAddress(TESTNET_USDC[BASE_SEPOLIA]),
      payTo: getAddress(input.payTo),
      maxPaymentAtomic: TOP_UP.atomic,
      totalAllowanceAtomic: (BigInt(TOP_UP.atomic) * BigInt(input.maxPayments)).toString(),
      maxPayments: input.maxPayments,
      attemptAllowance: input.attemptAllowance,
      authorizationLifetimeSeconds: AUTHORIZATION_LIFETIME_SECONDS,
    },
    createdAt: input.now.toISOString(),
    deadline: deadline.toISOString(),
    state: "awaiting_signer",
    reservations: [],
  };
}

/** Reserves one payment under the session's lock; refuses beyond the deadline, count or total. */
export async function reservePayment(
  store: NightWatchStore,
  sessionId: string,
  request: { jobId: string; amountAtomic: string; now: Date },
): Promise<{ session: DelegationSession; reservation: Reservation }> {
  let reservation: Reservation | undefined;
  const session = await store.update<DelegationSession>(sessionPath(sessionId), (current) => {
    if (!current) throw new SessionRefused("missing_session", "That Night Watch session does not exist.");
    const block = sessionBlock(current, request.now);
    if (block) throw new SessionRefused(block.code, block.message);
    const open = current.reservations.find((item) => item.jobId === request.jobId && (item.state === "reserved" || item.state === "signed"));
    if (open) throw new SessionRefused("payment_in_flight", "This job already has a payment in flight; resume or reconcile it instead.");
    const amount = BigInt(request.amountAtomic);
    if (amount <= 0n || amount > BigInt(current.limits.maxPaymentAtomic)) {
      throw new SessionRefused("over_single_limit", "That payment is larger than the maker allowed for one top-up.");
    }
    if (paymentsUsed(current) >= current.limits.maxPayments) {
      throw new SessionRefused("payment_count_exhausted", "The Night Watch has already used every top-up the maker allowed.");
    }
    if (amount > remainingAllowance(current)) {
      throw new SessionRefused("allowance_exhausted", "That payment would exceed the maker's total Night Watch allowance.");
    }
    const at = request.now.toISOString();
    reservation = { id: randomUUID(), jobId: request.jobId, amountAtomic: amount.toString(), state: "reserved", createdAt: at, updatedAt: at };
    return { ...current, reservations: [...current.reservations, reservation] };
  });
  return { session, reservation: reservation! };
}

/** Moves a reservation forward. A settled payment never goes back; released means it did not settle. */
export async function updateReservation(
  store: NightWatchStore,
  sessionId: string,
  reservationId: string,
  change: Partial<Omit<Reservation, "id" | "jobId" | "amountAtomic" | "createdAt">> & { state: ReservationState },
  now: Date,
  options: { requireOpen?: boolean } = {},
): Promise<DelegationSession> {
  return store.update<DelegationSession>(sessionPath(sessionId), (current) => {
    if (!current) throw new SessionRefused("missing_session", "That Night Watch session does not exist.");
    // Checked under the same lock a revocation takes, so "still allowed" and "now signing" are one step.
    if (options.requireOpen) {
      const block = sessionBlock(current, now);
      if (block) throw new SessionRefused(block.code, block.message);
    }
    const index = current.reservations.findIndex((item) => item.id === reservationId);
    if (index < 0) throw new SessionRefused("missing_reservation", "That reservation does not exist.");
    const existing = current.reservations[index];
    const order: ReservationState[] = ["reserved", "signed", "settled"];
    if (existing.state === "settled" && change.state !== "settled") {
      throw new SessionRefused("settled", "A settled payment cannot be released or reopened.");
    }
    if (existing.state === "released") throw new SessionRefused("released", "A released reservation is final.");
    if (change.state !== "released" && order.indexOf(change.state) < order.indexOf(existing.state)) {
      throw new SessionRefused("backwards", `A ${existing.state} reservation cannot become ${change.state}.`);
    }
    const reservations = [...current.reservations];
    reservations[index] = { ...existing, ...change, updatedAt: now.toISOString() };
    return { ...current, reservations };
  });
}

/** What the maker sees: limits, time left and every payment. */
export function sessionSummary(session: DelegationSession, now: Date) {
  return {
    id: session.id,
    state: sessionBlock(session, now)?.code === "expired" ? "expired" : session.state,
    roomId: session.roomId,
    walletAddress: session.privy.walletAddress,
    deadline: session.deadline,
    limits: {
      maxPaymentAtomic: session.limits.maxPaymentAtomic,
      totalAllowanceAtomic: session.limits.totalAllowanceAtomic,
      maxPayments: session.limits.maxPayments,
      attemptAllowance: session.limits.attemptAllowance,
      payTo: session.limits.payTo,
      token: session.limits.token,
      chainId: session.limits.chainId,
    },
    remainingAtomic: remainingAllowance(session).toString(),
    payments: session.reservations.map(({ id, jobId, amountAtomic, state, transaction, explorerUrl, creditsAdded, updatedAt }) => ({
      id,
      jobId,
      amountAtomic,
      state,
      transaction: transaction ?? null,
      explorerUrl: explorerUrl ?? null,
      creditsAdded: creditsAdded ?? null,
      updatedAt,
    })),
    revokedAt: session.revokedAt ?? null,
  };
}
