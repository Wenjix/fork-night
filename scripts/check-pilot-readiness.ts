import { runs, schedules } from "@trigger.dev/sdk";
import { pilotAdmin } from "../src/generation/client.ts";
import { validRoomId } from "../src/lib/pilot-rooms.ts";
import { readRecoveryTimer, recoveryCheckpoint, recoveryRunOutput } from "./recovery-timer-readiness.ts";

const room = process.argv[2] ?? "paper-moon";
if (!validRoomId(room) || process.argv.length > 3) throw new Error("Usage: check-pilot-readiness.ts [room-id]");
const required = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY", "PILOT_EXECUTION_ENV", "TRIGGER_SECRET_KEY"];
const settings = Object.fromEntries(required.map(name => [name, Boolean(process.env[name])]));
try {
  const report = await pilotAdmin().rpc("pilot_readiness", { p_room_id: room });
  if (report.error || !report.data) throw new Error("Database readiness could not be read. Check the matching migrations and service credential.");
  let nativeScheduleConflicts: unknown = { verified: false, reason: "A Production operator Trigger key is required" };
  let recoveryRuns: unknown = { verified: false, reason: "A Production operator Trigger key is required" };
  if (process.env.TRIGGER_SECRET_KEY?.startsWith("tr_prod_")) {
    try {
      const found = [];
      let count = 0;
      for await (const item of schedules.list()) {
        if (++count > 1000) throw new Error("Schedule listing exceeds inspection bound.");
        if (item.task === "fork-night-reconcile" && item.active && item.environments.some(environment => environment.type === "PRODUCTION"))
          found.push({ id: item.id });
      }
      nativeScheduleConflicts = { verified: true, conflicts: found };
    } catch { nativeScheduleConflicts = { verified: false, reason: "Cannot exclude a duplicate Trigger schedule; inspect Production schedules in the dashboard." }; }
    try {
      const recent = [];
      for await (const item of runs.list({ taskIdentifier: "fork-night-reconcile", tag: "cloudflare-recovery-timer", period: "1h", limit: 5 })) {
        recent.push({ id: item.id, status: item.status, version: item.version, environment: item.env.name,
          createdAt: item.createdAt, finishedAt: item.finishedAt, durationMs: item.durationMs,
          costInCents: item.costInCents, baseCostInCents: item.baseCostInCents });
        if (recent.length === 5) break;
      }
      const completed = recent.find(item => item.status === "COMPLETED");
      const lastCompleted = completed ? { id: completed.id, ...recoveryRunOutput((await runs.retrieve(completed.id)).output) } : null;
      recoveryRuns = { verified: true, recent, lastCompleted };
    } catch { recoveryRuns = { verified: false, reason: "Recovery runs could not be read; verify the operator key's run-read permission." }; }
  }
  const timer = await readRecoveryTimer(process.env);
  console.log(JSON.stringify({ settings, configuredEnvironment: process.env.PILOT_EXECUTION_ENV ?? null,
    database: report.data, timer, nativeScheduleConflicts, recoveryRuns, checkpoint: recoveryCheckpoint(report.data),
    recoveryAcceptance: "Observe a real Cloudflare clock invocation and its completed Production recovery run, then recover saved work after closing the originating browser. An empty tick or configuration alone does not prove that gate.",
    rehearsalTarget: {
    roomCredits: 12, requestSlots: 24, admissionHeadroomMicro: 6_000_000,
    freshMakerAttempts: 4, additionalShapeClaims: 36, perFreshMakerShapeClaims: 9,
    note: "Targets are a settings comparison, not permission to raise caps or reset usage. Check each participant's remaining attempts before rehearsal.",
  } }, null, 2));
} catch (reason) {
  console.error(JSON.stringify({ settings, error: reason instanceof Error ? reason.message : "Readiness unavailable" }));
  process.exitCode = 1;
}
