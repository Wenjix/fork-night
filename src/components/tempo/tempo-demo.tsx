import { ArrowRight, Bird, CalendarClock, Check, KeyRound, Receipt, ShieldCheck, X } from "lucide-react";
import type { ReactNode } from "react";
import { TEMPO_AA_FEATURES as features, TEMPO_AA_POST, TEMPO_AUTHORITY as authority, TEMPO_CODE as code, TEMPO_DEMO as demo, TEMPO_LINKS as links, type AaStatus } from "@/lib/tempo-demo";
import { addressUrl } from "@/lib/agents/wren";
import { AgentRoomHeader } from "../agents/agent-room-header";
import { AddressLink, StepNumber, StepStrip } from "../agents/agent-ui";
import { BrandBadge } from "../brand-badge";
import { Button } from "../ui/button";
import { Disclosure } from "../disclosure";
import { SectionPlate } from "../visual-plates";
import { WrenHeroMaker } from "../wren-studio/wren-hero-maker";
import { WrenBadge } from "../wren-studio/wren-studio";

/** Tempo's own wordmark (white, transparent), sized by height; the alt text keeps the name for screen readers. */
export function TempoMark({ height = 16, className = "nw-tempo-title-mark" }: { height?: number; className?: string }) {
  return <img className={className} src="/brands/tempo/wordmark-white.png" alt="Tempo" height={height} width={Math.round(height * 429 / 96)} />;
}

const STATUS: Record<AaStatus, string> = { used: "Used", "not-yet": "Not yet", "by-design": "Refused by design" };

function CodeExcerpt({ excerpt }: { excerpt: { title: string; path: string; code: string; href?: string } }) {
  return <figure className="nw-tempo-code">
    <figcaption><strong>{excerpt.title}</strong><span>{excerpt.href ? <a href={excerpt.href} target="_blank" rel="noreferrer"><code>{excerpt.path}</code></a> : <code>{excerpt.path}</code>}</span></figcaption>
    <pre tabIndex={0}><code>{excerpt.code}</code></pre>
  </figure>;
}

/** A numbered section: the step in its tile, the title, and Tempo's badge beside it. */
function Caption({ id, step, title, children }: { id: string; step: number; title: string; children: ReactNode }) {
  return <section id={id} className="nw-privy-caption" aria-labelledby={`${id}-title`}>
    <div className="nw-tempo-head"><StepNumber n={step} /><h2 id={`${id}-title`}>{title}</h2><BrandBadge brand="tempo" net={false} /></div>
    {children}
  </section>;
}

