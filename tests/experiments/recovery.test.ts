import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  inspectExperiment,
  requirePaidAdapter,
  runExperiment,
} from "../../src/experiments/runner.ts";
import { canonicalJson, digest } from "../../src/experiments/storage.ts";
import type { ExperimentRecord } from "../../src/experiments/types.ts";

async function workspace(t: {
  after(fn: () => Promise<unknown>): void;
}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "fork-night-experiments-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("seed, continuation and visible-reference baseline persist usable artifacts with zero actual expense", async (t) => {
  const rootDirectory = await workspace(t);
  for (const fixtureId of ["seed", "continuation", "recreation"]) {
    const record = await runExperiment({ fixtureId, rootDirectory });
    assert.equal(record.status, "delivered");
    assert.equal(record.artifacts.length, 5);
    assert.equal(record.accounting.realProviderExpenseUsd, "0.000000");
    assert.equal(
      record.accounting.selectedEligibleReuseBasisUsd,
      record.accounting.proposedBillableGenerationUsd,
    );
    assert.equal(record.validity.continuity, "not-evaluated");
    const inspected = await inspectExperiment(record.id, rootDirectory);
    assert.deepEqual(inspected, record);
    const repeated = await runExperiment({ fixtureId, rootDirectory });
    assert.deepEqual(repeated, record);
    assert.match(
      await readFile(join(rootDirectory, record.id, "panel-1.svg"), "utf8"),
      /NO MODEL CALL/,
    );
    const saved = JSON.parse(
      await readFile(
        join(rootDirectory, "_fake-provider", `${record.id}.json`),
        "utf8",
      ),
    );
    assert.equal(saved.acceptedCount, 1);
  }
  const continuation = await inspectExperiment(
    "continuation-local",
    rootDirectory,
  );
  const recreation = await inspectExperiment("recreation-local", rootDirectory);
  assert.equal(continuation.input.inherited.moments.length, 2);
  assert.equal(recreation.input.inherited.moments.length, 0);
});

test("an accepted lost reply reconciles the existing request, including across a separate process", async (t) => {
  const rootDirectory = await workspace(t);
  const first = await runExperiment({ fixtureId: "lost-reply", rootDirectory });
  assert.equal(first.status, "uncertain");
  assert.equal(first.dispatchCount, 1);
  assert.equal(first.allowance.heldSimulatedExpenseUsd, "0.100000");
  assert.equal(first.usage, null);
  const resumed = spawnSync(
    process.execPath,
    [
      "scripts/experiment.ts",
      "run",
      "lost-reply",
      "--output",
      rootDirectory,
      "--json",
    ],
    { encoding: "utf8" },
  );
  assert.equal(resumed.status, 0, resumed.stderr);
  const recovered = JSON.parse(resumed.stdout);
  assert.equal(recovered.status, "delivered");
  assert.equal(recovered.dispatchCount, 1);
  assert.equal(recovered.recoveryCount, 1);
  assert.equal(recovered.retryCount, 0);
  assert.equal(recovered.allowance.heldSimulatedExpenseUsd, "0.000000");
});

test("an unrecoverable accepted request retains its allowance and never blindly resubmits", async (t) => {
  const rootDirectory = await workspace(t);
  await runExperiment({ fixtureId: "uncertain", rootDirectory });
  const record = await runExperiment({ fixtureId: "uncertain", rootDirectory });
  assert.equal(record.status, "uncertain");
  assert.equal(record.dispatchCount, 1);
  assert.equal(record.retryCount, 0);
  assert.equal(record.providerRequestId, null);
  assert.equal(record.allowance.heldSimulatedExpenseUsd, "0.100000");
  assert.equal(record.accounting.proposedBillableGenerationUsd, "0.000000");
  assert.match(record.error!, /Stop for operator review/);
  assert.equal(
    (await readdir(join(rootDirectory, "_fake-provider"))).length,
    1,
  );
});

