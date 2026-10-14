import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function checkOnboarding(env = process.env, request = fetch) {
  const report = {
    privyAppIdPresent: !!env.NEXT_PUBLIC_PRIVY_APP_ID,
    googleProviderEnabled: null,
    publicSigningKeysAvailable: null,
    signingAlgorithms: [],
    jwtIdClaim: "sub",
    privyJwtIntegration: "confirm-in-dashboard",
    ethereumWalletProvider: "confirm-in-dashboard",
    solanaWalletProvider: "confirm-in-dashboard",
    connection: "not-configured",
  };
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) return report;
  const url = new URL(env.NEXT_PUBLIC_SUPABASE_URL);
  if (url.username || url.password || !["https:", "http:"].includes(url.protocol)) throw new Error("Use the public Supabase project URL without credentials.");
  try {
    const options = { headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY }, signal: AbortSignal.timeout(15000) };
    const [settings, jwks] = await Promise.all([
      request(new URL("/auth/v1/settings", url), options),
      request(new URL("/auth/v1/.well-known/jwks.json", url), options),
    ]);
    if (!settings.ok || !jwks.ok) { report.connection = "settings-unavailable"; return report; }
    const config = await settings.json(), keys = await jwks.json();
    report.googleProviderEnabled = config.external?.google === true;
    report.signingAlgorithms = [...new Set((keys.keys ?? []).map(key => key.alg).filter(alg => typeof alg === "string"))];
    report.publicSigningKeysAvailable = report.signingAlgorithms.some(alg => ["ES256", "RS256"].includes(alg));
    report.connection = "checked";
    return report;
  } catch { report.connection = "unreachable"; return report; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  checkOnboarding().then(report => console.log(JSON.stringify(report, null, 2))).catch(() => {
    console.error("Onboarding settings could not be checked. Verify the public Supabase URL."); process.exitCode = 1;
  });
}
