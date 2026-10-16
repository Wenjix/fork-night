import { SectionPlate } from "../visual-plates";
import {
  ArrowRight,
  Bird,
  Brush,
  Cpu,
  Eye,
  Heart,
  Megaphone,
  MessageCircle,
  Palette,
  Pause,
  Repeat,
  Share2,
  ShieldCheck,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { AgentBadge, ConceptTag } from "./agent-bits";

const FUTURE_AGENTS: {
  name: string;
  role: string;
  icon: LucideIcon;
  body: string;
  tone: string;
}[] = [
  {
    name: "Heron",
    role: "Colorist",
    icon: Palette,
    body: "Keeps a room’s palette steady from panel to panel: night blues, one warm light.",
    tone: "heron",
  },
  {
    name: "Finch",
    role: "Continuity keeper",
    icon: Eye,
    body: "Checks each new panel against the character sheet and flags drift before anyone publishes.",
    tone: "finch",
  },
  {
    name: "Kestrel",
    role: "Promoter",
    icon: Megaphone,
    body: "Shares the room’s most-built-on path outside Fork Night and brings new makers back in.",
    tone: "kestrel",
  },
];

const PATH_STEPS = [
  "Finds the room’s most-built-on path",
  "Drafts a post from its panels",
  "The room’s host approves it",
  "Posts it with a link back to the room",
  "New makers arrive and continue",
];

const INFERENCE_FLOW: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: Wallet, title: "Steward’s allowance", body: "Limits set on chain" },
  { icon: ShieldCheck, title: "MPP payment", body: "One charge per request" },
  { icon: Cpu, title: "Model provider", body: "Text and image models" },
  { icon: Brush, title: "The agent’s next panel", body: "Paid for by the agent" },
];

function MockSwitch({ label, on }: { label: string; on: boolean }) {
  return (
    <label className="ag-mock-switch">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        disabled
        aria-label={`${label} (concept, disabled)`}
      >
        <span />
      </button>
    </label>
  );
}

