import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tsImport } from "tsx/esm/api";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ClaimView, ConsentTerms, JobEvent, WorldMoment } from "../../src/night-watch/api-types.ts";
import {
  apiErrorFrom,
  BANNED_PHRASES,
  candidateLetter,
  consentItems,
  consentMismatches,
  consentPreview,
  deskProblems,
  displayImageUrl,
  eventLines,
  expenseText,
  fetchPrivateImage,
  forkPointChoices,
  formatMon,
  formatUnits,
  formatUsd,
  formatUsdc,
  jobTimeline,
  latestNightWatchMoment,
  momentHeadline,
  nightWatchClient,
  nightWatchReturnUrl,
  NightWatchApiError,
  openSessions,
  privateApiPath,
  receiptView,
  recapFileName,
  recapModel,
  safeHref,
  sha256Hex,
  shareRows,
  startsIn,
  storyPath,
  timeLeft,
  type DeskChoices,
  type Job,
} from "../../src/components/night-watch/api.ts";

const NOW = new Date("2026-10-13T22:00:00.000Z");
const WALLET = "0x1111111111111111111111111111111111111111";
const OTHER_WALLET = "0x2222222222222222222222222222222222222222";
const TEST_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const BEARER = "maker-session-for-tests";

const choices = (overrides: Partial<DeskChoices> = {}): DeskChoices => ({
  forkPointId: "moment-3",
  brief: "Mira and the Dokkaebi find a second lighthouse.",
  attempts: 2,
  maxPayments: 1,
  hours: 2,
  startInSeconds: 60,
  ...overrides,
});

const serverTerms = (overrides: Partial<ConsentTerms> = {}): ConsentTerms => ({
  purpose: "Prepare private candidates.",
  roomId: "midnight-signal",
  network: "eip155:84532",
  token: TEST_USDC,
  payTo: "0x4A6DE1347E9b2E466e5EAe6ba18dd63d7080BfdE",
  maxPaymentAtomic: "1000000",
  totalAllowanceAtomic: "1000000",
  maxPayments: 1,
  attemptAllowance: 2,
  deadline: new Date(NOW.getTime() + 2 * 3_600_000 + 4_000).toISOString(),
  revocation: "Revoke on the page.",
  ...overrides,
});

const moment = (id: string, parentId: string | null, overrides: Partial<WorldMoment> = {}): WorldMoment => ({
  id,
  parentId,
  makerId: "maker-a",
  makerLabel: "Ada",
  title: `Moment ${id}`,
  panels: [{ caption: `Caption ${id}`, imageUrl: "/art/midnight-story.webp#frame=0" }],
  createdAt: "2026-10-13T20:00:00.000Z",
  source: "pilot",
  ...overrides,
});

type FakeCall = { url: string; init: RequestInit | undefined };
function fakeFetch(responses: Response[]) {
  const calls: FakeCall[] = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error("No fake response left.");
    return next;
  };
  return { calls, fetcher };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const header = (call: FakeCall, name: string) => new Headers(call.init?.headers).get(name);

test("amounts read as test tokens with the right precision", () => {
  assert.equal(formatUsdc("1000000"), "1.00 test USDC");
  assert.equal(formatUsdc("1500000"), "1.50 test USDC");
  assert.equal(formatUsdc("1"), "0.000001 test USDC");
  assert.equal(formatUsdc(0n), "0.00 test USDC");
  assert.equal(formatMon("500000000000000000"), "0.5 test MON");
  assert.equal(formatMon("1000000000000000000"), "1 test MON");
  assert.equal(formatMon("1"), "< 0.000001 test MON");
  assert.equal(formatMon("0"), "0 test MON");
  assert.equal(formatUnits("not a number", 6, 2, 2), "0.00");
  assert.equal(formatUnits(-2_500_000n, 6, 6, 2), "-2.50");
  assert.equal(formatUsd("0.34"), "≈$0.34");
  assert.equal(formatUsd("nope"), "≈$0.00");
});

