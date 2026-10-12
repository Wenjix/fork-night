import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultRoot = fileURLToPath(new URL("../", import.meta.url));
const manifestPath = "config/submission-files.json";
const directoryExtensions = {
  src: new Set([".ts", ".tsx", ".css"]),
  tests: new Set([".ts", ".mjs"]),
  scripts: new Set([".ts", ".mjs"]),
  fixtures: new Set([".json"]),
  supabase: new Set([".toml", ".sql"]),
  contracts: new Set([".sol"]),
};
const privateNames = new Set([
  "node_modules", "output", "test-results", "coverage",
  "AGENTS.md", "PRODUCT.md", "DESIGN.md", "CONTEXT.md", "skills-lock.json",
  "next-env.d.ts",
]);
const privateFilename = /(?:^|[._-])(?:env|secrets?|credentials?|provenance|approvals?)(?:[._-]|$)/i;

function validatePath(path) {
  if (
    typeof path !== "string" || !path || isAbsolute(path) ||
    /[\\:\0]/.test(path) ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  ) throw new Error("Allowlist paths must be ordinary relative paths without traversal");
  return path;
}

function isPublicPath(path) {
  if ([".env.example", ".gitignore", ".vercelignore"].includes(path)) return true;
  return path.split("/").every((part) =>
    !part.startsWith(".") && !privateNames.has(part) &&
    !privateFilename.test(part) && !part.endsWith(".tsbuildinfo")
  );
}

function inside(path, root) {
  const tail = relative(root, path);
  return !!tail && tail !== ".." && !tail.startsWith(`..${sep}`) && !isAbsolute(tail);
}

