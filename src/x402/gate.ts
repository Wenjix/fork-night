import { createHash, timingSafeEqual } from "node:crypto";
import { AGENT_TOKEN_HEADER, readAgentToken } from "./config.ts";

const loopback = (host: string) =>
  ["localhost", "127.0.0.1", "[::1]", "::1"].includes(host);

/**
 * The x402 top-up exists only on an explicitly enabled local server. Every input here is a
 * header the client controls, so these checks are browser hygiene (DNS rebinding, cross-site
 * posts), not proof of locality: the route also requires the local agent token.
 */
export function allowsLocalX402(request: Request) {
  if (process.env.PILOT_LOCAL_CONTROLS !== "1" || process.env.VERCEL) return false;
  let url: URL;
  try { url = new URL(request.url); } catch { return false; }
  if (!loopback(url.hostname)) return false;
  const host = request.headers.get("host");
  if (host) {
    try {
      const hostUrl = new URL(`${url.protocol}//${host}`);
      if (!loopback(hostUrl.hostname) || hostUrl.host !== host || hostUrl.port !== url.port)
        return false;
    } catch { return false; }
  }
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost && forwardedHost.split(",").some((value) => {
    try { return !loopback(new URL(`http://${value.trim()}`).hostname); } catch { return true; }
  })) return false;
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded?.split(",").some((ip) => !loopback(ip.trim()))) return false;
  // Browsers may reach a loopback server from another site; agents send neither header.
  const origin = request.headers.get("origin");
  if (origin !== null) {
    try { if (!loopback(new URL(origin).hostname)) return false; } catch { return false; }
  }
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  return true;
}

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest();

/** What proves a local agent: the token from this machine's .local/x402/agent-token file. */
export async function agentAuthorized(request: Request): Promise<boolean> {
  const presented = request.headers.get(AGENT_TOKEN_HEADER);
  if (!presented) return false;
  let token: string | null;
  try { token = await readAgentToken(); } catch { return false; }
  // Equal-length digests, so neither the comparison nor its timing depends on the token's length.
  return token !== null && timingSafeEqual(sha256(presented), sha256(token));
}
