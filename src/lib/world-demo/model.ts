export const TERMS_VERSION = "concept-2026-10-04";
export const ASSETS = {
  hero: { src: "/world-demo/hero-4db281ac3107715bcf6837b49e7bfe5d10605f96ea7c5fc4c845c446dba1577e.webp", alt: "Nika works at an amber-lit repair stall in the rainy city." },
  "source-writing": { src: "/world-demo/source-writing-ff200a90ef07ad57eb703217fbbb41d27e3700745488b9a53ac80b271b1a2292.webp", alt: "Nika writes a customer's name in a paper repair ledger." },
  "source-ledger": { src: "/world-demo/source-ledger-9ddfab2e7a76cfb0c7cf9f8659a5ccba6d68042db7502b0fece1d35becabfbe5.webp", alt: "Nika holds open the handwritten ledger at the repair stall." },
  outcome: { src: "/world-demo/outcome-793decfde65591fd484505487052ac235ab1fd3819f30802ec48890ef0a9e6f0.webp", alt: "With the terminal offline, Nika uses the ledger to help a customer reconnect." },
} as const;
export type Asset = keyof typeof ASSETS;
export type Seat = "curator" | "maker" | "continuing";
export type Panel = { asset: Asset; caption: string; artifact?: { path: string; sha256: string } };
export type Member = { id: string; role: Seat; label: string };
export type Work = {
  id: string; parent_id: string | null; maker_id: string | null; maker_label: string;
  role: Seat | "opening"; title: string; panels: Panel[]; source_kind: string; created_at: string;
};
export type Draft = { member_id: string; parent_id: string; title: string; panels: Panel[]; updated_at: string };
export type Selection = { id: string; source_id: string; curator_id: string; reason: string; selected_at: string; withdrawn_at: string | null };
export type Release = {
  id: string; source_id: string; tip_id: string; digest: string; created_at: string;
  snapshot: {
    title: string; termsVersion: string; works: Work[]; sourceId: string; tipId: string;
    curator: { id: string; label: string; imaginedRole: string }; selectionReason: string; publishedAt: string;
  };
};
export type WorldState = {
  id: string; revision: number; termsVersion: string; me: Member; members: Member[];
  works: Work[]; draft: Draft | null; selections: Selection[]; releases: Release[];
  invitations: { role: Exclude<Seat, "curator">; token: string | null; claimed: boolean }[];
};
export type Command =
  | { kind: "save_draft"; payload: { title: string; panels: Panel[] } }
  | { kind: "publish_work" | "withdraw"; payload: Record<string, never> }
  | { kind: "select"; payload: { sourceId: string; reason: string } }
  | { kind: "publish_release"; payload: { tipId: string } };
export type PendingCommand = Command & { requestId: string; runId: string; revision: number };
export type CommandResult = { state: WorldState; replayed: boolean; resultId: string };

export const isUuid = (value: string | null | undefined): value is string =>
  !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export function seatFrom(value: string | null): Seat {
  return value === "maker" || value === "continuing" ? value : "curator";
}
export function worldLink(runId: string, seat: Seat, view = "story", workId?: string) {
  const params = new URLSearchParams({ run: runId, seat, view });
  if (workId) params.set("work", workId);
  return `/world-demo?${params}`;
}
export function invitationLink(runId: string, seat: Seat, token: string) {
  return `${worldLink(runId, seat)}&invite=${encodeURIComponent(token)}`;
}
export function draftTemplate(role: Seat): Pick<Draft, "title" | "panels"> {
  return role === "continuing" ? {
    title: "A name to call",
    panels: [{ asset: "outcome", caption: "The network goes dark. Nika turns back through the paper ledger—and finds the one name her customer thought was lost." }],
  } : {
    title: "Names We Keep",
    panels: [
      { asset: "source-writing", caption: "One broken radio. One name in the ledger. Nika writes down the people the city would otherwise forget." },
      { asset: "source-ledger", caption: "She keeps the old book beside her tools. Objects come back to life here. So do connections." },
    ],
  };
}

