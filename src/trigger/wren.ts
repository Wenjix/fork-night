import { schemaTask } from "@trigger.dev/sdk";
import { isUuid } from "../lib/pilot.ts";
import { preparePrivateWren } from "../generation/wren.ts";

function parseWrenTask(value: unknown): { requestId: string; dispatchVersion: number } {
  const input = value as { requestId?: unknown; dispatchVersion?: unknown };
  if (!input || !isUuid(input.requestId) || !Number.isInteger(input.dispatchVersion) || Number(input.dispatchVersion) < 1 || Number(input.dispatchVersion) > 8)
    throw new Error("Invalid private Wren request.");
  return { requestId: input.requestId, dispatchVersion: Number(input.dispatchVersion) };
}

export const prepareWrenContinuation = schemaTask({
  id: "fork-night-wren",
  schema: parseWrenTask,
  queue: { name: "fork-night-wren", concurrencyLimit: 1 },
  maxDuration: 240,
  retry: { maxAttempts: 1 },
  run: (payload, { ctx, signal }) => preparePrivateWren(payload.requestId, {
    environment: ctx.environment.type, runId: ctx.run.id, dispatchVersion: payload.dispatchVersion,
  }, signal),
});
