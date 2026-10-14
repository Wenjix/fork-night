export function parseReconcileTick(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid recovery tick.");
  const tick = value as Record<string, unknown>;
  if (Object.keys(tick).sort().join(",") !== "environment,scheduledAt,source" ||
      tick.source !== "cloudflare-cron" || tick.environment !== "PRODUCTION" ||
      typeof tick.scheduledAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/.test(tick.scheduledAt) ||
      !Number.isFinite(Date.parse(tick.scheduledAt)) || new Date(tick.scheduledAt).toISOString() !== tick.scheduledAt)
    throw new Error("Invalid recovery tick.");
  return { source: "cloudflare-cron" as const, environment: "PRODUCTION" as const, scheduledAt: tick.scheduledAt };
}
