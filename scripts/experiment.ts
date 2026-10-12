import { resolve } from "node:path";
import {
  inspectExperiment,
  loadFixtures,
  runExperiment,
} from "../src/experiments/runner.ts";
import type { ExperimentRecord } from "../src/experiments/types.ts";

const help = `Fork Night — local deterministic image experiments

  node scripts/experiment.ts list
  node scripts/experiment.ts run <fixture> [--id <attempt-id>] [--output <directory>] [--cap-usd <simulated-cap>]
  node scripts/experiment.ts inspect <attempt-id> [--output <directory>] [--json]

The default ID is <fixture>-local. Repeat the same command to resume it.
Use a new ID only for a deliberately separate experiment. Output defaults to
.local/experiments. All generation and prices are simulated; actual expense is $0.

--provider paid always fails closed in this deterministic runner. The separate
experiment:openai command runs explicitly paid OpenAI experiments.
`;

function parseArgs(args: string[]) {
  const positional: string[] = [];
  const options = new Map<string, string>();
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg.startsWith("--")) {
      if (!["--id", "--output", "--provider", "--cap-usd"].includes(arg))
        throw new Error(`Unknown option: ${arg}`);
      const value = args[++index];
      if (!value || value.startsWith("--"))
        throw new Error(`Missing value for ${arg}`);
      if (options.has(arg)) throw new Error(`Repeated option: ${arg}`);
      options.set(arg, value);
    } else positional.push(arg);
  }
  return { positional, options, json };
}

function printRecord(record: ExperimentRecord, root: string): void {
  console.log(`${record.id}: ${record.status}`);
  console.log(`Evidence: ${record.evidence}`);
  console.log(
    `Inherited: ${record.input.inherited.moments.map((moment) => moment.id).join(" → ") || "none"}`,
  );
  console.log(
    `Provider requests: ${record.dispatchCount}; recoveries: ${record.recoveryCount}; paid retries: ${record.retryCount}`,
  );
  console.log(
    `Actual expense: $${record.accounting.realProviderExpenseUsd}; simulated expense: $${record.accounting.simulatedProviderExpenseUsd}; simulated allowance held: $${record.allowance.heldSimulatedExpenseUsd}`,
  );
  console.log(`Record: ${resolve(root, record.id, "record.json")}`);
  if (record.status === "delivered")
    console.log(`Preview: ${resolve(root, record.id, "preview.html")}`);
  if (record.error) console.log(`Note: ${record.error}`);
}

async function main() {
  if (process.argv.includes("--help") || process.argv.length === 2) {
    console.log(help);
    return;
  }
  const { positional, options, json } = parseArgs(process.argv.slice(2));
  const [command, id] = positional;
  const rootDirectory = resolve(
    options.get("--output") ?? ".local/experiments",
  );
  if (command === "list") {
    if (positional.length !== 1)
      throw new Error("list takes no positional arguments");
    const { experiments } = await loadFixtures();
    if (json) console.log(JSON.stringify(experiments, null, 2));
    else
      for (const fixture of experiments)
        console.log(`${fixture.id.padEnd(19)} ${fixture.title}`);
    return;
  }
  if (!id || positional.length !== 2)
    throw new Error(
      "Expected run <fixture> or inspect <attempt-id>; use --help",
    );
  let record: ExperimentRecord;
  if (command === "inspect")
    record = await inspectExperiment(id, rootDirectory);
  else if (command === "run") {
    const provider = options.get("--provider") ?? "fake";
    if (provider !== "fake" && provider !== "paid")
      throw new Error("Provider must be fake or paid");
    record = await runExperiment({
      fixtureId: id,
      attemptId: options.get("--id"),
      rootDirectory,
      provider,
      maximumSimulatedExpenseUsd: options.get("--cap-usd"),
      paidApproval: {
        apiKey: process.env.FORK_NIGHT_EXPERIMENT_API_KEY,
        approvedBudgetUsd:
          process.env.FORK_NIGHT_EXPERIMENT_APPROVED_BUDGET_USD,
      },
    });
  } else throw new Error(`Unknown command: ${command}`);
  if (json) console.log(JSON.stringify(record, null, 2));
  else printRecord(record, rootDirectory);
  if (record.status !== "delivered") process.exitCode = 2;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Experiment failed");
  process.exitCode = 1;
});
