import type { Metadata } from "next";
import { NightWatchPageContent } from "@/components/night-watch/night-watch-page";
import "../pilot/pilot.css";
import "../pilot/rooms.css";
import "../pilot/releases.css";
import "./night-watch.css";
import "./agent-card.css";
import "./copilot.css";
import "./brain.css";

export const metadata: Metadata = {
  title: "Night Watch · Fork Night",
  description: "Leave a brief before bed; a capped Night Watch prepares private candidates on testnet, and you choose what to publish in the morning.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function NightWatchPage() {
  return <NightWatchPageContent />;
}
