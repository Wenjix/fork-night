import type { Metadata } from "next";
import { TempoDemo } from "@/components/tempo/tempo-demo";
import "../pilot/pilot.css";
import "../pilot/rooms.css";
import "../pilot/releases.css";
import "../night-watch/night-watch.css";
import "../night-watch-privy/privy-demo.css";
import "../wren-studio/wren-studio.css";
import "./tempo-demo.css";

export const metadata: Metadata = {
  title: "Wren with Tempo · Fork Night",
  description: "How an AI agent in a Fork Night room pays for room credits through MPP with a Tempo access key whose limits Tempo enforces. Recorded testnet evidence.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function TempoPage() {
  return <TempoDemo />;
}
