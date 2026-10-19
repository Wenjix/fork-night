#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, open, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { Wallet, parseEther } from "ethers";
import { WREN } from "../../src/lib/agents/wren.ts";
import { releaseConfig } from "../../src/lib/onchain/config.ts";
import { TERMS_HASH } from "../../src/lib/onchain/model.ts";
import { advanceMission, authorize, newMissionState, policyDigest, RESIDENT_ORIGIN, RESIDENT_ROOM, validatePolicy, validateState } from "./resident-mission.mjs";
import { inspectMission, missionPorts, readJson, writePrivate } from "./resident-runtime.mjs";

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  dir: { type: "string" }, session: { type: "string" }, parent: { type: "string" }, brief: { type: "string" }, live: { type: "boolean" },
} });
const command = positionals[0];
const ensure = (ok, message) => { if (!ok) throw new Error(message); };
let ports, lockFile, lockHandle;
try {
  ensure(["prepare", "status", "run"].includes(command) && values.dir,
    "Usage: resident.mjs prepare --dir .local/wren-resident --parent UUID --brief TEXT | status --dir DIR | run --dir DIR --session EXISTING_SESSION --live");
  const directory = resolve(values.dir);
  ensure(directory.split(/[\\/]/).includes(".local"), "Keep the mission, its wallet and approvals inside an ignored .local directory.");
  const policyFile = join(directory, "policy.json"), stateFile = join(directory, "state.json");
  if (command === "prepare") {
    ensure(!existsSync(directory), "This mission directory already exists. Inspect or resume it; do not replace its state.");
    const config = releaseConfig();
    ensure(config?.chainId === 10143 && values.parent && values.brief, "Provide the parent, creative brief and Monad testnet configuration.");
    const wallet = Wallet.createRandom();
    const policy = validatePolicy({ version: 1, id: randomUUID(), roomId: RESIDENT_ROOM, origin: RESIDENT_ORIGIN,
      parentId: values.parent, makerId: WREN.profileId, byline: WREN.displayName, wallet: wallet.address,
      maxScenes: 3, maxCredits: 3, durationSeconds: 3600, brief: values.brief,
      chainId: 10143, contract: config.address, curator: config.curator, termsHash: TERMS_HASH, maxGasWei: parseEther("0.1").toString() });
    // Local preparation only: no account creation, authorization, model call, signature or transaction.
    await mkdir(directory, { mode: 0o700 });
    await writePrivate(join(directory, "wallet.json"), { address: wallet.address, privateKey: wallet.privateKey });
    await writePrivate(policyFile, policy);
    await writePrivate(stateFile, newMissionState(policy));
    console.log(JSON.stringify({ status: "prepared-not-authorized", policy, policyDigest: policyDigest(policy) }, null, 2));
  } else {
    const policy = validatePolicy(await readJson(policyFile)), state = await readJson(stateFile);
    validateState(policy, state);
    if (command === "status") {
      const live = await inspectMission(policy);
      console.log(JSON.stringify({ status: state.completedAt ? "complete" : state.halted ? "halted" : "prepared",
        ...live, halted: state.halted ?? null, completedAt: state.completedAt ?? null,
        turns: state.turns.map(t => ({ number: t.number, operationId: t.operationId, momentId: t.momentId, reviewed: t.review?.ok, transaction: t.registration?.hash })),
        hasActivationRecord: existsSync(join(directory, "approval.json")), stopped: existsSync(join(directory, "STOP")) }, null, 2));
    } else {
      ensure(values.live && values.session, "Live execution needs --live and Wren's existing session file.");
      const approval = await readJson(join(directory, "approval.json")).catch(() => null);
      authorize(policy, approval);
      ensure(!existsSync(join(directory, "STOP")), "The resident mission is stopped.");
      ensure(process.env.OPENAI_API_KEY, "Configure the bounded vision reviewer before starting any generation.");
      // Share the original agent's lock so refreshing the session cannot race another Wren process.
      lockFile = join(dirname(resolve(values.session)), "lock");
      lockHandle = await open(lockFile, "wx", 0o600);
      await lockHandle.writeFile(JSON.stringify({ pid: process.pid, command: "resident", startedAt: new Date().toISOString(), mission: policy.id }));
      await lockHandle.sync();
      ports = await missionPorts({ policy, approval, directory, sessionFile: resolve(values.session) });
      for (;;) {
        const result = await advanceMission({ policy, approval, state, ports, save: value => writePrivate(stateFile, value) });
        // The saved raw transactions and credentials never appear in the console or public proof.
        console.log(JSON.stringify({ at: new Date().toISOString(), ...result }));
        if (!["pending", "pending-registration"].includes(result.status)) break;
        await new Promise(done => setTimeout(done, 15000));
      }
    }
  }
} catch (error) {
  console.error(error.code === "EEXIST" ? "Wren already has a lock. Check the running process before resuming." :
    error.code === "ENOENT" ? "A required saved mission or session file is missing. No replacement identity will be created." :
    // Provider errors can contain signed payloads; only our own Error messages are suitable for output.
    error.code ? "The mission stopped on a provider or filesystem error. Its saved state is retained." : error.message);
  process.exitCode = 1;
} finally {
  ports?.close();
  if (lockHandle) { await lockHandle.close(); await rm(lockFile); }
}
