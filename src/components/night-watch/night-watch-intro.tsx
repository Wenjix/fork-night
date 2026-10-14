import { ArrowDown, ArrowRight, Feather, Sunrise } from "lucide-react";
import { StoryArt } from "../story-art";
import { Button } from "../ui/button";

/** Presentational only: the hosted explanation never mounts account or wallet controls. */
export function NightWatchIntro({ privyDemo = false, local = true }: { privyDemo?: boolean; local?: boolean }) {
  return <div className="nw-entrance">
    <figure className="nw-room-sign">
      <StoryArt src="/art/midnight-story.webp#frame=1" description="A lighthouse keeper listening for a story on a glowing radio, beside a lantern." />
      <div className="nw-room-sign-title">
        <h1 id="nw-title">Night Watch{privyDemo && <span className="nw-privy-title">with Privy</span>}</h1>
      </div>
      <figcaption>Fork Night story illustration</figcaption>
    </figure>
    <div className="nw-invitation">
      <span className="fn-plate-mount" aria-hidden="true"><Feather size={24} strokeWidth={1.75} /></span>
      <h2>{privyDemo ? "Your creative agent. Your limits." : "Your own agent for the night."}</h2>
      <p className="nw-lede">{privyDemo
        ? "Give your creative agent a limited wallet permission. Authorize a signer, leave the app, and return to private story drafts. You choose what gets published."
        : "Leave a brief at a fork point before bed. The Night Watch prepares private candidates while you sleep, and may buy one room top-up with test USDC within the allowance you sign. In the morning, you choose what to publish."}</p>
      <p className="nw-promise"><Sunrise size={19} aria-hidden="true" /><span>Night Watch never publishes and never closes an edition.</span></p>
      <Button asChild className="nw-entrance-action">
        {local
          ? <a href="#desk">Leave a brief <ArrowDown size={17} aria-hidden="true" /></a>
          : <a href="/pilot">Open the shared story rooms <ArrowRight size={17} aria-hidden="true" /></a>}
      </Button>
      <p className="nw-demo-note">{local ? "Local testnet demo on this machine." : "This testnet demo runs on the operator’s machine."}</p>
    </div>
  </div>;
}