test("the consent card names every limit the maker agrees to", () => {
  const preview = consentPreview(choices(), NOW, "The light answers");
  const items = consentItems(preview, (iso) => iso);
  const text = items.map((item) => `${item.label}: ${item.value}`).join("\n");
  // Wren's allowance on /agents uses Limit, Allowed call, Only to and Expires; the two cards must match.
  assert.deepEqual(items.map((item) => item.label), ["Purpose", "Limit", "Allowed call", "Only to", "Expires", "Attempts", "Never", "Revoke"]);
  assert.match(text, /1\.00 test USDC on Base Sepolia/);
  assert.match(text, /Night Watch cannot publish or close an edition/);
  assert.match(text, /The Midnight Signal \(midnight-signal\)/);
  assert.match(text, /Signing stops at 2026-10-14T00:00:00\.000Z/);
  assert.match(text, /Up to 2 private candidates/);
  assert.match(text, /at most 1 room top-up/);
  assert.match(text, /Revoke: Revoke on this page at any time/);
  assert.match(preview.purpose, /“The light answers”/);
  assert.equal(preview.totalAllowanceAtomic, "1000000");

  const unpaid = consentItems(consentPreview(choices({ maxPayments: 0, attempts: 1 }), NOW), (iso) => iso);
  assert.match(unpaid.find((item) => item.label === "Limit")!.value, /0\.00 test USDC: this Night Watch may not buy a top-up/);
  assert.equal(unpaid.find((item) => item.label === "Allowed call")!.value, "None: no payments allowed");
  assert.match(unpaid.find((item) => item.label === "Attempts")!.value, /Up to 1 private candidate;/);
});

test("the signer is added only when the server's terms match what the maker saw", () => {
  const preview = consentPreview(choices(), NOW);
  assert.deepEqual(consentMismatches(preview, serverTerms()), []);
  assert.deepEqual(consentMismatches(preview, serverTerms({ totalAllowanceAtomic: "2000000", maxPayments: 2 })), ["total allowance", "number of top-ups"]);
  assert.deepEqual(consentMismatches(preview, serverTerms({ maxPaymentAtomic: "5000000" })), ["largest single payment"]);
  assert.deepEqual(consentMismatches(preview, serverTerms({ attemptAllowance: 3 })), ["attempts"]);
  assert.deepEqual(consentMismatches(preview, serverTerms({ roomId: "paper-moon" })), ["room"]);
  const late = new Date(Date.parse(preview.deadline) + 10 * 60_000).toISOString();
  assert.deepEqual(consentMismatches(preview, serverTerms({ deadline: late })), ["deadline"]);
  assert.deepEqual(consentMismatches(preview, serverTerms({ deadline: "not a date" })), ["deadline"]);
});

test("the desk refuses incomplete or impossible briefs before anything is created", () => {
  assert.deepEqual(deskProblems(choices()), []);
  assert.deepEqual(deskProblems(choices({ brief: "   " })), ["Write a brief for the Night Watch."]);
  assert.deepEqual(deskProblems(choices({ brief: "x".repeat(501) })), ["Keep the brief within 500 characters."]);
  assert.deepEqual(deskProblems(choices({ forkPointId: "" })), ["Choose a fork point."]);
  assert.deepEqual(deskProblems(choices({ hours: 1, startInSeconds: 3_600 })), ["Start the Night Watch before its allowance ends."]);
  assert.deepEqual(deskProblems(choices({ hours: 13 })), ["Authorize between 1 and 12 hours."]);
});