async function statIfPresent(path) {
  try { return await lstat(path); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

// Walk from a trusted root so intermediate links cannot redirect a file or output.
async function rejectSymlinks(root, path) {
  if (path !== root && !inside(path, root)) throw new Error("Path escapes its trusted root");
  let current = root;
  for (const part of relative(root, path).split(sep).filter(Boolean)) {
    current = join(current, part);
    const stat = await statIfPresent(current);
    if (stat?.isSymbolicLink()) throw new Error(`Symlinks are not allowed: ${relative(root, current)}`);
    if (stat && current !== path && !stat.isDirectory())
      throw new Error(`Expected a directory: ${relative(root, current)}`);
  }
}

function validateManifest(manifest) {
  if (manifest?.version !== 1 || !Array.isArray(manifest.files) ||
      !Array.isArray(manifest.directories)) throw new Error("Invalid submission allowlist");
  const files = new Set();
  for (const file of manifest.files) {
    validatePath(file);
    if (!isPublicPath(file)) throw new Error(`Private path cannot be allowlisted: ${file}`);
    if (files.has(file)) throw new Error(`Duplicate allowlist file: ${file}`);
    files.add(file);
  }
  const directories = new Set();
  for (const rule of manifest.directories) {
    validatePath(rule.path);
    const allowed = Object.hasOwn(directoryExtensions, rule.path) ? directoryExtensions[rule.path] : null;
    if (!allowed || !Array.isArray(rule.extensions) || !rule.extensions.length ||
        rule.extensions.some((extension) => !allowed.has(extension)))
      throw new Error(`Invalid source directory rule: ${rule.path}`);
    if (directories.has(rule.path)) throw new Error(`Duplicate source directory: ${rule.path}`);
    directories.add(rule.path);
  }
  return manifest;
}

async function collectFiles(root, manifest) {
  const paths = new Set(manifest.files);
  for (const rule of manifest.directories) {
    const start = join(root, rule.path);
    await rejectSymlinks(root, start);
    const stat = await lstat(start);
    if (!stat.isDirectory()) throw new Error(`Expected a source directory: ${rule.path}`);
    async function walk(directory, relativeDirectory) {
      const names = (await readdir(directory)).sort();
      for (const name of names) {
        const path = `${relativeDirectory}/${name}`;
        const absolute = join(directory, name);
        const entry = await lstat(absolute);
        if (entry.isSymbolicLink()) throw new Error(`Symlinks are not allowed: ${path}`);
        if (!isPublicPath(path)) continue;
        if (entry.isDirectory()) await walk(absolute, path);
        else if (entry.isFile() && rule.extensions.some((extension) => name.endsWith(extension)))
          paths.add(path);
      }
    }
    await walk(start, rule.path);
  }
  const files = [];
  for (const path of [...paths].sort()) {
    const absolute = join(root, path);
    await rejectSymlinks(root, absolute);
    const stat = await lstat(absolute);
    if (!stat.isFile()) throw new Error(`Allowlist entry must be a regular file: ${path}`);
    const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
    let content;
    try { content = await handle.readFile(); }
    finally { await handle.close(); }
    files.push({ path, content, bytes: content.length, sha256: createHash("sha256").update(content).digest("hex") });
  }
  return files;
}

async function validateOutput(root, requested, sourcePath) {
  let target = resolve(root, requested ?? ".local/submission/fork-night");
  // macOS exposes its temp root through both /var and /private/var.
  if (sourcePath !== root && (target === sourcePath || inside(target, sourcePath)))
    target = join(root, relative(sourcePath, target));
  const localRoot = join(root, ".local/submission");
  if (inside(target, localRoot)) {
    await rejectSymlinks(root, target);
  } else {
    const temporaryRoots = [...new Set([tmpdir(), await realpath(tmpdir()), "/tmp", "/private/tmp"])];
    const temporaryRoot = temporaryRoots.find((candidate) => inside(target, resolve(candidate)));
    if (!temporaryRoot) throw new Error("Output must be a new directory inside .local/submission or a temporary directory");
    const canonicalRoot = await realpath(temporaryRoot);
    const canonicalTarget = join(canonicalRoot, relative(resolve(temporaryRoot), target));
    if (canonicalTarget === root || inside(canonicalTarget, root) || inside(root, canonicalTarget))
      throw new Error("Temporary output must not overlap the source repository");
    await rejectSymlinks(canonicalRoot, canonicalTarget);
    if (await statIfPresent(canonicalTarget)) throw new Error("Output already exists; choose a new output directory");
    return { path: canonicalTarget, anchor: canonicalRoot };
  }
  if (await statIfPresent(target)) throw new Error("Output already exists; choose a new output directory");
  return { path: target, anchor: root };
}

/** Copy only allowlisted public files. No source files or old exports are changed.
 * Returns an audit inventory with relative paths, byte counts and SHA-256 hashes.
 */
export async function exportSubmission({ rootDirectory = defaultRoot, outputDirectory } = {}) {
  const sourcePath = resolve(rootDirectory);
  const root = await realpath(sourcePath);
  const destination = await validateOutput(root, outputDirectory, sourcePath);
  const output = destination.path;
  const absoluteManifest = join(root, manifestPath);
  await rejectSymlinks(root, absoluteManifest);
  const manifest = validateManifest(JSON.parse(await readFile(absoluteManifest, "utf8")));
  const files = await collectFiles(root, manifest);
  // Validate the full selection before creating a destination, then reserve it.
  await mkdir(dirname(output), { recursive: true });
  await rejectSymlinks(destination.anchor, output);
  try { await mkdir(output); }
  catch (error) {
    if (error.code === "EEXIST") throw new Error("Output already exists; choose a new output directory");
    throw error;
  }
  for (const file of files) {
    const target = join(output, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content, { flag: "wx" });
  }
  return {
    outputDirectory: output,
    fileCount: files.length,
    totalBytes: files.reduce((total, file) => total + file.bytes, 0),
    files: files.map(({ content, ...file }) => file),
  };
}

async function main(args) {
  if (args.length === 1 && args[0] === "--help") {
    console.log("Usage: node scripts/export-submission.mjs [--out <new-directory>]\nDefault: .local/submission/fork-night. Output must be inside .local/submission or an OS temporary directory; existing destinations are preserved.");
    return;
  }
  if (args.length && (args.length !== 2 || args[0] !== "--out" || args[1].startsWith("--")))
    throw new Error("Expected --out <new-directory>; use --help");
  const result = await exportSubmission({ outputDirectory: args[1] });
  const inventoryHash = createHash("sha256").update(JSON.stringify(result.files)).digest("hex");
  console.log(`Exported ${result.fileCount} files (${result.totalBytes} bytes) to ${result.outputDirectory}\nInventory SHA-256: ${inventoryHash}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`Submission export failed: ${error.message}`);
    process.exitCode = 1;
  });
}
