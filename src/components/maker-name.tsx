import { Sparkles } from "lucide-react";
import { Chip } from "./brand-badge";

const AGENT_SUFFIX = / \(AI agent\)$/;

/**
 * A maker's name, followed by the AI agent mark when the maker is an agent.
 * Agents are stored as "Wren (AI agent)"; the chip carries those words in place of the parenthesis,
 * so a card, a byline and a credit row all mark an agent the same way.
 */
export function MakerName({ name, agent = false }: { name: string; agent?: boolean }) {
  return (
    <>
      {name.replace(AGENT_SUFFIX, "")}
      {agent && <Chip icon={Sparkles} className="agent-mark">AI agent</Chip>}
    </>
  );
}
