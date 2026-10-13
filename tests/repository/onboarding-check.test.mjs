import assert from "node:assert/strict";
import test from "node:test";
import { checkOnboarding } from "../../scripts/check-onboarding.mjs";

test("onboarding diagnostics distinguish provider configuration and never reveal keys", async () => {
  const env = { NEXT_PUBLIC_PRIVY_APP_ID: "APP_ID_SENTINEL", NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "KEY_SENTINEL" };
  const paths = [];
  const result = await checkOnboarding(env, async url => {
    paths.push(url.pathname);
    return Response.json(url.pathname.endsWith("settings") ? { external: { google: true } } : { keys: [{ alg: "ES256", kid: "not-printed" }] });
  });
  assert.equal(result.googleProviderEnabled, true);
  assert.equal(result.publicSigningKeysAvailable, true);
  assert.deepEqual(result.signingAlgorithms, ["ES256"]);
  assert.equal(result.privyJwtIntegration, "confirm-in-dashboard");
  assert.equal(result.ethereumWalletProvider, "confirm-in-dashboard");
  assert.equal(result.connection, "checked");
  assert.deepEqual(paths.sort(), ["/auth/v1/.well-known/jwks.json", "/auth/v1/settings"]);
  assert.doesNotMatch(JSON.stringify(result), /KEY_SENTINEL|APP_ID_SENTINEL|not-printed/);
});
test("missing or unreachable settings remain unknown rather than claiming the setup passed", async () => {
  const absent = await checkOnboarding({}, () => { throw new Error("must not request"); });
  assert.equal(absent.connection, "not-configured");
  assert.equal(absent.googleProviderEnabled, null);
  const unreachable = await checkOnboarding({ NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public" }, () => { throw new Error("network unavailable"); });
  assert.equal(unreachable.connection, "unreachable");
  assert.equal(unreachable.publicSigningKeysAvailable, null);
});
