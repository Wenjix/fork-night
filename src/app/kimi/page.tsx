import type { Metadata } from "next";
import { KimiArticle } from "@/components/kimi/kimi-article";
import "./kimi.css";

export const metadata: Metadata = {
  title: "Kimi K3 is the Night Watch’s brain · Fork Night",
  description:
    "How Kimi K3 (by Moonshot AI) via TokenRouter plans, checks and suggests for Fork Night's Night Watch and Wren, measured on a live testnet run. In English and Simplified Chinese.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/** A static article: no data fetching, no environment, safe on the hosted site. */
export default function KimiPage() {
  return <KimiArticle />;
}