/** Recognition comes from published relationships, never optimistic UI state. */
export function recognition(state: WorldState, workId: string) {
  const continuations = state.works.filter(work => work.parent_id === workId);
  const selection = state.selections.find(item => item.source_id === workId && !item.withdrawn_at);
  const release = state.releases.find(item => item.snapshot.works.some(work => work.id === workId));
  return { continuations, selection, release };
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const panelsValid = (v: unknown): v is Panel[] => Array.isArray(v) && v.length >= 1 && v.length <= 3 &&
  v.every(p => record(p) && typeof p.asset === "string" && Object.hasOwn(ASSETS, p.asset) && typeof p.caption === "string");
const memberValid = (v: unknown): v is Member => record(v) && typeof v.id === "string" && isUuid(v.id) &&
  ["curator", "maker", "continuing"].includes(String(v.role)) && typeof v.label === "string";
const workValid = (v: unknown): v is Work => record(v) && typeof v.id === "string" && isUuid(v.id) &&
  typeof v.title === "string" && typeof v.maker_label === "string" && panelsValid(v.panels) &&
  (v.parent_id === null || typeof v.parent_id === "string" && isUuid(v.parent_id));
export function parseState(value: unknown): WorldState {
  if (!record(value) || typeof value.id !== "string" || !isUuid(value.id) || !Number.isInteger(value.revision) ||
    !memberValid(value.me) || !Array.isArray(value.members) || !value.members.every(memberValid) ||
    !Array.isArray(value.works) || !value.works.every(workValid) || !Array.isArray(value.selections) ||
    !value.selections.every(s => record(s) && typeof s.reason === "string" && typeof s.source_id === "string") ||
    !Array.isArray(value.releases) || !value.releases.every(r => record(r) && typeof r.id === "string" && typeof r.digest === "string" &&
      record(r.snapshot) && Array.isArray(r.snapshot.works) && r.snapshot.works.every(workValid) && record(r.snapshot.curator)) ||
    !Array.isArray(value.invitations) || !value.invitations.every(i => record(i) && ["maker", "continuing"].includes(String(i.role)) &&
      (i.token === null || typeof i.token === "string") && typeof i.claimed === "boolean") ||
    (value.draft !== null && !(record(value.draft) && typeof value.draft.title === "string" && panelsValid(value.draft.panels)))) {
    throw new Error("The rehearsal could not be read. Refresh to request a complete copy.");
  }
  return value as WorldState;
}

/** Browser storage is untrusted; only restore the known command envelope. */
export function parsePending(raw: string, runId: string): PendingCommand {
  const v: unknown = JSON.parse(raw);
  if (!record(v) || v.runId !== runId || typeof v.requestId !== "string" || !isUuid(v.requestId) ||
    !Number.isInteger(v.revision) || !["save_draft", "publish_work", "select", "withdraw", "publish_release"].includes(String(v.kind)) || !record(v.payload)) {
    throw new Error("An unfinished action could not be restored. Refresh the rehearsal before making another change.");
  }
  return v as PendingCommand;
}

export function releaseText(release: Release): string {
  const s = release.snapshot;
  return [s.title, "Unofficial future concept · fictional participation", "",
    ...s.works.flatMap(work => [work.title, `By ${work.maker_label}`, ...work.panels.map(p => p.caption), ""]),
    `Curated by ${s.curator.label}`, s.curator.imaginedRole,
    `Published: ${s.publishedAt}`, `Record: ${release.id}`, `SHA-256 of stored snapshot: ${release.digest}`,
  ].join("\n");
}

export function panelImage(panel: Panel) {
  const art = panel.artifact;
  if (art && /^[a-f0-9]{64}$/.test(art.sha256) && art.path === `/world-demo/${panel.asset}-${art.sha256}.webp`) {
    return { src: art.path, alt: ASSETS[panel.asset].alt };
  }
  return ASSETS[panel.asset];
}