test("storage interruption preserves the paid-like result and resumes without another generation", async (t) => {
  const rootDirectory = await workspace(t);
  const first = await runExperiment({
    fixtureId: "storage-recovery",
    rootDirectory,
  });
  assert.equal(first.status, "storing");
  assert.equal(first.accounting.proposedBillableGenerationUsd, "0.000000");
  assert.notEqual(first.accounting.simulatedProviderExpenseUsd, "0.000000");
  const savedPanel = await readFile(
    join(rootDirectory, first.id, "panel-1.svg"),
    "utf8",
  );
  const recovered = await runExperiment({
    fixtureId: "storage-recovery",
    rootDirectory,
  });
  assert.equal(recovered.status, "delivered");
  assert.equal(recovered.dispatchCount, 1);
  assert.equal(recovered.recoveryCount, 1);
  assert.equal(
    await readFile(join(rootDirectory, first.id, "panel-1.svg"), "utf8"),
    savedPanel,
  );
  assert.equal(recovered.expenses.length, 1);
});

test("storage recovery uses the durable local response after the provider has discarded its copy", async (t) => {
  const rootDirectory = await workspace(t);
  const first = await runExperiment({
    fixtureId: "storage-recovery",
    rootDirectory,
  });
  await rm(join(rootDirectory, "_fake-provider", `${first.id}.json`));
  const recovered = await runExperiment({
    fixtureId: "storage-recovery",
    rootDirectory,
  });
  assert.equal(recovered.status, "delivered");
  assert.equal(recovered.dispatchCount, 1);
  assert.equal(recovered.expenses.length, 1);
  assert.equal(recovered.allowance.heldSimulatedExpenseUsd, "0.000000");
  assert.deepEqual(await readdir(join(rootDirectory, "_fake-provider")), []);
  assert.ok(recovered.events.some((event) => event.type === "reconcile-local"));
});

test("a corrupted local response stops recovery without another request or losing its allowance", async (t) => {
  const rootDirectory = await workspace(t);
  const first = await runExperiment({
    fixtureId: "storage-recovery",
    rootDirectory,
  });
  const responsePath = join(rootDirectory, first.id, "provider-response.json");
  const response = JSON.parse(await readFile(responsePath, "utf8"));
  response.panels[0].svg = response.panels[0].svg.replace("#141d34", "#ffffff");
  await writeFile(responsePath, canonicalJson(response));
  await assert.rejects(
    runExperiment({ fixtureId: "storage-recovery", rootDirectory }),
    /response.*digest mismatch/i,
  );
  const stillHeld = await inspectExperiment(first.id, rootDirectory);
  assert.equal(stillHeld.status, "storing");
  assert.equal(stillHeld.allowance.heldSimulatedExpenseUsd, "0.100000");
  assert.equal(stillHeld.dispatchCount, 1);
});

test("an older response without a recorded digest still requires a valid bound response structure", async (t) => {
  const rootDirectory = await workspace(t);
  const first = await runExperiment({
    fixtureId: "storage-recovery",
    rootDirectory,
  });
  const recordPath = join(rootDirectory, first.id, "record.json");
  const record = JSON.parse(await readFile(recordPath, "utf8"));
  delete record.providerResponseDigest;
  await writeFile(recordPath, canonicalJson(record));
  const responsePath = join(rootDirectory, first.id, "provider-response.json");
  const response = JSON.parse(await readFile(responsePath, "utf8"));
  response.usage = null;
  await writeFile(responsePath, canonicalJson(response));
  await assert.rejects(
    runExperiment({ fixtureId: "storage-recovery", rootDirectory }),
    /Invalid saved provider response/,
  );
});

