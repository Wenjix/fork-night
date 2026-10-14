import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tsImport } from "tsx/esm/api";
import type { IdentityResponse } from "../../src/night-watch/api-types.ts";

// The Night Watch's ERC-8004 card is drawn as an agent profile, like Wren's on /agents, so the demo can end on
// "the Night Watch is an agent too". These tests pin its claims in both registry states and its stylesheet.
const { AgentCard, AGENT_ROLE } = await tsImport("../../src/components/night-watch/identity-card.tsx", import.meta.url);

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const TX = `0x${"ab".repeat(32)}`;

const identity = (registered: boolean): IdentityResponse => ({
  registered,
  chainId: 10143,
  registry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
  agentId: registered ? "42" : null,
  owner: registered ? "0x4e34c8b71963bB2678938F3f36C964d8A2b41a6C" : null,
  agentURI: registered ? "data:application/json;base64,eyJuYW1lIjoiTmlnaHQgV2F0Y2gifQ==" : null,
  card: {
    name: "Night Watch",
    description: "A testnet companion for The Midnight Signal on Fork Night.",
    steward: "Wenjie",
    service: "http://127.0.0.1:3005/night-watch",
    kitVersion: "midnight-signal@1",
    capabilities: ["prepares private candidates", "pays gas to deliver release claims"],
    evidence: [{ label: "Night Watch top-up on Base Sepolia", url: `https://sepolia.basescan.org/tx/${TX}` }],
  },
  transaction: registered ? TX : null,
  explorerUrl: registered ? `https://testnet.monadexplorer.com/tx/${TX}` : null,
  note: "An identity registration on a draft standard. It does not prove quality, ownership or trust.",
});

const render = (registered: boolean) =>
  renderToStaticMarkup(React.createElement(AgentCard, { identity: identity(registered), titleId: "agent-card" }));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

test("the Night Watch card reads as an AI agent profile with its steward and limits", () => {
  for (const registered of [true, false]) {
    const html = render(registered);
    const words = text(html);
    assert.match(html, /class="nw-card nw-agent-card"/);
    assert.match(html, /<h3 id="agent-card">Night Watch<\/h3>/);
    assert.match(html, /class="nw-agent-badge"[^>]*>.*AI agent<\/span>/s, "the agent badge");
    assert.match(words, new RegExp(AGENT_ROLE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(words, /Steward: Wenjie/);
    assert.match(words, /Publishes Never\. The maker chooses in the morning\./);
    assert.match(words, /Spends Only within a Privy policy the maker authorizes: Base Sepolia test USDC, to one room’s door, capped, expiring and revocable\./);
    assert.match(words, /Delivers shares As a Privy server wallet whose policy allows only claim\(\) on the release contract/);
    assert.match(words, /World kit midnight-signal@1/);
    assert.match(words, /prepares private candidates/);
    assert.match(html, /href="https:\/\/sepolia\.basescan\.org\/tx\/0x(ab){32}"/, "evidence links stay");
    assert.match(words, /draft standard\. It does not prove quality, ownership or trust\./);
    assert.doesNotMatch(words, /real money|mainnet|audited|funded credits|patron paid/i);
  }
});

test("registered and unregistered cards say which they are", () => {
  const registered = text(render(true));
  assert.match(registered, /Registered on Monad testnet as agent #42/);
  assert.match(registered, /Identity ERC-8004 on Monad testnet, agent #42/);
  assert.match(render(true), /href="https:\/\/testnet\.monadexplorer\.com\/tx\/0x(ab){32}"/, "the registration transaction");
  const unregistered = render(false);
  assert.match(text(unregistered), /Not registered yet\./);
  assert.match(text(unregistered), /Identity ERC-8004 on Monad testnet, not registered yet/);
  assert.match(unregistered, /class="nw-agent-card-status" data-pending=""/);
  assert.doesNotMatch(text(unregistered), /agent #/);
});

test("the agent card has its own stylesheet, loaded by the page, with a rule for every class it uses", () => {
  assert.match(read("src/app/night-watch/page.tsx"), /import "\.\/night-watch\.css";\nimport "\.\/agent-card\.css";/);
  const css = read("src/app/night-watch/agent-card.css");
  const source = read("src/components/night-watch/identity-card.tsx");
  const classes = new Set([...source.matchAll(/className="([^"]+)"/g)].flatMap((match) => match[1].split(/\s+/)).filter((name) => name.startsWith("nw-agent")));
  assert.ok(classes.size >= 10, `expected the card's classes, found ${[...classes].join(", ")}`);
  for (const name of classes) assert.match(css, new RegExp(`\\.${name}(?![\\w-])`), `${name} has a rule`);
});
