import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

async function paths(directory, prefix = "") {
  const result = [];
  for (const item of await readdir(join(directory, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${item.name}` : item.name;
    result.push(...(item.isDirectory() ? await paths(directory, path) : [path]));
  }
  return result.sort();
}

/** Every relative or @/ import in the exported source that does not resolve to a file the export ships. */
async function unresolvedImports(root) {
  const missing = [];
  const isFile = async path => (await stat(path).catch(() => null))?.isFile() === true;
  for (const file of (await paths(root)).filter(path => /^src\/.*\.tsx?$/.test(path))) {
    const source = await readFile(join(root, file), "utf8");
    for (const [, specifier] of source.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/g)) {
      if (!specifier.startsWith(".") && !specifier.startsWith("@/")) continue;
      const base = specifier.startsWith("@/") ? join(root, "src", specifier.slice(2)) : join(root, dirname(file), specifier);
      const found = await Promise.all(["", ".ts", ".tsx", ".d.ts", "/index.ts", "/index.tsx"].map(extension => isFile(base + extension)));
      if (!found.includes(true)) missing.push(`${file} imports ${specifier}`);
    }
  }
  return missing;
}

test("the export ships every file its own source imports, stylesheets and the shared wordmark included", async t => {
  const temporary = await mkdtemp(join(tmpdir(), "fork-night-waitlist-imports-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const output = join(temporary, "app");
  const script = fileURLToPath(new URL("../../scripts/export-waitlist.mjs", import.meta.url));
  execFileSync(process.execPath, [script, output], { stdio: "pipe" });
  assert.deepEqual(await unresolvedImports(output), []);
  assert.ok((await paths(output)).includes("src/components/fork-night-mark.tsx"));
  const layout = await readFile(join(output, "src/app/layout.tsx"), "utf8");
  assert.doesNotMatch(layout, /import "\.\/(?!globals\.css")/, "the layout imports no stylesheet the export leaves out");
});

test("Cloudflare export contains only signup routes and runtime bindings, preserving source files", async t => {
  const temporary = await mkdtemp(join(tmpdir(), "fork-night-waitlist-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const output = join(temporary, "app");
  const script = fileURLToPath(new URL("../../scripts/export-waitlist.mjs", import.meta.url));
  const original = await readFile(new URL("../../src/server/waitlist-settings.ts", import.meta.url));
  execFileSync(process.execPath, [script, output, "--cloudflare"], { stdio: "pipe" });
  const files = await paths(output);
  assert.deepEqual(files.filter(path => /(?:page|route)\.tsx?$/.test(path)), [
    "src/app/api/waitlist/route.ts", "src/app/demo/page.tsx", "src/app/page.tsx", "src/app/signup/page.tsx",
  ]);
  assert.equal(files.some(path => /(?:^|\/)(?:\.git|\.env[^/]*|\.internal|\.local|\.agents|node_modules|\.next)(?:\/|$)/.test(path)), false);
  assert.equal(files.some(path => /pilot|trigger|openai|cartesia|world-demo/.test(path)), false);
  const pkg = JSON.parse(await readFile(join(output, "package.json"), "utf8"));
  assert.equal(Object.keys(pkg.dependencies).some(name => /supabase|trigger|openai/.test(name)), false);
  assert.equal(pkg.scripts.deploy, "wrangler deploy --config dist/server/wrangler.json");
  const lock = JSON.parse(await readFile(join(output, "package-lock.json"), "utf8"));
  assert.deepEqual(lock.packages[""].dependencies, pkg.dependencies);
  assert.deepEqual(lock.packages[""].devDependencies, pkg.devDependencies);
  assert.equal(lock.packages["node_modules/@trigger.dev/sdk"], undefined);
  assert.equal(lock.packages["node_modules/@supabase/supabase-js"], undefined);
  assert.ok(lock.packages["node_modules/@cloudflare/workerd-linux-64"], "Linux Worker binary must be locked for Cloudflare CI");
  assert.ok(lock.packages["node_modules/@rolldown/binding-linux-x64-gnu"], "Linux Vite binary must be locked for Cloudflare CI");
  assert.equal(Object.values(lock.packages).some(entry => entry.resolved && new URL(entry.resolved).host !== "registry.npmjs.org"), false);
  const config = JSON.parse(await readFile(join(output, "wrangler.jsonc"), "utf8"));
  assert.equal(config.assets.not_found_handling, "none");
  assert.equal(config.keep_vars, true);
  assert.equal(config.vars, undefined);
  assert.match(await readFile(join(output, "src/server/waitlist-settings.ts"), "utf8"), /cloudflare:workers/);
  assert.deepEqual(await readFile(new URL("../../src/server/waitlist-settings.ts", import.meta.url)), original);
  assert.throws(() => execFileSync(process.execPath, [script, output, "--cloudflare"], { stdio: "pipe" }), /already exists/);
});
