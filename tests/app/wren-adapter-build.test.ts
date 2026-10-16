import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import type { BuildContext, BuildLayer } from "@trigger.dev/build";
import { wrenAdapterBuild } from "../../scripts/wren-adapter-build.ts";
import { loadMppAdapter } from "../../src/mpp/adapter.ts";

test("Trigger installs isolated pinned dependencies only in deployment images", async () => {
  const layers: BuildLayer[] = [];
  const extension = wrenAdapterBuild();
  await extension.onBuildComplete!({ target: "dev", addLayer: (layer: BuildLayer) => { layers.push(layer); } } as unknown as BuildContext, {} as never);
  assert.equal(layers.length, 0);
  await extension.onBuildComplete!({ target: "deploy", addLayer: (layer: BuildLayer) => { layers.push(layer); } } as unknown as BuildContext, {} as never);
  assert.deepEqual(layers, [{ id: "wren-isolated-payment-adapter", dependencies: { pnpm: "10.18.3" }, commands: ["node scripts/package-wren-adapter.mjs"] }]);
});

test("Trigger ships explicit reviewed adapter sources and preserves existing artwork and sharp settings", async () => {
  const config = await readFile(new URL("../../trigger.config.ts", import.meta.url), "utf8");
  for (const file of ["index.mjs", "wren.mjs", "package.json", "pnpm-lock.yaml"]) assert(config.includes(`./vendor/mpp-adapter/${file}`));
  assert(config.includes('./public/art/*.webp')); assert(config.includes('external: ["sharp"]'));
  assert(!config.includes('vendor/mpp-adapter/**'));
});

test("frozen standalone adapter survives final-image relocation with its own pinned dependencies", {
  skip: process.env.FORK_NIGHT_TEST_PACKAGE_WREN !== "1" ? "set FORK_NIGHT_TEST_PACKAGE_WREN=1 for the disposable frozen-install and relocation proof" : false,
  timeout: 120000,
}, async () => {
  const execute = promisify(execFile);
  const temporary = await mkdtemp(join(tmpdir(), "fork-night-wren-package-"));
  try {
    const build = join(temporary, "build"), final = join(temporary, "final");
    await mkdir(join(build, "vendor/mpp-adapter"), { recursive: true });
    await mkdir(join(build, "scripts")); await mkdir(join(build, "node_modules"));
    for (const file of ["index.mjs", "wren.mjs", "package.json", "pnpm-lock.yaml"])
      await cp(resolve("vendor/mpp-adapter", file), join(build, "vendor/mpp-adapter", file));
    await cp(resolve("scripts/package-wren-adapter.mjs"), join(build, "scripts/package-wren-adapter.mjs"));
    // The build tool is installed by Trigger's synthetic image dependencies. A
    // local link stands in for that tool; it never enters the deployed adapter.
    const pnpmBinary = (await execute("which", ["pnpm"])).stdout.trim();
    const pnpmPackage = dirname(dirname(await realpath(pnpmBinary)));
    await symlink(pnpmPackage, join(build, "node_modules/pnpm"));
    const before = await readFile(join(build, "vendor/mpp-adapter/pnpm-lock.yaml"));
    await execute(process.execPath, [join(build, "scripts/package-wren-adapter.mjs"), "--offline"], { cwd: build, timeout: 100000 });
    const installed = join(build, "node_modules/fork-night-mpp-adapter");
    assert((await readFile(join(installed, "pnpm-lock.yaml"))).equals(before));
    await mkdir(join(final, "node_modules"), { recursive: true });
    await cp(installed, join(final, "node_modules/fork-night-mpp-adapter"), { recursive: true });
    await rm(build, { recursive: true, force: true });
    const path = join(final, "node_modules/fork-night-mpp-adapter/index.mjs");
    const adapter = await loadMppAdapter(path);
    assert.equal(adapter.versions.mppx, "0.13.4"); assert.equal(adapter.versions.viem, "2.57.3");
    const reply = await execute(process.execPath, ["--input-type=module", "-e", "const m=await import(process.argv[1]); const w=await import(process.argv[2]); console.log(JSON.stringify({versions:m.versions,signer:typeof w.createWrenPayment}));",
      path, join(final, "node_modules/fork-night-mpp-adapter/wren.mjs")], { cwd: final });
    assert.deepEqual(JSON.parse(reply.stdout), { versions: { mppx: "0.13.4", viem: "2.57.3" }, signer: "function" });
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
