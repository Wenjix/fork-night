import assert from "node:assert/strict";
import test from "node:test";
import {
  copyFundingAddress,
  closeGuildFundingVisit,
  formatFundingUsdc,
  fundingExplorerUrl,
  getRecordedGuildFunding,
  isGuildFundingVisit,
  withoutGuildFundingView,
  watchGuildFundingVisit,
  type FundingNavigation,
} from "../../src/lib/guild-funding.ts";

const record = getRecordedGuildFunding("paper-moon")!;

test("treasury evidence belongs to Paper Moon, not a local guild or an arbitrary Solana room", () => {
  assert.equal(record.status, "recorded");
  assert.equal(record.protocol, "Squads v4");
  assert.equal(record.roomId, "paper-moon");
  for (const room of ["", "paper-lantern", "midnight-signal", "night-shift", "unknown", "constructor"])
    assert.equal(getRecordedGuildFunding(room), undefined, room);
});

test("the final receipt is the treasury-funded payment, distinct from the earlier ordinary top-up", () => {
  assert.equal(record.receipts.payment.signature,
    "2AFKQZCEDJdcpAqBcy5uMMKW3XViNjJmXSrWYymCBDPJTwdmkaTr7q7h7UQP2DUjG6BGXxUmsya9HtpZUri3KYdz");
  assert.notEqual(record.receipts.payment.signature,
    "2YHSYXPTzJUMmaoV2MHKHxzW5Lwx44zvhgaKnrQWq9F5vAHcdA6fhvBVjifVmP7B9fzWktG4k9eqLDJztTQ1BfSJ");
  assert.notEqual(record.accounts.vault, record.accounts.payer);
  assert.equal(record.accounts.payer, "EFpvKAoQ6tAFDyNFtdfrF3i3nHRwZdrYtKFR1q3j7MXL");
  assert.equal(record.accounts.multisig, "9Hwpbq8gkoCGSb5wBog9QwczeiCc1d1cXp78m8UfcReA");
});

test("two recorded approvals authorize a cap, with a smaller withdrawal and separate payment", () => {
  assert.equal(record.governance.stewardWallets, 3);
  assert.equal(record.governance.threshold, 2);
  assert.equal(record.governance.founderOperated, true);
  assert.equal(record.receipts.approvals.length, record.governance.threshold);
  const signatures = [record.receipts.proposal, ...record.receipts.approvals, record.receipts.allowance,
    record.receipts.draw, record.receipts.payment].map(receipt => receipt.signature);
  assert.equal(new Set(signatures).size, signatures.length);
  assert.equal(record.amounts.deposit, "5000000");
  assert.equal(record.amounts.allowance, "3000000");
  assert.equal(record.amounts.draw, "1000000");
  assert.equal(record.amounts.payment, "1000000");
  assert.ok(BigInt(record.amounts.draw) < BigInt(record.amounts.allowance));
});

test("the allowance was removed; unused permission is distinct from the vault's retained tokens", () => {
  assert.equal(record.cleanup.status, "removed");
  assert.equal(record.cleanup.recordedDate, "2026-10-13");
  assert.equal(record.cleanup.unusedPermission, "2000000");
  assert.equal(BigInt(record.amounts.allowance) - BigInt(record.amounts.draw), BigInt(record.cleanup.unusedPermission));
  assert.equal(BigInt(record.amounts.deposit) - BigInt(record.amounts.draw), BigInt(record.cleanup.vaultAtCleanup));
  assert.equal(record.cleanup.receipts.length, 4);
  assert.equal(record.cleanup.receipts.at(-1)?.signature,
    "39QCnEAZNp3NiSx3PtCs9uSXavasaUax4L2pg2uuYLG7iqXkD1FZtY3YjxenrVPSizSgKWVaGxcJ5k4HthvmHuSg");
});

test("the +5 is an app entry, with posting time separate from its later evidence check", () => {
  assert.equal(record.appCredit.state, "credited");
  assert.equal(record.appCredit.added, 5);
  assert.equal(record.appCredit.replayed, false);
  assert.equal(record.appCredit.historicalAfter - record.appCredit.historicalBefore, 5);
  assert.equal(record.appCredit.recordedAt, "2026-10-12T15:49:26.842Z");
  assert.notEqual(record.appCredit.recordedAt, "2026-10-12T15:49:24.109Z");
  assert.equal(record.appCredit.checkedAt, "2026-10-13T05:18:51.732Z");
  assert.ok(Date.parse(record.appCredit.recordedAt) < Date.parse(record.appCredit.checkedAt));
  assert.equal("available" in record.appCredit, false);
  assert.equal("signature" in record.appCredit, false);
});

test("every receipt and account opens a fixed devnet explorer origin", () => {
  const receipts = [record.receipts.creation, record.receipts.deposit, record.receipts.proposal,
    ...record.receipts.approvals, record.receipts.allowance, record.receipts.draw, record.receipts.payment,
    ...record.cleanup.receipts];
  for (const receipt of receipts) {
    const url = new URL(fundingExplorerUrl(receipt.signature));
    assert.equal(url.origin, "https://explorer.solana.com");
    assert.equal(url.pathname, `/tx/${receipt.signature}`);
    assert.equal(url.search, "?cluster=devnet");
  }
  for (const address of Object.values(record.accounts)) {
    assert.equal(new URL(fundingExplorerUrl(address, "address")).pathname, `/address/${address}`);
  }
  const hostile = new URL(fundingExplorerUrl("https://elsewhere.invalid/?cluster=mainnet"));
  assert.equal(hostile.origin, "https://explorer.solana.com");
  assert.equal(hostile.searchParams.get("cluster"), "devnet");
});

