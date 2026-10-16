// Executed in Trigger's image build, before any task runs. Only reviewed public
// source and a frozen dependency lock are copied; no local node_modules or keys.
import { execFile } from "node:child_process";
import { cp, mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { promisify } from "node:util";

const files = ["index.mjs", "wren.mjs", "package.json", "pnpm-lock.yaml"];
const source = resolve("vendor/mpp-adapter");
const destination = resolve("node_modules/fork-night-mpp-adapter");
const packageManager = resolve("node_modules/pnpm/bin/pnpm.cjs");
const execute = promisify(execFile);
const version = (await execute(process.execPath, [packageManager, "--version"])).stdout.trim();
if (version !== "10.18.3") throw new Error("The isolated Wren build requires pnpm 10.18.3.");
await mkdir(destination, { recursive: true });
for (const file of files) await cp(resolve(source, file), resolve(destination, file));
const sha = async (path) => createHash("sha256").update(await readFile(path)).digest("hex");
const before = await sha(resolve(destination, "pnpm-lock.yaml"));
await execute(process.execPath, [packageManager, "--dir", destination, "install", "--frozen-lockfile", "--ignore-scripts", "--prod",
  "--ignore-workspace", "--config.node-linker=hoisted", ...(process.argv.includes("--offline") ? ["--offline"] : [])], { maxBuffer: 1024 * 1024 });
if (before !== await sha(resolve(destination, "pnpm-lock.yaml"))) throw new Error("The frozen Wren adapter lockfile changed.");
// The entire directory lives under root node_modules, which Trigger explicitly
// copies from build to final. Its separate lock and dependency versions survive.
const adapter = await import(resolve(destination, "index.mjs"));
const signer = await import(resolve(destination, "wren.mjs"));
if (adapter.versions.mppx !== "0.13.4" || adapter.versions.viem !== "2.57.3" || typeof signer.createWrenPayment !== "function")
  throw new Error("The packaged Wren adapter did not load its pinned isolated dependencies.");
console.log("Packaged the isolated Wren testnet payment adapter and scoped signer.");
