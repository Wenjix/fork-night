import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { exportSubmission } from "../../scripts/export-submission.mjs";

const manifest = JSON.parse(await readFile(new URL("../../config/submission-files.json", import.meta.url), "utf8"));

async function fixture(t) {
  const sandbox = await mkdtemp(join(tmpdir(), "fork-night-export-test-"));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const root = join(sandbox, "source");
  await mkdir(root);
  async function put(path, content = `fixture:${path}\n`) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  for (const file of manifest.files) await put(file);
  await put("config/submission-files.json", JSON.stringify(manifest));
  for (const rule of manifest.directories) await mkdir(join(root, rule.path), { recursive: true });
  const selected = {
    "src/app/page.tsx": "export default function Page() { return <p>Demo</p>; }\n",
    "src/app/globals.css": "body { color: #123456; }\n",
    "src/domain/model.ts": "export const count = 2;\n",
    "tests/domain/model.test.ts": "import test from 'node:test';\n",
    "tests/repository/export.test.mjs": "import test from 'node:test';\n",
    "scripts/experiment.ts": "console.log('fixture runner');\n",
    "scripts/export-submission.mjs": "export const fixture = true;\n",
    "fixtures/experiments/sample.json": '{"mode":"simulated"}\n',
    "supabase/config.toml": 'project_id = "test-fixture"\n',
    "supabase/migrations/001_fixture.sql": 'select 1;\n',
    "contracts/ForkNightReleases.sol": '// SPDX-License-Identifier: AGPL-3.0-only\npragma solidity 0.8.24;\n',
  };
  for (const [path, content] of Object.entries(selected)) await put(path, content);
  return { root, sandbox, put, selected };
}

async function allFiles(root, prefix = "") {
  const result = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) result.push(...await allFiles(root, path));
    else result.push(path);
  }
  return result.sort();
}

test("exports only selected docs, runtime assets, config and source; preserves bytes and hashes", async (t) => {
  const { root, put, selected } = await fixture(t);
  const excluded = [
    ".git/objects/history", ".internal/research/private.md", ".local/experiments/record.json",
    ".agents/skills/private/SKILL.md", ".impeccable/review/approval.json",
    "PRODUCT.md", "DESIGN.md", "CONTEXT.md", "AGENTS.md", "skills-lock.json",
    "docs/research/notes.md", "docs/submission/PRIVATE.md", "docs/artwork/approvals.json",
    "output/visual-mocks/preview.webp", "node_modules/package/index.js", ".next/types/routes.d.ts",
    ".env", ".env.local", "next-env.d.ts", "tsconfig.tsbuildinfo",
    "public/art/midnight-story.png", "public/art/midnight-story.provenance.json",
    "public/art/midnight-story.webp.json", "public/art/unapproved.webp",
    "public/private.json", "src/.env", "src/.internal/private.ts", "src/secrets.ts",
    "src/credentials.ts", "src/notes.md", "src/approval.json", "tests/.local/secret.test.ts",
    "scripts/provider-secret.mjs", "fixtures/credentials.json", "fixtures/source.provenance.json",
    "supabase/.temp/project-ref", "supabase/.env", "supabase/private.env.toml", "supabase/secrets.sql",
  ];
  for (const file of excluded) await put(file, "PRIVATE_SENTINEL");
  const binary = Buffer.from([0, 255, 12, 0, 127, 33]);
  await put("public/art/midnight-story.webp", binary);
  const report = await exportSubmission({ rootDirectory: root });
  const expected = [...manifest.files, ...Object.keys(selected)].sort();
  assert.deepEqual(await allFiles(report.outputDirectory), expected);
  assert.equal(report.fileCount, expected.length);
  assert.deepEqual(report.files.map((file) => file.path), expected);
  let totalBytes = 0;
  for (const file of report.files) {
    const source = await readFile(join(root, file.path));
    const copied = await readFile(join(report.outputDirectory, file.path));
    assert.deepEqual(copied, source, file.path);
    assert.equal(file.bytes, copied.length);
    assert.equal(file.sha256, createHash("sha256").update(copied).digest("hex"));
    assert.equal(copied.includes("PRIVATE_SENTINEL"), false);
    assert.equal("content" in file, false);
    totalBytes += copied.length;
  }
  assert.equal(report.totalBytes, totalBytes);
  assert.deepEqual(await readFile(join(report.outputDirectory, "public/art/midnight-story.webp")), binary);
  assert.equal(await readFile(join(root, "DESIGN.md"), "utf8"), "PRIVATE_SENTINEL");
});

