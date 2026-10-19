import { isUuid, pilotPanels, pilotPath, type PilotMoment } from "./pilot.ts";
import { KESSLER_BEAT_IDS, KESSLER_OPENING_ID, KESSLER_ROOM_ID } from "./kessler-room.ts";
import { KESSLER_FILMS, type RoomFilm } from "./room-film.ts";

export type OverviewPath = {
  id: string; scenes: PilotMoment[]; title: string; description: string;
  makers: string; image: PilotMoment; film?: RoomFilm; route: string;
};
const routes = [
  { id: "rooftops", anchor: KESSLER_BEAT_IDS.billboard, title: "The rooftops", description: "Cross the city above the blackout.", image: KESSLER_BEAT_IDS.dish },
  { id: "neighbors", anchor: KESSLER_BEAT_IDS["every-door"], title: "The neighbors", description: "Carry help up eighty-one floors.", image: KESSLER_BEAT_IDS["dawn-81"] },
  { id: "lift", anchor: KESSLER_FILMS.find(film => film.id === "lift")!.shots[2].sourceId, title: "The service lift", description: "One battery. A different way up.", image: KESSLER_FILMS.find(film => film.id === "lift")!.shots[2].sourceId },
];

/** Only complete published ancestry enters the overview. Titles never determine connections. */
export function overviewPaths(moments: PilotMoment[]): OverviewPath[] {
  const story = moments.filter(moment => moment.room_id === KESSLER_ROOM_ID);
  const parents = new Set(story.map(moment => moment.parent_id));
  return story.filter(moment => !parents.has(moment.id)).flatMap(tip => {
    let scenes: PilotMoment[];
    try { scenes = pilotPath(story, KESSLER_ROOM_ID, tip.id); } catch { return []; }
    if (scenes[0]?.id !== KESSLER_OPENING_ID) return [];
    const route = routes.find(item => scenes.some(scene => scene.id === item.anchor));
    const film = KESSLER_FILMS.find(item => scenes.some(scene => scene.id === item.tipId));
    const preparedTip = film?.tipId === tip.id;
    const contributors = scenes.filter(scene => scene.maker_id || scene.maker_label !== "Prepared story");
    return [{ id: tip.id, scenes, title: preparedTip && route ? route.title : tip.title,
      description: preparedTip && route ? route.description : pilotPanels(tip.panels)[0]?.caption ?? "Read this path from its shared beginning.",
      makers: [...new Set((contributors.length ? contributors : scenes).map(scene => scene.maker_label))].join(" + "),
      image: scenes.find(scene => scene.id === route?.image) ?? tip, film, route: route?.id ?? "other" }];
  }).sort((a, b) => b.scenes.at(-1)!.created_at.localeCompare(a.scenes.at(-1)!.created_at) || a.id.localeCompare(b.id));
}

export function featuredPaths(paths: OverviewPath[]) {
  const picks = routes.flatMap(route => {
    const candidates = paths.filter(path => path.route === route.id);
    const film = KESSLER_FILMS.find(item => item.id === route.id);
    const pick = candidates.find(path => path.id === film?.tipId) ?? candidates[0];
    return pick ? [pick] : [];
  });
  return [...picks, ...paths.filter(path => !picks.includes(path))].slice(0, 3);
}

export type OverviewNode = { id: string; moment: PilotMoment; parent: string | null; paths: OverviewPath[]; terminal: boolean; x: number; y: number; label: string; route: string };
export type OverviewMap = { nodes: OverviewNode[]; page: number; pageCount: number; branchCount: number; pageSize: number };

