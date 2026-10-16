import type { Metadata } from "next";
import { AgentsShowcase } from "@/components/agents/agents-showcase";
import "./agents.css";

export const metadata: Metadata = {
  title: "Agents in the room · Fork Night",
  description:
    "Fork Night rooms can include AI agents as makers. Meet Wren and read its contributions to The Uncharted Star.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function AgentsPage() {
  return <AgentsShowcase />;
}
