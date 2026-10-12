import { DEMO_LIMITS } from "./engine.ts";
import type { DemoState, Moment, Panel, Project } from "./types.ts";
import { validateDemoState } from "./validation.ts";
import { isStoryArtUrl } from "../lib/art.ts";

export interface OriginalPanel extends Panel {
  /** Carry inherited context through selection so it cannot silently become original. */
  context?: { projectId: string; momentId: string };
}

export interface OriginalProjectInput {
  userId: string;
  projectId: string;
  title: string;
  description: string;
  panels: [OriginalPanel, OriginalPanel];
  now?: number;
}

function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function nonemptyText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maximum
  );
}

/** An original first node has no purchased ancestry, provider receipt or eligible reuse cost. */
export function publishOriginalProject(
  state: DemoState,
  input: OriginalProjectInput,
): DemoState {
  validateDemoState(state);
  ensure(
    input !== null &&
      typeof input === "object" &&
      !Array.isArray(input) &&
      (Object.getPrototypeOf(input) === Object.prototype ||
        Object.getPrototypeOf(input) === null),
    "Choose a valid original project.",
  );
  ensure(
    !Object.hasOwn(input, "context"),
    "Inherited work must continue its existing project; it cannot become a new original seed.",
  );
  ensure(
    Object.keys(input).every((key) =>
      ["userId", "projectId", "title", "description", "panels", "now"].includes(
        key,
      ),
    ),
    "Only the selected first node can be published.",
  );
  ensure(
    state.users.some((user) => user.id === input.userId),
    "Choose a known maker for this project.",
  );
  ensure(
    typeof input.projectId === "string" &&
      input.projectId.length <= 195 &&
      /^[A-Za-z0-9][A-Za-z0-9:_-]*$/.test(input.projectId) &&
      !["__proto__", "constructor", "prototype"].includes(input.projectId),
    "Choose a valid, unique project identity.",
  );
  ensure(
    nonemptyText(input.title, 300),
    "Give the new project a title of 1–300 characters.",
  );
  ensure(
    nonemptyText(input.description, 2_000),
    "Describe this project in 1–2000 characters.",
  );
  // Reject context at either level rather than accepting a stripped paid lineage.
  ensure(
    Array.isArray(input.panels) && input.panels.length === 2,
    "Select exactly two original image panels for the first node.",
  );
  const panels = Array.from(input.panels).map((panel) => {
    ensure(
      panel &&
        typeof panel === "object" &&
        !Array.isArray(panel) &&
        (Object.getPrototypeOf(panel) === Object.prototype ||
          Object.getPrototypeOf(panel) === null),
      "Select two original image panels.",
    );
    ensure(
      !Object.hasOwn(panel, "context"),
      "Inherited work must continue its existing project; it cannot become a new original seed.",
    );
    ensure(
      Object.keys(panel).every((key) => ["imageUrl", "caption"].includes(key)),
      "Only selected artwork and its caption can be published.",
    );
    ensure(
      isStoryArtUrl(panel.imageUrl),
      "Choose approved artwork or a PNG, JPEG or WebP image under 1 MB.",
    );
    ensure(
      nonemptyText(panel.caption, 2_000),
      "Add a caption of 1–2000 characters to each selected panel.",
    );
    return { imageUrl: panel.imageUrl, caption: panel.caption };
  }) as [Panel, Panel];
  const now = input.now ?? Date.now();
  ensure(
    Number.isSafeInteger(now) &&
      now >= 0 &&
      now <= Number.MAX_SAFE_INTEGER - DEMO_LIMITS.quoteLifetimeMs,
    "Choose a valid publication time.",
  );
  const project: Project = {
    id: input.projectId,
    title: input.title,
    description: input.description,
    visibility: "open",
    groupId: null,
    creatorId: input.userId,
    seedId: `${input.projectId}-seed`,
    termsVersion: "open-finished-work-v1",
    coverUrl: panels[0].imageUrl,
  };
  const seed: Moment = {
    id: project.seedId,
    projectId: project.id,
    parentId: null,
    version: 1,
    authorId: input.userId,
    title: input.title,
    panels,
    storyContext: `${input.description}\n\n${panels.map((panel) => panel.caption).join("\n")}`,
    reuseFee: 0,
    beneficiaryId: input.userId,
    termsVersion: project.termsVersion,
    publishedAt: now,
    source: "local-original",
  };
  const existingProject = state.projects.find((item) => item.id === project.id);
  const existingSeed = state.moments.find((item) => item.id === seed.id);
  if (existingProject || existingSeed) {
    ensure(
      existingProject &&
        existingSeed &&
        Object.entries(project).every(
          ([key, value]) => existingProject[key as keyof Project] === value,
        ) &&
        Object.entries(seed).every(
          ([key, value]) =>
            key === "publishedAt" ||
            JSON.stringify(existingSeed[key as keyof Moment]) ===
              JSON.stringify(value),
        ) &&
        existingSeed.builtOnThanks === undefined,
      "This project identity was already used for different work. Choose a new identity before publishing.",
    );
    return state;
  }
  const next = structuredClone(state);
  next.projects.push(project);
  next.moments.push(seed);
  validateDemoState(next);
  return next;
}
