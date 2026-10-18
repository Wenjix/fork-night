import type { Metadata, Viewport } from "next";
import { NightWatchPageContent } from "@/components/night-watch/night-watch-page";
import "../pilot/pilot.css";
import "../pilot/rooms.css";
import "../pilot/releases.css";
import "../night-watch/night-watch.css";
import "../night-watch/agent-card.css";
import "../night-watch/copilot.css";
import "../night-watch/brain.css";
import "./privy-demo.css";

/** The page is night from edge to edge, so the browser chrome and the document's own scrollbars are too. */
export const viewport: Viewport = { themeColor: "#10152f", colorScheme: "dark" };

export const metadata: Metadata = {
  title: "Night Watch with Privy · Fork Night",
  description: "A guided local testnet demo of creator-owned embedded wallets, limited agent signing, x402 test-credit purchases and revocation.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function NightWatchPrivyPage() {
  return <NightWatchPageContent privyDemo />;
}
