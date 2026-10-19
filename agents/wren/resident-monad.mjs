import { Interface, Transaction, ZeroAddress, keccak256 } from "ethers";
import { releaseAbi } from "../../src/lib/onchain/abi.ts";
import { operationArgs } from "../../src/lib/onchain/client.ts";
import { prepareRelease, sameAddress } from "../../src/lib/onchain/model.ts";
import { checkMoment } from "./resident-mission.mjs";

const abi = new Interface(releaseAbi);
const ensure = (ok, message) => { if (!ok) throw new Error(message); };

export function registrationData(policy, turn, moments) {
  const moment = moments.find(m => m.id === turn.momentId);
  checkMoment(policy, turn, moment);
  // Use the published rows verbatim, including their serialized timestamps.
  const prepared = prepareRelease(moments, policy.roomId, moment.id, policy.curator);
  const args = operationArgs(prepared, "register", prepared.scenes.length - 1);
  return { prepared, args, data: abi.encodeFunctionData("registerMoment", args) };
}

/** App-enforced signer limits, not a claim that an ordinary EOA is an onchain session key. */
export function validateSignedRegistration(policy, turn, state, data) {
  const saved = turn.registration;
  ensure(saved?.raw && saved.hash === keccak256(saved.raw), "The saved registration hash changed.");
  const tx = Transaction.from(saved.raw);
  ensure(sameAddress(tx.from ?? "", policy.wallet) && sameAddress(tx.to ?? "", policy.contract) && tx.chainId === BigInt(policy.chainId), "Registration signer, chain or contract changed.");
  ensure(tx.type === 0 && tx.value === 0n && tx.data === data && tx.gasLimit > 0n && tx.gasLimit <= 300000n && tx.gasPrice > 0n,
    "The signer permits only this zero-value scene registration, with at most 300,000 gas.");
  const all = state.turns.filter(t => t.registration);
  ensure(all.length <= policy.maxScenes && all.every(t => t.momentId), "A registration must belong to a published mission scene.");
  let committed = 0n;
  for (const [index, item] of all.entries()) {
    const signed = Transaction.from(item.registration.raw);
    ensure(signed.nonce === (policy.initialNonce ?? 0) + index && signed.type === 0 && signed.gasPrice > 0n && signed.gasLimit > 0n && signed.gasLimit <= 300000n,
      "Use this mission's approved starting nonce with exactly one nonce per scene.");
    committed += signed.gasLimit * signed.gasPrice;
  }
  ensure(committed <= BigInt(policy.maxGasWei), "The cumulative registration gas commitment exceeds the mission cap.");
  return tx;
}

export function residentRegistrar({ policy, client, wallet, readMoments }) {
  ensure(sameAddress(wallet.address, policy.wallet), "The local signer is not this mission's Wren wallet.");
  ensure(client.config.chainId === policy.chainId && sameAddress(client.config.address, policy.contract) && sameAddress(client.config.curator, policy.curator),
    "The release connection differs from the approved mission.");
  return async (turn, state, save, gate) => {
    const { prepared, args, data } = registrationData(policy, turn, await readMoments());
    await client.verify();
    let snapshot = await client.load(prepared);
    const target = snapshot.scenes.at(-1);
    ensure(snapshot.termsMatch && sameAddress(target.maker, policy.wallet), "Wren's byline is not approved for this wallet.");
    ensure(snapshot.scenes.slice(0, -1).every(s => s.registered && s.matches), "Register the complete parent path first.");
    if (target.registered && !turn.registration) throw new Error("This scene was registered outside the saved mission; reconcile its receipt first.");
    if (!turn.registration) {
      gate();
      const provider = client.provider;
      const [estimate, fees, nonce, pending, balance] = await Promise.all([
        client.contract.registerMoment.estimateGas(...args, { from: policy.wallet }), provider.getFeeData(),
        provider.getTransactionCount(policy.wallet, "latest"), provider.getTransactionCount(policy.wallet, "pending"), provider.getBalance(policy.wallet),
      ]);
      ensure(nonce === (policy.initialNonce ?? 0) + turn.number - 1 && pending === nonce, "The mission wallet has another or unresolved transaction.");
      const gasLimit = (estimate * 120n + 99n) / 100n, gasPrice = fees.gasPrice;
      ensure(gasLimit <= 300000n && gasPrice && gasPrice > 0n, "The registration estimate exceeds the permitted gas limit.");
      ensure(balance >= gasLimit * gasPrice, "Wren's Monad wallet needs test MON for registration gas.");
      const committed = state.turns.reduce((total, t) => {
        if (!t.registration) return total;
        const tx = Transaction.from(t.registration.raw); return total + tx.gasLimit * tx.gasPrice;
      }, 0n);
      ensure(committed + gasLimit * gasPrice <= BigInt(policy.maxGasWei), "The remaining mission gas cap cannot cover this registration.");
      gate();
      const raw = await wallet.signTransaction({ type: 0, chainId: policy.chainId, to: policy.contract, value: 0n, data, nonce, gasLimit, gasPrice });
      turn.registration = { raw, hash: keccak256(raw) };
      validateSignedRegistration(policy, turn, state, data);
      // A signed payload stays private and is fsynced before any broadcast.
      await save(state);
    }
    validateSignedRegistration(policy, turn, state, data);
    const receipt = await client.provider.getTransactionReceipt(turn.registration.hash);
    if (receipt) {
      ensure(receipt.status === 1 && sameAddress(receipt.from, policy.wallet) && sameAddress(receipt.to ?? ZeroAddress, policy.contract), "Wren's saved registration reverted or belongs to another sender.");
      if (await client.provider.getBlockNumber() < receipt.blockNumber + 1) return false;
      snapshot = await client.load(prepared);
      ensure(snapshot.scenes.at(-1).registered && snapshot.scenes.at(-1).matches, "The receipt does not match the published scene manifest.");
      turn.registration.block = receipt.blockNumber;
      turn.registration.gasUsed = receipt.gasUsed.toString();
      turn.registration.feeWei = receipt.fee.toString();
      await save(state);
      return true;
    }
    ensure(!target.registered, "The scene exists but this transaction is not confirmed; stop to reconcile.");
    const known = await client.provider.getTransaction(turn.registration.hash);
    if (!known) {
      gate();
      // A lost RPC answer leaves the identical raw transaction for the next check.
      try { await client.provider.broadcastTransaction(turn.registration.raw); }
      catch { return false; }
    }
    return false;
  };
}
