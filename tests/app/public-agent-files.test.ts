import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

// Wren's code is published in agents/wren/ next to the app. These guard what reaches the public export from it:
// only the reviewed files, no local configuration, no funding reference and the same pinned packages as the door.
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const allowlist = JSON.parse(read("config/submission-files.json")) as { files: string[] };
const WREN_FILES = ["README.md", "RESIDENT.md", "package.json", "pnpm-lock.yaml", "config.example.json", "wren.mjs", "pay.mjs", "rules.mjs", "test-offline.mjs", "test-next.mjs",
  "resident.mjs", "resident-mission.mjs", "resident-runtime.mjs", "resident-monad.mjs"]
  .map((name) => `agents/wren/${name}`);
const FUNDING_REF = /\/api\/(?:mpp|x402)\/fund\/(?!<funding-ref>|\[fundingRef\]|<[A-Za-z]|\$\{)[A-Za-z0-9_-]{8,}/;

test("the export publishes exactly Wren's reviewed files and never its local configuration or state", () => {
  const agentEntries = allowlist.files.filter((path) => path.startsWith("agents/"));
  assert.deepEqual([...agentEntries].sort(), [...WREN_FILES].sort());
  for (const path of WREN_FILES) assert.ok(existsSync(join(ROOT, path)), `${path} is listed but missing`);
  for (const path of allowlist.files) {
    assert.doesNotMatch(path, /(^|\/)config\.json$|agent-state|\.local\/|node_modules|\.key$/, path);
  }
  assert.ok(allowlist.files.includes("docs/submission/AGENT-ROOM.md"));
});

test("no published agent file or agent doc names a funding reference", () => {
  for (const path of [...WREN_FILES, "docs/submission/AGENT-ROOM.md", "docs/submission/MPP.md"])
    assert.doesNotMatch(read(path), FUNDING_REF, `${path} names a funding reference`);
  const pay = read("agents/wren/pay.mjs");
  const fallback = pay.match(/NIGHT_SHIFT_DOOR = process\.env\.WREN_DOOR_URL \?\? "([^"]+)"/)?.[1];
  assert.ok(fallback, "pay.mjs reads the door URL from WREN_DOOR_URL");
  const example = JSON.parse(read("agents/wren/config.example.json"));
  assert.equal(example.mpp.doorUrl, fallback, "the example config's door placeholder matches pay.mjs's fallback");
  assert.match(example.allowance.stewardAddress, /^0x<.+>$/);
  assert.match(example.allowance.agentKeyFile, /<.+>/);
});

test("Wren pins the same reviewed mppx and viem as the door's isolated adapter", () => {
  assert.equal(read("agents/wren/pnpm-lock.yaml"), read("vendor/mpp-adapter/pnpm-lock.yaml"));
  const manifest = JSON.parse(read("agents/wren/package.json"));
  assert.deepEqual(manifest.dependencies, { mppx: "0.13.4", viem: "2.57.3" });
});

const installed = existsSync(join(ROOT, "agents/wren/node_modules/mppx")) && existsSync(join(ROOT, "agents/wren/node_modules/viem"));
const run = promisify(execFile);
for (const script of ["test-offline.mjs", "test-next.mjs"]) {
  test(`agents/wren ${script} passes offline`, installed ? {} : { skip: "agents/wren is not installed (cd agents/wren && pnpm install --frozen-lockfile --ignore-scripts)" }, async () => {
    const env = { ...process.env };
    delete env.WREN_DOOR_URL;
    const { stdout } = await run(process.execPath, [script], { cwd: join(ROOT, "agents/wren"), env, timeout: 60_000 });
    assert.match(stdout, /checks passed/);
  });
}
