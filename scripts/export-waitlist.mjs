import { copyFile, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

// A separate, explicit deployment selection: no pilot, worker, archives or credentials.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const cloudflare = args.includes("--cloudflare");
const positional = args.filter(arg => arg !== "--cloudflare");
if (positional.length > 1 || positional.some(arg => arg.startsWith("--"))) throw new Error("Usage: node scripts/export-waitlist.mjs [output] [--cloudflare]");
const output = resolve(positional[0] ?? resolve(root, cloudflare ? ".local/waitlist-cloudflare" : ".local/waitlist-deploy"));
if (output === root || relative(output, root).split(sep)[0] !== "..") throw new Error("Choose a fresh output directory outside the source tree’s ancestors.");
try { await lstat(output); throw new Error("Output already exists; choose a fresh directory."); }
catch (error) { if (error.code !== "ENOENT") throw error; }

const files = [
  "src/app/demo/page.tsx", "src/app/signup/page.tsx", "src/app/signup/signup.css",
  "src/app/api/waitlist/route.ts", "src/app/layout.tsx",
  "src/components/demo-controls.tsx", "src/components/waitlist-form.tsx",
  "src/lib/waitlist.ts", "src/server/waitlist.ts", "src/server/waitlist-settings.ts", "src/types/qrcode.d.ts",
  "public/fonts/inter-latin.woff2", "public/fonts/OFL.txt", "LICENSE", "next.config.ts",
];
for (const file of files) {
  const source = resolve(root, file);
  if (!(await lstat(source)).isFile()) throw new Error(`Expected a source file: ${file}`);
}
await mkdir(output, { recursive: true });
for (const file of files) {
  const target = resolve(output, file);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(resolve(root, file), target);
}
const base = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const dependencies = Object.fromEntries(["next", "react", "react-dom", "lucide-react", "qrcode"].map(name => [name, base.dependencies[name]]));
const devDependencies = Object.fromEntries(["typescript", "@types/node", "@types/react", "@types/react-dom"].map(name => [name, base.devDependencies[name]]));
if (cloudflare) {
  const packages = JSON.parse(await readFile(resolve(root, "config/waitlist-cloudflare/packages.json"), "utf8"));
  Object.assign(dependencies, packages.dependencies);
  Object.assign(devDependencies, packages.devDependencies);
}
const scripts = cloudflare
  ? { check: "vinext check", build: "vite build", dev: "vite dev", preview: "wrangler dev --config dist/server/wrangler.json", deploy: "wrangler deploy --config dist/server/wrangler.json" }
  : { build: "next build", dev: "next dev", start: "next start" };
const pkg = { name: "fork-night-waitlist", version: base.version, private: true, type: "module", license: base.license, engines: { node: ">=22.18.0" }, scripts, dependencies, devDependencies };
await writeFile(resolve(output, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
const lock = JSON.parse(await readFile(resolve(root, cloudflare ? "config/waitlist-cloudflare/package-lock.json" : "package-lock.json"), "utf8"));
if (cloudflare) {
  // Refuse to resolve a different toolchain silently when source pins change.
  if (lock.name !== pkg.name || lock.version !== pkg.version) throw new Error("Regenerate the Cloudflare lockfile for this app version.");
  for (const section of ["dependencies", "devDependencies"]) {
    const actual = lock.packages[""]?.[section] ?? {};
    if (Object.keys(actual).length !== Object.keys(pkg[section]).length ||
        Object.entries(pkg[section]).some(([name, version]) => actual[name] !== version))
      throw new Error(`Regenerate the Cloudflare lockfile: ${section} pins changed.`);
  }
} else {
  lock.name = pkg.name;
  lock.packages[""] = { name: pkg.name, version: pkg.version, license: pkg.license, engines: pkg.engines, dependencies, devDependencies };
  // npm prunes unreachable entries when regenerating the Next.js-only lock.
}
await writeFile(resolve(output, "package-lock.json"), JSON.stringify(lock, null, 2) + "\n");
const tsconfig = JSON.parse(await readFile(resolve(root, "tsconfig.json"), "utf8"));
tsconfig.include = ["next-env.d.ts", "src/**/*.ts", "src/**/*.tsx", "next.config.ts", ".next/types/**/*.ts", ".next/dev/types/**/*.ts"];
if (cloudflare) tsconfig.include.push("vite.config.ts");
await writeFile(resolve(output, "tsconfig.json"), JSON.stringify(tsconfig, null, 2) + "\n");
await writeFile(resolve(output, "src/app/page.tsx"), 'import { redirect } from "next/navigation";\nexport default function Page() { redirect("/signup"); }\n');
await writeFile(resolve(output, "src/app/globals.css"), `* { box-sizing: border-box; }
body { margin: 0; font-family: var(--font-interface), sans-serif; font-size: 14px; line-height: 1.5; -webkit-font-smoothing: antialiased; }
button, input { font: inherit; }
button { cursor: pointer; touch-action: manipulation; }
button:disabled { opacity: .58; }
button, a, input { -webkit-tap-highlight-color: transparent; }
a { text-underline-offset: 4px; }
`);
const layout = await readFile(resolve(output, "src/app/layout.tsx"), "utf8");
await writeFile(resolve(output, "src/app/layout.tsx"), layout.replace("Fork Night local prototype.", "Join the Fork Night waitlist."));
await writeFile(resolve(output, ".gitignore"), "node_modules/\n.next/\n.wrangler/\n.cloudflare/\n.vinext/\ndist/\n.env*\n.dev.vars*\n*.tsbuildinfo\nnext-env.d.ts\n");
if (cloudflare) {
  for (const [source, target] of [
    ["vite.config.ts", "vite.config.ts"],
    ["wrangler.jsonc", "wrangler.jsonc"],
    ["waitlist-settings.ts", "src/server/waitlist-settings.ts"],
    ["bindings.d.ts", "src/types/cloudflare.d.ts"],
  ]) await copyFile(resolve(root, "config/waitlist-cloudflare", source), resolve(output, target));
}
console.log(`Prepared demo + signup deployment: ${output}`);
