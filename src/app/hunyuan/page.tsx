import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Metadata } from "next";
import { HunyuanArticle } from "@/components/hunyuan/hunyuan-article";
import { COPY, DEMO_VIDEO, langFrom } from "@/components/hunyuan/copy";
import { ArticleLinks } from "@/components/kimi/article-links";
import "./hunyuan.css";

type Props = { searchParams: Promise<{ lang?: string | string[] }> };

const metadata: Metadata = {
  title: "How Hunyuan keeps a forked story one film · Fork Night",
  description:
    "How Fork Night used Tencent Hunyuan image models on GMI Cloud to keep story branches visually consistent, turn scenes into film, and restyle a whole branch.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const lang = langFrom((await searchParams).lang);
  return { ...metadata, title: COPY[lang].pageTitle };
}

// Reading ?lang makes the page render per request, so a zh link arrives in Chinese instead of switching after load.
export default async function HunyuanPage({ searchParams }: Props) {
  // Drop the recorded walkthrough at public/hunyuan/ and redeploy; until then a labelled placeholder shows.
  const hasVideo = existsSync(join(process.cwd(), "public", DEMO_VIDEO));
  return <HunyuanArticle hasVideo={hasVideo} initialLang={langFrom((await searchParams).lang)} closing={<ArticleLinks current="hunyuan" className="hy-more" />} />;
}
