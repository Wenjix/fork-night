import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tsImport } from "tsx/esm/api";
import type { BrainView, MeResponse, SessionView, WorldResponse } from "../../src/night-watch/api-types.ts";

// The Night Watch's tools and networks as badges, its card kinds as chips beside the title instead of kickers above it, and
// the paper account menu under the dark bar. The running app (desk, receipt, brain, identity) needs a maker, a wallet and a
// local runner, so these states are rendered here with fixtures; the hosted pages are also checked in the browser.
const { NightWatchPageContent, NightWatchTools, PaymentChain, ModelBadge, RouterBadge, NightWatchPrivyContext, DeskPanel, AwayPanel, WorldPanel, BrainCard, AgentCard, PrivyDemoIntro, PrivyAwayCaption, PrivyPermissionCaption, PrivyControlCaption, PrivyHelperCaption } =
  await tsImport("./night-watch-ui-fixtures.ts", import.meta.url);

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
/** React 19 emits image preload hints ahead of static markup; they are not part of the page. */
const html = (element: unknown) => renderToStaticMarkup(element as never).replace(/<link rel="preload"[^>]*\/>/g, "");
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
/** The words a screen reader hears: the badge tiles (a mark, or letters for a brand without one) are hidden from it. */
const heard = (markup: string) => text(markup.replace(/<span class="fn-badge-tile"[\s\S]*?<\/span>(?=<span class="fn-badge-name")/g, "")).replace(/\s+([.,;:])/g, "$1");
/** A badge's name, with a model version ("K3") that follows a logotype appended to it. */
const names = (markup: string) => [...markup.matchAll(/<span class="fn-badge-name">([^<]*)<\/span>(?:<span class="fn-badge-version">([^<]*)<\/span>)?/g)].map((match) => match[1] + (match[2] ?? ""));

const WALLET = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const TX = `0x${"ab".repeat(32)}`;
const NOW = Date.parse("2026-10-17T22:00:00.000Z");
const iso = (offset: number) => new Date(NOW + offset).toISOString();

test("the tools row names each tool and network once, and a chain never comes without its test network", () => {
  const row = html(React.createElement(NightWatchTools, { label: "Built with", size: "md" }));
  assert.match(row, /^<ul class="fn-badges" aria-label="Built with">/);
  assert.deepEqual(names(row), ["Privy", "x402", "Base", "Kimi K3", "Monad"]);
  assert.match(row, /<span class="fn-badge-role">wallets<\/span>/);
  assert.match(row, /<span class="fn-badge-role">releases<\/span>/);
  // Base and Monad are chains: each carries its network word by itself.
  assert.match(row, /<span class="fn-badge-name">Base<\/span><span class="fn-net">Sepolia<\/span>/);
  assert.match(row, /<span class="fn-badge-name">Monad<\/span><span class="fn-badge-role">releases<\/span><span class="fn-net">Testnet<\/span>/);
  assert.equal([...row.matchAll(/<li>/g)].length, 5);
});

