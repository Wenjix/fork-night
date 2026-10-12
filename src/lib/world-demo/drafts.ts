import type { Draft, Seat } from "./model.ts";

export type EditableDraft = Pick<Draft, "title" | "panels">;
type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const contributionDraftKey = (runId: string, memberId: string) => `world-demo:draft:v1:${runId}:${memberId}`;
export const selectionDraftKey = (runId: string, memberId: string) => `world-demo:selection:v1:${runId}:${memberId}`;

export function draftContent(draft: EditableDraft): EditableDraft {
  return { title: draft.title, panels: draft.panels.map(p => ({ asset: p.asset, caption: p.caption })) };
}

/** Normalize at the save/comparison boundary, leaving typing and captions intact. */
export function canonicalDraft(draft: EditableDraft): EditableDraft {
  return { ...draftContent(draft), title: draft.title.trim() };
}

/** Sequence edits stay inside one private contribution and keep image/caption pairs. */
export function addDraftPanel(draft: EditableDraft, role: Seat): EditableDraft {
  if (role === "curator" || draft.panels.length >= 3) return draft;
  return { ...draft, panels: [...draft.panels, { asset: role === "maker" ? "source-ledger" : "outcome", caption: "" }] };
}

export function moveDraftPanel(draft: EditableDraft, from: number, direction: -1 | 1): EditableDraft {
  const to = from + direction;
  if (!Number.isInteger(from) || from < 0 || from >= draft.panels.length || to < 0 || to >= draft.panels.length) return draft;
  const panels = [...draft.panels];
  [panels[from], panels[to]] = [panels[to], panels[from]];
  return { ...draft, panels };
}

export function sameDraft(a: EditableDraft, b: EditableDraft | null): boolean {
  return !!b && JSON.stringify(canonicalDraft(a)) === JSON.stringify(canonicalDraft(b));
}

export function readContributionDraft(storage: DraftStorage, key: string): EditableDraft | null {
  const raw = storage.getItem(key);
  if (raw === null) return null;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object") throw new Error("Your browser draft could not be restored. The last server-saved draft is shown.");
  const v = value as Record<string, unknown>;
  if (typeof v.title !== "string" || v.title.length > 80 || !Array.isArray(v.panels) || v.panels.length < 1 || v.panels.length > 3 ||
    !v.panels.every(p => p && typeof p === "object" && ["source-writing", "source-ledger", "outcome"].includes(p.asset) && typeof p.caption === "string" && p.caption.length <= 500)) {
    throw new Error("Your browser draft could not be restored. The last server-saved draft is shown.");
  }
  // Older copies may carry editedAt. A browser clock cannot order server writes.
  return draftContent(v as EditableDraft);
}

export function rememberContributionDraft(storage: DraftStorage, key: string, draft: EditableDraft): void {
  storage.setItem(key, JSON.stringify(draftContent(draft)));
}

/** Acknowledging one content version must not discard a newer edit from another tab. */
export function acknowledgeContributionDraft(storage: DraftStorage, key: string, acknowledged: EditableDraft): void {
  const local = readContributionDraft(storage, key);
  if (local && sameDraft(local, acknowledged)) storage.removeItem(key);
}

export function readSelectionDraft(storage: DraftStorage, key: string): string | null {
  const raw = storage.getItem(key);
  if (raw === null) return null;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || !("reason" in value) || typeof value.reason !== "string" || value.reason.length > 500) {
    throw new Error("Your browser could not restore the selection explanation. Keep this page open while editing it.");
  }
  return value.reason;
}

export function rememberSelectionDraft(storage: DraftStorage, key: string, reason: string): void {
  storage.setItem(key, JSON.stringify({ reason }));
}

/** Also recover pending selections created before explanations had their own draft. */
export function preserveSelectionDraft(storage: DraftStorage, key: string, reason: string): void {
  if (typeof reason !== "string" || reason.length > 500) throw new Error("This selection explanation could not be restored.");
  if (readSelectionDraft(storage, key) === null) rememberSelectionDraft(storage, key, reason);
}
