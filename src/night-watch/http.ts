import { allowsLocalX402 } from "../x402/gate.ts";

/**
 * Route helpers for the local-only Night Watch API. Import this module statically from routes; it
 * loads nothing heavy. Load everything else with `await import(...)` after `localOnly` passes.
 */

const NO_STORE = { "Cache-Control": "no-store" } as const;

export class NightWatchError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "NightWatchError";
    this.status = status;
    this.code = code;
  }
}

export function reply(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

export const notFound = () => reply({ error: "Not found." }, 404);

/** The same opt-in and loopback checks as the local x402 door; anything else looks absent. */
export function localOnly(request: Request): Response | null {
  return allowsLocalX402(request) ? null : notFound();
}

/** Maps thrown errors to a JSON reply without leaking internals. */
export function failure(error: unknown) {
  if (error instanceof NightWatchError) return reply({ error: error.message, code: error.code }, error.status);
  const named = error as { name?: string; code?: string; message?: string };
  if (named?.name === "SessionRefused" || named?.name === "DelegationRefused" || named?.name === "ClaimRefused") {
    return reply({ error: named.message ?? "Refused.", code: named.code ?? "refused" }, 409);
  }
  console.error("[night-watch]", error);
  return reply({ error: "The Night Watch could not finish that request. Nothing was signed or published.", code: "internal" }, 500);
}

export function bearer(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ") || header.length < 20) throw new NightWatchError(401, "sign_in", "Sign in on this machine first.");
  return header.slice(7);
}

export async function readJson<T>(request: Request, maxBytes = 4096): Promise<T> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > maxBytes) throw new NightWatchError(413, "too_large", "That request is too large.");
  const text = await request.text();
  if (text.length > maxBytes) throw new NightWatchError(413, "too_large", "That request is too large.");
  try {
    return (text ? JSON.parse(text) : {}) as T;
  } catch {
    throw new NightWatchError(400, "invalid_json", "That request is not valid JSON.");
  }
}
