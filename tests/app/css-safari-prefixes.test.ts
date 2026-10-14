import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Production builds with webpack and this project's PostCSS config, which has no autoprefixer.
// Turbopack adds these prefixes in dev only, so Safari's forms are written by hand.
const PREFIXED = ["user-select", "backdrop-filter"];

test("every user-select and backdrop-filter rule carries Safari's -webkit- form", async () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const files = (await readdir(join(root, "src"), { recursive: true })).filter((file) => file.endsWith(".css"));
  assert(files.length > 5, "the stylesheets were found");
  const missing: string[] = [];
  for (const file of files) {
    const css = (await readFile(join(root, "src", file), "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");
    for (const rule of css.split("}"))
      for (const property of PREFIXED)
        if (new RegExp(`(?:^|[;{\\s])${property}\\s*:`).test(rule) && !rule.includes(`-webkit-${property}:`))
          missing.push(`${file}: ${rule.split("{")[0].trim()} needs -webkit-${property}`);
  }
  assert.deepEqual(missing, []);
});
