import { canAccessProject } from "../domain/engine.ts";
import type { DemoState } from "../domain/types.ts";
import { isStoryArtUrl, LOCAL_RASTER_LIMITS } from "../lib/art.ts";

export const DESK_STORAGE_KEY = "fork-night-personal-desk-v1";
export const DESK_LIMITS = {
  maxCards: 60,
  maxTitle: 120,
  maxText: 2_000,
  maxImageBytes: LOCAL_RASTER_LIMITS.maxBytes,
  maxImageLength: LOCAL_RASTER_LIMITS.maxUrlLength,
  maxBoardLength: 3_000_000,
  maxSavedLength: 4_000_000,
  boardWidth: 1_800,
  boardHeight: 1_200,
  maxX: 1_500,
  maxY: 900,
} as const;

export interface DeskContext {
  projectId: string;
  momentId: string;
}

export interface DeskCard {
  id: string;
  kind: "note" | "image";
  title: string;
  text: string;
  imageUrl?: string;
  x: number;
  y: number;
  /** Retained when working from a published moment; never flattened into a new seed. */
  context?: DeskContext;
}

export interface DeskBoard {
  ownerId: string;
  cards: DeskCard[];
}

/** Browser-local creative work. This is not a group board or authenticated storage. */
export interface DeskState {
  version: 1;
  boards: Record<string, DeskBoard>;
}

export interface DeskStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function ensure(condition: unknown, detail: string): asserts condition {
  if (!condition)
    throw new Error(`Personal canvas data is invalid: ${detail}.`);
}

function record(
  value: unknown,
  detail: string,
  required: string[],
  optional: string[] = [],
): Record<string, unknown> {
  ensure(
    value !== null && typeof value === "object" && !Array.isArray(value),
    detail,
  );
  const result = value as Record<string, unknown>;
  ensure(
    (Object.getPrototypeOf(result) === Object.prototype ||
      Object.getPrototypeOf(result) === null) &&
      required.every((key) => Object.hasOwn(result, key)) &&
      Object.keys(result).every(
        (key) => required.includes(key) || optional.includes(key),
      ),
    detail,
  );
  return result;
}

function checkedId(value: unknown, detail: string): asserts value is string {
  ensure(
    typeof value === "string" &&
      value.length <= 200 &&
      /^[A-Za-z0-9][A-Za-z0-9:_-]*$/.test(value) &&
      !["__proto__", "constructor", "prototype"].includes(value),
    detail,
  );
}

function userExists(demo: DemoState, userId: string): void {
  checkedId(userId, "owner identity");
  ensure(
    demo.users.some((user) => user.id === userId),
    "unknown owner",
  );
}

function validContext(
  value: unknown,
  demo: DemoState,
): asserts value is DeskContext {
  const context = record(value, "card context", ["projectId", "momentId"]);
  checkedId(context.projectId, "context project");
  checkedId(context.momentId, "context moment");
  const moment = demo.moments.find((item) => item.id === context.momentId);
  // Resetting local stories can orphan a saved link. Keep it, but do not expose it.
  ensure(
    !moment || moment.projectId === context.projectId,
    "context must reference a published moment in its project",
  );
}

function accessibleCard(
  demo: DemoState,
  userId: string,
  card: DeskCard,
): boolean {
  return (
    !card.context ||
    (canAccessProject(demo, userId, card.context.projectId) &&
      demo.moments.some(
        (moment) =>
          moment.id === card.context!.momentId &&
          moment.projectId === card.context!.projectId,
      ))
  );
}

