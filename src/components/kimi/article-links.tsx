import { BRANDS, type BrandId } from "@/lib/brands";
import { BrandBadge, BrandStrip } from "../brand-badge";

/**
 * The quiet strip at the end of each sponsor article that points to the pages for the payment rail and the wallet.
 * A model article is about its own model alone (kimi-article.test.ts), so the strip never links one model's page
 * from another's; the lobby's built-with row is where the models sit side by side.
 */
const PAGES = [
  { brand: "tempo", href: "/tempo" },
  { brand: "privy", href: "/night-watch-privy" },
] as const satisfies readonly { brand: BrandId; href: string }[];

export function ArticleLinks({ className }: { className?: string }) {
  return (
    <BrandStrip label={PAGES.map((page) => BRANDS[page.brand].name).join(" · ")} className={className}>
      {PAGES.map((page) => <BrandBadge key={page.brand} brand={page.brand} href={page.href} />)}
    </BrandStrip>
  );
}
