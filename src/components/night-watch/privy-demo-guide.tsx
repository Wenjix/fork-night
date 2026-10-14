import { ArrowRight, KeyRound, MoonStar, Receipt, ShieldCheck, Wallet } from "lucide-react";
import { PrivyMark } from "../auth-branding.tsx";

export function PrivyDemoIntro() {
  return <div className="nw-privy-intro">
    <p className="nw-privy-provider">Wallets and agent permissions by <PrivyMark /></p>
    <ol className="nw-privy-flow" aria-label="The Privy demo sequence">
      <li><a href="#privy-permission"><Wallet size={20} aria-hidden="true" /><span>Your wallet</span></a></li>
      <li><a href="#privy-permission"><KeyRound size={20} aria-hidden="true" /><span>Limited permission</span></a></li>
      <li><a href="#privy-away"><MoonStar size={20} aria-hidden="true" /><span>Works while away</span></a></li>
      <li><a href="#privy-control"><ShieldCheck size={20} aria-hidden="true" /><span>Revoke access</span></a></li>
    </ol>
    <p className="nw-privy-scope">Local testnet demo. Test credits track room capacity. The operator pays for image generation.</p>
  </div>;
}

export function PrivyPermissionCaption() {
  return <aside id="privy-permission" className="nw-privy-caption" aria-labelledby="privy-permission-title">
    <div className="nw-privy-caption-heading"><span className="nw-privy-step" aria-hidden="true">1</span><h2 id="privy-permission-title">Your wallet. A limited signer.</h2><PrivyMark /></div>
    <p>Google sign-in prepares your embedded wallet. You authorize an additional signer for this Night Watch.</p>
    <dl className="nw-privy-responsibilities">
      <div><dt>Privy checks each signature</dt><dd>Approved chain, token, recipient, maximum amount and signing deadline.</dd></div>
      <div><dt>Fork Night tracks the session</dt><dd>Total allowance, number of top-ups and which room receives the credits.</dd></div>
      <div><dt>You keep publication control</dt><dd>The signer can authorize a permitted payment. It cannot publish a candidate or close an edition.</dd></div>
    </dl>
  </aside>;
}

export function PrivyAwayCaption() {
  return <aside id="privy-away" className="nw-privy-caption" aria-labelledby="privy-away-title">
    <div className="nw-privy-caption-heading"><span className="nw-privy-step" aria-hidden="true">2</span><h2 id="privy-away-title">Signing continues while you are away.</h2><PrivyMark /></div>
    <p>After you close the browser, the local runner can request a permitted signature through Privy. It buys a top-up only when the room needs test credits.</p>
    <div className="nw-privy-payment-flow" aria-label="How a permitted top-up works">
      <span><KeyRound size={18} aria-hidden="true" />Privy signs the authorization</span><ArrowRight size={18} aria-hidden="true" />
      <span><Receipt size={18} aria-hidden="true" />x402 settles the payment</span><ArrowRight size={18} aria-hidden="true" />
      <span>Fork Night adds test credits</span>
    </div>
    <p className="nw-privy-caption-note">The log and receipt below show this job’s actual result. A job with enough credits makes no payment.</p>
  </aside>;
}

export function PrivyControlCaption() {
  return <aside id="privy-control" className="nw-privy-caption" aria-labelledby="privy-control-title">
    <div className="nw-privy-caption-heading"><span className="nw-privy-step" aria-hidden="true">3</span><h2 id="privy-control-title">Review the drafts. Revoke further signing.</h2><PrivyMark /></div>
    <p>Candidates stay private until you choose one to publish. Use Revoke Night Watch on your desk to remove its signer and change its session policy to deny new requests.</p>
    <p className="nw-privy-caption-note">Revocation stops new signatures. A payment signed before revocation can still settle.</p>
    <a className="nw-privy-return" href="#desk">Return to the revocation control <ArrowRight size={18} aria-hidden="true" /></a>
  </aside>;
}

export function PrivyHelperCaption() {
  return <aside className="nw-privy-caption nw-privy-helper" aria-labelledby="privy-helper-title">
    <div className="nw-privy-caption-heading"><h2 id="privy-helper-title">A second wallet role: deliver a creator’s share.</h2><PrivyMark /></div>
    <p>A separate Privy server wallet can sign a release claim on Monad testnet and pay its gas. The contract sends the share to the fixed beneficiary. The helper has its own restricted policy.</p>
    <p className="nw-privy-caption-note">Helper-paid gas. This is separate from the maker’s payment permission above.</p>
  </aside>;
}