/** Access changes hide linked cards without destroying their saved lineage. */
export function validateDeskState(
  value: unknown,
  demo: DemoState,
): asserts value is DeskState {
  const root = record(value, "state", ["version", "boards"]);
  ensure(root.version === 1, "unsupported version");
  ensure(
    root.boards !== null &&
      typeof root.boards === "object" &&
      !Array.isArray(root.boards),
    "boards",
  );
  const boards = root.boards as Record<string, unknown>;
  ensure(
    Object.getPrototypeOf(boards) === Object.prototype ||
      Object.getPrototypeOf(boards) === null,
    "boards",
  );
  ensure(Object.keys(boards).length <= demo.users.length, "too many owners");
  for (const [ownerId, value] of Object.entries(boards)) {
    userExists(demo, ownerId);
    const board = record(value, "board", ["ownerId", "cards"]);
    ensure(board.ownerId === ownerId, "board owner mismatch");
    ensure(
      Array.isArray(board.cards) && board.cards.length <= DESK_LIMITS.maxCards,
      `at most ${DESK_LIMITS.maxCards} cards per canvas`,
    );
    const seen = new Set<string>();
    for (const raw of Array.from(board.cards)) {
      const card = record(
        raw,
        "card",
        ["id", "kind", "title", "text", "x", "y"],
        ["imageUrl", "context"],
      );
      checkedId(card.id, "card identity");
      ensure(!seen.has(card.id), "duplicate card identity");
      seen.add(card.id);
      ensure(card.kind === "note" || card.kind === "image", "card kind");
      ensure(
        typeof card.title === "string" &&
          card.title.trim().length > 0 &&
          card.title.length <= DESK_LIMITS.maxTitle,
        `card title needs 1–${DESK_LIMITS.maxTitle} characters`,
      );
      ensure(
        typeof card.text === "string" &&
          card.text.length <= DESK_LIMITS.maxText,
        `card text is limited to ${DESK_LIMITS.maxText} characters`,
      );
      for (const [key, maximum] of [
        ["x", DESK_LIMITS.maxX],
        ["y", DESK_LIMITS.maxY],
      ] as const)
        ensure(
          typeof card[key] === "number" &&
            Number.isFinite(card[key]) &&
            card[key] >= 0 &&
            card[key] <= maximum,
          `card ${key} position`,
        );
      ensure(
        card.kind === "image"
          ? isStoryArtUrl(card.imageUrl)
          : !Object.hasOwn(card, "imageUrl"),
        "images must be approved artwork or a PNG, JPEG or WebP under 1 MB",
      );
      if (Object.hasOwn(card, "context")) validContext(card.context, demo);
    }
    ensure(
      JSON.stringify(board).length <= DESK_LIMITS.maxBoardLength,
      "canvas storage limit reached; remove an image before adding another",
    );
  }
  ensure(
    JSON.stringify(value).length <= DESK_LIMITS.maxSavedLength,
    "personal canvas storage limit reached",
  );
}

export function createDeskState(): DeskState {
  return { version: 1, boards: {} };
}

/** Return only this maker's visible cards, never another maker's private canvas. */
export function getDeskBoard(
  state: DeskState,
  demo: DemoState,
  userId: string,
): DeskBoard {
  validateDeskState(state, demo);
  userExists(demo, userId);
  return {
    ownerId: userId,
    cards: structuredClone(
      (state.boards[userId]?.cards ?? []).filter((card) =>
        accessibleCard(demo, userId, card),
      ),
    ),
  };
}

export function addDeskCard(
  state: DeskState,
  demo: DemoState,
  input: DeskCard & { userId: string },
): DeskState {
  validateDeskState(state, demo);
  userExists(demo, input.userId);
  const { userId, ...card } = input;
  const next = structuredClone(state);
  const board =
    next.boards[userId] ??
    (next.boards[userId] = { ownerId: userId, cards: [] });
  ensure(
    !board.cards.some((item) => item.id === card.id),
    "card identity already exists",
  );
  board.cards.push(structuredClone(card));
  validateDeskState(next, demo);
  ensure(
    accessibleCard(demo, userId, card),
    "linked project is not accessible to this maker",
  );
  return next;
}

export type DeskCardChanges = Partial<
  Pick<DeskCard, "title" | "text" | "imageUrl" | "x" | "y">
>;

