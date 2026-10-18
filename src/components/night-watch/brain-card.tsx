import { BrainCircuit, Check, Flag, Sparkles } from "lucide-react";
import type { BrainView } from "../../night-watch/api-types.ts";
import { BrandStrip } from "../brand-badge";
import { candidateLetter } from "./api.ts";
import { CardHeading } from "./card-heading";
import { ModelBadge, RouterBadge } from "./night-watch-badges";

/**
 * The Night Watch's brain as the maker meets it in the morning: what it read in the room, its note,
 * and the take it would look at first. The brain plans and checks before anything is drawn; it never
 * publishes. Nothing renders for a job without a brain, so older nights look exactly as before.
 */

export type BrainCandidate = BrainView["candidates"][number];

/** The brain's entry for one candidate, if the brain planned this job. */
export function brainCandidate(brain: BrainView | null | undefined, number: number): BrainCandidate | null {
  return brain?.candidates.find((candidate) => candidate.number === number) ?? null;
}

/** The candidate the brain suggests looking at first, only when it planned the night. */
export const brainPick = (brain: BrainView | null | undefined) => (brain?.state === "planned" ? brain.pick : null);

/** Operator-paid text inference: a tiny sum reads as "under $0.01", never as free. */
export function brainExpense(usd: string | null | undefined): string {
  const amount = Number(usd);
  if (!Number.isFinite(amount) || amount <= 0) return "≈$0.00";
  return amount < 0.01 ? "under $0.01" : `≈$${amount.toFixed(2)}`;
}

const took = (ms: number | null) => {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return "";
  return ` in ${ms < 10_000 ? (ms / 1000).toFixed(1) : Math.round(ms / 1000)} s`;
};

/** One model planned and checked (the default since Oct 13). */
const selfChecked = (brain: BrainView) => !!brain.planner && !!brain.critic && brain.critic.label === brain.planner.label;

/** "Planned and checked by Kimi K3 in 4.2 s + 9.6 s · via TokenRouter · operator-paid inference under $0.01" */
export function brainByline(brain: BrainView): string {
  const verb = brain.state === "planned" ? "Planned" : "Asked";
  const models = selfChecked(brain)
    ? [`${verb} and checked by ${brain.planner!.label}${took(brain.planner!.latencyMs)}${took(brain.critic!.latencyMs).replace(" in ", " + ")}`]
    : [
        brain.planner ? `${verb} by ${brain.planner.label}${took(brain.planner.latencyMs)}` : "",
        brain.critic ? `checked by ${brain.critic.label}${took(brain.critic.latencyMs)}` : "",
      ];
  return [
    ...models,
    brain.planner || brain.critic ? "via TokenRouter" : "",
    `operator-paid inference ${brainExpense(brain.expenseUsd)}`,
  ].filter(Boolean).join(" · ");
}

/** Lines for the morning edition's front page about the published take. */
export function brainFrontFacts(brain: BrainView | null | undefined, published: number | null): string[] {
  if (!brain) return [];
  if (brain.state === "plain") return ["Drawn from the plain prompts: the brain did not plan this night"];
  // A take the brain's plan did not shape is never credited to the brain.
  if (published && brainCandidate(brain, published)?.plain) return ["Drawn from the plain prompt: the brain's plan was not used for this take"];
  const models = selfChecked(brain)
    ? `planned and checked overnight by ${brain.planner!.label}`
    : [brain.planner ? `planned overnight by ${brain.planner.label}` : "", brain.critic ? `checked by ${brain.critic.label}` : ""].filter(Boolean).join(", ");
  const facts = [models ? `${models[0].toUpperCase()}${models.slice(1)}` : "Planned overnight by the Night Watch's brain"];
  const pick = brainPick(brain);
  if (pick && published) {
    facts.push(pick === published
      ? "You chose the take your Night Watch suggested first"
      : `Your Night Watch suggested candidate ${candidateLetter(pick)}; you chose ${candidateLetter(published)}`);
  }
  return facts;
}

