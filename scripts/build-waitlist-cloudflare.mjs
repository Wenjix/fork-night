import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const working = join(root, ".local/cloudflare-builds");
const pointer = join(working, "ready.json");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const args = process.argv.slice(2);
if (args.length > 1 || (args.length && args[0] !== "--deploy")) throw new Error("Usage: node scripts/build-waitlist-cloudflare.mjs [--deploy]");

function run(command, commandArgs, cwd) {
  const result = spawnSync(command, commandArgs, { cwd, stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status ?? result.signal})`);
}

if (args[0] === "--deploy") {
  const { directory } = JSON.parse(await readFile(pointer, "utf8"));
  // Only consume a successful output from this script, not an arbitrary path.
  if (typeof directory !== "string" || !/^build-[a-zA-Z0-9]+$/.test(directory)) throw new Error("Invalid build reference");
  const app = join(working, directory, "app");
  await access(join(app, "dist/server/wrangler.json"));
  run(npm, ["run", "deploy"], app);
} else {
  await mkdir(working, { recursive: true });
  // Invalidate a previous successful build before starting a new one. No stale
  // artifact can be deployed if dependency installation or this build fails.
  await writeFile(pointer, JSON.stringify({ directory: null }) + "\n");
  const build = await mkdtemp(join(working, "build-"));
  const app = join(build, "app");
  run(process.execPath, [join(root, "scripts/export-waitlist.mjs"), app, "--cloudflare"], root);
  run(npm, ["ci", "--include=dev", "--no-audit", "--no-fund"], app);
  run(npm, ["run", "check"], app);
  run(npm, ["run", "build"], app);
  await access(join(app, "dist/server/wrangler.json"));
  const pending = join(build, "ready.json");
  await writeFile(pending, JSON.stringify({ directory: build.slice(working.length + 1) }) + "\n");
  await rename(pending, pointer);
  console.log("Cloudflare build ready. Run npm run deploy:cloudflare to publish it.");
}