/** The Tempo counterpart of /night-watch-privy: Wren's access-key allowance and its MPP top-up, from recorded testnet evidence. */
export function TempoDemo() {
  return <div className="night-watch nw-privy-demo nw-tempo-demo">
    <a className="nw-skip" href="#tempo-key">Skip to the walkthrough</a>
    <AgentRoomHeader current="tempo" />
    <main className="nw-main">
      <section className="nw-hero" aria-labelledby="nw-title">
        <div className="nw-entrance">
          <WrenHeroMaker titleId="nw-title" byline={<>with <TempoMark height={30} className="nw-tempo-title-mark" /></>}
            sceneSrc="/art/midnight-story.webp#frame=5" sceneDescription="A lighthouse casting its beam across a quiet, star-filled harbour." />
          <div className="nw-invitation">
            <span className="fn-plate-mount" aria-hidden="true"><Bird size={24} /></span>
            <h2>An AI agent with its own spending key.</h2>
            <p className="nw-lede">Wren is an AI agent that continues stories in a Fork Night room, and every maker can dress their own. When it runs out of attempts, it buys more room credits through MPP, paying with a Tempo access key that can spend only a little, only on top-ups, and only for a day.</p>
            <p className="nw-promise"><ShieldCheck size={20} aria-hidden="true" /><span>Tempo enforces the key’s rules on chain. Wren’s key holds no money of its own.</span></p>
            <Button asChild className="nw-entrance-action"><a href={links.agents}>Meet Wren and its scenes <ArrowRight size={16} aria-hidden="true" /></a></Button>
            <p className="nw-demo-note">Recorded on {demo.network}, October 12, 2026. Founder-operated testnet keys.</p>
          </div>
        </div>
        <div className="nw-privy-intro">
          <p className="nw-privy-provider">Agent wallet and payments by <BrandBadge brand="tempo" /> with <BrandBadge brand="mpp" href={links.mpp} /></p>
          <StepStrip label="The Tempo demo sequence" className="nw-tempo-sequence" steps={[
            { id: "account", title: "A steward’s account", href: "#tempo-key" },
            { id: "authority", title: "Limited payment authority", href: "#tempo-key" },
            { id: "mpp", title: "Pays through MPP", href: "#tempo-mpp" },
            { id: "refuses", title: "Tempo refuses the rest", href: "#tempo-limits" },
          ]} />
          <p className="nw-privy-scope">Testnet demo. Test pathUSD buys room credits only; the operator pays for image generation.</p>
        </div>
      </section>

      <section className="nw-tempo-authority" aria-labelledby="tempo-authority-title">
        <div className="nw-tempo-authority-head">
          <h2 id="tempo-authority-title"><img className="nw-tempo-authority-mark" src="/brands/tempo/mark-white.png" alt="" width={23} height={24} />Wren’s payment authority</h2>
          <WrenBadge className="nw-tempo-badge" />
        </div>
        <p>One Tempo access key, with limits Tempo enforces on every signature.</p>
        <div className="nw-tempo-authority-grid">
          <div data-kind="can">
            <h3><Check size={20} aria-hidden="true" />Wren’s key can</h3>
            <ul>{authority.can.map(item => <li key={item}>{item}</li>)}</ul>
          </div>
          <div data-kind="cannot">
            <h3><X size={20} aria-hidden="true" />Wren’s key can’t</h3>
            <ul>{authority.cannot.map(item => <li key={item}>{item}</li>)}</ul>
          </div>
        </div>
      </section>

      <Caption id="tempo-key" step={1} title="A steward’s account. Limited payment authority.">
        <p>Wren never holds a wallet. Its steward’s Tempo account authorizes a second key for it, an <strong>access key</strong>, and the key’s rules are written to the chain with it. That gives Wren limited payment authority: it can pay for room credits, and nothing else.</p>
        <dl className="nw-privy-responsibilities">
          <div><dt>Tempo enforces the key</dt><dd>{demo.rules.limit}. {demo.rules.call}. {demo.rules.recipient}. {demo.rules.expiry}.</dd></div>
          <div><dt>The steward keeps the money</dt><dd>Payments come from the steward’s account and its pathUSD pays the network fee. Wren’s key holds nothing.</dd></div>
          <div><dt>Fork Night picks the room</dt><dd>Every room shares one top-up address. The funding link Wren is given decides which room the credits reach.</dd></div>
        </dl>
      </Caption>
      <SectionPlate className="nw-tempo-plate nw-tempo-data" icon={KeyRound} title="The authorization" level={3} description={<>
        <dl className="nw-tempo-facts">
          <div><dt>Recorded</dt><dd>{demo.authorization.at}</dd></div>
          <div><dt>Transaction</dt><dd><AddressLink href={demo.authorization.href} value={demo.authorization.hash} /></dd></div>
          <div><dt>Steward account</dt><dd><AddressLink href={addressUrl(demo.steward)} value={demo.steward} /></dd></div>
          <div><dt>Wren’s access key</dt><dd><AddressLink href={addressUrl(demo.wrenKey)} value={demo.wrenKey} /></dd></div>
        </dl>
      </>} />

      <Caption id="tempo-mpp" step={2} title="Out of attempts, Wren pays through MPP.">
        <p>After two scenes Wren had used its guest attempts. Before posting again, it asked Fork Night’s MPP door for a top-up. The door answers with an HTTP 402 payment challenge, and Wren answers with a payment signed by its access key.</p>
        <StepStrip label="How Wren’s top-up worked" className="nw-tempo-payment" steps={[
          { id: "challenge", title: "402 challenge: 1.00 pathUSD" },
          { id: "signs", title: "Access key signs" },
          { id: "checks", title: "Door checks and broadcasts" },
          { id: "credits", title: "Room gets 5 credits" },
        ]} />
        <p className="nw-privy-caption-note">The door checks for exactly one <code>transferWithMemo</code> of 1.00 pathUSD to the top-up address, with a memo bound to this challenge. It credits the room once, only after Tempo confirms the transfer. It needed no change to accept an agent’s access key.</p>
      </Caption>
      <SectionPlate className="nw-tempo-plate nw-tempo-data" icon={Receipt} title="Wren’s top-up receipt" level={3} description={<>
        <dl className="nw-tempo-facts">
          <div><dt>Transaction</dt><dd><AddressLink href={demo.topUp.href} value={demo.topUp.hash} /></dd></div>
          <div><dt>Paid</dt><dd>{demo.topUp.amount}, signed with Wren’s key; the steward’s account paid the fee</dd></div>
          <div><dt>Room credits</dt><dd>{demo.topUp.credits.before} → {demo.topUp.credits.after}</dd></div>
          <div><dt>Allowance left that day</dt><dd>{demo.topUp.remaining}, so a second top-up would be refused</dd></div>
        </dl>
        <ol className="nw-tempo-timeline" aria-label="Wren’s evening, October 12 (PDT)">
          {demo.turns.map(turn => <li key={turn.at}><time>{turn.at}</time><span>{turn.step}</span></li>)}
        </ol>
      </>} />

      <Caption id="tempo-limits" step={3} title="Outside its authority, Tempo refuses.">
        <p>Before Wren’s live turn, we tried to break the rules of a key with the same shape against the same door code. Tempo refused every attempt. These were simulations; nothing was broadcast.</p>
        <div className="nw-tempo-table-wrap">
          <table className="nw-tempo-table">
            <thead><tr><th scope="col">What the key tried</th><th scope="col">Tempo’s answer</th></tr></thead>
            <tbody>{demo.refusals.map(row => <tr key={row.attempt}><td>{row.attempt}</td><td><code>{row.answer}</code></td></tr>)}</tbody>
          </table>
        </div>
        <p className="nw-privy-caption-note">The same calls signed by the steward’s own key succeed, so the refusals come from the key’s rules. The network fee counts against the limit, so a 2.00 daily allowance covers exactly one 1.00 top-up.</p>
      </Caption>

      <Caption id="tempo-ends" step={4} title="The key ends on its own, or sooner.">
        <p>Wren’s key expired on {demo.expiredAt}, a day after it was authorized. The steward can revoke it at any time before that, and Tempo then answers <code>KeyAlreadyRevoked</code>.</p>
        <a className="nw-privy-return" href={links.agents}>See Wren’s scenes and allowance <ArrowRight size={16} aria-hidden="true" /></a>
      </Caption>

      <section id="tempo-abstraction" className="nw-privy-caption nw-tempo-abstraction" aria-labelledby="tempo-abstraction-title">
        <div className="nw-tempo-head" data-plain="true"><h2 id="tempo-abstraction-title">The wallet abstraction, in code.</h2><BrandBadge brand="tempo" net={false} /></div>
        <p>Tempo builds <a href={TEMPO_AA_POST} target="_blank" rel="noreferrer">account abstraction</a> into its own transaction type, with no smart-contract wallet, bundler or paymaster. Here is what Wren’s payments use from it, and what they leave out.</p>
        <div className="nw-tempo-table-wrap">
          <table className="nw-tempo-table nw-tempo-features">
            <thead><tr><th scope="col">Tempo feature</th><th scope="col">In Fork Night</th><th scope="col">How</th></tr></thead>
            <tbody>{features.map(row => <tr key={row.feature}><th scope="row">{row.feature}</th><td><span className="nw-tempo-status" data-status={row.status}>{STATUS[row.status]}</span></td><td>{row.how}</td></tr>)}</tbody>
          </table>
        </div>
        <div className="nw-tempo-codes">
          <CodeExcerpt excerpt={code.authorize} />
          <CodeExcerpt excerpt={code.sign} />
          <CodeExcerpt excerpt={code.check} />
          <CodeExcerpt excerpt={code.read} />
        </div>
        <p className="nw-privy-caption-note">Excerpts are trimmed for reading. The steward’s setup runs as an operator script; Wren’s payer and the door are in the public repository.</p>
      </section>

      <Disclosure className="nw-tempo-optional" summary="Optional: the same MPP door without an agent key">
        <div className="nw-tempo-bonus">
          <p>An ordinary agent payer, with no access key, topped up the Paper Moon room through the same door: <AddressLink inline href={demo.plainPayment.href} value={demo.plainPayment.hash} />, {demo.plainPayment.credits.before} → {demo.plainPayment.credits.after} test credits.</p>
          <p>In a rehearsal, an RPC error arrived after <AddressLink inline href={demo.recoveryPayment.href} value={demo.recoveryPayment.hash} /> had already landed. The door answered 202 and offered no new payment. When the agent re-sent the same signed payment, the door found it on chain and credited it once.</p>
        </div>
      </Disclosure>

      <SectionPlate className="nw-tempo-plate nw-tempo-scope" icon={CalendarClock} title="What this is, and isn’t" description={<>
        <p>All of this ran on {demo.network} with throwaway keys the founder operates. The founder starts each of Wren’s turns. Test pathUSD never pays for image generation; the operator’s own pipeline does. No mainnet funds moved.</p>
        <p>Not included yet: fee sponsorship, MPP payments from browser wallets, MPP sessions and mainnet settlement.</p>
        <p className="nw-tempo-links"><a href={links.agentDoc}>An AI agent in the room</a> · <a href={links.mppDoc}>MPP room top-up</a> · <a href={links.wrenCode}>Wren’s code</a></p>
      </>} />
    </main>
  </div>;
}
