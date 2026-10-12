import { readFile } from "node:fs/promises";
import { sumUsd } from "./money.ts";
import type {
  ExperimentFixture,
  InheritedPackage,
  StoryFixture,
  StoryMoment,
} from "./types.ts";

export const EXPERIMENT_LIMITS = {
  maxAncestors: 32,
  maxInputBytes: 64 * 1024,
} as const;

export async function loadFixtures(): Promise<{
  story: StoryFixture;
  experiments: ExperimentFixture[];
}> {
  const raw = await readFile(
    new URL("../../fixtures/experiments/lantern-archive.json", import.meta.url),
    "utf8",
  );
  return JSON.parse(raw) as {
    story: StoryFixture;
    experiments: ExperimentFixture[];
  };
}

/** Include exactly the published ancestor path, with only its versioned assets. */
export function buildInheritedPackage(
  story: StoryFixture,
  parentId: string | null,
): InheritedPackage {
  const byId = new Map<string, StoryMoment>();
  for (const moment of story.moments) {
    if (byId.has(moment.id)) throw new Error(`Duplicate moment: ${moment.id}`);
    byId.set(moment.id, moment);
  }
  const path: StoryMoment[] = [];
  const visited = new Set<string>();
  let current = parentId;
  while (current !== null) {
    if (visited.has(current))
      throw new Error("Cyclic ancestry is not permitted");
    if (path.length >= EXPERIMENT_LIMITS.maxAncestors)
      throw new Error("Ancestor path exceeds the local fixture limit");
    const moment = byId.get(current);
    if (!moment) throw new Error(`Unknown parent: ${current}`);
    if (moment.projectId !== story.projectId)
      throw new Error("Parent belongs to another project");
    if (!moment.published)
      throw new Error("Parent must be a published immutable moment");
    visited.add(current);
    path.push(moment);
    current = moment.parentId;
  }
  path.reverse();
  const characterIds = new Set(
    path.flatMap((moment) => moment.characterVersionIds),
  );
  const referenceIds = new Set(path.flatMap((moment) => moment.referenceIds));
  for (const id of characterIds) {
    if (!story.characters.some((character) => character.id === id))
      throw new Error(`Missing character version: ${id}`);
  }
  for (const id of referenceIds) {
    if (!story.references.some((reference) => reference.id === id))
      throw new Error(`Missing reference: ${id}`);
  }
  const inherited: InheritedPackage = {
    version: "inheritance-v1",
    projectId: story.projectId,
    parentId,
    moments: path,
    characters: story.characters.filter((character) =>
      characterIds.has(character.id),
    ),
    references: story.references.filter((reference) =>
      referenceIds.has(reference.id),
    ),
    upstreamReuseFeesUsd: sumUsd(path.map((moment) => moment.reuseFeeUsd)),
  };
  if (
    Buffer.byteLength(JSON.stringify(inherited)) >
    EXPERIMENT_LIMITS.maxInputBytes
  ) {
    throw new Error("Inherited input exceeds the local fixture size limit");
  }
  return structuredClone(inherited);
}
