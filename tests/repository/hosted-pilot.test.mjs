import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { parseEnv } from "node:util";
import { prepareHostedPilot, selectHostedSettings } from "../../scripts/prepare-hosted-pilot.mjs";

const env = {
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  SUPABASE_SECRET_KEY: "sb_secret_test",
  OPENAI_API_KEY: "sk-provider-test",
  TRIGGER_SECRET_KEY: "tr_prod_sk_test",
  NEXT_PUBLIC_MONAD_CHAIN_ID: "10143",
  NEXT_PUBLIC_MONAD_RPC_URL: "https://testnet-rpc.monad.xyz",
  NEXT_PUBLIC_MONAD_RELEASE_ADDRESS: "0x15247565331013132e5563Cd29E99E0baA38690f",
  NEXT_PUBLIC_MONAD_CURATOR_ADDRESS: "0x744D5A0D982752DBd1414Aa2898d57Da9E30645B",
  FORK_NIGHT_PUBLIC_URL: "https://fork-night.vercel.app/",
  MONAD_DEPLOYER_PRIVATE_KEY: "PRIVATE_DEPLOYER_SENTINEL",
  VERCEL_TOKEN: "PRIVATE_HOSTING_SENTINEL",
  PILOT_LOCAL_CONTROLS: "1",
};

test("hosted settings exclude unrelated credentials and separate worker access from web access", () => {
  const selected = selectHostedSettings(env);
  assert.deepEqual(selected.missingWeb, []);
  assert.deepEqual(selected.missingWorker, []);
  assert.equal(selected.web.PILOT_LOCAL_CONTROLS, "0");
  assert.equal(selected.web.FORK_NIGHT_PUBLIC_URL, "https://fork-night.vercel.app");
  assert.equal(selected.worker.OPENAI_API_KEY, env.OPENAI_API_KEY);
  assert.equal(selected.worker.TRIGGER_SECRET_KEY, undefined);
  assert.equal(selected.worker.NEXT_PUBLIC_MONAD_CURATOR_ADDRESS, undefined);
  for (const destination of [selected.web, selected.worker]) {
    assert.equal(destination.MONAD_DEPLOYER_PRIVATE_KEY, undefined);
    assert.equal(destination.VERCEL_TOKEN, undefined);
  }
});

test("a development Trigger key becomes an explicit missing Production setting", () => {
  const selected = selectHostedSettings({ ...env, TRIGGER_SECRET_KEY: "tr_dev_sk_test" });
  assert.equal(selected.web.TRIGGER_SECRET_KEY, "");
  assert.equal(selected.developmentKeyOmitted, true);
  assert.deepEqual(selected.missingWeb, ["TRIGGER_SECRET_KEY"]);
});

test("preparation preserves local files and creates private settings outside the clean source", async t => {
  const root = await mkdtemp(join(tmpdir(), "fork-night-hosted-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifest = JSON.parse(await readFile(new URL("../../config/submission-files.json", import.meta.url), "utf8"));
  for (const file of manifest.files) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), file === "config/submission-files.json" ? JSON.stringify(manifest) : `fixture:${file}`);
  }
  for (const rule of manifest.directories) await mkdir(join(root, rule.path), { recursive: true });
  const local = Object.entries({ ...env, TRIGGER_SECRET_KEY: "tr_dev_sk_test" }).map(([k, v]) => `${k}=${v}\n`).join("");
  const production = "TRIGGER_SECRET_KEY=tr_prod_sk_test\n";
  await writeFile(join(root, ".env.local"), local);
  await writeFile(join(root, ".env.production.local"), production);
  const report = await prepareHostedPilot({ rootDirectory: root, env: {} });
  assert.equal(report.status, "prepared-not-deployed");
  assert.deepEqual(report.missingWeb, []);
  const web = parseEnv(await readFile(report.webEnvironmentFile, "utf8"));
  const worker = parseEnv(await readFile(report.workerEnvironmentFile, "utf8"));
  assert.equal(web.TRIGGER_SECRET_KEY, env.TRIGGER_SECRET_KEY);
  assert.equal(web.PILOT_LOCAL_CONTROLS, "0");
  assert.equal(worker.SUPABASE_SECRET_KEY, env.SUPABASE_SECRET_KEY);
  assert.equal(worker.TRIGGER_SECRET_KEY, undefined);
  for (const file of [report.webEnvironmentFile, report.workerEnvironmentFile]) {
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal(file.startsWith(`${report.sourceDirectory}/`), false);
    assert.equal((await readFile(file, "utf8")).includes("PRIVATE_DEPLOYER_SENTINEL"), false);
  }
  assert.equal((await stat(dirname(report.sourceDirectory))).mode & 0o777, 0o700);
  const inventory = JSON.stringify(report);
  assert.equal(inventory.includes(env.SUPABASE_SECRET_KEY), false);
  assert.equal(inventory.includes(env.TRIGGER_SECRET_KEY), false);
  assert.equal(report.files.some(file => /\.env(\.local|\.production\.local)?$/.test(file.path)), false);
  assert.equal(await readFile(join(root, ".env.local"), "utf8"), local);
  assert.equal(await readFile(join(root, ".env.production.local"), "utf8"), production);
  const next = await prepareHostedPilot({ rootDirectory: root, env: {} });
  assert.notEqual(next.sourceDirectory, report.sourceDirectory);
  assert.deepEqual(next.files, report.files);
});

test("invalid public origins fail without including configuration values in the error", () => {
  for (const url of ["http://fork-night.vercel.app", "https://fork-night.vercel.app/pilot", "https://user:SECRET@fork-night.vercel.app", "https://localhost", "https://fork-night.vercel.app:3005", "https://demo.invalid"]) {
    assert.throws(() => selectHostedSettings({ ...env, FORK_NIGHT_PUBLIC_URL: url }), error => {
      assert.equal(error.message.includes(url), false);
      assert.match(error.message, /public HTTPS origin/);
      return true;
    });
  }
});

test("public Privy settings belong only to the web deployment; private Privy credentials are excluded", () => {
  const selected = selectHostedSettings({ ...env, NEXT_PUBLIC_PRIVY_APP_ID: "public-app-id", NEXT_PUBLIC_PRIVY_CLIENT_ID: "public-client-id", PRIVY_APP_SECRET: "PRIVATE_PRIVY_SENTINEL" });
  assert.equal(selected.web.NEXT_PUBLIC_PRIVY_APP_ID, "public-app-id");
  assert.equal(selected.web.NEXT_PUBLIC_PRIVY_CLIENT_ID, "public-client-id");
  assert.equal(selected.worker.NEXT_PUBLIC_PRIVY_APP_ID, undefined);
  assert.equal(selected.web.PRIVY_APP_SECRET, undefined);
  assert.equal(selected.worker.PRIVY_APP_SECRET, undefined);
});
