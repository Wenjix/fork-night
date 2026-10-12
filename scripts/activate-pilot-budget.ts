import { resolve, join } from "node:path";
import { pilotAdmin } from "../src/generation/client.ts";
import {
  canonicalJson,
  digest,
  readJson,
  withAttemptLock,
  writeJson,
} from "../src/experiments/storage.ts";
import {
  OPENAI_EXPERIMENT_POLICY,
  summarizeOpenAiLedger,
  type ExperimentLedger,
} from "../src/experiments/openai-live.ts";
import { parseUsd } from "../src/experiments/money.ts";

// Explicit operator command: transfers the existing $10 experiment, never a new allowance.
// Run with node --env-file=.env.local scripts/activate-pilot-budget.ts.
const directory = resolve(".local/experiments/openai-live");
await withAttemptLock(directory, async () => {
  const ledger = await readJson<ExperimentLedger>(
    join(directory, "ledger.json"),
  );
  if (
    !ledger ||
    canonicalJson(ledger.policy) !== canonicalJson(OPENAI_EXPERIMENT_POLICY)
  )
    throw new Error(
      "Existing experiment ledger required; refusing a fresh allowance.",
    );
  const summary = summarizeOpenAiLedger(ledger);
  if (summary.unresolvedAllowanceUsd !== "0.000000")
    throw new Error(
      "Resolve earlier provider expense before transferring the budget.",
    );
  const marker = {
    authority: "shared-pilot",
    ledgerDigest: digest(canonicalJson(ledger)),
    importedExpenseMicro: Number(parseUsd(summary.calculatedExpenseUsd)),
    importedRequests: summary.requestCount,
  };
  const path = join(directory, "hosted-ledger.json");
  const existing = await readJson(path);
  if (existing && canonicalJson(existing) !== canonicalJson(marker))
    throw new Error(
      "The transferred ledger changed; review accounting manually.",
    );
  const admin = pilotAdmin();
  const budget = await admin
    .from("pilot_generation_budget")
    .select("*")
    .eq("id", true)
    .single();
  if (budget.error) throw new Error("Cannot read the shared budget.");
  if (budget.data.cap_micro !== 0) {
    if (
      !existing ||
      budget.data.imported_expense_micro !== marker.importedExpenseMicro ||
      budget.data.imported_requests !== marker.importedRequests
    )
      throw new Error("The shared budget already has different accounting.");
    console.log("Budget transfer already complete; no settings changed.");
    return;
  }
  // Disables local paid dispatch first; a lost DB acknowledgement is safely repeatable.
  await writeJson(path, marker);
  const result = await admin
    .from("pilot_generation_budget")
    .update({
      enabled: true,
      cap_micro: Number(parseUsd(OPENAI_EXPERIMENT_POLICY.budgetUsd)),
      imported_expense_micro: marker.importedExpenseMicro,
      imported_requests: marker.importedRequests,
      max_requests: OPENAI_EXPERIMENT_POLICY.maximumRequests,
    })
    .eq("id", true)
    .eq("cap_micro", 0)
    .select("id")
    .single();
  if (result.error)
    throw new Error(
      "Local dispatch is disabled. Check the shared budget before repeating this transfer.",
    );
  console.log({
    budgetUsd: OPENAI_EXPERIMENT_POLICY.budgetUsd,
    ...summary,
    authority: "shared-pilot",
  });
});
