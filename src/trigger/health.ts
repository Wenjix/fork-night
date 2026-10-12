import { task } from "@trigger.dev/sdk";

/** No email, media, personal data or paid model request. */
export const pilotHealth = task({
  id: "fork-night-health",
  maxDuration: 30,
  retry: { maxAttempts: 1 },
  run: async () => ({
    application: "fork-night",
    status: "ready",
    providerRequests: 0,
  }),
});
