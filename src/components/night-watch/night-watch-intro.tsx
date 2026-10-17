import { ArrowDown, ArrowRight, MoonStar, Sunrise } from "lucide-react";
import { BrandBadge } from "../brand-badge";
import { StoryArt } from "../story-art";
import { Button } from "../ui/button";
import { NightWatchTools } from "./night-watch-badges";

/** Presentational only: the hosted explanation never mounts account or wallet controls. */
export function NightWatchIntro({ privyDemo = false, local = true }: { privyDemo?: boolean; local?: boolean }) {
  return <div className="nw-entrance">
    <figure className="nw-room-sign">
      <StoryArt src="/art/midnight-story.webp#frame=1" description="A lighthouse keeper listening for a story on a glowing radio, beside a lantern." />
      <div className="nw-room-sign-title">
        <h1 id="nw-title">Night Watch{privyDemo && <span className="nw-privy-title">with <BrandBadge brand="privy" size="lg" /></span>}</h1>
      </div>
      <figcaption>Fork Night story illustration</figcaption>
    </figure>
    <div className="nw-invitation">
      <span className="fn-plate-mount" aria-hidden="true"><MoonStar size={24} strokeWidth={1.75} /></span>
      <h2>{privyDemo ? "Your creative agent. Your limits." : "Your own agent for the night."}</h2>
      <p className="nw-lede">{privyDemo
        ? "Give your creative agent a limited wallet permission. Authorize a signer, leave the app, and return to private story drafts. You choose what gets published."
        : "Leave a brief at a fork point before bed. The Night Watch prepares private candidates while you sleep, and may buy one room top-up with test USDC within the allowance you sign. In the morning, you choose what to publish."}</p>
      <p className="nw-promise"><Sunrise size={20} aria-hidden="true" /><span>Night Watch never publishes and never closes an edition.</span></p>
      <NightWatchTools label="Tools and networks" size="md" className="nw-invitation-tools" />
      <Button asChild className="nw-entrance-action">
        {local
          ? <a href="#desk">Leave a brief <ArrowDown size={16} aria-hidden="true" /></a>
          : <a href="/pilot">Open the shared story rooms <ArrowRight size={16} aria-hidden="true" /></a>}
      </Button>
      <p className="nw-demo-note">{local ? "Local testnet demo on this machine." : "This testnet demo runs on the operator’s machine."}</p>
    </div>
  </div>;
}

/** The page's closing line: the testnet disclosure, on the hosted explainer as well as the running app. */
export function NightWatchFooter() {
  return <footer className="nw-footer">
    <p>Fork Night · testnet only. Test USDC, test MON and test credits have no redemption value. Images are operator-paid inference.</p>
  </footer>;
}