test("an existing output remains intact and is never merged or overwritten", async (t) => {
  const { root } = await fixture(t);
  const output = join(root, ".local/submission/reviewed");
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "README.md"), "existing reviewed export");
  await assert.rejects(exportSubmission({ rootDirectory: root, outputDirectory: output }), /already exists/);
  assert.deepEqual(await allFiles(output), ["README.md"]);
  assert.equal(await readFile(join(output, "README.md"), "utf8"), "existing reviewed export");
  const fileOutput = join(root, ".local/submission/existing-file");
  await writeFile(fileOutput, "preserve me");
  await assert.rejects(exportSubmission({ rootDirectory: root, outputDirectory: fileOutput }), /already exists/);
  assert.equal(await readFile(fileOutput, "utf8"), "preserve me");
});

test("rejects allowlist traversal, absolute paths and private paths before creating output", async (t) => {
  const { root, put } = await fixture(t);
  for (const path of ["../outside.ts", "/tmp/outside.ts", "src/../../outside.ts", "src\\outside.ts", ".env", ".internal/notes.md"]) {
    await put("config/submission-files.json", JSON.stringify({ ...manifest, files: [...manifest.files, path] }));
    await assert.rejects(exportSubmission({ rootDirectory: root }), /relative paths|Private path/);
  }
  for (const rule of [
    { path: "src/../.internal", extensions: [".ts"] },
    { path: ".internal", extensions: [".json"] },
    { path: "src", extensions: [".json"] },
    { path: "__proto__", extensions: [".ts"] },
  ]) {
    await put("config/submission-files.json", JSON.stringify({ ...manifest, directories: [rule] }));
    await assert.rejects(exportSubmission({ rootDirectory: root }), /relative paths|Invalid source directory/);
  }
  await assert.rejects(lstat(join(root, ".local")), { code: "ENOENT" });
});

test("rejects symlinked files, source directories and manifest ancestors", async (t) => {
  for (const path of ["README.md", "src/domain", "config"]) {
    const { root, sandbox } = await fixture(t);
    const target = join(sandbox, "outside");
    await mkdir(target);
    await writeFile(join(target, "private.ts"), "PRIVATE_SENTINEL");
    await rm(join(root, path), { recursive: true });
    await symlink(path === "README.md" ? join(target, "private.ts") : target, join(root, path));
    await assert.rejects(exportSubmission({ rootDirectory: root }), /Symlinks are not allowed/);
    await assert.rejects(lstat(join(root, ".local")), { code: "ENOENT" });
  }
});

test("permits a fresh temporary export but rejects source overlap and output symlinks", async (t) => {
  const { root, sandbox } = await fixture(t);
  const output = join(sandbox, "clean-export");
  const report = await exportSubmission({ rootDirectory: root, outputDirectory: output });
  assert.equal(report.fileCount, manifest.files.length + 11);
  for (const outputDirectory of [root, join(root, "src/copy"), sandbox, join(root, ".internal/copy")]) {
    await assert.rejects(exportSubmission({ rootDirectory: root, outputDirectory }), /overlap/);
  }
  const local = join(root, ".local");
  await symlink(sandbox, local);
  await assert.rejects(exportSubmission({ rootDirectory: root }), /Symlinks are not allowed/);
  const link = join(sandbox, "redirect");
  await symlink(root, link);
  await assert.rejects(exportSubmission({ rootDirectory: root, outputDirectory: join(link, "copy") }), /Symlinks are not allowed/);
  await assert.rejects(lstat(join(root, "copy")), { code: "ENOENT" });
});

test("missing required public files fail before an output is created", async (t) => {
  const { root } = await fixture(t);
  await rm(join(root, "public/art/social-worlds.webp"));
  await assert.rejects(exportSubmission({ rootDirectory: root }), { code: "ENOENT" });
  await assert.rejects(lstat(join(root, ".local")), { code: "ENOENT" });
});
