import type { DemoState } from "../domain/types.ts";

/** Published history only: a draft, a wallet balance or guild membership is not a contribution. */
export function projectActivity(demo: DemoState, projectId: string) {
  const project = demo.projects.find((item) => item.id === projectId);
  if (!project) return { contributors: 0, moments: 0, longestPath: 0 };
  const moments = demo.moments.filter((item) => item.projectId === projectId);
  const children = new Map<string, string[]>();
  for (const moment of moments) {
    if (moment.parentId) {
      const siblings = children.get(moment.parentId) ?? [];
      siblings.push(moment.id);
      children.set(moment.parentId, siblings);
    }
  }
  const known = new Set(moments.map((item) => item.id));
  const visited = new Set<string>();
  const pending = [{ id: project.seedId, depth: 1 }];
  let longestPath = 0;
  while (pending.length) {
    const { id, depth } = pending.pop()!;
    if (!known.has(id) || visited.has(id)) continue;
    visited.add(id);
    longestPath = Math.max(longestPath, depth);
    for (const child of children.get(id) ?? [])
      pending.push({ id: child, depth: depth + 1 });
  }
  return {
    contributors: new Set(moments.map((item) => item.authorId)).size,
    moments: moments.length,
    longestPath,
  };
}