test("open sessions are the ones that still hold a signer", () => {
  const base = {
    roomId: "midnight-signal", walletAddress: WALLET, deadline: NOW.toISOString(),
    limits: { maxPaymentAtomic: "1", totalAllowanceAtomic: "1", maxPayments: 1, attemptAllowance: 1, payTo: WALLET, token: TEST_USDC, chainId: 84532 },
    remainingAtomic: "1", payments: [], revokedAt: null,
  };
  const sessions = [
    { ...base, id: "a", state: "active" as const },
    { ...base, id: "b", state: "awaiting_signer" as const },
    { ...base, id: "c", state: "revoked" as const },
    { ...base, id: "d", state: "expired" as const },
  ];
  assert.deepEqual(openSessions(sessions).map((session) => session.id), ["a", "b"]);
});

const event = (step: string, at = "2026-10-13T22:01:00.000Z"): JobEvent => ({ at, step, detail: `${step} detail` });
const statuses = (job: Pick<Job, "state" | "events" | "payment">) => Object.fromEntries(jobTimeline(job).map((step) => [step.state, step.status]));

test("the job timeline marks payment steps as skipped when no top-up was needed", () => {
  assert.deepEqual(statuses({ state: "generating", events: [event("checking")], payment: null }), {
    scheduled: "done", checking: "done", topping_up: "skipped", waiting_payment: "skipped", generating: "current", ready: "upcoming", published: "upcoming",
  });
  assert.deepEqual(statuses({ state: "checking", events: [], payment: null }), {
    scheduled: "done", checking: "current", topping_up: "upcoming", waiting_payment: "upcoming", generating: "upcoming", ready: "upcoming", published: "upcoming",
  });
  const payment = { id: "p", jobId: "j", amountAtomic: "1000000", state: "settled" as const, transaction: "0xabc", explorerUrl: null, creditsAdded: 5, updatedAt: NOW.toISOString() };
  assert.deepEqual(statuses({ state: "ready", events: [event("topping_up"), event("generating")], payment }), {
    scheduled: "done", checking: "done", topping_up: "done", waiting_payment: "done", generating: "done", ready: "current", published: "upcoming",
  });
  assert.deepEqual(statuses({ state: "published", events: [], payment: null }), {
    scheduled: "done", checking: "done", topping_up: "skipped", waiting_payment: "skipped", generating: "done", ready: "done", published: "done",
  });
});

test("a stopped job marks the step it stopped at", () => {
  assert.deepEqual(statuses({ state: "blocked", events: [event("scheduled"), event("checking"), event("blocked")], payment: null }), {
    scheduled: "done", checking: "stopped", topping_up: "upcoming", waiting_payment: "upcoming", generating: "upcoming", ready: "upcoming", published: "upcoming",
  });
  assert.deepEqual(statuses({ state: "blocked", events: [event("checking"), event("topping_up"), event("blocked")], payment: null }), {
    scheduled: "done", checking: "done", topping_up: "stopped", waiting_payment: "upcoming", generating: "upcoming", ready: "upcoming", published: "upcoming",
  });
  assert.equal(statuses({ state: "failed", events: [], payment: null }).scheduled, "stopped");
});

test("events read in time order with readable step names", () => {
  const lines = eventLines([event("generating", "2026-10-13T22:05:00.000Z"), event("checking", "2026-10-13T22:01:00.000Z"), event("custom_step", "2026-10-13T22:03:00.000Z")]);
  assert.deepEqual(lines.map((line) => line.title), ["Checking room credits", "custom step", "Preparing private candidates"]);
});

