import { pilotAdmin } from "../src/generation/client.ts";
import { validRoomId } from "../src/lib/pilot-rooms.ts";

// Read-only: prints a concrete comparison and the once-only SQL for operator review.
const room = process.argv[2] ?? "paper-moon";
if (!validRoomId(room) || process.argv.length > 3) throw new Error("Usage: prepare-judge-rehearsal.ts [room-id]");
try {
  const result = await pilotAdmin().rpc("pilot_readiness", { p_room_id: room });
  if (result.error || !result.data) throw new Error("Readiness could not be verified. No settings were changed.");
  const state = result.data as any;
  console.log(JSON.stringify({ observedAt: state.observedAt, room,
    comparison: {
      availableRoomCredits: { current: state.room.credits.available, target: 12 },
      perMakerRoomAttempts: { current: state.room.guestAttemptLimit, target: 4 },
      availableImageRequests: { current: state.generation.requestSlots, target: 24 },
      imageCapMicro: { current: state.generation.capMicro, change: 0 },
      admissionHeadroomMicro: { current: state.generation.headroomMicro, minimum: 6_000_000 },
      shapeRequests: { used: state.helpers.shapeUsed, currentLimit: state.helpers.shapeLimit, proposedLimit: Math.max(state.helpers.shapeLimit, state.helpers.shapeUsed + 36) },
      perFreshMakerShapeRequests: { current: state.helpers.perMakerShapeLimit, proposed: 9 },
      shapeEnabled: { current: state.helpers.shapeEnabled, proposed: true }, voiceEnabled: { current: state.helpers.voiceEnabled, proposed: false },
    },
    requirements: { productionEnvironment: state.generation.environment === "PRODUCTION", generationEnabled: state.generation.enabled, unresolvedExpenses: state.work.unresolvedPanels, lastReconcileAt: state.generation.lastReconcileAt },
    reviewedSql: `select public.pilot_prepare_judge_room('judges-2026-10-first-session','${room}');`,
    note: "No writes performed. Reusing this grant ID cannot add capacity twice. Existing usage, provider expense and the image cap remain intact; verify each maker's actual remaining attempts separately.",
  }, null, 2));
} catch (reason) { console.error(reason instanceof Error ? reason.message : "Readiness unavailable"); process.exitCode = 1; }
