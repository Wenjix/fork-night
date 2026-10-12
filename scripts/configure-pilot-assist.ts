import { pilotAdmin } from "../src/generation/client.ts";

// Operator-only. Totals are cumulative; this command never deletes usage history.
// node --env-file=.env.local scripts/configure-pilot-assist.ts --status
// node --env-file=.env.local scripts/configure-pilot-assist.ts --voice-total 5 --shape-total 10
// node --env-file=.env.local scripts/configure-pilot-assist.ts --pause
const args = process.argv.slice(2);
const status =
  args.length === 0 || (args.length === 1 && args[0] === "--status");
const pause = args.length === 1 && args[0] === "--pause";
function total(flag: string) {
  const value = args[args.indexOf(flag) + 1];
  if (
    !args.includes(flag) ||
    !/^\d+$/.test(value ?? "") ||
    Number(value) > 10000
  )
    throw new Error(
      "Supply explicit cumulative totals from 0 to 10000 for both --voice-total and --shape-total.",
    );
  return Number(value);
}
if (
  !status &&
  !pause &&
  (args.length !== 4 ||
    !args.includes("--voice-total") ||
    !args.includes("--shape-total"))
)
  throw new Error("Use --status, --pause, or --voice-total N --shape-total N.");
const change = status
  ? null
  : pause
    ? { voice_enabled: false, shape_enabled: false }
    : {
        voice_enabled: total("--voice-total") > 0,
        shape_enabled: total("--shape-total") > 0,
        voice_token_limit: total("--voice-total"),
        shape_request_limit: total("--shape-total"),
      };
const admin = pilotAdmin();
if (change) {
  const saved = await admin
    .from("pilot_assist_limits")
    .update(change)
    .eq("id", true)
    .select("id")
    .single();
  if (saved.error)
    throw new Error(
      "Helper settings could not be confirmed. Read --status before trying again.",
    );
}
const [limits, voice, shape] = await Promise.all([
  admin.from("pilot_assist_limits").select("*").eq("id", true).single(),
  admin
    .from("pilot_assist_requests")
    .select("id", { count: "exact", head: true })
    .eq("kind", "voice"),
  admin
    .from("pilot_assist_requests")
    .select("id", { count: "exact", head: true })
    .eq("kind", "shape"),
]);
if (limits.error || voice.error || shape.error)
  throw new Error("Could not read helper capacity.");
console.log(
  JSON.stringify(
    {
      limits: limits.data,
      issuedVoiceSessions: voice.count,
      admittedShapeRequests: shape.count,
    },
    null,
    2,
  ),
);
if (change)
  console.log(
    "These are request allowances, not provider-enforced duration or dollar caps. Existing sessions may outlive a pause.",
  );