test("an incomplete two-panel result records expense without claiming billable delivery", async (t) => {
  const rootDirectory = await workspace(t);
  const failed = await runExperiment({
    fixtureId: "invalid-output",
    rootDirectory,
  });
  assert.equal(failed.status, "failed");
  assert.equal(failed.validity.technical, "invalid");
  assert.notEqual(failed.accounting.simulatedProviderExpenseUsd, "0.000000");
  assert.equal(failed.accounting.proposedBillableGenerationUsd, "0.000000");
  assert.equal(failed.accounting.selectedEligibleReuseBasisUsd, null);
  assert.deepEqual(
    await runExperiment({ fixtureId: "invalid-output", rootDirectory }),
    failed,
  );
});

test("input identity reuse, insufficient allowance and path traversal fail before another dispatch", async (t) => {
  const rootDirectory = await workspace(t);
  await runExperiment({ fixtureId: "seed", attemptId: "fixed", rootDirectory });
  await assert.rejects(
    runExperiment({
      fixtureId: "continuation",
      attemptId: "fixed",
      rootDirectory,
    }),
    /different immutable inputs/,
  );
  await assert.rejects(
    runExperiment({
      fixtureId: "seed",
      attemptId: "..\/escape",
      rootDirectory,
    }),
    /Attempt ID/,
  );
  await assert.rejects(
    runExperiment({
      fixtureId: "seed",
      attemptId: "too-small",
      rootDirectory,
      maximumSimulatedExpenseUsd: "0.000001",
    }),
    /allowance cannot cover/,
  );
  assert.deepEqual(await readdir(join(rootDirectory, "_fake-provider")), [
    "fixed.json",
  ]);
});

test("concurrent starts for the same attempt admit one dispatch", async (t) => {
  const rootDirectory = await workspace(t);
  const outcomes = await Promise.allSettled(
    Array.from({ length: 8 }, () =>
      runExperiment({ fixtureId: "continuation", rootDirectory }),
    ),
  );
  const delivered = outcomes.filter((result) => result.status === "fulfilled");
  assert.ok(delivered.length >= 1);
  for (const outcome of outcomes) {
    if (outcome.status === "rejected")
      assert.match(outcome.reason.message, /locked/);
    else assert.equal(outcome.value.dispatchCount, 1);
  }
  assert.equal(
    (await inspectExperiment("continuation-local", rootDirectory))
      .dispatchCount,
    1,
  );
  const request = JSON.parse(
    await readFile(
      join(rootDirectory, "_fake-provider", "continuation-local.json"),
      "utf8",
    ),
  );
  assert.equal(request.acceptedCount, 1);
});

test("artifact tampering is detected by inspect and repeat-run without regeneration", async (t) => {
  const rootDirectory = await workspace(t);
  const record = await runExperiment({ fixtureId: "seed", rootDirectory });
  await writeFile(join(rootDirectory, record.id, "panel-1.svg"), "tampered");
  await assert.rejects(
    inspectExperiment(record.id, rootDirectory),
    /digest mismatch/,
  );
  await assert.rejects(
    runExperiment({ fixtureId: "seed", rootDirectory }),
    /digest mismatch/,
  );
});

test("persisted records reject empty, missing, duplicate and traversal artifact manifests", async (t) => {
  const rootDirectory = await workspace(t);
  const mutations: Array<(record: ExperimentRecord) => void> = [
    (record) => {
      record.artifacts = [];
    },
    (record) => {
      record.artifacts = record.artifacts.filter(
        (artifact) => artifact.path !== "panel-2.svg",
      );
    },
    (record) => {
      record.artifacts[1] = { ...record.artifacts[0]! };
    },
    (record) => {
      record.artifacts[0] = {
        path: "../marker.txt",
        sha256: digest("outside"),
        bytes: 7,
      };
    },
  ];
  await writeFile(join(rootDirectory, "marker.txt"), "outside");
  for (const [index, mutate] of mutations.entries()) {
    const record = await runExperiment({
      fixtureId: "seed",
      rootDirectory,
      attemptId: `malformed-${index}`,
    });
    mutate(record);
    await writeFile(
      join(rootDirectory, record.id, "record.json"),
      canonicalJson(record),
    );
    await assert.rejects(
      inspectExperiment(record.id, rootDirectory),
      /Invalid persisted experiment record/,
    );
    await assert.rejects(
      runExperiment({ fixtureId: "seed", rootDirectory, attemptId: record.id }),
      /Invalid persisted experiment record/,
    );
  }
  assert.equal(
    await readFile(join(rootDirectory, "marker.txt"), "utf8"),
    "outside",
  );
});

