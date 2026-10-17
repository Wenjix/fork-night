import assert from "node:assert/strict";
import test from "node:test";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tsImport } from "tsx/esm/api";
import { getRecordedGuildFunding } from "../../src/lib/guild-funding.ts";
import type { PilotCredits } from "../../src/lib/pilot-generation.ts";

const { GuildFundingHallEntry, GuildFundingHistory, PilotRoomFunding } = await tsImport("../../src/components/guild-funding.tsx", import.meta.url);
const { PilotRoomActivity } = await tsImport("../../src/components/pilot-generation-status.tsx", import.meta.url);
const record = getRecordedGuildFunding("paper-moon")!;
const history = () => renderToStaticMarkup(createElement(GuildFundingHistory, { record, onClose: () => {} }));

test("a room loading or switching cannot show another room's recorded treasury", () => {
  for (const [roomId, loadedRoom] of [["paper-moon", ""], ["midnight-signal", "paper-moon"], ["paper-moon", "midnight-signal"], ["", ""]])
    assert.equal(renderToStaticMarkup(createElement(PilotRoomFunding, { roomId, loadedRoom })), "");
  const moon = renderToStaticMarkup(createElement(PilotRoomFunding, { roomId: "paper-moon", loadedRoom: "paper-moon", creditsAvailable: 30 }));
  assert.match(moon, /Funded by a 3-person guild · added 5 credits · 30 room credits left · <strong>See how →<\/strong>/);
  assert.match(renderToStaticMarkup(createElement(PilotRoomFunding, { roomId: "paper-moon", loadedRoom: "paper-moon" })), /Funded by a 3-person guild · added 5 credits · <strong>See how →<\/strong>/);
  assert.match(moon, /<details class="guild-funding-drawer"/);
  assert.match(moon, /Guild funding rehearsal/);
  assert.match(moon, /2 of 3 guild members approved/);
  assert.match(moon, /Recorded addition: \+5 room credits/);
  assert.match(moon, /Solana devnet.*test run by the founder/);
  assert.doesNotMatch(moon, /<dialog|5 credits available/);
  const monad = renderToStaticMarkup(createElement(PilotRoomFunding, { roomId: "midnight-signal", loadedRoom: "midnight-signal" }));
  assert.match(monad, /This story paid its makers on Monad: 1 MON split across 4 wallets, all claimed/);
  assert.match(monad, /View on MonadScan ↗/);
  assert.doesNotMatch(monad, /Guild funding rehearsal|Squads/);
  assert.equal(renderToStaticMarkup(createElement(PilotRoomFunding, { roomId: "unassigned", loadedRoom: "unassigned" })), "");
});

test("Squads stays first and the branded Solana and Base funding rows remain visible together", () => {
  const html = renderToStaticMarkup(createElement(PilotRoomFunding, { roomId: "paper-moon", loadedRoom: "paper-moon", creditsAvailable: 30 }));
  assert.match(html, /<section class="guild-funding-other" aria-label="Other recorded funding">/);
  assert.doesNotMatch(html, /<details class="guild-funding-other"/);
  assert.match(html, /2YHSYXPTzJUMmaoV2MHKHxzW5Lwx44zvhgaKnrQWq9F5vAHcdA6fhvBVjifVmP7B9fzWktG4k9eqLDJztTQ1BfSJ/);
  assert.match(html, /0xd5e58832014d09ae1bad68daec8ad9377287fd9e349b0d59fab38766a1fd4d2d/);
  assert.match(html, /Base.*Sepolia/);
  assert.ok(html.indexOf("Squads v4") < html.indexOf("View Solana receipt"));
  assert.ok(html.indexOf("View Solana receipt") < html.indexOf("View Base receipt"));
  assert.equal((html.match(/src="\/brands\/networks\/solana.svg"/g) ?? []).length, 2);
  assert.equal((html.match(/src="\/brands\/networks\/base.svg"/g) ?? []).length, 1);
  assert.equal((html.match(/src="\/brands\/networks\/usdc.svg" width="32" height="32"/g) ?? []).length, 3);
  assert.equal((html.match(/\bfn-network-card\b/g) ?? []).length, 1);
});

test("funding history opens from a primary button with explicit dialog semantics", () => {
  const html = renderToStaticMarkup(createElement(PilotRoomFunding, { roomId: "paper-moon", loadedRoom: "paper-moon", creditsAvailable: 30 }));
  const trigger = html.match(/<button[^>]*class="[^"]*guild-funding-open[^"]*"[^>]*>[\s\S]*?<\/button>/)?.[0];
  assert.ok(trigger);
  assert.match(trigger, /data-variant="default"/);
  assert.match(trigger, /type="button"/);
  assert.match(trigger, /aria-haspopup="dialog"/);
  assert.match(trigger, /aria-expanded="false"/);
  assert.match(trigger, /See how this room was funded/);
  assert.doesNotMatch(trigger, /guild-funding-link|hover:underline/);
});

