import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tsImport } from "tsx/esm/api";

// The /agents demo page: Wren's live work, its Tempo testnet allowance and clearly labeled concepts. These tests
// guard the page's claims and its data boundary; the live rows themselves come from the room at runtime.
const { WREN, WREN_ALLOWANCE, WREN_TOP_UPS, txUrl, addressUrl } = await tsImport("../../src/lib/agents/wren.ts", import.meta.url);
const { AgentConcepts } = await tsImport("../../src/components/agents/agent-concepts.tsx", import.meta.url);
const { WrenAllowance } = await tsImport("../../src/components/agents/wren-allowance.tsx", import.meta.url);
const { TurnSteps } = await tsImport("../../src/components/agents/turn-steps.tsx", import.meta.url);
const { loadVerifiedPanel } = await tsImport("../../src/components/agents/verified-panel-image.tsx", import.meta.url);

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const walk = (dir: string): string[] =>
  readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    return statSync(join(ROOT, path)).isDirectory() ? walk(path) : [path];
  });
const PAGE_FILES = ["src/app/agents", "src/components/agents", "src/lib/agents"].flatMap(walk);
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const PUBLIC_TX = new Set([WREN_ALLOWANCE.authorizationTx, ...WREN_TOP_UPS.map((topUp: { txHash: string }) => topUp.txHash)]);

test("the agents page reads through the pilot's guest client only and carries no secrets", () => {
  assert.ok(PAGE_FILES.length >= 10, `expected the page's files, found ${PAGE_FILES.join(", ")}`);
  for (const path of PAGE_FILES) {
    const text = read(path);
    assert.doesNotMatch(text, /SUPABASE_SECRET_KEY|service[_-]?role|createAdminClient|supabase\/server|process\.env\.(?!NEXT_PUBLIC_)/i, path);
    assert.doesNotMatch(text, /\/api\/(?:mpp|x402)\/fund\/[A-Za-z0-9_-]{8,}/, `${path} names a funding reference`);
    for (const hex of text.match(/0x[0-9a-fA-F]{64}/g) ?? [])
      assert.ok(PUBLIC_TX.has(hex), `${path} contains a 32-byte hex value that is not a recorded public transaction: ${hex.slice(0, 10)}…`);
  }
  assert.match(read("src/components/agents/use-wren-room.ts"), /from "@\/lib\/supabase\/pilot-client"/);
});

test("the page makes no claim the testnet proof cannot back", () => {
  for (const path of PAGE_FILES) {
    const text = read(path);
    for (const phrase of [/\baudited\b/i, /patron paid/i, /funded credits/i, /\bmainnet\b/i, /real money/i])
      assert.doesNotMatch(text, phrase, `${path}: ${phrase}`);
  }
  const steps = renderToStaticMarkup(React.createElement(TurnSteps));
  assert.doesNotMatch(steps, /same steps as any guest/i);
  assert.match(steps, new RegExp(`${WREN_ALLOWANCE.topUp.price.replace(".", "\\.")} for ${WREN_ALLOWANCE.topUp.credits} test credits`));
});

test("every concept element carries a visible Concept label and no live-looking numbers", () => {
  const html = renderToStaticMarkup(React.createElement(AgentConcepts));
  assert.match(html, /Concept — not built yet/);
  const segments = (marker: string, end?: string) => {
    const starts = [...html.matchAll(new RegExp(marker, "g"))].map((match) => match.index!);
    return starts.map((start, i) => html.slice(start, end ? html.indexOf(end, start) : starts[i + 1] ?? html.length));
  };
  const blocks = segments('class="ag-concept-block"');
  assert.ok(blocks.length >= 4, `concept blocks: ${blocks.length}`);
  for (const block of blocks) assert.match(block, /class="ag-concept-tag"/, block.slice(0, 120));
  const agents = segments('<article class="ag-future-agent"', "</article>");
  assert.equal(agents.length, 3);
  for (const card of agents) {
    assert.match(card, /class="ag-concept-tag"/);
    assert.match(card, /AI agent/);
  }
  const posts = segments('<article class="ag-mock-post"', "</article>");
  assert.equal(posts.length, 1);
  assert.match(posts[0], /class="ag-concept-tag"/);
  assert.match(html, /Illustrative/i);
});

