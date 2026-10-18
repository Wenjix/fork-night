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

const KESSLER_FUNDING: RecordedGuildFunding = {
  "id": "kessler-squads-rehearsal-2026-10-18",
  "roomId": "kessler-ward",
  "roomTitle": "Kessler Ward",
  "status": "recorded",
  "protocol": "Squads v4",
  "cluster": "devnet",
  "governance": {
    "stewardWallets": 3,
    "threshold": 2,
    "founderOperated": true
  },
  "token": {
    "label": "test USDC",
    "decimals": 6
  },
  "accounts": {
    "multisig": "9Hwpbq8gkoCGSb5wBog9QwczeiCc1d1cXp78m8UfcReA",
    "vault": "6LGvFZbMoWyWsNjayMi4FeAQMLNAXEVFJbGzeSPE52RW",
    "allowance": "EuNCr1gPhzLSxAYu9CfdcCe6NzumkwGcTmLkGE2uJ3kY",
    "payer": "EFpvKAoQ6tAFDyNFtdfrF3i3nHRwZdrYtKFR1q3j7MXL"
  },
  "amounts": {
    "deposit": "5000000",
    "allowance": "1000000",
    "draw": "1000000",
    "payment": "1000000"
  },
  "balances": {
    "vaultBeforeDraw": "4000000",
    "vaultAfterDraw": "3000000",
    "allowanceAfterDraw": "0"
  },
  "receipts": {
    "creation": {
      "label": "Multisig created",
      "signature": "4Wz3Q4vRVFvhMPVV1oPkY1La2xaSYxvyGytdRLh163SRZQvrDeg41VLgzoKm6aabpUerQNpEMKDFWjFYGcGqaRyt"
    },
    "deposit": {
      "label": "Original treasury deposit",
      "signature": "8am75HgwckBxoBpxzRwehdnddmPuvmWoPdPBaDXj6aCEfD13ytL9LB8xCbsNLQcdgbgVEigPPzeX3MU8YmbpsWs"
    },
    "proposal": {
      "label": "Kessler allowance proposal",
      "signature": "2y33PjxqNcMagEGRLUag9sdfmP6637S399aRGt87b6k6XN6NtQ5EpL28fUKmt7F6ZZD6t1KwdVsLAquptwmvNzNn"
    },
    "approvals": [
      {
        "label": "Approval 1",
        "signature": "wEDRc3UYnbWfbhWtadrB2uCnkYrGfA6QvtAR4mKru2ZQnp7BG81k8qrhFQKKrvLc6kciVDjR9BfGPGA69EE3iVk"
      },
      {
        "label": "Approval 2",
        "signature": "3bqLcwkioFVSD78PbyK54HkrmsgALdwccTJnpW3GZLX6gGcGpLjJBjzSCpLsMBEh4MpybWnA2dpyrSrX2WN6h3ZB"
      }
    ],
    "allowance": {
      "label": "Kessler allowance executed",
      "signature": "2fidPAbrETSqZnD7EKtk5hMGHWCCWTYncpWq5PqbVA76BFAZzXHTK2gvgcmFcLgcaB6s7rrgm6NegJVXKLSEXmE4"
    },
    "draw": {
      "label": "Kessler withdrawal receipt",
      "signature": "4tEGeE559u76cVkMjXc1ZBbVSdwuZhKrDzChYE1TNdzunAtnjpThRxPJ4pyctF26RrrPdVntJTyhgHEhWcQGAEUd"
    },
    "payment": {
      "label": "Kessler x402 payment receipt",
      "signature": "AX5i3xszHmWhYaY2Auri7YtkGAWMPUuhWM1Bmx3dURm51d2dkUMjxXPq5GsJaciPJPmWmMKTdrQsN7yWWwdaQ9U"
    }
  },
  "appCredit": {
    "state": "credited",
    "added": 5,
    "replayed": false,
    "recordedAt": "2026-10-18T11:44:35.005986+00:00",
    "checkedAt": "2026-10-18T11:45:00.929Z",
    "historicalBefore": 4,
    "historicalAfter": 9
  },
  "cleanup": {
    "status": "removed",
    "recordedDate": "2026-10-18",
    "unusedPermission": "0",
    "vaultAtCleanup": "3000000",
    "receipts": [
      {
        "label": "Removal proposal",
        "signature": "59Y1DvsRGa1inAXJuZekLpsA7cBxJH1NwgAncUQHcci91VHZHKL3eTrfyHsitKjNBSAFPa2EnRQQmUzoAzcRRtqN"
      },
      {
        "label": "Removal approval 1",
        "signature": "5sr9Mp8C1jPB9BBDoAj9Z7nJ1gZveXHkgqrgJAUbTSq4iMZumvxopAB1StCEmkY3wBgTgbn85Qka1TcZxncBCpeL"
      },
      {
        "label": "Removal approval 2",
        "signature": "3fTuHf3S1pPXb7eDuC5rNZgeBSkQyVPXCAqfbkfEQJfVk4FTpYBvrfyMpdvRbYRzJvmSrRySZpwRXCopEy5XeBur"
      },
      {
        "label": "Allowance removed",
        "signature": "4Jwu8vNQK6kXmuZdBNBMio4VzxLxtZ6bAv6s8pZR3eYVjtWEYSxfY9YVkrgUsqTQaMBRdtRtzu1bbY55B3qP68BT"
      }
    ]
  }
};

export function getRecordedGuildFunding(roomId: string): RecordedGuildFunding | undefined {
  return roomId === PAPER_MOON_FUNDING.roomId ? PAPER_MOON_FUNDING : roomId === KESSLER_FUNDING.roomId ? KESSLER_FUNDING : undefined;
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
