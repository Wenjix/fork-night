import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Metadata } from "next";
import { HunyuanArticle } from "@/components/hunyuan/hunyuan-article";
import { DEMO_VIDEO } from "@/components/hunyuan/copy";
import "./hunyuan.css";

export const metadata: Metadata = {
  title: "How Hunyuan keeps a forked story one film · Fork Night",
  description:
    "How Fork Night used Tencent Hunyuan image models on GMI Cloud to keep story branches visually consistent, turn scenes into film, and restyle a whole branch.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function HunyuanPage() {
  // Drop the recorded walkthrough at public/hunyuan/ and redeploy; until then a labelled placeholder shows.
  const hasVideo = existsSync(join(process.cwd(), "public", DEMO_VIDEO));
  return <HunyuanArticle hasVideo={hasVideo} />;
}
