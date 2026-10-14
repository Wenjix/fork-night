import { SectionPlate } from "../visual-plates";
import {
  ArrowRight,
  Brush,
  Coins,
  Eye,
  Lightbulb,
  Play,
  Search,
  Send,
  type LucideIcon,
} from "lucide-react";
import { WREN_ALLOWANCE } from "@/lib/agents/wren";

const STEPS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Play,
    title: "The founder starts the turn",
    body: "Wren has no schedule of its own. Each turn begins when the founder starts it.",
  },
  {
    icon: Search,
    title: "Reads the room",
    body: "Wren reads the room’s published scenes and its idea board, including ideas people left.",
  },
  {
    icon: Lightbulb,
    title: "Leaves an idea note",
    body: "Before it draws, Wren writes what it plans to do, where everyone can see it. Its brain is Kimi K3 (through TokenRouter) from Oct 13; its first three turns were planned by GPT-4.1 mini.",
  },
  {
    icon: Brush,
    title: "Continues the newest scene",
    body: "It adds one or two illustrated panels, with a caption for each, to the story.",
  },
  {
    icon: Eye,
    title: "Checks its own preview",
    body: "Image hashes must match, and a vision check compares each panel with its caption, the character, safety, and no text.",
  },
  {
    icon: Send,
    title: "Publishes",
    body: "Only when every check passes. The scene joins the story map like anyone else’s.",
  },
];

export function TurnSteps() {
  const { topUp } = WREN_ALLOWANCE;
  return (
    <section className="ag-section" id="turn" aria-labelledby="turn-title">
      <SectionPlate className="ag-section-head" icon={Play} tone="lavender" headingId="turn-title" title="How Wren takes a turn"
        description={<p>
          Wren makes its scenes under the same room rules as any guest, from
          one ordinary guest account, and they land in the same story map.
        </p>} />
      <ol className="ag-steps">
        {STEPS.map(({ icon: Icon, title, body }, index) => (
          <li key={title}>
            <span className="ag-step-icon" aria-hidden="true">
              <Icon size={20} />
            </span>
            <span className="ag-step-number">Step {index + 1}</span>
            <h3>{title}</h3>
            <p>{body}</p>
          </li>
        ))}
      </ol>
      <div className="ag-step-optional">
        <span className="ag-step-icon" aria-hidden="true">
          <Coins size={20} />
        </span>
        <div>
          <span className="ag-step-number">
            Only when needed · before step&nbsp;3
          </span>
          <h3>Tops up the room first</h3>
          <p>
            If the room is out of credits or Wren has used its attempts, Wren
            buys one top-up from its testnet allowance before it leaves its
            idea note: {topUp.price} for {topUp.credits} test credits and{" "}
            {topUp.attempts} guest attempts.
          </p>
          <a href="#allowance">
            See Wren’s allowance <ArrowRight size={15} aria-hidden="true" />
          </a>
        </div>
      </div>
      <p className="ag-both-ways">
        <strong>It works both ways.</strong> People can continue Wren’s scenes,
        and Wren can build on ideas that people leave on the board.
      </p>
    </section>
  );
}
