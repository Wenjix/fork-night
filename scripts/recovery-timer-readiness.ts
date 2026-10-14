const workerName = "fork-night-recovery-timer";
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Reads configuration only; no task, timer or credential is created. */
export async function readRecoveryTimer(env: Record<string, string | undefined>, fetchImpl: typeof fetch = fetch) {
  const account = env.CLOUDFLARE_ACCOUNT_ID;
  if (!account || !/^[a-f0-9]{32}$/.test(account) || !env.CLOUDFLARE_API_TOKEN)
    return { provider: "cloudflare", workerName, verified: false,
      reason: "Set operator-only CLOUDFLARE_ACCOUNT_ID and a Workers Scripts Read CLOUDFLARE_API_TOKEN, or inspect the timer in the dashboard." };
  const base = `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${workerName}`;
  try {
    const [schedule, settings, subdomain] = await Promise.all(["schedules", "settings", "subdomain"].map(async resource => {
      const response = await fetchImpl(`${base}/${resource}`, { method: "GET", redirect: "error",
        signal: AbortSignal.timeout(10_000), headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` } });
      if (!response.ok) { await response.body?.cancel(); throw new Error("unavailable"); }
      const body = record(await response.json());
      if (body.success !== true || !body.result) throw new Error("unavailable");
      return record(body.result);
    }));
    if (!Array.isArray(schedule.schedules) || !Array.isArray(settings.bindings)) throw new Error("unavailable");
    const bindings = settings.bindings.map(record);
    const variable = (name: string, value: string) => bindings.some(binding => binding.name === name && binding.type === "plain_text" && binding.text === value);
    const checks = {
      exactlyOneMinuteSchedule: schedule.schedules.length === 1 && record(schedule.schedules[0]).cron === "* * * * *",
      productionEnvironment: variable("PILOT_EXECUTION_ENV", "PRODUCTION"),
      timerEnabled: variable("PILOT_TIMER_ENABLED", "1"),
      triggerSecretPresent: bindings.some(binding => binding.name === "TRIGGER_SECRET_KEY" && binding.type === "secret_text"),
      workersDevDisabled: subdomain.enabled === false,
      previewsDisabled: subdomain.previews_enabled === false,
    };
    return { provider: "cloudflare", workerName, verified: true, configurationMatches: Object.values(checks).every(Boolean), checks,
      note: "Configuration does not prove execution. Match a clock invocation's accepted run ID to Trigger and the database checkpoint; verify no custom routes in the dashboard." };
  } catch {
    return { provider: "cloudflare", workerName, verified: false, reason: "Cloudflare timer configuration could not be verified. Check the target account, read permission and deployed Worker." };
  }
}

export function recoveryCheckpoint(database: unknown, now = Date.now()) {
  const generation = record(record(database).generation);
  const last = typeof generation.lastReconcileAt === "string" ? generation.lastReconcileAt : null;
  const elapsed = last ? now - Date.parse(last) : NaN;
  return { lastReconcileAt: last, ageSeconds: Number.isFinite(elapsed) ? Math.floor(elapsed / 1000) : null,
    fresh: generation.environment === "PRODUCTION" && Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= 180_000,
    note: "A fresh scan can still contain unavailable checks or work needing review; inspect those database counts separately." };
}

export function recoveryRunOutput(value: unknown) {
  const output = record(value);
  const executed = output.environment === "PRODUCTION" && output.dryRun === false && Array.isArray(output.checked);
  return { recoveryExecuted: executed,
    checkedDispatches: executed ? (output.checked as unknown[]).length : null,
    unavailableChecks: executed ? (output.checked as unknown[]).filter(item => record(item).result === "check-unavailable").length : null };
}