test("receipts and expenses use testnet wording", () => {
  const mixedCase = `0x${WALLET.slice(2).toUpperCase()}`;
  const receipt = receiptView({ network: "eip155:84532", transaction: "0xfeed", explorerUrl: "https://sepolia.basescan.org/tx/0xfeed", creditsAdded: 5, roomId: "midnight-signal", amountAtomic: "1000000", payer: mixedCase }, WALLET);
  assert.equal(receipt.amount, "1.00 test USDC");
  assert.equal(receipt.credits, "+5 test credits to The Midnight Signal");
  assert.equal(receipt.payerIsYou, true);
  assert.equal(receipt.payer, "your in-app wallet (0x1111…1111)");
  assert.equal(receipt.signedBy, "Signed by your Night Watch signer within your allowance.");
  assert.equal(receipt.network, "Base Sepolia");
  assert.equal(receiptView({ network: "eip155:84532", transaction: null, explorerUrl: null, creditsAdded: null, roomId: "midnight-signal", amountAtomic: null, payer: OTHER_WALLET }, WALLET).payerIsYou, false);
  assert.equal(expenseText({ operatorPaidUsd: "0.3400", model: "gpt-image-1", images: 2 }), "Operator-paid inference: 2 images, ≈$0.34 (gpt-image-1).");
  assert.equal(expenseText({ operatorPaidUsd: "0", model: "", images: 0 }), "No images prepared yet, so no image inference expense.");
});

test("story paths walk from the root to the tip and survive gaps and loops", () => {
  const moments = [moment("root", null), moment("a", "root"), moment("b", "a"), moment("x", "missing"), moment("loop1", "loop2"), moment("loop2", "loop1")];
  assert.deepEqual(storyPath(moments, "b").map((item) => item.id), ["root", "a", "b"]);
  assert.deepEqual(storyPath(moments, "x").map((item) => item.id), ["x"]);
  assert.deepEqual(storyPath(moments, "loop1").map((item) => item.id), ["loop2", "loop1"]);
  assert.deepEqual(storyPath(moments, null), []);
  const choicesList = forkPointChoices({
    moments: [...moments.slice(0, 3), moment("side", "root", { createdAt: "2026-10-13T21:00:00.000Z" }), moment("older", "root", { createdAt: "2026-10-12T21:00:00.000Z" })],
    defaultForkPointId: "b",
  });
  assert.deepEqual(choicesList.map((item) => item.id), ["b", "a", "root", "side", "older"]);
});

test("the edition opens at the maker's newest Night Watch moment", () => {
  const moments = [
    moment("pilot", null),
    moment("nw-old", "pilot", { source: "night-watch", makerId: "me", createdAt: "2026-10-13T01:00:00.000Z" }),
    moment("nw-new", "pilot", { source: "night-watch", makerId: "me", createdAt: "2026-10-13T05:00:00.000Z" }),
    moment("nw-other", "pilot", { source: "night-watch", makerId: "someone", createdAt: "2026-10-13T09:00:00.000Z" }),
  ];
  assert.equal(latestNightWatchMoment(moments, "me")?.id, "nw-new");
  assert.equal(latestNightWatchMoment(moments, "nobody"), null);
});

test("share rows pair each frozen recipient with its latest helper claim", () => {
  const claim = (beneficiary: string, state: ClaimView["state"], updatedAt: string): ClaimView => ({
    releaseId: "0xAB", beneficiary, state, hash: `0x${state}`, amountWei: "5", claimedWei: state === "finalized" ? "5" : null, explorerUrl: "https://testnet.monadscan.com/tx/0x1", updatedAt,
  });
  const rows = shareRows({
    release: {
      id: "0xab", projectId: "0x1", tipId: "0x2", manifestHash: "0x3", receivedWei: "10", paidWei: "5", exists: true, finalizedBlock: 7,
      beneficiaries: [{ address: WALLET, claimableWei: "0", claimedWei: "5" }, { address: OTHER_WALLET, claimableWei: "5", claimedWei: "0" }],
    },
    claims: [claim(`0x${WALLET.slice(2).toUpperCase()}`, "broadcast", "2026-10-13T22:00:00.000Z"), claim(WALLET, "finalized", "2026-10-13T22:05:00.000Z")],
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].claim?.state, "finalized");
  assert.equal(rows[1].claim, null);
  assert.deepEqual(shareRows({ release: null, claims: [] }), []);
});

