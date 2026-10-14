import { randomUUID } from "node:crypto";
import { appendFile, mkdir, open, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/**
 * Local JSON state for the Night Watch: sessions, jobs and their append-only event logs.
 *
 * Writes are atomic (temporary file, then rename) and every read-modify-write runs under an
 * exclusive lock file, so the web server and the runner process can share one directory.
 */
export type NightWatchStore = {
  readonly root: string;
  read<T>(name: string): Promise<T | null>;
  /** Replaces a document atomically. Prefer `update` when another process may write it. */
  write(name: string, value: unknown): Promise<void>;
  /** Creates a document only if none exists; returns false when one already does. */
  create(name: string, value: unknown): Promise<boolean>;
  /** Reads, changes and writes one document while holding its lock. */
  update<T>(name: string, change: (current: T | null) => T | Promise<T>): Promise<T>;
  /** Runs `work` while holding a named lock; other holders wait. */
  withLock<T>(name: string, work: () => Promise<T>, options?: { waitMs?: number }): Promise<T>;
  list(directory: string): Promise<string[]>;
  appendEvent(name: string, event: Record<string, unknown>): Promise<void>;
  readEvents(name: string): Promise<Record<string, unknown>[]>;
};

const NAME = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/i;
const STALE_LOCK_MS = 120_000;

export class LockTimeoutError extends Error {}

export function defaultNightWatchRoot(cwd = process.cwd()) {
  return resolve(cwd, process.env.NIGHT_WATCH_DIR ?? ".local/night-watch");
}

export function fileNightWatchStore(root = defaultNightWatchRoot()): NightWatchStore {
  const local = new Map<string, Promise<unknown>>();

  const pathOf = (name: string, extension = ".json") => {
    if (!NAME.test(name) || name.includes("..")) throw new Error(`Invalid Night Watch record name: ${name}`);
    return join(root, `${name}${extension}`);
  };

  async function writeAtomic(path: string, text: string) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(text);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
  }

  async function readJson<T>(path: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(path, "utf8")) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async function acquire(name: string, waitMs: number) {
    const lockPath = pathOf(`locks/${name}`, ".lock");
    await mkdir(dirname(lockPath), { recursive: true, mode: 0o700 });
    const started = Date.now();
    for (let delay = 15; ; delay = Math.min(delay * 2, 250)) {
      try {
        const handle = await open(lockPath, "wx", 0o600);
        await handle.writeFile(JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
        await handle.close();
        return async () => {
          await rm(lockPath, { force: true });
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const info = await stat(lockPath).catch(() => null);
        if (info && Date.now() - info.mtimeMs > STALE_LOCK_MS) {
          await rm(lockPath, { force: true });
          continue;
        }
        if (Date.now() - started > waitMs) throw new LockTimeoutError(`Timed out waiting for the Night Watch lock ${name}.`);
        await new Promise((done) => setTimeout(done, delay));
      }
    }
  }

  async function withLock<T>(name: string, work: () => Promise<T>, options: { waitMs?: number } = {}): Promise<T> {
    // Serialize within this process first so one process never races itself for the file lock.
    const previous = local.get(name) ?? Promise.resolve();
    let release!: () => void;
    const turn = new Promise<void>((done) => (release = done));
    const chained = previous.then(() => turn);
    local.set(name, chained);
    await previous.catch(() => undefined);
    try {
      const unlock = await acquire(name, options.waitMs ?? 15_000);
      try {
        return await work();
      } finally {
        await unlock();
      }
    } finally {
      release();
      if (local.get(name) === chained) local.delete(name);
    }
  }

  return {
    root,
    read: (name) => readJson(pathOf(name)),
    write: (name, value) => writeAtomic(pathOf(name), `${JSON.stringify(value, null, 2)}\n`),
    async create(name, value) {
      return withLock(name, async () => {
        if (await readJson(pathOf(name))) return false;
        await writeAtomic(pathOf(name), `${JSON.stringify(value, null, 2)}\n`);
        return true;
      });
    },
    update(name, change) {
      return withLock(name, async () => {
        const next = await change(await readJson(pathOf(name)));
        await writeAtomic(pathOf(name), `${JSON.stringify(next, null, 2)}\n`);
        return next;
      });
    },
    withLock,
    async list(directory) {
      try {
        const entries = await readdir(join(root, directory));
        return entries.filter((entry) => entry.endsWith(".json")).map((entry) => entry.slice(0, -5)).sort();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      }
    },
    async appendEvent(name, event) {
      const path = pathOf(name, ".jsonl");
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await appendFile(path, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`, { mode: 0o600 });
    },
    async readEvents(name) {
      try {
        const text = await readFile(pathOf(name, ".jsonl"), "utf8");
        // A line torn by a crash is skipped rather than hiding the whole log.
        return text
          .split("\n")
          .filter(Boolean)
          .flatMap((line) => {
            try {
              return [JSON.parse(line) as Record<string, unknown>];
            } catch {
              return [];
            }
          });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      }
    },
  };
}
