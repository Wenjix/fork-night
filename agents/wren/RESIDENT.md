# Wren's Kessler mission

`resident.mjs` runs one bounded, resumable contribution in Kessler Ward. It uses Wren's existing **Wren (AI agent)** guest identity. The operator starts the mission once; the runner chooses each next scene through the story helper, generates one panel, checks its pixels and continuity, and publishes passing scenes. Each scene continues the previous one.

The live mission completed on October 18, 2026 (October 19 at 02:07 UTC). Wren published three linked scenes, requested its byline's wallet approval, and signed all three Monad registrations after the curator approved that wallet once. The seven-scene ancestry matches its stored manifests. Local state-machine and actual-contract tests cover recovery and limits separately.

## Live result

[Read Wren's branch in Kessler Ward](https://fork-night.vercel.app/pilot?room=kessler-ward&moment=e56773e9-8568-424c-80f8-97145ef96255). Wren continues Burkes's battery scene under **Wren (AI agent)**. All three registrations were sent by its dedicated wallet, `0x6fF4db835c151c7e2089C9d80A940217cb0D0207`.

| Scene | Monad registration | Block |
| --- | --- | --- |
| First continuation | [View receipt](https://testnet.monadscan.com/tx/0x70a564a00693c8aefc06b59766c4e2b8384ce172d3c727be059a31ed5781329c) | 72,266,786 |
| Second continuation | [View receipt](https://testnet.monadscan.com/tx/0x6f135c481ab09792729cd053c7e15178a55e607d4855375ffa7cdb3e7417eeda) | 72,266,845 |
| Third continuation | [View receipt](https://testnet.monadscan.com/tx/0x4c1c3eb7ceb76a8b5d7466580967dc4dadfd820c1a5a6b5b036a4a702df69a19) | 72,266,903 |

The mission used three existing room credits, three planning calls, three image generations and four vision checks. One explicitly approved recheck corrected a reviewer that had mistaken choosing one branch for a mismatch. The original failed verdict remains counted. Registration gas totaled **0.06451398 test MON** of the 0.1 cap; 0.03548602 test MON remained in Wren's wallet. The operator's initial 0.1-test-MON funding transfer used a separate 0.002142-test-MON fee. No new credit top-up, release freeze, support payment or claim was made.

The three captions repeat Kenji's battery handoff instead of developing distinct consequences. This result demonstrates bounded autonomous execution and attribution; story planning needs a dedicated progression pass before this branch becomes the storytelling showcase. The October 12 Uncharted Star and Tempo receipts remain a separate demonstration.

## What is authorized

The saved policy fixes the starting scene, room, byline, wallet, brief, contract and release terms. An operator activation record must match its SHA-256 digest and expire within one hour. The mission permits:

- At most three planning requests, three one-panel generation attempts and three vision reviews. A failed or uncertain review stops the mission with the image private. No replacement attempt is purchased.
- At most three public scenes and three zero-value `registerMoment` transactions. The cumulative maximum gas commitment is 0.1 test MON. Each transaction is limited to 300,000 gas.
- One wallet request for Wren's byline. This does not grant curator permissions.

Existing guest, room, helper and global inference limits still apply. The runner uses the ordinary hosted story-helper and generation endpoints; it cannot purchase credits or change budgets. Planning and images remain inside their existing service limits. The three bounded vision calls use the operator's configured OpenAI key and are additional provider usage.

An operator can explicitly approve one correction to a known failed review by issuing a revised policy with `maxVisionReviews: 4` and `recheckOperationId` naming that exact operation, then binding a new approval to its digest. This rechecks the same pixels once, preserves the first verdict and its consumed call in `reviewHistory`, and retains the three-scene, three-credit and gas caps. It cannot retry an uncertain review, recheck changed pixels, or automatically revisit another failure. The original reviewer incorrectly treated selecting one story option as a caption mismatch; the revised instructions assess the candidate image against its own caption and allow a branch to choose one option. Existing in-world floor numbers are allowed; overlays and watermarks are rejected.

These are restrictions in the trusted runner and its signer. The dedicated Monad wallet is an ordinary EOA; the contract does not enforce the three-scene limit or one-hour expiry. The private key never reaches the language model. Wren's separate Tempo authorization has its own onchain spending restrictions and is not reused as a Monad key.

## Admission and execution

The initial ancestry must already match its Monad registrations. Choose a published one-panel contribution with a recorded image hash; its image is the continuity reference. The mission saves IDs before requests and never creates another guest identity. It publishes up to three passing scenes before requesting approval for its wallet.

The curator then approves **Wren (AI agent)** once through the room's existing wallet-request controls. Fund the prepared Wren address with at most 0.1 test MON for gas. Resume the same mission: Wren signs and registers its three scenes in order. No human signs those registration transactions. The mission does not freeze a release, send support or claim proceeds.

The new wallet must have no prior transactions. This runner implements a single demonstration; subsequent missions and a long-lived signing service need a separate policy. Starting a fresh directory is not a way to reset Wren's existing service allowances or onchain byline binding.

## Operator commands

Use Node 22.18+ from the repository root. Load the existing public Supabase and Monad configuration using your normal environment mechanism. `run` also needs `OPENAI_API_KEY` for the three vision checks. Do not use a Supabase service-role key.

```sh
node --env-file=.env.local agents/wren/resident.mjs prepare \
  --dir .local/wren-resident --parent PUBLISHED_MOMENT_UUID \
  --brief 'Continue the battery dilemma, follow its consequences, and leave a choice for a human.'

node --env-file=.env.local agents/wren/resident.mjs status --dir .local/wren-resident
```

`prepare` creates only local files and a fresh, unfunded wallet. It does not sign, authorize, call a model or write to production. `status` reads public story and chain data. Review `policy.json` and the live status before activating. Following the operator's explicit approval of this exact policy and release terms, write `.local/wren-resident/approval.json` with:

```json
{
  "policyDigest": "SHA256_PRINTED_BY_PREPARE",
  "publish": true,
  "termsHash": "CURRENT_TERMS_HASH_FROM_POLICY",
  "authorizedAt": "ACTIVATION_TIME_ISO",
  "expiresAt": "AT_MOST_ONE_HOUR_AFTER_ACTIVATION"
}
```

The activation record is a local operator control, not a cryptographic delegation. Keep the policy, approval, signer and state under operator control. Then run with Wren's original persisted session:

```sh
node --env-file=.env.local agents/wren/resident.mjs run \
  --dir .local/wren-resident \
  --session .local/protocol-extras/agent-room/agent-state/session.json --live
```

The runner shares the old agent's session lock. If the process was interrupted, verify that it exited before removing its stale lock. Resume using the same command and saved directory. A lost publication acknowledgement reuses its operation; a lost transaction acknowledgement reuses its exact signed payload. Signed payloads are saved privately and fsynced before broadcast. Confirmed transactions require a matching stored scene and an additional block.

Create `.local/wren-resident/STOP` to prevent further generation requests, publication, wallet requests and signing/broadcast. An already admitted image may finish privately, and a broadcast transaction may still settle. Expiry works the same way. An expired mission needs a new explicit operator decision before extending its authorization; do not erase its history or replace its wallet.

## Verification

```sh
node --test tests/repository/wren-resident.test.mjs
node --test tests/contracts/wren-resident.test.mjs
```

The contract tests deploy the real release bytecode in a local EVM, exercise curator admission, register three linked scenes, and simulate a lost broadcast acknowledgement. They also check the gas cap, parent ordering and a stop immediately before signing. Local fixtures and signatures are not production evidence.
