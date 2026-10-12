export const WAITLIST_CONSENT_VERSION = "fork-night-updates-2026-10-05";

export function normalizeWaitlistEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(email)) return null;
  const local = email.split("@")[0];
  return local.length <= 64 && !local.startsWith(".") && !local.endsWith(".") && !local.includes("..") ? email : null;
}

/** Only configured, public HTTPS origins become phone-facing QR destinations. */
export function signupUrl(env: Record<string, string | undefined>): string | null {
  const origin = env.FORK_NIGHT_PUBLIC_URL;
  if (!origin) return null;
  try {
    const url = new URL(origin);
    const host = url.hostname;
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
        url.pathname !== "/" || url.search || url.hash ||
        !host.includes(".") || host.endsWith(".local") || host.endsWith(".localhost") ||
        host.endsWith(".test") || host.endsWith(".invalid") ||
        /^[\d.]+$/.test(host) || host.includes(":")) return null;
    return new URL("/signup?source=demo", url).href;
  } catch { return null; }
}