test("only same-origin Night Watch paths may receive the bearer token", () => {
  assert.equal(privateApiPath("/api/night-watch/jobs/nwj_1/candidates/1"), "/api/night-watch/jobs/nwj_1/candidates/1");
  for (const path of ["https://evil.example/api/night-watch/x", "//evil.example/api/night-watch/x", "/api/night-watch/../pilot/x", "/api/pilot/generate", "/api/night-watch//x", "/api/night-watch/x#frag", "", null]) {
    assert.equal(privateApiPath(path as string | null), null, String(path));
  }
});

test("private candidates are fetched with the bearer token and never sent elsewhere", async () => {
  let asked = 0;
  const bearer = async () => {
    asked++;
    return BEARER;
  };
  const refused = fakeFetch([]);
  await assert.rejects(fetchPrivateImage("https://evil.example/x.png", bearer, { fetcher: refused.fetcher }), (error: unknown) => error instanceof NightWatchApiError && error.code === "invalid_path");
  assert.equal(refused.calls.length, 0);
  assert.equal(asked, 0);

  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  const ok = fakeFetch([new Response(png, { status: 200, headers: { "Content-Type": "image/png" } })]);
  const blob = await fetchPrivateImage("/api/night-watch/jobs/nwj_1/candidates/2", bearer, { fetcher: ok.fetcher });
  assert.equal(blob.type, "image/png");
  assert.equal(header(ok.calls[0], "authorization"), `Bearer ${BEARER}`);
  assert.equal(ok.calls[0].init?.cache, "no-store");

  const notImage = fakeFetch([new Response("<html>", { status: 200, headers: { "Content-Type": "text/html" } })]);
  await assert.rejects(fetchPrivateImage("/api/night-watch/jobs/nwj_1/candidates/2", bearer, { fetcher: notImage.fetcher }), /did not come back as an image/);
  const gone = fakeFetch([json({ error: "Not found." }, 404)]);
  await assert.rejects(fetchPrivateImage("/api/night-watch/jobs/nwj_1/candidates/2", bearer, { fetcher: gone.fetcher }), (error: unknown) => error instanceof NightWatchApiError && error.code === "unavailable");
});

test("the client sends the bearer token only to maker routes and maps errors", async () => {
  const { calls, fetcher } = fakeFetch([
    json({ ok: "world" }),
    json({ ok: "me" }),
    json({ ok: "session" }),
    json({ error: "That payment is larger than the maker allowed.", code: "over_single_limit" }, 409),
    json({ error: "Not found." }, 404),
    new Response("", { status: 200 }),
  ]);
  const client = nightWatchClient(async () => BEARER, fetcher);
  assert.deepEqual(await client.world(), { ok: "world" });
  assert.equal(calls[0].url, "/api/night-watch/world");
  assert.equal(header(calls[0], "authorization"), null);
  assert.deepEqual(await client.me(), { ok: "me" });
  assert.equal(header(calls[1], "authorization"), `Bearer ${BEARER}`);
  await client.createSession({ hours: 2, maxPayments: 1, attemptAllowance: 2 });
  assert.equal(calls[2].url, "/api/night-watch/sessions");
  assert.equal(calls[2].init?.method, "POST");
  assert.equal(header(calls[2], "content-type"), "application/json");
  assert.deepEqual(JSON.parse(String(calls[2].init?.body)), { hours: 2, maxPayments: 1, attemptAllowance: 2 });
  await assert.rejects(client.revokeSession("nws_1/../x"), (error: unknown) =>
    error instanceof NightWatchApiError && error.status === 409 && error.code === "over_single_limit" && error.message === "That payment is larger than the maker allowed.");
  assert.equal(calls[3].url, "/api/night-watch/sessions/nws_1%2F..%2Fx/revoke");
  await assert.rejects(client.identity(), (error: unknown) => error instanceof NightWatchApiError && error.code === "unavailable");
  await assert.rejects(client.job("nwj_1"), (error: unknown) => error instanceof NightWatchApiError && error.code === "invalid_reply");

  const viewer = fakeFetch([json({ ok: "viewer world" })]);
  await nightWatchClient(async () => BEARER, viewer.fetcher).viewerWorld();
  assert.equal(viewer.calls[0].url, "/api/night-watch/world");
  assert.equal(header(viewer.calls[0], "authorization"), `Bearer ${BEARER}`);

  const signedOut = fakeFetch([]);
  await assert.rejects(nightWatchClient(async () => null, signedOut.fetcher).me(), (error: unknown) => error instanceof NightWatchApiError && error.status === 401);
  assert.equal(signedOut.calls.length, 0);
  const edition = fakeFetch([json({ tipId: "t" })]);
  await nightWatchClient(async () => BEARER, edition.fetcher).edition("a b&c");
  assert.equal(edition.calls[0].url, "/api/night-watch/edition?tip=a%20b%26c");
});

