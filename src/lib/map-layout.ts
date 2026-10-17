import type { Moment } from "../domain/types.ts";

export interface MapNode<T = Moment> {
  moment: T;
  x: number;
  y: number;
  depth: number;
}

/** Presentation only. Parent IDs, never coordinates, determine story order. */
export function layoutMoments<
  T extends { id: string; parentId: string | null },
>(moments: T[], seedId: string) {
  const nodes: MapNode<T>[] = [];
  const visited = new Set<string>();
  const maxDepth = 32;
  let leaf = 0;
  function visit(id: string, depth: number): number {
    if (visited.has(id) || depth > maxDepth)
      throw new Error("This map has invalid or oversized ancestry.");
    visited.add(id);
    const moment = moments.find((item) => item.id === id);
    if (!moment) throw new Error("A moment in this map is missing.");
    const children = moments.filter((item) => item.parentId === id);
    const childXs = children.map((item) => visit(item.id, depth + 1));
    const x = childXs.length
      ? (childXs[0] + childXs.at(-1)!) / 2
      : leaf++ * 224 + 120;
    nodes.push({ moment, x, y: 0, depth });
    return x;
  }
  visit(seedId, 0);
  // Room above the seed: two tiers for a story that has begun to branch, one (the slot for the next moment) for a lone seed.
  const deepest = Math.max(nodes.length > 1 ? 2 : 1, ...nodes.map((node) => node.depth));
  for (const node of nodes) node.y = 30 + (deepest - node.depth) * 180;
  // The world is never narrower than 680px. A small story sits in the middle of it, not against its left edge.
  const content = leaf * 224 + 16;
  const width = Math.max(680, content);
  const inset = (width - content) / 2;
  for (const node of nodes) node.x += inset;
  return {
    nodes,
    width,
    height: 215 + deepest * 180,
  };
}
