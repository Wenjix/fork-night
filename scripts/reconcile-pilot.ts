import { reconcileGeneration } from "../src/generation/reconcile.ts";

if (process.argv.slice(2).some(arg => arg !== "--apply")) {
  console.error("Usage: node --env-file-if-exists=.env.local scripts/reconcile-pilot.ts [--apply]");
  process.exitCode = 1;
} else {
  try { console.log(JSON.stringify(await reconcileGeneration({ dryRun: !process.argv.includes("--apply") }), null, 2)); }
  catch { console.error("The saved generation could not be checked. Verify the database, execution environment and Trigger read credentials."); process.exitCode = 1; }
}