test("error replies keep the server's message and explain the local-only gate", () => {
  assert.equal(apiErrorFrom(401, null).message, "Sign in with Google on this machine first.");
  assert.equal(apiErrorFrom(404, { error: "Not found." }).code, "unavailable");
  assert.equal(apiErrorFrom(404, { error: "That job does not exist.", code: "missing_job" }).message, "That job does not exist.");
  assert.equal(apiErrorFrom(500, "oops").message, "The Night Watch answered with status 500.");
});

test("links and images are limited to same-origin paths and web URLs", () => {
  assert.equal(safeHref("https://testnet.monadscan.com/tx/0x1"), "https://testnet.monadscan.com/tx/0x1");
  assert.equal(safeHref("http://127.0.0.1:3005/night-watch"), "http://127.0.0.1:3005/night-watch");
  assert.equal(safeHref("/night-watch"), "/night-watch");
  for (const bad of ["javascript:alert(1)", "data:text/html,hi", "//evil.example", "", null]) assert.equal(safeHref(bad as string | null), null);
  assert.equal(displayImageUrl("/api/night-watch/moments/m/image"), "/api/night-watch/moments/m/image");
  assert.equal(displayImageUrl("https://project.supabase.co/storage/v1/object/sign/x"), "https://project.supabase.co/storage/v1/object/sign/x");
  for (const bad of ["http://example.com/x.png", "data:image/png;base64,AAAA", "javascript:alert(1)", "//evil.example/x.png"]) assert.equal(displayImageUrl(bad), null);
});

test("a moment's caption is shown once when its title repeats it", () => {
  assert.deepEqual(momentHeadline("Mira unfolds the note.", "Mira unfolds the note."), { heading: "Mira unfolds the note.", body: "" });
  assert.deepEqual(momentHeadline("The Dokkaebi leaps off of the paper boat, does an acrobatic flourish, lands on h", "The Dokkaebi leaps off of the paper boat, does an acrobatic flourish, lands on his feet."),
    { heading: "The Dokkaebi leaps off of the paper boat, does an acrobatic flourish, lands on his feet.", body: "" });
  assert.deepEqual(momentHeadline("The midnight signal", "At midnight, the lighthouse blinked."), { heading: "The midnight signal", body: "At midnight, the lighthouse blinked." });
  assert.deepEqual(momentHeadline("A short title…", "A short title that keeps going."), { heading: "A short title that keeps going.", body: "" });
  assert.deepEqual(momentHeadline("Only a title", null), { heading: "Only a title", body: "" });
});

test("sign-in returns to the Night Watch page", () => {
  assert.equal(nightWatchReturnUrl("http://127.0.0.1:3005/night-watch?code=abc#world"), "http://127.0.0.1:3005/night-watch");
  assert.equal(nightWatchReturnUrl("http://127.0.0.1:3005/night-watch-privy?code=abc#desk"), "http://127.0.0.1:3005/night-watch-privy");
  assert.equal(nightWatchReturnUrl("http://localhost:3005/pilot?room=midnight-signal"), "http://localhost:3005/night-watch");
});