/** An extra recap-card line; it goes last, so the canvas draws it only when it fits. */
export function brainRecapLine(brain: BrainView | null | undefined): string | null {
  if (!brain || brain.state !== "planned") return null;
  const models = selfChecked(brain)
    ? [`planned and checked by ${brain.planner!.label}`]
    : [brain.planner ? `planned by ${brain.planner.label}` : "", brain.critic ? `checked by ${brain.critic.label}` : ""].filter(Boolean);
  return models.length ? `Night Watch brain: ${models.join(", ")} (via TokenRouter)` : null;
}

/** Who thought it: the model (or models) that planned and checked, and the router they were asked through. */
function BrainCredit({ brain }: { brain: BrainView }) {
  const models = [...new Set([brain.planner?.label, brain.critic?.label].filter((label): label is string => !!label))];
  if (!models.length) return null;
  return <BrandStrip label="Models and provider" className="nw-brain-credit">
    {models.map((label) => <ModelBadge key={label} label={label} />)}
    <RouterBadge />
  </BrandStrip>;
}

/** "What your Night Watch thought": the card in Act 3. */
export function BrainCard({ brain, titleId }: { brain: BrainView | null | undefined; titleId: string }) {
  if (!brain) return null;
  if (brain.state === "plain") {
    const spent = Number(brain.expenseUsd) > 0 || !!brain.planner;
    return <section className="nw-card nw-brain-card" data-state="plain" aria-labelledby={titleId}>
      <CardHeading id={titleId} title="What your Night Watch thought" kind="Room co-pilot" icon={BrainCircuit} />
      <p className="nw-brain-plain">{brain.message}</p>
      {spent && <>
        <BrainCredit brain={brain} />
        <p className="nw-brain-byline">{brainByline(brain)}</p>
      </>}
    </section>;
  }
  const pick = brainPick(brain);
  return <section className="nw-card nw-brain-card" data-state="planned" aria-labelledby={titleId}>
    <CardHeading id={titleId} title="What your Night Watch thought" kind="Room co-pilot" icon={BrainCircuit} lead={<span className="nw-brain-pulse" aria-hidden="true" />} />
    {brain.readOfTheRoom && <p className="nw-brain-read"><strong>Read the room:</strong> {brain.readOfTheRoom}</p>}
    {brain.morningNote && <blockquote className="nw-brain-note">
      <p>“{brain.morningNote}”</p>
      <footer>Your Night Watch{brain.critic && !selfChecked(brain) ? `, after ${brain.critic.label}’s check` : ""}</footer>
    </blockquote>}
    {pick && <p className="nw-brain-pick"><Sparkles size={16} aria-hidden="true" />It suggests starting with candidate {candidateLetter(pick)}.</p>}
    <BrainCredit brain={brain} />
    <p className="nw-brain-byline">{brainByline(brain)}</p>
    <p className="nw-brain-fine">It plans and checks before anything is drawn. It cannot publish: you choose.</p>
  </section>;
}

/** The badge on the take the brain suggests looking at first. */
export function PickChip() {
  return <span className="nw-pick-chip"><Sparkles size={16} aria-hidden="true" />Night Watch suggests starting here</span>;
}

/** Under a candidate's caption: why the brain planned this take, and the second brain's check. */
export function CandidateThought({ thought }: { thought: BrainCandidate | null }) {
  if (!thought) return null;
  const ok = thought.check?.ok;
  return <span className="nw-thought" data-plain={thought.plain || undefined}>
    {thought.plain
      ? <span className="nw-thought-plain">Plain prompt</span>
      : thought.why && <span className="nw-thought-why">{thought.why}</span>}
    {thought.check && <span className="nw-thought-check" data-ok={ok ? "true" : "false"}>
      {ok ? <Check size={16} aria-hidden="true" /> : <Flag size={16} aria-hidden="true" />}
      <span><span className="nw-visually-hidden">{ok ? "Checked: " : "Flagged: "}</span>{thought.check.note}</span>
    </span>}
  </span>;
}
