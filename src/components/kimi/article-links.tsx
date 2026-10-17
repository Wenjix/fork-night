import { BRANDS, type BrandId } from "@/lib/brands";
import { BrandBadge, BrandStrip } from "../brand-badge";

/**
 * The quiet strip at the end of each sponsor article that points to the other tool pages. It is shared by /kimi and
 * /hunyuan and lives in this one file because the Kimi tests scan the Kimi source files for other model names:
 * the names of the pages it links to stay here, not in the article files.
 */
const PAGES = [
  { brand: "kimi", href: "/kimi" },
  { brand: "hunyuan", href: "/hunyuan" },
  { brand: "tempo", href: "/tempo" },
  { brand: "privy", href: "/night-watch-privy" },
] as const satisfies readonly { brand: BrandId; href: string }[];

export type ArticlePage = (typeof PAGES)[number]["brand"];

/** Every page but the one being read, as badge links. */
export function ArticleLinks({ current, className }: { current: ArticlePage; className?: string }) {
  const others = PAGES.filter((page) => page.brand !== current);
  return (
    <BrandStrip label={others.map((page) => BRANDS[page.brand].name).join(" · ")} className={className}>
      {others.map((page) => <BrandBadge key={page.brand} brand={page.brand} href={page.href} />)}
    </BrandStrip>
  );
}