test("small readable helpers", async () => {
  assert.deepEqual([1, 2, 3, 27].map(candidateLetter), ["A", "B", "C", "27"]);
  assert.equal(timeLeft("2026-10-14T00:00:00.000Z", NOW), "2 h left");
  assert.equal(timeLeft("2026-10-13T23:59:00.000Z", NOW), "1 h 59 min left");
  assert.equal(timeLeft("2026-10-13T22:04:00.000Z", NOW), "4 min left");
  assert.equal(timeLeft("2026-10-13T21:00:00.000Z", NOW), "Ended");
  assert.equal(startsIn("2026-10-13T22:00:45.000Z", NOW), "in 45 s");
  assert.equal(startsIn("2026-10-13T22:05:00.000Z", NOW), "in 5 min");
  assert.equal(startsIn("2026-10-13T21:59:00.000Z", NOW), "now");
  assert.equal(await sha256Hex(new TextEncoder().encode("abc").buffer as ArrayBuffer), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(recapFileName("The Light Answers!"), "night-watch-the-light-answers.png");
  assert.equal(recapFileName("???"), "night-watch-edition.png");
});

test("the recap card links the edition, makers and receipts in testnet wording", () => {
  const finalized: ClaimView = { releaseId: "0xab", beneficiary: WALLET, state: "finalized", hash: "0x1", amountWei: "5", claimedWei: "5", explorerUrl: "", updatedAt: NOW.toISOString() };
  const model = recapModel({
    worldTitle: "The Midnight Signal",
    kitVersion: "1",
    momentTitle: "The second lighthouse",
    makerName: "Wenjie",
    pathMakers: ["Ada", "Burkes", "Ada", "Wenjie"],
    candidate: 2,
    receipt: { amountAtomic: "1000000", creditsAdded: 5, transaction: `0x47f2ac96${"a".repeat(52)}d14d` },
    release: { id: `0x36ed82e6${"b".repeat(52)}2b2f`, exists: true, receivedWei: "1000000000000000000" },
    claims: [finalized, { ...finalized, state: "broadcast" }],
    expense: { operatorPaidUsd: "0.34", images: 2 },
    date: "Oct 13",
  });
  const text = [model.eyebrow, model.title, model.byline, ...model.lines, model.footer].join("\n");
  assert.equal(model.title, "The second lighthouse");
  assert.equal(model.byline, "by Wenjie · Oct 13");
  assert.match(text, /World: The Midnight Signal · kit v1/);
  assert.match(text, /Made together by Ada, Burkes, Wenjie/);
  assert.match(text, /candidate B; the maker chose to publish it/);
  assert.match(text, /Room top-up: 1\.00 test USDC on Base Sepolia · \+5 test credits · 0x47f2…d14d/);
  assert.match(text, /Operator-paid inference: 2 images, ≈\$0\.34/);
  assert.match(text, /Release 0x36ed…2b2f on Monad testnet · 1 test MON support received/);
  assert.match(text, /Shares delivered and settled: 1/);
  assert.match(model.footer, /Testnet only/);
  const quiet = recapModel({ worldTitle: "W", kitVersion: "1", momentTitle: "M", makerName: "N", pathMakers: [], candidate: null, receipt: null, release: null, claims: [], expense: null, date: "d" });
  assert.deepEqual(quiet.lines, ["World: W · kit v1", "Published by the maker after a Night Watch", "Room top-up: none needed", "Release: not frozen yet"]);
});

test("Night Watch page files keep to the testnet wording rules", async () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const components = join(root, "src/components/night-watch");
  const files = [
    ...(await readdir(components)).map((name) => join(components, name)),
    join(root, "src/app/night-watch/page.tsx"),
    join(root, "src/app/night-watch/night-watch.css"),
  ];
  const sources = new Map<string, string>();
  for (const file of files) sources.set(file, await readFile(file, "utf8"));
  const offenders: string[] = [];
  for (const [file, source] of sources) {
    const text = source.split("\n").filter((line) => !line.includes("BANNED_PHRASES =")).join("\n").toLowerCase();
    for (const phrase of BANNED_PHRASES) if (text.includes(phrase)) offenders.push(`${file}: ${phrase}`);
  }
  assert.deepEqual(offenders, []);
  const all = [...sources.values()].join("\n");
  assert.match(all, /Night Watch never publishes and never closes an edition/);
  assert.match(all, /operator-paid inference/i);
  assert.match(all, /it does not prove quality, ownership or trust/);
  assert.match(all, /Sign in with Google on this machine/);
  assert.match(all, /Night Watch is scheduled\. You can close this tab\./);
});

