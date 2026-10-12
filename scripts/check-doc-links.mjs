import { access, readFile, readdir } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--internal")) {
  console.error("Usage: npm run docs:check [-- --internal]");
  process.exit(1);
}
const includeInternal = args.includes("--internal");

async function markdownFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await markdownFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(path);
  }
  return files;
}

const files = [join(root, "README.md"), ...await markdownFiles(join(root, "docs/submission"))];
if (includeInternal) files.push(...await markdownFiles(join(root, ".internal")));
let checked = 0;
let historicalExternalPaths = 0;
const failures = [];
for (const file of files) {
  const content = (await readFile(file, "utf8"))
    .replace(/^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s*\1\s*$/gm, "")
    .replace(/`[^`\n]+`/g, "");
  const links = [
    ...[...content.matchAll(/\]\((<[^>]+>|[^)\n]+)\)/g)].map((match) => match[1]),
    ...[...content.matchAll(/(?:href|src)\s*=\s*["']([^"']+)["']/g)].map((match) => match[1]),
    ...[...content.matchAll(/^\s*\[[^\]]+\]:\s*(<[^>]+>|\S+)/gm)].map((match) => match[1]),
  ];
  for (let target of links) {
    target = target.trim().replace(/\s+["'][^"']*["']$/, "");
    if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
    if (!target || target.startsWith("#") || /^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith("//")) continue;
    target = decodeURIComponent(target.split(/[?#]/, 1)[0]).replace(/:\d+$/, "");
    if (isAbsolute(target)) {
      // Historic inspiration files outside this workspace are deliberately not relocated.
      if (includeInternal && file.startsWith(join(root, ".internal/"))) {
        historicalExternalPaths += 1;
        continue;
      }
      failures.push(`${relative(root, file)}: absolute local link is unsuitable for submission: ${target}`);
      continue;
    }
    checked += 1;
    try { await access(resolve(dirname(file), target)); }
    catch { failures.push(`${relative(root, file)}: missing ${target}`); }
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  console.error(`${failures.length} broken links across ${files.length} documents.`);
  process.exitCode = 1;
} else {
  console.log(`Checked ${checked} local links across ${files.length} documents.${historicalExternalPaths ? ` Skipped ${historicalExternalPaths} historical external filesystem links.` : ""}`);
}