test("safe artifact names cannot escape the directory through symlinks", async (t) => {
  const rootDirectory = await workspace(t);
  const record = await runExperiment({ fixtureId: "seed", rootDirectory });
  const panelPath = join(rootDirectory, record.id, "panel-1.svg");
  const outsidePath = join(rootDirectory, "same-content.svg");
  await writeFile(outsidePath, await readFile(panelPath));
  await rm(panelPath);
  await symlink(outsidePath, panelPath);
  await assert.rejects(
    inspectExperiment(record.id, rootDirectory),
    /symbolic link|symlink/i,
  );
});

test("a digest-updated candidate still must declare both panels and the correct identity", async (t) => {
  const rootDirectory = await workspace(t);
  const record = await runExperiment({ fixtureId: "seed", rootDirectory });
  const manifestPath = join(rootDirectory, record.id, "candidate.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.panels = [];
  const content = canonicalJson(manifest);
  await writeFile(manifestPath, content);
  const artifact = record.artifacts.find(
    (item) => item.path === "candidate.json",
  )!;
  artifact.sha256 = digest(content);
  artifact.bytes = Buffer.byteLength(content);
  await writeFile(
    join(rootDirectory, record.id, "record.json"),
    canonicalJson(record),
  );
  await assert.rejects(
    inspectExperiment(record.id, rootDirectory),
    /Invalid candidate manifest/,
  );
});

test("an updated media digest cannot hide incorrect SVG dimensions", async (t) => {
  const rootDirectory = await workspace(t);
  const record = await runExperiment({ fixtureId: "seed", rootDirectory });
  const panelPath = join(rootDirectory, record.id, "panel-1.svg");
  const content = (await readFile(panelPath, "utf8")).replace(
    'width="1024"',
    'width="1"',
  );
  await writeFile(panelPath, content);
  record.artifacts[0]!.sha256 = digest(content);
  record.artifacts[0]!.bytes = Buffer.byteLength(content);
  await writeFile(
    join(rootDirectory, record.id, "record.json"),
    canonicalJson(record),
  );
  await assert.rejects(
    inspectExperiment(record.id, rootDirectory),
    /Invalid deterministic SVG panel/,
  );
});

test("persisted record structure and status are checked before inspection", async (t) => {
  const rootDirectory = await workspace(t);
  const record = await runExperiment({ fixtureId: "seed", rootDirectory });
  await writeFile(
    join(rootDirectory, record.id, "record.json"),
    canonicalJson({ ...record, status: "published-on-mainnet" }),
  );
  await assert.rejects(
    inspectExperiment(record.id, rootDirectory),
    /Invalid persisted experiment record/,
  );
});

test("the deterministic runner rejects paid execution even with credentials and a budget", async (t) => {
  const rootDirectory = await workspace(t);
  assert.throws(
    () => requirePaidAdapter(undefined),
    /API key and explicit positive/,
  );
  assert.throws(
    () => requirePaidAdapter({ apiKey: "do-not-log", approvedBudgetUsd: "0" }),
    /positive/,
  );
  assert.throws(
    () =>
      requirePaidAdapter({ apiKey: "do-not-log", approvedBudgetUsd: "1.00" }),
    /separate experiment:openai/,
  );
  await assert.rejects(
    runExperiment({ fixtureId: "seed", rootDirectory, provider: "paid" }),
    /Paid execution is disabled/,
  );
  assert.deepEqual(await readdir(rootDirectory), []);
});