test("the timeline reads the runner's own event names", () => {
  // Blocked at the credit check (the runner writes started/checked, not state names).
  assert.deepEqual(statuses({ state: "blocked", events: [event("scheduled"), event("started"), event("checked")], payment: null }), {
    scheduled: "done", checking: "stopped", topping_up: "upcoming", waiting_payment: "upcoming", generating: "upcoming", ready: "upcoming", published: "upcoming",
  });
  // Failed while preparing candidates.
  assert.equal(statuses({ state: "failed", events: [event("scheduled"), event("checked"), event("prepared"), event("candidate_failed")], payment: null }).generating, "stopped");
  // After a credited top-up the runner re-checks credits; the top-up stays done.
  const settled = { id: "p", jobId: "j", amountAtomic: "1000000", state: "settled" as const, transaction: "0xabc", explorerUrl: null, creditsAdded: 5, updatedAt: NOW.toISOString() };
  const rechecking = statuses({ state: "checking", events: [event("scheduled"), event("started"), event("checked"), event("topped_up")], payment: settled });
  assert.equal(rechecking.topping_up, "done");
  assert.equal(rechecking.checking, "current");
  // A released (refused) payment is not shown as paid.
  const released = { ...settled, state: "released" as const, transaction: null, creditsAdded: null };
  assert.equal(statuses({ state: "ready", events: [event("checked"), event("prepared"), event("ready")], payment: released }).topping_up, "skipped");
  assert.deepEqual(eventLines([event("topped_up"), event("prepared", "2026-10-13T22:02:00.000Z")]).map((line) => line.title), ["Bought one room top-up", "Prepared a private candidate"]);
});

test("the agents page and the Night Watch link to each other as one idea", async () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const source = (path: string) => readFile(join(root, path), "utf8");
  const app = await source("src/components/night-watch/night-watch-app.tsx");
  assert.match(app, /href="\/agents"/, "the Night Watch links back to Wren");
  const { AgentRoomHeader } = await tsImport("../../src/components/agents/agent-room-header.tsx", import.meta.url);
  for (const [current, href] of [["agents", "/agents"], ["night-watch", "/night-watch"], ["privy", "/night-watch-privy"]]) {
    const html = renderToStaticMarkup(createElement(AgentRoomHeader, { current }));
    const nav = html.match(/<nav[^>]+aria-label="Agent spaces"[^>]*>([\s\S]*?)<\/nav>/)![1];
    const activeLinks = nav.match(/<a[^>]+aria-current="page"[^>]*>/g) ?? [];
    assert.equal(activeLinks.length, 1, "exactly one destination is current");
    assert.ok(activeLinks[0].includes(`href="${href}"`), "the shared nav marks the current room");
  }
  assert.match(await source("src/components/agents/agents-showcase.tsx"), /href="\/night-watch"/, "the agents nav names the Night Watch");
  const concepts = await source("src/components/agents/agent-concepts.tsx");
  assert.match(concepts, /href="\/night-watch"/, "the steward-controls concept points at what was built");
  assert.match(concepts, /never\s+publishes/, "the bridge keeps the Night Watch's promise");
});
