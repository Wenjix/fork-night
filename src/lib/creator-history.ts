import type { CandidateId, CreatorAgent, CreatorReviewState } from "./creator-review.ts";

export type CreativeEvent = {
  id: string; kind: "bible" | "scene" | "candidate" | "feedback" | "brief";
  title: string; description: string; actor: "agent" | "human"; prepared: boolean;
  status: string; parentIds: string[]; imageUrl?: string; createdAt?: string;
  candidateId?: CandidateId; bibleVersion?: number;
};

/** Both views read the same artifact history; a saved revision never rewrites an earlier cycle. */
export function creatorHistory(agent: CreatorAgent, state: CreatorReviewState): CreativeEvent[] {
  const events: CreativeEvent[] = [
    { id: "bible-1", kind: "bible", title: "Creator bible v1", description: state.versions[0].text, actor: "human", prepared: true, status: "Instructions used", parentIds: [], bibleVersion: 1 },
    { id: "scene", kind: "scene", title: agent.scene.title, description: `${agent.brief}\n\n${agent.scene.caption}`, actor: "agent", prepared: true, status: "Shared opening", parentIds: ["bible-1"], imageUrl: agent.scene.imageUrl, bibleVersion: 1 },
    ...agent.candidates.map(candidate => ({ id: `candidate-${candidate.id}`, kind: "candidate" as const, title: candidate.title, description: candidate.caption, actor: "agent" as const, prepared: true, status: candidate.status === "selected" ? "Selected" : "Discarded", parentIds: ["scene"], imageUrl: candidate.imageUrl, candidateId: candidate.id, bibleVersion: 1 })),
    ...state.feedback.map(note => ({ id: `feedback-${note.id}`, kind: "feedback" as const, title: "Human feedback", description: note.text, actor: "human" as const, prepared: false, status: "Saved by you", parentIds: [`candidate-${note.candidateId}`], createdAt: note.createdAt, candidateId: note.candidateId })),
    ...state.versions.slice(1).map(version => ({ id: `bible-${version.number}`, kind: "bible" as const, title: `Creator bible v${version.number}`, description: version.text, actor: "human" as const, prepared: false, status: "Saved by you", parentIds: [`bible-${version.number - 1}`, ...version.feedbackIds.map(id => `feedback-${id}`)], createdAt: version.createdAt, bibleVersion: version.number })),
    ...state.briefs.map(brief => ({ id: `brief-${brief.id}`, kind: "brief" as const, title: "Next story brief", description: brief.text, actor: "human" as const, prepared: false, status: `Ready · bible v${brief.bibleVersion}`, parentIds: [`bible-${brief.bibleVersion}`, ...brief.feedbackIds.map(id => `feedback-${id}`)], createdAt: brief.createdAt, bibleVersion: brief.bibleVersion })),
  ];
  return [...events.filter(event => event.prepared), ...events.filter(event => !event.prepared).sort((a, b) => Date.parse(a.createdAt!) - Date.parse(b.createdAt!))];
}

export function creativeAncestry(events: CreativeEvent[], selectedId: string): Set<string> {
  const result = new Set<string>();
  function visit(id: string) { if (result.has(id)) return; const event = events.find(item => item.id === id); if (!event) return; result.add(id); event.parentIds.forEach(visit); }
  visit(selectedId);
  return result;
}

export function layoutCreatorHistory(events: CreativeEvent[], { nodeWidth = 200, columnGap = 30, minimumWidth = 600 } = {}) {
  const ranks = new Map<string, number>();
  function rank(event: CreativeEvent): number {
    const cached = ranks.get(event.id); if (cached !== undefined) return cached;
    const value = event.parentIds.length ? Math.max(...event.parentIds.map(id => rank(events.find(item => item.id === id)!))) + 1 : 0;
    ranks.set(event.id, value); return value;
  }
  events.forEach(rank);
  const maxRank = Math.max(...ranks.values());
  const rows = Array.from({ length: maxRank + 1 }, (_, depth) => events.filter(event => ranks.get(event.id) === depth));
  const width = Math.max(minimumWidth, Math.max(...rows.map(row => row.length * nodeWidth + (row.length - 1) * columnGap + 24)));
  const height = (maxRank + 1) * 220 + 30;
  const nodes = rows.flatMap((row, depth) => row.map((event, index) => ({ event, x: width / 2 + (index - (row.length - 1) / 2) * (nodeWidth + columnGap), y: (maxRank - depth) * 220 + 20 })));
  return { nodes, width, height };
}
