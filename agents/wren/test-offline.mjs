// Offline checks for Wren's payment hygiene: a door-shaped MPP challenge made by mppx's own server code
// (in memory, no network, nothing signed) must pass checkChallenge; wrong recipient, amount or chain must not.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { Challenge } from "mppx";
import { Mppx, Store, tempo as tempoServer } from "mppx/server";
import { createClient, http } from "viem";
import { tempoModerato } from "viem/tempo/chains";
import { checkChallenge, NIGHT_SHIFT_DOOR, PATHUSD, refusalOf } from "./pay.mjs";

const cfg = JSON.parse(await readFile(new URL(existsSync(new URL("./config.json", import.meta.url)) ? "./config.json" : "./config.example.json", import.meta.url), "utf8")); // offline tests need only the public fields
assert.equal(cfg.mpp.doorUrl, NIGHT_SHIFT_DOOR, "config door must be the pinned night-shift door");
const client = createClient({ chain: tempoModerato, transport: http("http://127.0.0.1:9") });
async function offer({ recipient = cfg.mpp.payTo, amount = "1" } = {}) {
  const mppx = Mppx.create({
    secretKey: randomBytes(32).toString("base64url"), realm: "fork-night-mpp-door",
    methods: [tempoServer.charge({ currencies: [PATHUSD], recipient, chainId: tempoModerato.id, testnet: true, supportedModes: ["pull"],
      waitForConfirmation: true, store: Store.memory(), getClient: () => client })],
  });
  const challenge = await mppx.challenge.tempo.charge({ amount, meta: { room: "test" } });
  return Challenge.deserialize(Challenge.serialize(challenge));
}
const good = await offer();
console.log("door-shaped offer:", JSON.stringify({ method: good.method, intent: good.intent, amount: good.request.amount, recipient: good.request.recipient, chainId: good.request.methodDetails?.chainId, modes: good.request.methodDetails?.supportedModes, expires: good.expires }));
assert.equal(checkChallenge(good, cfg), null, "a door-shaped offer must pass");
assert.match(checkChallenge(await offer({ recipient: "0x30c56c01E00a139A9A6aB28Ee5Bc7d5b1d8aE861" }), cfg), /recipient/);
assert.match(checkChallenge(await offer({ amount: "2" }), cfg), /exactly/);
assert.match(checkChallenge({ ...good, request: { ...good.request, methodDetails: { ...good.request.methodDetails, chainId: 4217 } } }, cfg), /Moderato/);
assert.match(checkChallenge({ ...good, expires: new Date(Date.now() - 1000).toISOString() }, cfg), /expiry/);
assert.equal(refusalOf({ shortMessage: "Execution reverted with reason: Account keychain error: SpendingLimitExceeded(SpendingLimitExceeded)" }).name, "SpendingLimitExceeded");
assert.equal(refusalOf({ shortMessage: "x", details: "Account keychain error: CallNotAllowed(CallNotAllowed)" }).name, "CallNotAllowed");
console.log("offline payment hygiene checks passed");
