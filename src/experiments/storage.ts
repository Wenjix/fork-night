import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Artifact } from "./types.ts";

export function digest(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Consistent hashing irrespective of object key insertion order. */
export function canonicalJson(value: unknown): string {
  const sort = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(sort);
    if (item !== null && typeof item === "object") {
      return Object.fromEntries(
        Object.entries(item)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, next]) => [key, sort(next)]),
      );
    }
    return item;
  };
  return JSON.stringify(sort(value), null, 2) + "\n";
}

export async function writeAtomic(
  path: string,
  contents: string | Buffer,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(contents);
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, path);
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await writeAtomic(path, canonicalJson(value));
}

export async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function writeArtifact(
  directory: string,
  path: string,
  contents: string,
): Promise<Artifact> {
  await writeAtomic(join(directory, path), contents);
  return { path, sha256: digest(contents), bytes: Buffer.byteLength(contents) };
}

export function validateAttemptId(id: string): void {
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(id)) {
    throw new Error(
      "Attempt ID must be 1–80 lowercase letters, digits, underscores or hyphens",
    );
  }
}

/** Local exclusion, not a distributed lease or an application budget authority. */
export async function withAttemptLock<T>(
  directory: string,
  work: () => Promise<T>,
): Promise<T> {
  await mkdir(directory, { recursive: true });
  const path = join(directory, "run.lock");
  let lock;
  try {
    lock = await open(path, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(
        `Attempt is locked: ${path}. Do not run it twice. After an abrupt process death, verify the recorded PID is no longer active before manually removing this local lock.`,
      );
    }
    throw error;
  }
  try {
    await lock.writeFile(
      canonicalJson({ pid: process.pid, startedAt: new Date().toISOString() }),
    );
    await lock.sync();
    return await work();
  } finally {
    await lock.close();
    await unlink(path);
  }
}