test("token formatting keeps six-decimal base units exact, even beyond Number's integer precision", () => {
  for (const [units, expected] of [["0", "0"], ["1", "0.000001"], ["1000000", "1"],
    ["1234567", "1.234567"], ["1000100", "1.0001"], ["9007199254740993", "9007199254.740993"]])
    assert.equal(formatFundingUsdc(units), expected);
});

test("deep entry needs both the actual recorded room and the recognized view", () => {
  assert.equal(isGuildFundingVisit(new URL("https://fork-night.vercel.app/pilot?room=paper-moon&view=treasury&moment=saved"), "paper-moon"), true);
  for (const query of ["room=midnight-signal&view=treasury", "room=paper-moon&view=map", "room=paper-moon", "view=treasury"])
    assert.equal(isGuildFundingVisit(new URL(`https://fork-night.vercel.app/pilot?${query}`), "paper-moon"), false);
  assert.equal(isGuildFundingVisit(new URL("https://fork-night.vercel.app/pilot?room=paper-lantern&view=treasury"), "paper-lantern"), false);
});

test("closing removes only the owned view value, keeping the story link and unrelated parameters", () => {
  const current = new URL("https://fork-night.vercel.app/pilot?room=paper-moon&moment=saved&view=treasury&onboarding=1&tag=a&tag=b&view=map#story");
  const next = withoutGuildFundingView(current);
  assert.equal(next.searchParams.get("room"), "paper-moon");
  assert.equal(next.searchParams.get("moment"), "saved");
  assert.equal(next.searchParams.get("onboarding"), "1");
  assert.deepEqual(next.searchParams.getAll("tag"), ["a", "b"]);
  assert.deepEqual(next.searchParams.getAll("view"), ["map"]);
  assert.equal(next.hash, "#story");
  assert.equal(current.searchParams.get("view"), "treasury");
  const unsupported = new URL("https://fork-night.vercel.app/pilot?room=paper-moon&view=map");
  assert.equal(withoutGuildFundingView(unsupported).href, unsupported.href);
});

test("copy returns usable recovery text for missing or denied clipboard access", async (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor);
    else Reflect.deleteProperty(globalThis, "navigator");
  });
  let copied = "";
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
    clipboard: { writeText: async (value: string) => { copied = value; } },
  } });
  assert.equal(await copyFundingAddress(record.accounts.payer), "Address copied.");
  assert.equal(copied, record.accounts.payer);
  for (const value of [{}, { clipboard: { writeText: async () => { throw new Error("Denied"); } } }]) {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value });
    assert.equal(await copyFundingAddress(record.accounts.payer), "Could not copy. Select the full address above and copy it.");
  }
});

function navigationAt(url: string) {
  const events = new EventTarget();
  const replaced: { state: unknown; url: string }[] = [];
  const browser: FundingNavigation = {
    location: { href: url },
    history: {
      state: { savedStory: "keep" },
      replaceState(state: unknown, _unused: string, next?: string | URL | null) {
        browser.location.href = new URL(String(next), browser.location.href).href;
        replaced.push({ state, url: browser.location.href });
      },
    },
    addEventListener: (type, listener) => events.addEventListener(type, listener),
    removeEventListener: (type, listener) => events.removeEventListener(type, listener),
  };
  const visit = (next: string) => {
    browser.location.href = next;
    events.dispatchEvent(new Event("popstate"));
  };
  return { browser, replaced, visit };
}

test("the navigation subscription opens a deep entry, reacts to browser history, and releases its listener", () => {
  const { browser, visit, replaced } = navigationAt("https://fork-night.vercel.app/pilot?room=paper-moon&view=treasury&moment=draft-parent");
  const opened: boolean[] = [];
  const stop = watchGuildFundingVisit(browser, "paper-moon", open => opened.push(open));
  assert.deepEqual(opened, [true]);
  visit("https://fork-night.vercel.app/pilot?room=paper-moon&view=treasury&moment=ancestor");
  assert.deepEqual(opened, [true, true]);
  visit("https://fork-night.vercel.app/pilot?room=paper-moon");
  visit("https://fork-night.vercel.app/pilot?room=midnight-signal&view=treasury");
  assert.deepEqual(opened, [true, true, false, false]);
  assert.deepEqual(replaced, []);
  stop();
  visit("https://fork-night.vercel.app/pilot?room=paper-moon&view=treasury");
  assert.deepEqual(opened, [true, true, false, false]);
});

test("closing history keeps the browser's existing state, scene and onboarding; unsupported views cause no write", () => {
  const { browser, replaced } = navigationAt("https://fork-night.vercel.app/pilot?room=paper-moon&view=treasury&moment=saved&onboarding=1#story");
  const savedState = browser.history.state;
  closeGuildFundingVisit(browser);
  assert.equal(replaced.length, 1);
  assert.equal(replaced[0].state, savedState);
  assert.equal(new URL(browser.location.href).searchParams.get("moment"), "saved");
  assert.equal(new URL(browser.location.href).searchParams.get("onboarding"), "1");
  assert.equal(new URL(browser.location.href).hash, "#story");
  assert.equal(new URL(browser.location.href).searchParams.has("view"), false);
  closeGuildFundingVisit(browser);
  assert.equal(replaced.length, 1);
  browser.location.href = "https://fork-night.vercel.app/pilot?room=paper-moon&view=map";
  closeGuildFundingVisit(browser);
  assert.equal(replaced.length, 1);
});
