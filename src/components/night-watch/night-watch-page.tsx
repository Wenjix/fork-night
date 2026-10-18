import { headers } from "next/headers";
import { AgentRoomHeader } from "../agents/agent-room-header";
import { SectionPlate } from "../visual-plates";
import { Monitor } from "lucide-react";
import { KIMI_HREFS, KIMI_VIDEO } from "../../lib/kimi-article";
import { NightWatchFooter, NightWatchIntro } from "./night-watch-intro";
import { NightWatchApp } from "./night-watch-app";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
/** The recorded walkthrough of the Night Watch (embedded on /kimi) and the public repository's README. */
const DEMO_HREF = KIMI_VIDEO && "href" in KIMI_VIDEO ? KIMI_VIDEO.href : KIMI_HREFS.kimi;
const README_HREF = `${KIMI_HREFS.repo}#readme`;

/** Like the Night Watch API, the page exists only on an operator's machine with local controls on. */
async function servedLocally() {
  if (process.env.PILOT_LOCAL_CONTROLS !== "1" || process.env.VERCEL) return false;
  const host = (await headers()).get("host") ?? "";
  try {
    return LOOPBACK.has(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
}

/** What a visitor to the hosted site sees: an explanation, with no account, wallet or API code. */
function RunsLocally({ privyDemo }: { privyDemo: boolean }) {
  return <div className={`night-watch${privyDemo ? " nw-privy-demo" : ""}`}>
    <a className="nw-skip" href="#nw-title">Skip to Night Watch</a>
    <AgentRoomHeader current={privyDemo ? "privy" : "night-watch"} />
    <main className="nw-main">
      <section className="nw-hero" aria-labelledby="nw-title">
        <NightWatchIntro privyDemo={privyDemo} local={false} />
      </section>
      <SectionPlate className="nw-local-explanation" icon={Monitor} title="A demo on the operator’s machine" description={<>
        <p>The second kind of agent in Fork Night. <a href="/agents">Wren</a> takes public turns in a room; a Night Watch works only for the maker who authorizes it. A maker leaves a brief at a fork point and authorizes a capped Night Watch. While their browser is closed, a local runner may buy one room top-up with test USDC through a Privy signer limited by policy, and prepares private candidates. In the morning the maker chooses what to publish, and a credited edition can be released on Monad testnet.</p>
        <p>This proof needs the operator&apos;s local runner and local x402 door, so it is not served from this hosted site. See <a href={DEMO_HREF} target="_blank" rel="noreferrer">the recorded demo</a> and <a href={README_HREF} target="_blank" rel="noreferrer">the project README</a>.</p>
      </>} />
    </main>
    <NightWatchFooter />
  </div>;
}

export async function NightWatchPageContent({ privyDemo = false }: { privyDemo?: boolean }) {
  if (!(await servedLocally())) return <RunsLocally privyDemo={privyDemo} />;
  return <NightWatchApp privyDemo={privyDemo} />;
}
