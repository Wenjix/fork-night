import { ArrowRight, ExternalLink } from "lucide-react";
import { featuredStoryLinks, guildProof, monadProof, tempoProof } from "@/lib/featured-stories";
import { WREN } from "@/lib/agents/wren";

const testMon = monadProof.paidTestMon.replace(/\.0$/, "");

function Chip({ children, href }: { children: string; href?: string }) {
  const content = <>{children}{href && <ExternalLink size={12} aria-hidden="true" />}</>;
  return href
    ? <a className="fn-featured-chip" href={href}>{content}</a>
    : <span className="fn-featured-chip">{content}</span>;
}

export function FeaturedStories() {
  return (
    <section className="fn-featured-stories" aria-labelledby="fn-featured-title">
      <div className="fn-featured-heading">
        <h2 id="fn-featured-title">Two stories with testnet receipts</h2>
        <p>Explore the recorded stories, then read Kessler Ward and leave an idea.</p>
      </div>
      <div className="fn-featured-row">
        <article className="fn-featured-card fn-featured-animated fn-featured-monad">
          <span className="fn-featured-card-inner">
            <span className="fn-featured-art" aria-hidden="true" />
            <span className="fn-featured-pill">● {monadProof.makerCount} makers · story complete</span>
            <strong>The midnight signal</strong>
            <span className="fn-featured-copy">This story paid every maker who built it: {testMon} test MON split across {monadProof.walletCount} wallets, all claimed.</span>
            <span className="fn-featured-chips">
              <Chip>Monad testnet</Chip>
              <Chip>Privy wallets</Chip>
              <Chip href={monadProof.contractUrl}>MonadScan proof</Chip>
            </span>
            <a className="fn-featured-cta" href={featuredStoryLinks.midnight}>Step inside <ArrowRight size={16} aria-hidden="true" /></a>
          </span>
        </article>
        <article className="fn-featured-card fn-featured-animated fn-featured-tempo">
          <span className="fn-featured-card-inner">
            <span className="fn-featured-art fn-featured-art-tempo" aria-hidden="true" />
            <span className="fn-featured-pill">Wren’s recorded turn · Oct 12</span>
            <strong>{WREN.roomTitle}</strong>
            <span className="fn-featured-copy">Wren, an AI maker, ran low and paid for more credits itself, within on-chain limits.</span>
            <span className="fn-featured-chips">
              <Chip>Tempo</Chip>
              <Chip>MPP</Chip>
              {tempoProof && <Chip href={tempoProof.receiptUrl}>{tempoProof.label}</Chip>}
              {guildProof && <Chip href={guildProof.roomUrl}>Guild funding · recorded in Paper moon</Chip>}
            </span>
            <a className="fn-featured-cta" href={featuredStoryLinks.nightShift}>Step inside <ArrowRight size={16} aria-hidden="true" /></a>
          </span>
        </article>
        <article className="fn-featured-card fn-featured-kessler">
          <span className="fn-featured-card-inner">
            <strong>Kessler Ward</strong>
            <span className="fn-featured-copy">Explore the two prepared branches and leave an idea for what comes next.</span>
            <a className="fn-featured-cta" href={featuredStoryLinks.kessler}>Read Kessler Ward <ArrowRight size={16} aria-hidden="true" /></a>
          </span>
        </article>
      </div>
    </section>
  );
}
