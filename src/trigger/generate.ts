import { task } from "@trigger.dev/sdk";
import { generatePilotContinuation } from "../generation/run.ts";

export const generateContinuation = task({
  id: "fork-night-generate",
  queue: { name: "fork-night-images", concurrencyLimit: 1 },
  maxDuration: 600,
  retry: { maxAttempts: 1 },
  run: async (payload: { operationId: string }) =>
    generatePilotContinuation(payload.operationId),
});
