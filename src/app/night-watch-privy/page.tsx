import type { Metadata } from "next";
import { NightWatchPageContent } from "@/components/night-watch/night-watch-page";
import "../pilot/pilot.css";
import "../pilot/rooms.css";
import "../pilot/releases.css";
import "../night-watch/night-watch.css";
import "../night-watch/agent-card.css";
import "../night-watch/copilot.css";
import "../night-watch/brain.css";
import "./privy-demo.css";

export const metadata: Metadata = {
  title: "Night Watch with Privy · Fork Night",
  description: "A guided local testnet demo of creator-owned embedded wallets, limited agent signing, x402 test-credit purchases and revocation.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function NightWatchPrivyPage() {
  return <NightWatchPageContent privyDemo />;
}
