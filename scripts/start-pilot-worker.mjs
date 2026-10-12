import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const packagePath = require.resolve("trigger.dev/package.json");
const cli = JSON.parse(readFileSync(packagePath, "utf8"));
const env = { ...process.env };
// Electric's optional browser cache probes Node's experimental localStorage during indexing.
if (process.allowedNodeEnvironmentFlags.has("--no-experimental-webstorage")) {
  env.NODE_OPTIONS = [env.NODE_OPTIONS, "--no-experimental-webstorage"].filter(Boolean).join(" ");
}
const child = spawn(process.execPath, [
  resolve(dirname(packagePath), cli.bin.trigger),
  "dev", "start", "--env-file", ".env.local", "--skip-update-check", "--max-concurrent-runs", "1",
  ...process.argv.slice(2),
], { env, stdio: "inherit" });
child.on("error", () => { console.error("The local Trigger worker could not start. Check the installed dependencies."); process.exitCode = 1; });
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
