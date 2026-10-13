import { DEMO_LIMITS } from "../domain/engine.ts";
import { validateDemoState } from "../domain/validation.ts";
import type { DemoState } from "../domain/types.ts";

export type SocialRoute =
  | { kind: "lobby" | "spaces" | "desk" }
  | { kind: "guild" | "hall"; guildId: string }
  | { kind: "ideas"; boardId: string }
  | { kind: "project"; projectId: string; view?: "images-to-video" };

export interface OpenProjectOptions {
  momentId?: string;
  prompt?: string;
  task?: "create" | "read" | "balance" | "members";
  ideaId?: string;
}

export interface WorkspaceDraft {
  userId: string;
  projectId: string;
  selectedId: string;
  prompt: string;
  operationId: string | null;
  updatedAt: number;
  ideaId?: string;
}

/** Browser-local work, scoped to its maker and project. It is never group content. */
export interface LocalWorkspace {
  state: DemoState;
  userId: string;
  projectId: string;
  selectedId: string;
  draft: string;
  /** Reading another branch must not move an unfinished draft's starting point. */
  draftSourceId?: string;
  operationId: string | null;
  drafts: Record<string, WorkspaceDraft>;
  ideaId?: string;
}

const routeId = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,199}$/;

export function parseSocialRoute(hash: string): SocialRoute {
  try {
    const path = hash.replace(/^#/, "");
    if (path === "" || path === "/" || path === "/lobby")
      return { kind: "lobby" };
    if (path === "/spaces") return { kind: "spaces" };
    if (path === "/desk") return { kind: "desk" };
    const match = path.match(/^\/(guild|hall|ideas|project)\/([^/?#]+)(\/images-to-video)?\/?$/);
    if (!match) return { kind: "lobby" };
    const id = decodeURIComponent(match[2]);
    if (!routeId.test(id) || ["constructor", "prototype", "__proto__"].includes(id))
      return { kind: "lobby" };
    if (match[3]) return match[1] === "project" && id === "blade-runner-memory"
      ? { kind: "project", projectId: id, view: "images-to-video" }
      : { kind: "lobby" };
    if (match[1] === "guild" || match[1] === "hall")
      return { kind: match[1], guildId: id };
    if (match[1] === "ideas") return { kind: "ideas", boardId: id };
    return { kind: "project", projectId: id };
  } catch {
    return { kind: "lobby" };
  }
}

export function formatSocialRoute(route: SocialRoute): string {
  if (route.kind === "guild" || route.kind === "hall")
    return `#/${route.kind}/${encodeURIComponent(route.guildId)}`;
  if (route.kind === "ideas") return `#/ideas/${encodeURIComponent(route.boardId)}`;
  if (route.kind === "project")
    return `#/project/${encodeURIComponent(route.projectId)}${route.view === "images-to-video" && route.projectId === "blade-runner-memory" ? "/images-to-video" : ""}`;
  return `#/${route.kind}`;
}

function draftKey(userId: string, projectId: string): string {
  return JSON.stringify([userId, projectId]);
}

export function rememberWorkspaceDraft(
  workspace: LocalWorkspace,
  now = Date.now(),
): LocalWorkspace {
  const key = draftKey(workspace.userId, workspace.projectId);
  const previous = workspace.drafts[key];
  const operation = workspace.state.operations.find(
    (item) => item.id === workspace.operationId &&
      item.quote.userId === workspace.userId && item.quote.projectId === workspace.projectId &&
      ["reserved", "delivered"].includes(item.status),
  );
  const sourceId = operation?.quote.parentId ??
    (workspace.draft.trim() ? workspace.draftSourceId ?? workspace.selectedId : workspace.selectedId);
  const unchanged =
    previous?.selectedId === sourceId &&
    previous?.prompt === workspace.draft &&
    previous?.operationId === workspace.operationId &&
    previous?.ideaId === workspace.ideaId;
  return {
    ...workspace,
    drafts: {
      ...workspace.drafts,
      [key]: {
        userId: workspace.userId,
        projectId: workspace.projectId,
        selectedId: sourceId,
        prompt: workspace.draft,
        operationId: workspace.operationId,
        updatedAt: unchanged ? previous.updatedAt : now,
        ...(workspace.ideaId ? { ideaId: workspace.ideaId } : {}),
      },
    },
  };
}

export function switchWorkspaceContext(
  workspace: LocalWorkspace,
  userId: string,
  projectId: string,
): LocalWorkspace {
  const project = workspace.state.projects.find((item) => item.id === projectId);
  if (!project || !workspace.state.users.some((item) => item.id === userId))
    throw new Error("That local workspace is unavailable.");
  const remembered = rememberWorkspaceDraft(workspace);
  const saved = remembered.drafts[draftKey(userId, projectId)];
  const selected = workspace.state.moments.find(
    (item) => item.id === saved?.selectedId && item.projectId === projectId,
  );
  const operation = workspace.state.operations.find(
    (item) =>
      item.id === saved?.operationId &&
      item.quote.userId === userId &&
      item.quote.projectId === projectId,
  );
  return {
    ...remembered,
    userId,
    projectId,
    selectedId: selected?.id ?? project.seedId,
    draftSourceId: operation && ["reserved", "delivered"].includes(operation.status)
      ? operation.quote.parentId : selected?.id,
    draft: saved?.prompt ?? "",
    operationId: operation?.id ?? null,
    ideaId: saved?.ideaId,
  };
}

export function unfinishedDrafts(workspace: LocalWorkspace): WorkspaceDraft[] {
  return Object.values(rememberWorkspaceDraft(workspace).drafts)
    .filter((draft) => {
      const active = workspace.state.operations.some(
        (item) =>
          item.id === draft.operationId &&
          item.quote.userId === draft.userId &&
          item.quote.projectId === draft.projectId &&
          (item.status === "reserved" || item.status === "delivered"),
      );
      return draft.prompt.trim().length > 0 || active;
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Preserve pre-social saves and validate the ledger before any fixture migration. */
export function restoreLocalWorkspace(
  value: unknown,
  extend: (state: DemoState) => DemoState = (state) => state,
): LocalWorkspace {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Unrecognized local save");
  const saved = value as Partial<LocalWorkspace>;
  if (
    !saved.state ||
    typeof saved.userId !== "string" ||
    typeof saved.projectId !== "string" ||
    typeof saved.draft !== "string"
  )
    throw new Error("Unrecognized local save");
  validateDemoState(saved.state);
  const state = extend(saved.state);
  validateDemoState(state);
  const project = state.projects.find((item) => item.id === saved.projectId);
  if (!project || !state.users.some((item) => item.id === saved.userId))
    throw new Error("Unrecognized local workspace");
  const drafts: Record<string, WorkspaceDraft> = {};
  if (saved.drafts !== undefined) {
    if (!saved.drafts || typeof saved.drafts !== "object" || Array.isArray(saved.drafts))
      throw new Error("Unrecognized saved drafts");
    for (const entry of Object.values(saved.drafts)) {
      if (
        !entry ||
        typeof entry !== "object" ||
        typeof entry.userId !== "string" ||
        typeof entry.projectId !== "string" ||
        typeof entry.prompt !== "string" ||
        !Number.isSafeInteger(entry.updatedAt) ||
        entry.updatedAt < 0
      )
        throw new Error("Unrecognized saved draft");
      const target = state.projects.find((item) => item.id === entry.projectId);
      if (!target || !state.users.some((item) => item.id === entry.userId)) continue;
      const source = state.moments.find(
        (item) => item.id === entry.selectedId && item.projectId === entry.projectId,
      );
      const operation = state.operations.find(
        (item) =>
          item.id === entry.operationId &&
          item.quote.userId === entry.userId &&
          item.quote.projectId === entry.projectId,
      );
      drafts[draftKey(entry.userId, entry.projectId)] = {
        userId: entry.userId,
        projectId: entry.projectId,
        selectedId: source?.id ?? target.seedId,
        prompt: entry.prompt.slice(0, DEMO_LIMITS.maxPromptLength),
        operationId: operation?.id ?? null,
        updatedAt: entry.updatedAt,
        ...(typeof entry.ideaId === "string" ? { ideaId: entry.ideaId } : {}),
      };
    }
  }
  const moment = state.moments.find(
    (item) => item.id === saved.selectedId && item.projectId === project.id,
  );
  const operation = state.operations.find(
    (item) =>
      item.id === saved.operationId &&
      item.quote.userId === saved.userId &&
      item.quote.projectId === project.id,
  );
  const draftSource = state.moments.find(
    (item) => item.id === saved.draftSourceId && item.projectId === project.id,
  );
  return rememberWorkspaceDraft({
    state,
    userId: saved.userId,
    projectId: project.id,
    selectedId: moment?.id ?? project.seedId,
    draftSourceId: operation && ["reserved", "delivered"].includes(operation.status)
      ? operation.quote.parentId : draftSource?.id ?? moment?.id ?? project.seedId,
    draft: saved.draft.slice(0, DEMO_LIMITS.maxPromptLength),
    operationId: operation?.id ?? null,
    drafts,
    ...(typeof saved.ideaId === "string" ? { ideaId: saved.ideaId } : {}),
  });
}
