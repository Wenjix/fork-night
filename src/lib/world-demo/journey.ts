import { isUuid, recognition, type WorldState } from "./model.ts";

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
type Entry = { runId: string; token?: string };
export const MAKER_ENTRY_KEY = "world-demo:entering:maker:v1";

/** Keep both steps recoverable: creating the room and claiming its maker invitation. */
export async function enterAsMaker(storage: Storage, ports: {
  newId: () => string;
  create: (runId: string) => Promise<WorldState>;
  join: (runId: string, token: string) => Promise<WorldState>;
  read: (runId: string) => Promise<WorldState>;
}): Promise<WorldState> {
  const raw = storage.getItem(MAKER_ENTRY_KEY);
  let entry: Entry;
  if (raw) {
    const saved: unknown = JSON.parse(raw);
    if (!saved || typeof saved !== "object" || !("runId" in saved) || typeof saved.runId !== "string" || !isUuid(saved.runId) ||
      ("token" in saved && (typeof saved.token !== "string" || !/^[a-f0-9]{64}$/.test(saved.token)))) {
      throw new Error("Your unfinished room entry could not be restored. Keep this browser open and use your saved room link.");
    }
    entry = saved as Entry;
  } else {
    entry = { runId: ports.newId() };
    storage.setItem(MAKER_ENTRY_KEY, JSON.stringify(entry));
  }
  if (!entry.token) {
    const host = await ports.create(entry.runId);
    if (host.id !== entry.runId || host.me.role !== "curator") throw new Error("The room host could not be confirmed. Try entering again.");
    storage.setItem("world-demo:last:curator", host.id);
    const invitation = host.invitations.find(item => item.role === "maker");
    if (invitation?.token) {
      entry = { ...entry, token: invitation.token };
      // Persist before the join: its response may be lost after the invitation is claimed.
      storage.setItem(MAKER_ENTRY_KEY, JSON.stringify(entry));
    } else if (!invitation?.claimed) {
      throw new Error("Mira's invitation is not ready. Try entering the room again.");
    }
  }
  const maker = entry.token ? await ports.join(entry.runId, entry.token) : await ports.read(entry.runId);
  if (maker.id !== entry.runId || maker.me.role !== "maker") throw new Error("Mira's seat could not be confirmed. Reopen her invitation in the original browser.");
  return maker;
}

export function completeMakerEntry(storage: Storage, runId: string) {
  const raw = storage.getItem(MAKER_ENTRY_KEY);
  if (raw && (JSON.parse(raw) as Entry).runId === runId) storage.removeItem(MAKER_ENTRY_KEY);
}

/** Milestones are derived from published relationships, never from the current screen. */
export function makerJourney(state: WorldState) {
  const source = state.works.find(work => work.role === "maker");
  const seen = source ? recognition(state, source.id) : undefined;
  const continuation = seen?.continuations.find(work => work.role === "continuing");
  const step = seen?.release ? 4 : seen?.selection ? 3 : continuation ? 2 : source ? 1 : 0;
  const completed = [!!source, !!source, !!continuation, !!seen?.selection || !!seen?.release, !!seen?.release];
  return { source, continuation, selection: seen?.selection, release: seen?.release, step, completed };
}
