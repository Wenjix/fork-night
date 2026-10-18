export type FundingReceipt = Readonly<{ label: string; signature: string }>;

export type RecordedGuildFunding = Readonly<{
  id: string;
  roomId: string;
  roomTitle: string;
  status: "recorded";
  protocol: "Squads v4";
  cluster: "devnet";
  governance: Readonly<{ stewardWallets: number; threshold: number; founderOperated: true }>;
  token: Readonly<{ label: "test USDC"; decimals: 6 }>;
  accounts: Readonly<{ multisig: string; vault: string; allowance: string; payer: string }>;
  amounts: Readonly<{ deposit: string; allowance: string; draw: string; payment: string }>;
  balances: Readonly<{ vaultBeforeDraw: string; vaultAfterDraw: string; allowanceAfterDraw: string }>;
  receipts: Readonly<{
    creation: FundingReceipt;
    deposit: FundingReceipt;
    proposal: FundingReceipt;
    approvals: readonly FundingReceipt[];
    allowance: FundingReceipt;
    draw: FundingReceipt;
    payment: FundingReceipt;
  }>;
  appCredit: Readonly<{
    state: "credited";
    added: number;
    replayed: false;
    recordedAt: string;
    checkedAt: string;
    historicalBefore: number;
    historicalAfter: number;
  }>;
  cleanup: Readonly<{
    status: "removed";
    recordedDate: string;
    unusedPermission: string;
    vaultAtCleanup: string;
    receipts: readonly FundingReceipt[];
  }>;
}>;

// Curated public receipts; live room capacity remains owned by the pilot ledger.
const PAPER_MOON_FUNDING: RecordedGuildFunding = {
  id: "paper-moon-squads-rehearsal-2026-10-12",
  roomId: "paper-moon",
  roomTitle: "Paper Moon",
  status: "recorded",
  protocol: "Squads v4",
  cluster: "devnet",
  governance: { stewardWallets: 3, threshold: 2, founderOperated: true },
  token: { label: "test USDC", decimals: 6 },
  accounts: {
    multisig: "9Hwpbq8gkoCGSb5wBog9QwczeiCc1d1cXp78m8UfcReA",
    vault: "6LGvFZbMoWyWsNjayMi4FeAQMLNAXEVFJbGzeSPE52RW",
    allowance: "6ygdeiwJEvAfBNMVgSX5NPTQ7XfjLUPk8UqdahDCKnaM",
    payer: "EFpvKAoQ6tAFDyNFtdfrF3i3nHRwZdrYtKFR1q3j7MXL",
  },
  amounts: { deposit: "5000000", allowance: "3000000", draw: "1000000", payment: "1000000" },
  balances: { vaultBeforeDraw: "5000000", vaultAfterDraw: "4000000", allowanceAfterDraw: "2000000" },
  receipts: {
    creation: { label: "Multisig created", signature: "4Wz3Q4vRVFvhMPVV1oPkY1La2xaSYxvyGytdRLh163SRZQvrDeg41VLgzoKm6aabpUerQNpEMKDFWjFYGcGqaRyt" },
    deposit: { label: "Deposit receipt", signature: "8am75HgwckBxoBpxzRwehdnddmPuvmWoPdPBaDXj6aCEfD13ytL9LB8xCbsNLQcdgbgVEigPPzeX3MU8YmbpsWs" },
    proposal: { label: "Allowance proposal", signature: "4qBGrGKH9fGSP3gPPoWs56ogWGyzuC2y86LzWLM2DRd3er4bTfW9d4zsuGv7voRKpufAqJJK6wJLnekLYtcXQ5bs" },
    approvals: [
      { label: "Approval 1", signature: "cLFvnQxQdvk2EG6q2DeqgesdX1mT9Siaj3bH8LgbTkG2Q8jYqmZavGjip7NxkBxPVEc7bbSedpX1h5bjeQTkpii" },
      { label: "Approval 2", signature: "3XKXtuSgvMq355JMEJRnU5XtVQkEbwyVVQuXk7WmqrX7GGh4TriTRogJ8AwwhpksvDNmE5baZY8UyhJuoYzMfB1A" },
    ],
    allowance: { label: "Allowance executed", signature: "Cj5cawMtpzGQu3P89ZGTQAycst6rtAynSM8YobTvXu37rFHB3ERcT77mZW3mPjHayQYdPKMdLJNgoSSiPgtB8TG" },
    draw: { label: "Withdrawal receipt", signature: "2DqxTyddDx9DE4gDKcFNWWB7kunnm7dfPdt4hftH17492cfceAzx4off7WSy9ZcU1DyVxVnvtGzK7BgYc5bXgXcr" },
    payment: { label: "x402 payment receipt", signature: "2AFKQZCEDJdcpAqBcy5uMMKW3XViNjJmXSrWYymCBDPJTwdmkaTr7q7h7UQP2DUjG6BGXxUmsya9HtpZUri3KYdz" },
  },
  appCredit: {
    state: "credited",
    added: 5,
    replayed: false,
    recordedAt: "2026-10-12T15:49:26.842Z",
    checkedAt: "2026-10-13T05:18:51.732Z",
    historicalBefore: 19,
    historicalAfter: 24,
  },
  cleanup: {
    status: "removed",
    recordedDate: "2026-10-13",
    unusedPermission: "2000000",
    vaultAtCleanup: "4000000",
    receipts: [
      { label: "Removal proposal", signature: "2wPP9GYYjWvPKNRJij5ut7U2nd7eT7zdtxyYdKJJEYdc2i69YLummuXiXeDDU1a9r24kqmTYMAVLBWt6g8y1XeJG" },
      { label: "Removal approval 1", signature: "in2M2gHFBa8caXUErp5BxMcWydtVothfHuJnHTAQJ7DMKdhotMcMA4CZnDmE3wCz3dD86UsntLCGyffpg5untDW" },
      { label: "Removal approval 2", signature: "3CgxgHUfMXuDhkMUvSiDBFADkFyzAS9QPejVdm9jwAzQsouBYZcPQwMh2VgBKvfTEV9ABekpQqeqYVisMzj4NC7p" },
      { label: "Allowance removed", signature: "39QCnEAZNp3NiSx3PtCs9uSXavasaUax4L2pg2uuYLG7iqXkD1FZtY3YjxenrVPSizSgKWVaGxcJ5k4HthvmHuSg" },
    ],
  },
};