test("a payment chain, a model and the router read as their words inside a sentence", () => {
  assert.match(html(React.createElement(PaymentChain)), /<span class="fn-badge-name">Base Sepolia<\/span>/);
  assert.match(html(React.createElement(PaymentChain, { label: "chain 84532" })), /<span class="fn-badge-name">chain 84532<\/span>/);
  // Kimi's official logotype stands in for its name; the version after it stays text, and the whole name stays for screen readers.
  assert.match(html(React.createElement(ModelBadge, { label: "Kimi K3" })), /<span class="fn-badge-tile" data-lockup="light"[^>]*aria-hidden="true"[^>]*><img src="\/brands\/kimi\.svg"[^>]*\/><\/span><span class="fn-badge-name">Kimi <\/span><span class="fn-badge-version">K3<\/span>/);
  assert.match(html(React.createElement(ModelBadge, { label: "Tencent HY4 preview" })), /<img src="\/brands\/hunyuan\.png"[\s\S]*Tencent HY4 preview/);
  assert.match(html(React.createElement(ModelBadge, { label: "A model nobody has a mark for" })), /fn-badge" data-size="sm" data-kind="feature"/);
  assert.match(html(React.createElement(RouterBadge)), /<span class="fn-badge-name">via TokenRouter<\/span>/);
});

test("the hosted pages show the tools once (in the hero), the Privy lockup, and the testnet line, with every word kept", async (t) => {
  const saved = process.env.PILOT_LOCAL_CONTROLS;
  delete process.env.PILOT_LOCAL_CONTROLS;
  t.after(() => {
    if (saved === undefined) delete process.env.PILOT_LOCAL_CONTROLS;
    else process.env.PILOT_LOCAL_CONTROLS = saved;
  });
  for (const privyDemo of [false, true]) {
    const page = html(await NightWatchPageContent({ privyDemo }));
    assert.equal([...page.matchAll(/<ul class="fn-badges[^"]*" aria-label="(?:Tools and networks|Built with)"/g)].length, 1, "one list, in the hero; the explainer below does not repeat it");
    assert.match(page, /<p class="nw-promise">[\s\S]*<ul class="fn-badges nw-invitation-tools" aria-label="Tools and networks">[\s\S]*<\/ul><a href="\/pilot"[^>]*nw-entrance-action/, "the tools sit between the promise and the button");
    assert.match(page, /<footer class="nw-footer"><p>Fork Night · testnet only\. Test USDC, test MON and test credits have no redemption value\. Images are operator-paid inference\.<\/p><\/footer>/);
    assert.match(heard(page), /Night Watch never publishes and never closes an edition\./);
    assert.match(page, /<span class="fn-net">Sepolia<\/span>/);
    assert.match(page, /<span class="fn-net">Testnet<\/span>/);
    const title = page.match(/<h1 id="nw-title">([\s\S]*?)<\/h1>/)![1];
    assert.equal(heard(title), privyDemo ? "Night Watch with Privy" : "Night Watch", "the title keeps its words; with Privy the name is the badge");
    assert.equal(/nw-privy-title/.test(title), privyDemo);
  }
});

test("the Privy page keeps its list numbers, its caption numerals and its Act labels, and names Privy with the badge", () => {
  const guide = [PrivyDemoIntro, PrivyPermissionCaption, PrivyAwayCaption, PrivyControlCaption, PrivyHelperCaption].map((part) => html(React.createElement(part))).join("");
  assert.equal([...guide.matchAll(/<span class="nw-privy-step" aria-hidden="true">(\d)<\/span>/g)].map((match) => match[1]).join(""), "123", "the three captions keep their numerals");
  assert.equal([...guide.matchAll(/<li><a href="#privy-/g)].length, 4);
  const css = strip(read("src/app/night-watch-privy/privy-demo.css"));
  assert.match(css, /\.nw-privy-flow a::before \{[^}]*content: counter\(privy-step\) "\."/, "the list is the numbering");
  assert.doesNotMatch(css, /\.nw-act-head \.fn-plate-action/, "the acts keep their 'Act N' labels on this page");
  // Each caption names Privy with its badge inside the heading, so the badge can never wrap away alone at 390px.
  for (const caption of [PrivyPermissionCaption, PrivyAwayCaption, PrivyControlCaption, PrivyHelperCaption]) {
    assert.match(html(React.createElement(caption)), /<h2 id="[^"]+">[^<]*<span class="fn-badge"[^>]*>[\s\S]*<span class="fn-badge-name">Privy<\/span>[\s\S]*<\/h2>/);
  }
  assert.match(html(React.createElement(PrivyAwayCaption)), /<span class="fn-badge-name">Privy<\/span><\/span> signs the authorization/);
  assert.match(html(React.createElement(PrivyAwayCaption)), /<span class="fn-badge-name">x402<\/span><\/span> settles the payment/);
  assert.match(html(React.createElement(PrivyHelperCaption)), /<span class="fn-badge-name">Monad<\/span><span class="fn-net">Testnet<\/span>/);
});

const SESSION: SessionView = {
  id: "nws_active", state: "active", roomId: "midnight-signal", walletAddress: WALLET, deadline: iso(2 * 3_600_000), revokedAt: null, remainingAtomic: "0",
  limits: { maxPaymentAtomic: "1000000", totalAllowanceAtomic: "1000000", maxPayments: 1, attemptAllowance: 2, payTo: WALLET, token: WALLET, chainId: 84532 },
  payments: [{ id: "p1", jobId: "j1", amountAtomic: "1000000", state: "settled", transaction: TX, explorerUrl: `https://sepolia.basescan.org/tx/${TX}`, creditsAdded: 5, updatedAt: iso(-600_000) }],
};
const ME: MeResponse = {
  maker: { id: "maker", displayName: "Burkes" },
  privy: { configured: true, wallet: { id: "w1", address: WALLET, delegated: true, tee: true }, signerId: "signer" },
  sessions: [SESSION],
  jobs: [{ id: "j1", state: "ready", sessionId: SESSION.id, forkPointId: "m1", createdAt: iso(-3_600_000), runAfter: iso(-3_000_000), updatedAt: iso(-600_000), message: "Two private candidates are ready for you." }],
  runner: { lastSeen: iso(-60_000), alive: true },
};
const WORLD: WorldResponse = {
  room: { id: "midnight-signal", title: "The Midnight Signal", description: "A shared story that grows by forks." },
  kit: { id: "midnight-signal", version: "1", digest: "a".repeat(64), title: "The Midnight Signal", creator: "Wenjie · world creator", disclosure: "The opening artwork was AI-assisted.", lore: [], style: [], rules: [], starters: [], participation: [], references: [] },
  moments: [{ id: "m1", parentId: null, makerId: null, makerLabel: "Wenjie", title: "The midnight signal", panels: [{ caption: "At midnight, the lighthouse blinked.", imageUrl: "/art/midnight-story.webp#frame=0" }], createdAt: iso(-86_400_000), source: "pilot" }],
  friendContribution: null, defaultForkPointId: "m1", credits: null,
};
const PRIVY = { configured: true, ready: true, address: WALLET, walletId: "w1", delegated: true, tee: true, error: "", addSigner: async () => {}, removeAllSigners: async () => {} };
const noop = () => {};

function desk(overrides: Record<string, unknown> = {}) {
  return html(React.createElement(NightWatchPrivyContext.Provider, { value: PRIVY },
    React.createElement(DeskPanel, { api: {}, world: WORLD, me: ME, meError: "", signedIn: true, accountLoading: false, forkPointId: "m1", onForkPoint: noop, latestJob: null, onScheduled: noop, onChanged: noop, ...overrides })));
}

test("the desk's wallet and runner are one status panel, with the Privy badge beside 'Your in-app wallet'", () => {
  const markup = desk();
  const panel = markup.slice(markup.indexOf('<div class="nw-status-panel">'), markup.indexOf('<section class="nw-session"'));
  assert.match(panel, /<div class="nw-wallet-line">[\s\S]*<strong>Your in-app wallet <span class="fn-badge"[^>]*>[\s\S]*<span class="fn-badge-name">Privy<\/span><\/span><\/strong>/);
  assert.match(panel, /<p class="nw-runner">[\s\S]*The Night Watch runner is running on this machine \(last seen/);
  assert.doesNotMatch(markup, /pilot-privy-mark/, "the Privy mark is the shared badge now");
  assert.match(heard(markup), /A top-up is paid from this wallet’s own test USDC on Base Sepolia\. Add at least 1\.00 test USDC to the same address first\./);
  const off = desk({ me: { ...ME, runner: { lastSeen: null, alive: false } } });
  assert.match(off, /<p class="nw-runner nw-runner-off">[\s\S]*The runner is not running on this machine\. Scheduled jobs wait until the operator starts/);
});

test("the consent card leads with its limits as badges, keeps all eight terms below, and names its kind beside the title", () => {
  const markup = desk();
  const card = markup.slice(markup.indexOf('<aside class="nw-card nw-consent"'), markup.indexOf("</aside>"));
  assert.match(card, /<div class="nw-card-head nw-card-head-kind"><h3 id="[^"]+">What this Night Watch may do<\/h3><span class="fn-badge"[^>]*data-kind="feature"[\s\S]*Consent<\/span><\/span><\/div>/);
  assert.doesNotMatch(card, /nw-card-eyebrow/);
  const glance = card.match(/<ul class="fn-badges nw-consent-glance" aria-label="The limits at a glance">([\s\S]*?)<\/ul>/)![1];
  assert.match(heard(glance), /^1\.00 test USDC Base Sepolia Signing stops at .+ 2 candidates$/);
  const terms = [...card.matchAll(/<dt>([^<]*)<\/dt>/g)].map((match) => match[1]);
  assert.deepEqual(terms, ["Purpose", "Limit", "Allowed call", "Only to", "Expires", "Attempts", "Never", "Revoke"]);
});

test("the co-pilot note keeps its sentence, with the model and its router as badges", () => {
  const markup = desk();
  const note = markup.match(/<small id="[^"]*-copilot-note" class="nw-copilot-note">([\s\S]*?)<\/small>/)![1];
  assert.equal(heard(note), "Room co-pilot: Kimi K3 via TokenRouter · operator-paid · suggestions only, you choose");
  assert.deepEqual(names(note), ["Kimi K3", "via TokenRouter"]);
});

test("the session card is a flat tile whose details open with the shared expander", () => {
  const markup = desk();
  assert.match(markup, /<section class="nw-session" data-state="active"/);
  assert.match(markup, /<details class="fn-disclosure nw-technical"><summary class="fn-disclosure-summary">[\s\S]*<span>Session details<\/span><\/summary>/);
  assert.match(markup, /Allowed call<\/dt><dd>One transfer of at most 1\.00 test USDC on <span class="fn-badge"[^>]*>[\s\S]*<span class="fn-badge-name">Base Sepolia<\/span>/);
  const css = strip(read("src/app/night-watch/night-watch.css"));
  const session = css.match(/\.nw-session \{([^}]*)\}/)![1];
  assert.doesNotMatch(session, /gradient|shadow/, "a tile inside a card has a 1px edge and nothing else");
});

const BRAIN: BrainView = {
  state: "planned", message: "Kimi K3 read the room and planned 2 takes.",
  planner: { model: "moonshotai/kimi-k3", label: "Kimi K3", latencyMs: 4210 }, critic: { model: "moonshotai/kimi-k3", label: "Kimi K3", latencyMs: 9600 },
  readOfTheRoom: "The story needs the second light to answer.", pick: 2, morningNote: "B felt truest.",
  candidates: [{ number: 1, caption: "The far light blinks back.", why: "Simplest.", check: { ok: true, note: "Fits." }, plain: false }, { number: 2, caption: "They row toward it.", why: "Moves on.", check: null, plain: false }],
  expenseUsd: "0.004812",
};
function away(state: string, brain: BrainView | null) {
  const job = {
    id: "j1", state, sessionId: SESSION.id, forkPointId: "m1", createdAt: iso(-3_600_000), runAfter: iso(-3_000_000), updatedAt: iso(-600_000), message: "Ready.",
    brief: "Row toward the second lighthouse.", attempts: 2, kit: { id: "midnight-signal", version: "1", digest: "b".repeat(64) }, forkPoint: { id: "m1", title: "The midnight signal", makerLabel: "Wenjie" },
    capacity: { neededCredits: 4, availableAtCheck: 3, charged: 4, refunded: 0 }, payment: SESSION.payments[0],
    receipt: { network: "eip155:84532", transaction: TX, explorerUrl: `https://sepolia.basescan.org/tx/${TX}`, creditsAdded: 5, roomId: "midnight-signal", amountAtomic: "1000000", payer: WALLET },
    expense: { operatorPaidUsd: "0.34", model: "gpt-image-1", images: 2 },
    candidates: [{ number: 1, state: "delivered", caption: "The far light blinks back.", imagePath: "/api/night-watch/jobs/j1/candidates/1", sha256: null, expenseUsd: "0.17", published: false }],
    events: [{ at: iso(-3_000_000), step: "scheduled", detail: "Scheduled" }], publishedMomentId: null, brain,
  };
  return html(React.createElement(AwayPanel, { api: {}, jobs: ME.jobs, jobId: "j1", job, jobError: "", me: ME, forkPoint: WORLD.moments[0], onSelectJob: noop, onRefresh: noop, onPublished: noop }));
}

test("Act 3 names each card's kind in a chip beside its title, and the job's state colours the status chip", () => {
  const markup = away("ready", BRAIN);
  assert.doesNotMatch(markup, /nw-card-eyebrow|nw-brain-eyebrow|nw-agent-card-eyebrow/, "no kicker above any title");
  const kinds = [...markup.matchAll(/<div class="nw-card-head nw-card-head-kind">(?:<span class="nw-brain-pulse"[^>]*><\/span>)?<h3[^>]*>([^<]*)<\/h3><span class="fn-badge"[^>]*>[\s\S]*?<span class="fn-badge-name">([^<]*)<\/span>/g)].map((match) => [match[1], match[2]]);
  assert.deepEqual(kinds, [["Ready for your review", "Night Watch status"], ["Room top-up", "Payment receipt"], ["Image generation", "Expense"], ["What your Night Watch thought", "Room co-pilot"]]);
  assert.match(markup, /<div class="nw-card nw-status-card" data-state="ready">/);
  assert.doesNotMatch(markup, /border-top: 6px/);
  assert.match(markup, /<details class="fn-disclosure nw-log"/);
  // The receipt's transaction is a link badge with the chain's mark, the same words, and a note for a new tab.
  assert.match(markup, /<a class="fn-badge nw-tx"[^>]*href="https:\/\/sepolia\.basescan\.org\/tx\/0xabab[^"]*"[^>]*target="_blank"[\s\S]*Base Sepolia transaction 0xabab…abab[\s\S]*\(opens in a new tab\)/);
  assert.match(markup, /<p class="nw-receipt-amount">1\.00 test USDC<span>on <span class="fn-badge"[^>]*>[\s\S]*Base Sepolia<\/span><\/span><\/span><\/p>/);
});

test("the brain card credits its models and router as badges above a byline that still says how long and how much", () => {
  const planned = html(React.createElement(BrainCard, { brain: BRAIN, titleId: "brain" }));
  assert.match(planned, /<ul class="fn-badges nw-brain-credit" aria-label="Models and provider">/);
  assert.deepEqual(names(planned.match(/<ul class="fn-badges nw-brain-credit"[\s\S]*?<\/ul>/)![0]), ["Kimi K3", "via TokenRouter"], "one model that planned and checked is shown once");
  assert.ok(planned.indexOf("nw-brain-credit") < planned.indexOf("nw-brain-byline"));
  assert.match(heard(planned), /Planned and checked by Kimi K3 in 4\.2 s \+ 9\.6 s · via TokenRouter · operator-paid inference under \$0\.01/);
  const two = html(React.createElement(BrainCard, { brain: { ...BRAIN, critic: { model: "tencent/hy4-preview", label: "Tencent HY4 preview", latencyMs: 18_400 } }, titleId: "brain" }));
  assert.deepEqual(names(two.match(/<ul class="fn-badges nw-brain-credit"[\s\S]*?<\/ul>/)![0]), ["Kimi K3", "Tencent HY4 preview", "via TokenRouter"]);
  // Nothing was asked, so there is nobody to credit.
  const quiet = html(React.createElement(BrainCard, { brain: { ...BRAIN, state: "plain", planner: null, critic: null, expenseUsd: "0.000000", message: "The night used the plain prompts." }, titleId: "brain" }));
  assert.doesNotMatch(quiet, /nw-brain-credit|nw-brain-byline|fn-badges/);
});

test("the agent card names the ERC-8004 standard in its top row and Monad testnet beside its registration, in both states", () => {
  const identity = (registered: boolean) => ({
    registered, chainId: 10143, registry: WALLET, agentId: registered ? "42" : null, owner: null, agentURI: null, transaction: null, explorerUrl: null, note: "",
    card: { name: "Night Watch", description: "A testnet companion.", steward: "Wenjie", service: "http://127.0.0.1:3005/night-watch", kitVersion: "midnight-signal@1", capabilities: [], evidence: [] },
  });
  for (const registered of [true, false]) {
    const markup = html(React.createElement(AgentCard, { identity: identity(registered), titleId: "agent" }));
    assert.match(markup, /<div class="nw-agent-card-title"><h3 id="agent">Night Watch<\/h3><span class="nw-agent-badge">/);
    assert.match(markup, /<ul class="fn-badges nw-agent-card-chips" aria-label="Identity standard">[\s\S]*<span class="fn-badge-name">ERC-8004<\/span><span class="fn-badge-role">calling card<\/span>/);
    assert.match(markup, /<div class="nw-agent-card-statusrow"><p class="nw-agent-card-status"[\s\S]*<\/p><span class="fn-badge"[^>]*data-kind="chain"[\s\S]*<span class="fn-net">Testnet<\/span>/);
    assert.doesNotMatch(markup, /nw-agent-card-eyebrow|ERC-8004 calling card<\/p>/);
  }
  // Before the first read lands the top row is the same, so the card does not jump: no chain mark yet, no image to fetch.
  const empty = html(React.createElement(AgentCard, { identity: null, titleId: "agent" }));
  assert.match(empty, /^<section class="nw-card nw-agent-card"/);
  assert.doesNotMatch(empty, /<img/);
});

test("Act 1's kit says it is the world kit in a chip beside the title, and its details use the shared expander", () => {
  const markup = html(React.createElement(WorldPanel, { world: WORLD, error: "", reading: false, forkPointId: "m1", signedIn: false, onChooseForkPoint: noop, onRetry: noop }));
  assert.match(markup, /<header class="nw-kit-head"><div><div class="nw-card-head nw-card-head-kind"><h3>The Midnight Signal<\/h3><span class="fn-badge"[\s\S]*<span class="fn-badge-name">World kit<\/span>/);
  assert.doesNotMatch(markup, /nw-card-eyebrow/);
  assert.match(markup, /<details class="fn-disclosure nw-technical"><summary class="fn-disclosure-summary">[\s\S]*Kit version 1 · digest aaaaaaaaaaaa…/);
});

test("the stylesheets keep the polish: no kickers, no offset shadows, no blur, no text under 12px, no leaks into the paper menu", () => {
  const files = ["src/app/night-watch/night-watch.css", "src/app/night-watch/brain.css", "src/app/night-watch/agent-card.css", "src/app/night-watch/copilot.css", "src/app/night-watch-privy/privy-demo.css"];
  for (const file of files) {
    const css = strip(read(file));
    assert.doesNotMatch(css, /eyebrow/, `${file}: the kicker rules are gone`);
    assert.doesNotMatch(css, /\d+px \d+px 0 (?:var|#)/, `${file}: no hard offset shadow`);
    assert.doesNotMatch(css, /backdrop-filter/, `${file}: no blur`);
    assert.doesNotMatch(css, /font-size: (?:1[01]|12\.5)px/, `${file}: 12px is the floor`);
    assert.doesNotMatch(css, /border-(?:left|right): [2-9]\d*px/, `${file}: no coloured side rule`);
  }
  const nw = strip(read("src/app/night-watch/night-watch.css"));
  // The dark treatment belongs to the bar. Nothing that recolours buttons may match the paper menu it opens.
  assert.doesNotMatch(nw, /\.fn-header \.text-button/);
  assert.doesNotMatch(nw, /\.nw-account\b(?!-slot)/);
  assert.doesNotMatch(nw, /\.nw-header-identity \.button\.secondary/, "bar buttons are scoped to .pilot-account-entry, menu buttons to .pilot-guest-context");
  assert.match(nw, /\.nw-header-identity \.pilot-guest-context \{[^}]*color-scheme: light;/);
  assert.match(nw, /\.night-watch \.pilot-guest-context :is\(a, button, summary\):focus-visible \{ outline-color: var\(--focus-ring\); \}/);
  assert.doesNotMatch(strip(read("src/app/night-watch-privy/privy-demo.css")), /pilot-privy-mark/, "the Privy mark is no longer a pale pill on paper");
  // The page is night to its edges, and the chrome and content share one gutter.
  assert.match(nw, /html:has\(\.night-watch\) \{[^}]*background: var\(--night\)/);
  assert.match(nw, /\.nw-main \{[^}]*padding: 0 var\(--gutter\)/);
  for (const page of ["src/app/night-watch/page.tsx", "src/app/night-watch-privy/page.tsx"]) {
    assert.match(read(page), /export const viewport: Viewport = \{ themeColor: "#10152f", colorScheme: "dark" \};/);
  }
});
