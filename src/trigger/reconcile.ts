import { schemaTask } from "@trigger.dev/sdk";
import { executionEnvironment } from "../generation/execution.ts";
import { reconcileGeneration } from "../generation/reconcile.ts";
import { parseReconcileTick } from "../generation/reconcile-tick.ts";

// Cloudflare sends clock notifications after cutover; no Trigger schedule attaches.
export const reconcilePilotGeneration = schemaTask({
  id: "fork-night-reconcile",
  schema: parseReconcileTick,
  queue: { name: "fork-night-reconciliation", concurrencyLimit: 1 },
  maxDuration: 120,
  ttl: "5m",
  retry: { maxAttempts: 1 },
  run: async (_payload, { ctx }) => {
    if (ctx.environment.type !== "PRODUCTION" || process.env.PILOT_RECONCILE_ENABLED !== "1")
      return { enabled: false };
    executionEnvironment(ctx.environment.type);
    return reconcileGeneration();
  },
});
