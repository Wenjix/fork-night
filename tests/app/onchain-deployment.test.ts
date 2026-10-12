import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { promisify } from "node:util";

const run = promisify(execFile);
const script = fileURLToPath(new URL("../../scripts/deploy-releases.mjs", import.meta.url));
const { resolveDeploymentCurator }: { resolveDeploymentCurator: (deployer: string, curator?: string) => string } = await import(pathToFileURL(script).href);
const deployer = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const curator = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

test("deployment preserves an explicitly configured curator distinct from the signer", () => {
  assert.equal(resolveDeploymentCurator(deployer, curator), curator);
  assert.equal(resolveDeploymentCurator(deployer, curator.toLowerCase()), curator);
});
test("deployment uses the signer as curator only when the public curator setting is empty", () => {
  assert.equal(resolveDeploymentCurator(deployer), deployer);
  assert.equal(resolveDeploymentCurator(deployer, ""), deployer);
});
test("deployment rejects malformed and zero curator addresses", () => {
  assert.throws(() => resolveDeploymentCurator(deployer, "not-an-address"), /valid Ethereum address/);
  assert.throws(() => resolveDeploymentCurator(deployer, "0x0000000000000000000000000000000000000000"), /zero address/);
});
test("an invalid curator stops the CLI before compilation or RPC", async t => {
  const dir = await mkdtemp(join(tmpdir(), "fork-night-deploy-")); t.after(() => rm(dir, { recursive: true, force: true }));
  await assert.rejects(run(process.execPath, [script], { cwd: dir, env: { ...process.env, MONAD_DEPLOYER_PRIVATE_KEY: "0x" + "01".repeat(32), NEXT_PUBLIC_MONAD_CURATOR_ADDRESS: "not-an-address", SOLC_BIN: join(dir, "missing-solc") } }), error => {
    assert.match((error as { stderr: string }).stderr, /valid Ethereum address/); return true;
  });
});

test("deployment needs an explicitly configured local wallet before any RPC or signing", async t => {
  const dir = await mkdtemp(join(tmpdir(), "fork-night-deploy-")); t.after(() => rm(dir, { recursive: true, force: true }));
  await assert.rejects(run(process.execPath, [script], { cwd: dir, env: { ...process.env, MONAD_DEPLOYER_PRIVATE_KEY: "" } }), error => {
    assert.match((error as { stderr: string }).stderr, /Set MONAD_DEPLOYER_PRIVATE_KEY locally/); return true;
  });
});
test("an existing deployment intent prevents another deployment even without a key", async t => {
  const dir = await mkdtemp(join(tmpdir(), "fork-night-deploy-")); t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, ".local/contracts"), { recursive: true });
  await writeFile(join(dir, ".local/contracts/monad-deployment.pending.json"), JSON.stringify({ predictedAddress: "0x0000000000000000000000000000000000000001", nonce: 0 }));
  await assert.rejects(run(process.execPath, [script], { cwd: dir, env: { ...process.env, MONAD_DEPLOYER_PRIVATE_KEY: "" } }), error => {
    assert.match((error as { stderr: string }).stderr, /deployment intent or receipt already exists/); return true;
  });
});