test("the allowance panel shows Tempo's rules and links every recorded top-up", () => {
  const html = renderToStaticMarkup(React.createElement(WrenAllowance));
  assert.match(html, /transferWithMemo/);
  assert.match(html, /network fees included/);
  assert.match(html, new RegExp(addressUrl(WREN_ALLOWANCE.recipient).replace(/[.?]/g, "\\$&")));
  assert.match(html, new RegExp(txUrl(WREN_ALLOWANCE.authorizationTx).replace(/[.?]/g, "\\$&")));
  assert.ok(WREN_TOP_UPS.length >= 1, "the paid turn's top-up is recorded");
  for (const topUp of WREN_TOP_UPS) {
    assert.ok(html.includes(`href="${txUrl(topUp.txHash)}"`), `missing explorer link for ${topUp.txHash}`);
    if (topUp.momentId) assert.ok(html.includes(`moment=${topUp.momentId}`), `missing scene link for ${topUp.momentId}`);
  }
  assert.doesNotMatch(html, /No top-up yet/);
});

test("Wren's public facts are well formed", () => {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  assert.match(WREN.profileId, uuid);
  assert.equal(WREN.displayName, "Wren (AI agent)");
  assert.equal(WREN.roomId, "night-shift");
  for (const address of [WREN_ALLOWANCE.steward, WREN_ALLOWANCE.accessKey, WREN_ALLOWANCE.recipient]) assert.match(address, /^0x[0-9a-fA-F]{40}$/);
  assert.notEqual(WREN_ALLOWANCE.steward.toLowerCase(), WREN_ALLOWANCE.accessKey.toLowerCase(), "the payer is the steward's account, not the key");
  assert.match(WREN_ALLOWANCE.authorizationTx, /^0x[0-9a-f]{64}$/);
  for (const topUp of WREN_TOP_UPS) {
    assert.match(topUp.txHash, /^0x[0-9a-f]{64}$/);
    assert.equal(topUp.amount, WREN_ALLOWANCE.topUp.price);
    assert.equal(topUp.credits, WREN_ALLOWANCE.topUp.credits);
    assert.equal(topUp.attempts, WREN_ALLOWANCE.topUp.attempts);
    if (topUp.momentId) assert.match(topUp.momentId, uuid);
  }
  assert.equal(txUrl("0xabc"), "https://explore.testnet.tempo.xyz/tx/0xabc");
});

test("a panel image is shown only when its bytes match the hash saved with the scene", async () => {
  const bytes = new TextEncoder().encode("night shift panel bytes");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const blob = new Blob([bytes]);
  const downloads: string[] = [];
  const client = (result: () => { data: Blob | null; error: Error | null }) => ({
    storage: {
      from(bucket: string) {
        assert.equal(bucket, "pilot-media");
        return { async download(path: string) { downloads.push(path); return result(); } };
      },
    },
  });
  const good = client(() => ({ data: blob, error: null }));
  assert.equal(await loadVerifiedPanel(good, "op/1.webp", sha256), blob);
  assert.equal(await loadVerifiedPanel(good, "op/1.webp", sha256), blob);
  assert.deepEqual(downloads, ["op/1.webp"], "a verified panel is cached by path and hash");
  await assert.rejects(loadVerifiedPanel(good, "op/2.webp", "0".repeat(64)), /Hash mismatch/);
  const failing = client(() => ({ data: null, error: new Error("storage down") }));
  await assert.rejects(loadVerifiedPanel(failing, "op/3.webp", sha256), /Image unavailable/);
  assert.equal(await loadVerifiedPanel(good, "op/3.webp", sha256), blob, "a failed download is not cached");
});