/** Collapse linear stretches, then expand actual forks within a small visible-path budget. */
export function overviewMap(paths: OverviewPath[], scope = KESSLER_OPENING_ID, requestedPage = 0): OverviewMap {
  const scoped = paths.filter(path => path.scenes.some(scene => scene.id === scope));
  const scenes = new Map(scoped.flatMap(path => path.scenes.map(scene => [scene.id, scene] as const)));
  const root = scenes.get(scope);
  const budget = scope === KESSLER_OPENING_ID ? 3 : 4;
  if (!root) return { nodes: [], page: 0, pageCount: 1, branchCount: 0, pageSize: budget };
  const rank = (id: string) => Math.min(...scoped.filter(path => path.scenes.some(scene => scene.id === id)).map(path => {
    const index = routes.findIndex(route => route.id === path.route);
    return index < 0 ? routes.length : index;
  }));
  const children = (id: string) => [...scenes.values()].filter(scene => scene.parent_id === id).sort((a, b) => rank(a.id) - rank(b.id) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  function nextFork(scene: PilotMoment): PilotMoment {
    let next = scene;
    while (children(next.id).length === 1) next = children(next.id)[0];
    return next;
  }
  const nodes: OverviewNode[] = [];
  const depths = new Map<string, number>();
  function add(moment: PilotMoment, parent: string | null) {
    const descendants = scoped.filter(path => path.scenes.some(scene => scene.id === moment.id));
    const route = routes.find(item => descendants.every(path => path.route === item.id));
    const node: OverviewNode = { id: moment.id, moment, parent, paths: descendants, terminal: true, x: 50, y: 5,
      label: moment.id === KESSLER_OPENING_ID ? "Lights out" : descendants.length === 1 ? descendants[0].title : route?.title ?? moment.title, route: route?.id ?? "other" };
    nodes.push(node);
    depths.set(node.id, parent ? depths.get(parent)! + 1 : 0);
    return node;
  }
  add(root, null);
  const branches = children(root.id).map(nextFork);
  const pageCount = Math.max(1, Math.ceil(branches.length / budget));
  const page = Math.max(0, Math.min(pageCount - 1, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 0));
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    // Keep deeper forks grouped above the two internal ranks; opening a group re-roots the map.
    if (depths.get(node.id)! >= 2) continue;
    const next = node.id === root.id ? branches.slice(page * budget, (page + 1) * budget) : children(node.id).map(nextFork);
    if (!next.length || nodes.filter(item => item.terminal).length - 1 + next.length > budget) continue;
    node.terminal = false;
    node.label = node.moment.id === KESSLER_OPENING_ID ? "Lights out" : node.moment.title;
    for (const child of next) add(child, node.id);
  }
  const leaves = nodes.filter(node => node.terminal);
  leaves.forEach((node, index) => { node.x = (index + .5) * 100 / leaves.length; });
  function position(id: string, depth: number): number {
    const node = nodes.find(item => item.id === id)!;
    const kids = nodes.filter(item => item.parent === id);
    if (kids.length) {
      const positions = kids.map(child => position(child.id, depth + 1));
      node.x = (positions[0] + positions.at(-1)!) / 2;
      node.y = 82 - depth * 26;
    }
    return node.x;
  }
  position(root.id, 0);
  return { nodes, page, pageCount, branchCount: branches.length, pageSize: budget };
}

export const followedPathsKey = `fork-night-followed-paths:${KESSLER_ROOM_ID}`;
export function parseFollowedPaths(raw: string | null): string[] {
  try { const value = JSON.parse(raw ?? "[]"); return Array.isArray(value) ? [...new Set<string>(value.filter(isUuid))].slice(0, 500) : []; }
  catch { return []; }
}
export function followsPath(followed: string[], path: OverviewPath) { return path.scenes.some(scene => followed.includes(scene.id)); }
export function toggleFollowedPath(followed: string[], path: OverviewPath, paths: OverviewPath[]) {
  if (!followsPath(followed, path)) return [...followed, path.id];
  const removed = followed.filter(id => path.scenes.some(scene => scene.id === id));
  const kept = followed.filter(id => !removed.includes(id));
  // Unfollowing one descendant preserves the other paths that grew from the same saved fork.
  return [...new Set([...kept, ...paths.filter(other => other.id !== path.id && followsPath(removed, other)).map(other => other.id)])];
}

export function kesslerEntryView(search: string, hash: string): "overview" | "read" | "map" {
  const params = new URLSearchParams(search);
  if (["moment", "film", "firstNight", "starter", "onboarding"].some(key => params.has(key)) || hash) return "read";
  return params.get("view") === "map" ? "map" : params.get("view") === "read" ? "read" : "overview";
}

export function sharedReadingTip(moments: PilotMoment[], roomId: string, selected: string, tip?: string) {
  if (tip) try { if (pilotPath(moments, roomId, tip).some(scene => scene.id === selected)) return tip; } catch { /* An incomplete link still opens its selected scene. */ }
  return selected;
}
