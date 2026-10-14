import { randomUUID } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseEnv } from "node:util";
import { exportSubmission } from "./export-submission.mjs";
import { signupUrl } from "../src/lib/waitlist.ts";

const defaultRoot = fileURLToPath(new URL("../", import.meta.url));
const webKeys = [
  "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY", "TRIGGER_SECRET_KEY",
  "NEXT_PUBLIC_MONAD_CHAIN_ID", "NEXT_PUBLIC_MONAD_RPC_URL",
  "NEXT_PUBLIC_MONAD_RELEASE_ADDRESS", "NEXT_PUBLIC_MONAD_CURATOR_ADDRESS",
  "FORK_NIGHT_PUBLIC_URL",
];
const workerKeys = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY", "OPENAI_API_KEY"];
const helperKeys = ["OPENAI_API_KEY", "CARTESIA_API_KEY"];
const onboardingKeys = ["NEXT_PUBLIC_PRIVY_APP_ID", "NEXT_PUBLIC_PRIVY_CLIENT_ID"];

async function readEnv(path) {
  try { return parseEnv(await readFile(path, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return {}; throw error; }
}

function serializeSettings(settings) {
  return Object.entries(settings).map(([key, value]) => {
    if (/["\r\n]/.test(value)) throw new Error(`Set ${key} to a single-line value without double quotes.`);
    return `${key}="${value}"\n`;
  }).join("");
}

export function selectHostedSettings(env) {
  const web = Object.fromEntries(webKeys.map(key => [key, env[key] ?? ""]));
  const developmentKeyOmitted = !!web.TRIGGER_SECRET_KEY && !web.TRIGGER_SECRET_KEY.startsWith("tr_prod_");
  if (developmentKeyOmitted) web.TRIGGER_SECRET_KEY = "";
  web.PILOT_LOCAL_CONTROLS = "0";
  web.PILOT_EXECUTION_ENV = "PRODUCTION";
  for (const key of helperKeys) if (env[key]) web[key] = env[key];
  for (const key of onboardingKeys) if (env[key]) web[key] = env[key];
  if (web.FORK_NIGHT_PUBLIC_URL) {
    if (!signupUrl(web))
      throw new Error("Set FORK_NIGHT_PUBLIC_URL to the public HTTPS origin without a path.");
    web.FORK_NIGHT_PUBLIC_URL = new URL(web.FORK_NIGHT_PUBLIC_URL).origin;
  }
  const worker = Object.fromEntries(workerKeys.map(key => [key, env[key] ?? ""]));
  worker.PILOT_EXECUTION_ENV = "PRODUCTION";
  worker.PILOT_RECONCILE_ENABLED = "0";
  const suppliedTimerKey = env.PILOT_TIMER_TRIGGER_SECRET_KEY ?? "";
  const timer = { TRIGGER_SECRET_KEY: /^tr_prod_sk_[a-zA-Z0-9_-]{1,500}$/.test(suppliedTimerKey) ? suppliedTimerKey : "" };
  return {
    web, worker, timer, developmentKeyOmitted,
    invalidTimerKeyOmitted: Boolean(suppliedTimerKey) && !timer.TRIGGER_SECRET_KEY,
    missingWeb: webKeys.filter(key => !web[key]),
    missingWorker: workerKeys.filter(key => !worker[key]),
    missingTimer: timer.TRIGGER_SECRET_KEY ? [] : ["PILOT_TIMER_TRIGGER_SECRET_KEY"],
  };
}

export async function prepareHostedPilot({ rootDirectory = defaultRoot, env = process.env } = {}) {
  const root = resolve(rootDirectory);
  const settings = selectHostedSettings({
    ...await readEnv(join(root, ".env.local")),
    ...await readEnv(join(root, ".env.production.local")),
    ...env,
  });
  const webText = serializeSettings(settings.web);
  const workerText = serializeSettings(settings.worker);
  const bundle = join(root, ".local/submission", `fork-night-hosted-${randomUUID()}`);
  const source = await exportSubmission({ rootDirectory: root, outputDirectory: join(bundle, "source") });
  await chmod(bundle, 0o700);
  const webEnvironmentFile = join(bundle, "web.production.env");
  const workerEnvironmentFile = join(bundle, "worker.production.env");
  const timerSecretsFile = join(bundle, "timer.production.secrets.json");
  await writeFile(webEnvironmentFile, webText, { mode: 0o600, flag: "wx" });
  await writeFile(workerEnvironmentFile, workerText, { mode: 0o600, flag: "wx" });
  await writeFile(timerSecretsFile, `${JSON.stringify(settings.timer, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  const report = {
    preparedAt: new Date().toISOString(),
    status: "prepared-not-deployed",
    sourceDirectory: source.outputDirectory,
    webEnvironmentFile, workerEnvironmentFile, timerSecretsFile,
    developmentKeyOmitted: settings.developmentKeyOmitted,
    missingWeb: settings.missingWeb,
    missingWorker: settings.missingWorker,
    missingTimer: settings.missingTimer,
    invalidTimerKeyOmitted: settings.invalidTimerKeyOmitted,
    fileCount: source.fileCount,
    totalBytes: source.totalBytes,
    files: source.files,
  };
  await writeFile(join(bundle, "preparation.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  return report;
}

async function main(args) {
  if (args.length === 1 && args[0] === "--help") {
    console.log("Usage: npm run hosting:prepare\nCreates fresh clean source and separate private web/worker/timer settings under .local/submission. Reads .env.local, then .env.production.local, then the process environment. The timer requires PILOT_TIMER_TRIGGER_SECRET_KEY; it never inherits the web key. Sends no requests and prints no secret values.");
    return;
  }
  if (args.length) throw new Error("No arguments are accepted; use --help.");
  const { files, ...report } = await prepareHostedPilot();
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => {
    console.error(`Hosting preparation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