export function getRecordedGuildFunding(roomId: string): RecordedGuildFunding | undefined {
  return roomId === PAPER_MOON_FUNDING.roomId ? PAPER_MOON_FUNDING : undefined;
}

export function fundingExplorerUrl(identifier: string, kind: "tx" | "address" = "tx"): string {
  return `https://explorer.solana.com/${kind}/${encodeURIComponent(identifier)}?cluster=devnet`;
}

export function formatFundingUsdc(baseUnits: string): string {
  const units = BigInt(baseUnits);
  const fraction = (units % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${units / 1_000_000n}${fraction ? `.${fraction}` : ""}`;
}

export function isGuildFundingVisit(url: URL, roomId: string): boolean {
  return !!getRecordedGuildFunding(roomId)
    && url.searchParams.get("room") === roomId
    && url.searchParams.get("view") === "treasury";
}

export function withoutGuildFundingView(url: URL): URL {
  const next = new URL(url.href);
  if (next.searchParams.get("view") === "treasury") next.searchParams.delete("view", "treasury");
  return next;
}

export type FundingNavigation = {
  location: { href: string };
  history: Pick<History, "state" | "replaceState">;
  addEventListener: (type: "popstate", listener: () => void) => void;
  removeEventListener: (type: "popstate", listener: () => void) => void;
};

export function watchGuildFundingVisit(browser: FundingNavigation, roomId: string, onOpen: (open: boolean) => void): () => void {
  const readVisit = () => onOpen(isGuildFundingVisit(new URL(browser.location.href), roomId));
  readVisit();
  browser.addEventListener("popstate", readVisit);
  return () => browser.removeEventListener("popstate", readVisit);
}

export function closeGuildFundingVisit(browser: FundingNavigation): void {
  const current = new URL(browser.location.href);
  const next = withoutGuildFundingView(current);
  if (next.href !== current.href) browser.history.replaceState(browser.history.state, "", next.href);
}

export async function copyFundingAddress(address: string): Promise<string> {
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
    await navigator.clipboard.writeText(address);
    return "Address copied.";
  } catch {
    return "Could not copy. Select the full address above and copy it.";
  }
}
