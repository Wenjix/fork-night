/** All records are local demonstration data, not authentication or chain evidence. */
export type Amount = number;

export interface DemoUser {
  id: string;
  name: string;
  initials: string;
  color: string;
}

export interface Project {
  id: string;
  title: string;
  description: string;
  visibility: "open" | "private";
  groupId: string | null;
  creatorId: string;
  seedId: string;
  termsVersion: string;
  coverUrl: string;
}

export interface Group {
  id: string;
  name: string;
  adminId: string;
  termsVersion: string;
  /** The cartridge gauge is measured against this displayed reference quantity. */
  cartridgeCapacity: Amount;
}

export interface Membership {
  groupId: string;
  userId: string;
  role: "admin" | "contributor";
  status: "active" | "invited" | "removed";
  acceptedTermsVersion: string | null;
  canSpend: boolean;
  /** A total demo allowance, including settled spend and outstanding holds. */
  spendingLimit: Amount;
  spent: Amount;
}

export interface Panel {
  imageUrl: string;
  caption: string;
}

export interface Moment {
  id: string;
  projectId: string;
  parentId: string | null;
  version: number;
  authorId: string;
  title: string;
  /** One through three panels, checked when loading saved state. */
  panels: Panel[];
  storyContext: string;
  reuseFee: Amount;
  beneficiaryId: string;
  termsVersion: string;
  publishedAt: number;
  source: "fixture" | "demo-generation" | "local-original";
  builtOnThanks?: string;
}

export interface FundingAccount {
  id: string;
  kind: "personal" | "group";
  ownerId: string | null;
  groupId: string | null;
  available: Amount;
  reserved: Amount;
  spent: Amount;
  deposited: Amount;
  withdrawn: Amount;
}

export interface AncestorFee {
  momentId: string;
  version: number;
  beneficiaryId: string;
  amount: Amount;
}

export interface ForkQuote {
  id: string;
  userId: string;
  projectId: string;
  parentId: string;
  parentVersion: number;
  fundingAccountId: string;
  prompt: string;
  ancestorFees: AncestorFee[];
  pathIds: string[];
  upstreamTotal: Amount;
  generationMax: Amount;
  totalMax: Amount;
  issuedAt: number;
  expiresAt: number;
  termsVersion: string;
  pricingVersion: "fixture-price-v1";
}

export interface Candidate {
  title: string;
  panels: Panel[];
  storyContext: string;
  /** This simulation is not evidence of real provider usage. */
  provider: "deterministic-fixture";
  receiptId: string;
  generationActual: Amount;
  eligibleReuseBasis: Amount;
}

export interface ForkOperation {
  id: string;
  quote: ForkQuote;
  status: "reserved" | "delivered" | "published" | "discarded";
  candidate?: Candidate;
  generationActual?: Amount;
  publishedMomentId?: string;
  settledAmount?: Amount;
  releasedAmount?: Amount;
  settledAt?: number;
}

export interface LedgerEntry {
  id: string;
  kind:
    | "opening"
    | "top-up"
    | "withdrawal"
    | "reservation"
    | "publication"
    | "discard";
  accountId: string;
  userId: string;
  operationId?: string;
  amount: Amount;
  releasedAmount?: Amount;
  description: string;
}

export interface DemoState {
  version: 1;
  users: DemoUser[];
  projects: Project[];
  groups: Group[];
  memberships: Membership[];
  moments: Moment[];
  accounts: FundingAccount[];
  operations: ForkOperation[];
  ledger: LedgerEntry[];
  claims: Record<string, Amount>;
  generationSpent: Amount;
}

export interface QuoteInput {
  userId: string;
  projectId: string;
  parentId: string;
  prompt: string;
  now?: number;
}

export interface FinishedExport {
  format: "fork-night-finished-branch";
  version: 1;
  mode: "local-demo";
  projectTitle: string;
  selectedMomentId: string;
  termsVersion: string;
  moments: {
    id: string;
    version: number;
    parentId: string | null;
    title: string;
    panels: Panel[];
    credit: { name: string; thankYou?: string };
    termsVersion: string;
  }[];
}