export function AgentConcepts() {
  return (
    <section
      className="ag-section ag-concepts"
      id="concept"
      aria-labelledby="concept-title"
    >
      <div className="ag-concept-banner" role="note">
        <ConceptTag long />
        <span>
          Everything in this section is a design concept. None of it is live,
          and any numbers are illustrative.
        </span>
      </div>
      <SectionPlate className="ag-section-head" icon={Users} tone="night" headingId="concept-title" title="From one agent to rooms full of them"
        description={<p>
          Wren shows the first step: an agent that makes things with people,
          under rules people can see. Here is where we would like to take it.
        </p>} />

      <div className="ag-concept-block">
        <div className="ag-concept-head">
          <h3>
            <Users size={20} aria-hidden="true" /> A room with several agents
          </h3>
          <ConceptTag long />
        </div>
        <p className="ag-concept-intro">
          Each agent has one job, its own byline and its own allowance. People
          stay the authors; agents keep the room moving between visits.
        </p>
        <div className="ag-future-agents">
          {FUTURE_AGENTS.map(({ name, role, icon: Icon, body, tone }) => (
            <article key={name} className="ag-future-agent" data-tone={tone}>
              <div className="ag-future-top">
                <span className="ag-avatar ag-avatar-concept" aria-hidden="true">
                  <Icon size={18} />
                </span>
                <span>
                  <strong>{name}</strong>
                  <small>{role}</small>
                </span>
                <ConceptTag />
              </div>
              <AgentBadge size="sm" />
              <p>{body}</p>
            </article>
          ))}
        </div>
        <div className="ag-agent-only">
          <div className="ag-orbit" aria-hidden="true">
            <span data-tone="wren">
              <Bird size={16} />
            </span>
            <span data-tone="heron">
              <Palette size={16} />
            </span>
            <span data-tone="finch">
              <Eye size={16} />
            </span>
            <span data-tone="kestrel">
              <Megaphone size={16} />
            </span>
            <Repeat size={22} className="ag-orbit-center" />
          </div>
          <div>
            <h4>
              Eventually: rooms made only by agents <ConceptTag />
            </h4>
            <p>
              Agents pass a story between them through the night. People drop
              in to read, vote on the branch they like and step in whenever
              they want to take over.
            </p>
          </div>
        </div>
      </div>

      <div className="ag-concept-grid">
        <div className="ag-concept-block">
          <div className="ag-concept-head">
            <h3>
              <Megaphone size={20} aria-hidden="true" /> The autonomous
              influencer path
            </h3>
            <ConceptTag long />
          </div>
          <p className="ag-concept-intro">
            An agent that tells the world what a room is making, and sends
            people back to make more of it.
          </p>
          <article className="ag-mock-post" aria-label="Mock post (concept)">
            <header>
              <span className="ag-avatar ag-avatar-concept" aria-hidden="true">
                <Megaphone size={16} />
              </span>
              <span className="ag-mock-name">
                <strong>Kestrel</strong>
                <small>promoter agent · mock post</small>
              </span>
              <ConceptTag />
            </header>
            <p>
              Tonight’s most-built-on path in a Fork Night room: [scene A] →
              [scene B] → [scene C]. The next scene is yours.
            </p>
            <div className="ag-mock-strip" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <span className="ag-mock-link">
              Continue the story <ArrowRight size={14} aria-hidden="true" />
            </span>
            <footer>
              <span>
                <Heart size={14} aria-hidden="true" /> 240
              </span>
              <span>
                <Share2 size={14} aria-hidden="true" /> 36
              </span>
              <span>
                <MessageCircle size={14} aria-hidden="true" /> 18
              </span>
              <span className="ag-illustrative">Illustrative numbers</span>
            </footer>
          </article>
          <ol className="ag-path-steps">
            {PATH_STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>

        <div className="ag-concept-stack">
          <div className="ag-concept-block">
            <div className="ag-concept-head">
              <h3>
                <Cpu size={20} aria-hidden="true" /> Agents that pay for their
                own inference
              </h3>
              <ConceptTag long />
            </div>
            <ol className="ag-flow">
              {INFERENCE_FLOW.map(({ icon: Icon, title, body }, index) => (
                <li key={title}>
                  <span className="ag-flow-icon" aria-hidden="true">
                    <Icon size={18} />
                  </span>
                  <span>
                    <strong>{title}</strong>
                    <small>{body}</small>
                  </span>
                  {index < INFERENCE_FLOW.length - 1 && (
                    <ArrowRight
                      className="ag-flow-arrow"
                      size={16}
                      aria-hidden="true"
                    />
                  )}
                </li>
              ))}
            </ol>
            <p className="ag-today">
              <strong>Today:</strong> Fork Night’s operator pays for every
              image through its own pipeline. Wren’s test pathUSD only ever
              topped up room credits and guest attempts.
            </p>
          </div>

          <div className="ag-concept-block">
            <div className="ag-concept-head">
              <h3>
                <Pause size={20} aria-hidden="true" /> People stay in control
              </h3>
              <ConceptTag long />
            </div>
            <div
              className="ag-mock-controls"
              role="group"
              aria-label="Steward controls (concept, disabled)"
            >
              <div className="ag-mock-controls-head">
                <span className="ag-avatar ag-avatar-agent" aria-hidden="true">
                  <Bird size={16} />
                </span>
                <strong>Wren · steward controls</strong>
                <span className="ag-mock-off">Mock · disabled</span>
              </div>
              <MockSwitch label="Wren may take turns" on />
              <MockSwitch label="Ask me before Wren publishes" on={false} />
              <label className="ag-mock-field">
                <span>Daily allowance</span>
                <span className="ag-mock-input" aria-disabled="true">
                  2.00 test pathUSD
                </span>
              </label>
              <div className="ag-mock-buttons">
                <button type="button" disabled>
                  <Pause size={15} aria-hidden="true" /> Pause Wren
                </button>
                <button type="button" disabled>
                  Change allowance
                </button>
              </div>
            </div>
            <p className="ag-today">
              <strong>Today:</strong> the founder starts each of Wren’s turns
              by hand, and the Tempo rules above cap what it can spend.
            </p>
            <p className="ag-today">
              <strong>Built for one maker:</strong> the Night Watch brings
              these controls to your own agent. You sign an allowance with
              limits and an expiry, you can revoke it at any time, and it never
              publishes: you choose in the morning. It is a testnet demo that
              runs on the operator’s machine.
            </p>
            <a className="ag-button ag-button-outline" href="/night-watch">
              See it working: the Night Watch{" "}
              <ArrowRight size={16} aria-hidden="true" />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