export function updateDeskCard(
  state: DeskState,
  demo: DemoState,
  input: { userId: string; cardId: string; changes: DeskCardChanges },
): DeskState {
  validateDeskState(state, demo);
  userExists(demo, input.userId);
  record(
    input.changes,
    "card changes",
    [],
    ["title", "text", "imageUrl", "x", "y"],
  );
  const next = structuredClone(state);
  const card = next.boards[input.userId]?.cards.find(
    (item) => item.id === input.cardId,
  );
  ensure(
    card && accessibleCard(demo, input.userId, card),
    "card is not available to this maker",
  );
  Object.assign(card, input.changes);
  validateDeskState(next, demo);
  return next;
}

export function removeDeskCard(
  state: DeskState,
  demo: DemoState,
  input: { userId: string; cardId: string },
): DeskState {
  validateDeskState(state, demo);
  userExists(demo, input.userId);
  const next = structuredClone(state);
  const board = next.boards[input.userId];
  ensure(
    board?.cards.some(
      (card) =>
        card.id === input.cardId && accessibleCard(demo, input.userId, card),
    ),
    "card is not available to this maker",
  );
  board.cards = board.cards.filter((card) => card.id !== input.cardId);
  return next;
}

function readSavedDesk(
  storage: Pick<DeskStorage, "getItem">,
  demo: DemoState,
): DeskState | null {
  let saved: string | null;
  try {
    saved = storage.getItem(DESK_STORAGE_KEY);
  } catch {
    throw new Error(
      "This browser could not read your personal canvas. Its saved data has not been changed.",
    );
  }
  if (saved === null) return null;
  try {
    ensure(
      saved.length <= DESK_LIMITS.maxSavedLength,
      "saved canvas is too large",
    );
    const parsed: unknown = JSON.parse(saved);
    validateDeskState(parsed, demo);
    return parsed;
  } catch {
    throw new Error(
      "Your saved personal canvas could not be read. It has not been overwritten; restore or reset the saved canvas before editing.",
    );
  }
}

export function loadDeskState(
  storage: Pick<DeskStorage, "getItem">,
  demo: DemoState,
): DeskState {
  return readSavedDesk(storage, demo) ?? createDeskState();
}

/** Commit owner-scoped changes before UI success/navigation; failures leave the input untouched. */
export function commitDeskChange(
  storage: DeskStorage,
  current: DeskState,
  demo: DemoState,
  userId: string,
  action: (current: DeskState) => DeskState,
): DeskState {
  validateDeskState(current, demo);
  userExists(demo, userId);
  const saved = readSavedDesk(storage, demo);
  if (saved && JSON.stringify(saved) !== JSON.stringify(current))
    throw new Error(
      "Your personal canvas changed in another window. Reload it before saving this edit.",
    );
  const next = action(structuredClone(current));
  validateDeskState(next, demo);
  for (const ownerId of new Set([
    ...Object.keys(current.boards),
    ...Object.keys(next.boards),
  ]))
    ensure(
      ownerId === userId ||
        JSON.stringify(current.boards[ownerId]) ===
          JSON.stringify(next.boards[ownerId]),
      "another maker's canvas cannot be changed",
    );
  for (const card of next.boards[userId]?.cards ?? []) {
    const previous = current.boards[userId]?.cards.find(
      (item) => item.id === card.id,
    );
    if (previous)
      ensure(
        JSON.stringify(card.context) === JSON.stringify(previous.context),
        "inherited card context cannot be changed",
      );
    if (!previous || JSON.stringify(card) !== JSON.stringify(previous))
      ensure(
        accessibleCard(demo, userId, card),
        "linked project is not accessible to this maker",
      );
  }
  try {
    storage.setItem(DESK_STORAGE_KEY, JSON.stringify(next));
  } catch {
    throw new Error(
      "This browser could not save your personal canvas, so the change has not been applied. Free some browser storage and try again.",
    );
  }
  return next;
}