test("five ordered steps distinguish approvals, payer withdrawal, payment and app evidence", () => {
  const html = history();
  assert.match(html, /<dialog[^>]*aria-labelledby="[^"]+"/);
  assert.match(html, /Close How the guild funded this room/);
  assert.equal((html.match(/class="guild-funding-step"/g) ?? []).length, 5);
  const titles = ["Treasury funded", "Allowance approved", "Payer funded", "Room payment settled", "Credits recorded in the app"];
  for (let i = 1; i < titles.length; i++) assert.ok(html.indexOf(titles[i - 1]) < html.indexOf(titles[i]));
  assert.match(html, /3 test USDC.*no periodic reset/);
  assert.match(html, /Approval 1 recorded/);
  assert.match(html, /Approval 2 recorded/);
  assert.doesNotMatch(html, /Approval 3|pending vote|rejected vote/);
  assert.match(html, /vault did not pay the room directly/);
  assert.match(html, new RegExp(record.receipts.payment.signature));
  assert.match(html, /App ledger entry/);
  const lastStep = html.slice(html.indexOf("Credits recorded in the app"), html.indexOf("guild-funding-cleanup"));
  assert.doesNotMatch(lastStep, /explorer.solana.com/);
  assert.match(lastStep, /datetime="2026-10-12T15:49:26.842Z"/i);
  assert.match(lastStep, /datetime="2026-10-13T05:18:51.732Z"/i);
});

test("cleanup is recorded permission removal, without an active balance or refund claim", () => {
  const html = history();
  assert.match(html, /Allowance closed after the rehearsal/);
  assert.match(html, /2 test USDC.*unused permission/);
  assert.match(html, /not a token refund/);
  assert.match(html, /4 test USDC.*at cleanup/);
  for (const receipt of record.cleanup.receipts) assert.match(html, new RegExp(receipt.signature));
  assert.match(html, /earlier app record check does not verify it/);
  assert.doesNotMatch(html, /2 test USDC available|Current vault balance|Refund received/);
});

test("full accounts can be selected or copied, with devnet links and explicit proof boundaries", () => {
  const html = history();
  for (const address of Object.values(record.accounts)) assert.ok(html.includes(`<code>${address}</code>`));
  assert.match(html, /Copy authorized payer address/);
  assert.match(html, /<details class="guild-funding-disclosure"><summary>Accounts and receipt details/);
  assert.match(html, /What this rehearsal proves/);
  assert.match(html, /All three guild-member keys were held by the founder/);
  assert.match(html, /did not restrict that wallet/);
  assert.match(html, /does not identify which credits/);
  assert.match(html, /operator’s approved provider budget/);
  assert.doesNotMatch(html, /<form|<input|<select|>Approve<|>Deny<|>Withdraw<|>Top up<|>Revoke<|Connect wallet/);
});

test("missing approval receipts produce an explicit evidence gap, not invented links", () => {
  const html = renderToStaticMarkup(createElement(GuildFundingHistory, {
    record: { ...record, receipts: { ...record.receipts, approvals: [] } }, onClose: () => {},
  }));
  assert.match(html, /No receipt recorded for this step/);
  assert.match(html, /Approval receipts are incomplete in this view/);
  assert.match(html, /recorded policy requires/);
  assert.doesNotMatch(html, /onchain approval and spending limit worked/);
  assert.doesNotMatch(html, /Approval 1 recorded|Approval 2 recorded/);
});

test("live credits, reservation and generation status remain independent of the recorded +5", () => {
  const base: PilotCredits = { limit: 13, used: 3, reserved: 3, available: 7, enabled: true,
    queued_requests: 1, generating_requests: 1, checking_requests: 0 };
  for (const state of [base, { ...base, available: 0, enabled: false }, { ...base, reserved: 0, available: 10, generating_requests: 0, queued_requests: 0 }]) {
    const html = renderToStaticMarkup(createElement(Fragment, null,
      createElement(PilotRoomFunding, { roomId: "paper-moon", loadedRoom: "paper-moon" }),
      createElement(PilotRoomActivity, { credits: state }),
    ));
    assert.match(html, /Recorded addition: \+5 room credits/);
    assert.match(html, new RegExp(`${state.available}[^<]*<[^>]*>[^<]*credits available|${state.available}.*credits available`));
    if (state.reserved) assert.match(html, /3.*reserved for unfinished requests/);
    if (state.generating_requests) assert.match(html, /1 generating/);
    if (!state.enabled) assert.match(html, /paused/i);
  }
  const interrupted = renderToStaticMarkup(createElement(Fragment, null,
    createElement(PilotRoomFunding, { roomId: "paper-moon", loadedRoom: "paper-moon" }),
    createElement(PilotRoomActivity, { credits: base, interrupted: true }),
  ));
  assert.match(interrupted, /Recorded addition: \+5 room credits/);
  assert.match(interrupted, /Last saved room activity/);
  assert.doesNotMatch(interrupted, /pilot-generation-active/);
});

test("hall entry opens the exact public history in a new tab without carrying local identities", () => {
  const html = renderToStaticMarkup(createElement(GuildFundingHallEntry));
  assert.match(html, /Shared creative budget/);
  assert.match(html, /href="\/pilot\?room=paper-moon&amp;view=treasury" target="_blank" rel="noreferrer"/);
  assert.match(html, /opens in a new tab; uses your shared-room storyteller account/);
  assert.match(html, /recorded rehearsal/);
  assert.doesNotMatch(html, /Sam|Priya|Jules|userId=|wallet=|private|treasury balance/i);
});

test("rendering funding history requires no network call or authenticated wallet", (t) => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("History must not request funding or authentication"); });
  assert.ok(history().includes("How the guild funded this room"));
  assert.ok(renderToStaticMarkup(createElement(PilotRoomFunding, { roomId: "paper-moon", loadedRoom: "paper-moon" })));
  assert.ok(renderToStaticMarkup(createElement(GuildFundingHallEntry)));
});
