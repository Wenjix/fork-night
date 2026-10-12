import type { CostCandidate, CostSummary, Expense } from "./types.ts";

/** Exact six-decimal fixture USD arithmetic. Never use floats for amounts. */
export function parseUsd(value: string): bigint {
  if (!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(value)) {
    throw new Error(`Invalid nonnegative six-decimal USD amount: ${value}`);
  }
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}

export function formatUsd(microUsd: bigint): string {
  if (microUsd < 0n) throw new Error("A nonnegative USD amount is required");
  return `${microUsd / 1_000_000n}.${(microUsd % 1_000_000n).toString().padStart(6, "0")}`;
}

export function sumUsd(values: string[]): string {
  return formatUsd(
    values.reduce((total, value) => total + parseUsd(value), 0n),
  );
}

/**
 * Fixture conversion only: 1 simulated USD = 1 mock token, 6 decimals.
 * No real asset or provider credit is represented; exact input means no rounding.
 */
export function toTestTokenUnits(simulatedUsd: string): string {
  return parseUsd(simulatedUsd).toString();
}

export function summarizeCosts(options: {
  expenses: Expense[];
  candidates: CostCandidate[];
  selectedCandidateId: string | null;
  upstreamReuseFeesUsd: string;
}): CostSummary {
  const expenses = new Map<string, Expense>();
  for (const expense of options.expenses) {
    parseUsd(expense.amountUsd);
    if (expenses.has(expense.id))
      throw new Error(`Duplicate expense ID: ${expense.id}`);
    expenses.set(expense.id, expense);
  }
  const candidateIds = new Set<string>();
  for (const candidate of options.candidates) {
    if (candidateIds.has(candidate.id))
      throw new Error(`Duplicate candidate ID: ${candidate.id}`);
    candidateIds.add(candidate.id);
    for (const id of candidate.expenseIds) {
      if (!expenses.has(id))
        throw new Error(`Unknown candidate expense: ${id}`);
    }
  }
  const selected =
    options.selectedCandidateId === null
      ? null
      : options.candidates.find(
          (candidate) => candidate.id === options.selectedCandidateId,
        );
  if (
    options.selectedCandidateId !== null &&
    (!selected || !selected.technicallyDelivered)
  ) {
    throw new Error("Only a delivered candidate can be selected");
  }
  const total = (records: Expense[]) =>
    sumUsd(records.map((expense) => expense.amountUsd));
  const distinctNewExpenses = (candidates: CostCandidate[]) => {
    const ids = new Set(
      candidates.flatMap((candidate) => candidate.expenseIds),
    );
    return [...ids]
      .map((id) => expenses.get(id)!)
      .filter((expense) => expense.scope === "new-production");
  };
  const newProduction = options.expenses.filter(
    (expense) => expense.scope === "new-production",
  );
  return {
    currency: "USD",
    realProviderExpenseUsd: total(
      newProduction.filter(
        (expense) => expense.evidence === "provider-reported",
      ),
    ),
    simulatedProviderExpenseUsd: total(
      newProduction.filter((expense) => expense.evidence === "simulated"),
    ),
    proposedBillableGenerationUsd: total(
      distinctNewExpenses(
        options.candidates.filter(
          (candidate) => candidate.technicallyDelivered,
        ),
      ),
    ),
    selectedEligibleReuseBasisUsd: selected
      ? total(distinctNewExpenses([selected]))
      : null,
    upstreamReuseFeesUsd: formatUsd(parseUsd(options.upstreamReuseFeesUsd)),
    policy: "proposal-simulation-v1",
  };
}
