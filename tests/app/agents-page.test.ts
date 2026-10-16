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
const { WREN, WREN_ALLOWANCE, WREN_TOP_UPS, allowanceExpired, txUrl, addressUrl } = await tsImport("../../src/lib/agents/wren.ts", import.meta.url);
const { AgentConcepts } = await tsImport("../../src/components/agents/agent-concepts.tsx", import.meta.url);
const { WrenAllowance } = await tsImport("../../src/components/agents/wren-allowance.tsx", import.meta.url);
const { TurnSteps } = await tsImport("../../src/components/agents/turn-steps.tsx", import.meta.url);
const { WrenProfile } = await tsImport("../../src/components/agents/wren-profile.tsx", import.meta.url);
const { loadVerifiedPanel, loadVerifiedPanelWithRetry, PANEL_RETRIES, PANEL_RETRY_MS } = await tsImport("../../src/components/agents/verified-panel-image.tsx", import.meta.url);

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

test("a panel whose download fails is tried again a few times, 15 s apart, and a hash mismatch is final", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const until = async (done: () => boolean) => {
    for (let i = 0; i < 2000 && !done(); i++) await new Promise((resolve) => setImmediate(resolve));
  };
  const bytes = new TextEncoder().encode("night shift retry bytes");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  // A storage client whose first `failures` downloads fail, then succeed with `served`.
  const flaky = (failures: number, served = bytes) => {
    const seen = { downloads: 0, loaded: 0, failed: 0 };
    const client = { storage: { from: () => ({ async download() {
      seen.downloads++;
      return seen.downloads <= failures ? { data: null, error: new Error("offline") } : { data: new Blob([served]), error: null };
    } }) } };
    const watch = (path: string) => loadVerifiedPanelWithRetry(client, path, sha256, () => seen.loaded++, () => seen.failed++);
    return { seen, watch };
  };
  assert.equal(PANEL_RETRY_MS, 15_000);

  const twice = flaky(2);
  const stopTwice = twice.watch("op/retry-1.webp");
  await until(() => twice.seen.failed === 1);
  t.mock.timers.tick(PANEL_RETRY_MS - 1);
  await until(() => false);
  assert.deepEqual(twice.seen, { downloads: 1, loaded: 0, failed: 1 }, "no retry before 15 s");
  t.mock.timers.tick(1);
  await until(() => twice.seen.failed === 2);
  t.mock.timers.tick(PANEL_RETRY_MS);
  await until(() => twice.seen.loaded === 1);
  assert.deepEqual(twice.seen, { downloads: 3, loaded: 1, failed: 2 }, "the third download succeeds");
  t.mock.timers.tick(10 * PANEL_RETRY_MS);
  await until(() => false);
  assert.equal(twice.seen.downloads, 3, "a shown image is not downloaded again");
  stopTwice();

  const down = flaky(Infinity);
  down.watch("op/retry-2.webp");
  for (let tries = 1; tries <= PANEL_RETRIES; tries++) {
    await until(() => down.seen.failed === tries);
    t.mock.timers.tick(PANEL_RETRY_MS);
  }
  await until(() => down.seen.failed === PANEL_RETRIES + 1);
  t.mock.timers.tick(10 * PANEL_RETRY_MS);
  await until(() => false);
  assert.deepEqual(down.seen, { downloads: PANEL_RETRIES + 1, loaded: 0, failed: PANEL_RETRIES + 1 }, "retries are bounded");

  const tampered = flaky(0, new TextEncoder().encode("other bytes"));
  tampered.watch("op/retry-3.webp");
  await until(() => tampered.seen.failed === 1);
  t.mock.timers.tick(10 * PANEL_RETRY_MS);
  await until(() => false);
  assert.deepEqual(tampered.seen, { downloads: 1, loaded: 0, failed: 1 }, "a hash mismatch is never retried");

  const unmounted = flaky(1);
  const stop = unmounted.watch("op/retry-4.webp");
  await until(() => unmounted.seen.failed === 1);
  stop();
  t.mock.timers.tick(10 * PANEL_RETRY_MS);
  await until(() => false);
  assert.deepEqual(unmounted.seen, { downloads: 1, loaded: 0, failed: 1 }, "stopping cancels the waiting retry");
});

test("after its expiry Wren's allowance reads in the past tense and keeps every fact", () => {
  const expiry = Date.parse(WREN_ALLOWANCE.expiresAtIso);
  assert.equal(new Date(expiry).toISOString(), "2026-10-13T23:24:42.000Z", "the access key's on-chain expiry");
  const pacific = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles", timeZoneName: "short" });
  assert.equal(pacific.format(expiry).replace(/\s/g, " "), WREN_ALLOWANCE.expiresAt, "the display string names the same moment");
  assert.equal(allowanceExpired(expiry - 1000), false);
  assert.equal(allowanceExpired(expiry), true);
  // Before mount (the server HTML) both sections already read as expired, so they never claim a key that can pay.
  const allowance = renderToStaticMarkup(React.createElement(WrenAllowance));
  const steps = renderToStaticMarkup(React.createElement(TurnSteps));
  for (const html of [allowance, steps]) {
    assert.doesNotMatch(html, /Wren can top the room up|Wren buys one top-up|Tops up the room first/);
  }
  assert.ok(steps.includes(`expired on ${WREN_ALLOWANCE.expiresAt}`), "the turn steps name when it expired");
  assert.match(allowance, /Wren paid for more room on Tempo, by itself/);
  assert.match(allowance, /Machine Payments Protocol \(MPP\) · Tempo Moderato testnet/);
  assert.match(allowance, /<small>Recorded Oct 12 · allowance has since expired<\/small>/);
  assert.match(allowance, new RegExp(WREN_ALLOWANCE.expiresAt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(steps, /Topped up the room first/);
  for (const fact of [WREN_ALLOWANCE.limit, WREN_ALLOWANCE.limitNote, WREN_ALLOWANCE.allowedCall, WREN_ALLOWANCE.topUp.price, `${WREN_ALLOWANCE.topUp.credits} test credits`, `${WREN_ALLOWANCE.topUp.attempts} guest attempts`])
    assert.ok(allowance.includes(fact), `the allowance keeps: ${fact}`);
  // The concept note and the footer describe the allowance in the past tense too.
  assert.match(renderToStaticMarkup(React.createElement(AgentConcepts)), /Wren’s test pathUSD only ever topped up room credits and guest attempts\./);
  const footer = read("src/components/agents/agents-showcase.tsx").replace(/\s+/g, " ");
  assert.match(footer, /Wren’s allowance spent test pathUSD from its steward’s Tempo Moderato testnet account until it expired on Oct 13, 2026\. Test pathUSD has no cash value\./);
});

test("Wren's card and the mock steward controls are named groups, not landmarks", () => {
  const profile = renderToStaticMarkup(React.createElement(WrenProfile, { room: { status: "loading" } }));
  assert.match(profile, /<div class="ag-id-card" role="group" aria-label="Wren’s agent card">/);
  assert.doesNotMatch(profile, /<aside/, "an aside inside the labelled section would be a nested complementary landmark");
  const concepts = renderToStaticMarkup(React.createElement(AgentConcepts));
  assert.match(concepts, /<div class="ag-mock-controls" role="group" aria-label="Steward controls \(concept, disabled\)">/);
});
