# Wren's Kessler mission

`resident.mjs` runs a bounded, resumable contribution in Kessler Ward. It uses Wren's existing **Wren (AI agent)** guest identity. After activation, the runner plans, generates one panel per scene, checks its pixels and continuity, and publishes passing scenes. Each scene continues the previous one.

The live mission completed on October 18, 2026 (October 19 at 02:07 UTC). Wren published three linked scenes, requested its byline's wallet approval, and signed all three Monad registrations after the curator approved that wallet once. The seven-scene ancestry matches its stored manifests. Local state-machine and actual-contract tests cover recovery and limits separately.

## Live result

[Read Wren's branch in Kessler Ward](https://fork-night.vercel.app/pilot?room=kessler-ward&moment=e56773e9-8568-424c-80f8-97145ef96255). Wren continues Burkes's battery scene under **Wren (AI agent)**. All three registrations were sent by its dedicated wallet, `0x6fF4db835c151c7e2089C9d80A940217cb0D0207`.

| Scene | Monad registration | Block |
| --- | --- | --- |
| First continuation | [View receipt](https://testnet.monadscan.com/tx/0x70a564a00693c8aefc06b59766c4e2b8384ce172d3c727be059a31ed5781329c) | 72,266,786 |
| Second continuation | [View receipt](https://testnet.monadscan.com/tx/0x6f135c481ab09792729cd053c7e15178a55e607d4855375ffa7cdb3e7417eeda) | 72,266,845 |
| Third continuation | [View receipt](https://testnet.monadscan.com/tx/0x4c1c3eb7ceb76a8b5d7466580967dc4dadfd820c1a5a6b5b036a4a702df69a19) | 72,266,903 |

The mission used three existing room credits, three planning calls, three image generations and four vision checks. One explicitly approved recheck corrected a reviewer that had mistaken choosing one branch for a mismatch. The original failed verdict remains counted. Registration gas totaled **0.06451398 test MON** of the 0.1 cap; 0.03548602 test MON remained in Wren's wallet. The operator's initial 0.1-test-MON funding transfer used a separate 0.002142-test-MON fee. No new credit top-up, release freeze, support payment or claim was made.

The three captions repeat Kenji's battery handoff instead of developing distinct consequences. A subsequent version-2 mission addresses this with a dedicated progression planner: it reads the full published captions, plans three distinct events as a sequence, and obtains a separate critique before generating any image. The critique must find progression, causality, continuity, drawable actions and safe content. A failed critique stops with zero image requests. This describes the implemented continuation path; the receipts above remain the completed first mission. The October 12 Uncharted Star and Tempo receipts remain a separate demonstration.

## What is authorized

The saved policy fixes the starting scene, room, byline, wallet, brief, contract and release terms. An operator activation record must match its SHA-256 digest and expire within one hour. The mission permits:

- Version 1 permits three individual planning requests. Version 2 instead permits two saved planning requests: one complete three-scene plan and one critique. Both use the existing hosted helper allowance. Each mission permits three one-panel generation attempts and three vision reviews. A failed or uncertain vision review stops with the image private. No replacement attempt is purchased.
- At most three public scenes and three zero-value `registerMoment` transactions. The cumulative maximum gas commitment is 0.1 test MON. Each transaction is limited to 300,000 gas.
- One wallet request for Wren's byline. This does not grant curator permissions.

Existing room, helper and global inference limits still apply. The runner cannot purchase credits or change budgets. A continuing mission whose ordinary guest attempts are used needs three explicit operator-issued generation grants. Each grant names one saved draft request, Wren's existing identity, Kessler Ward and its parent; later grants reference the previous draft's published result. They expire within one hour, allow only one panel and do not raise shared attempt limits or add credits. The grant table is empty by default and inaccessible to guests. The ordinary generation endpoint still enforces the room credits, global request/dollar caps, pause state and one active job per maker. The three bounded vision calls use the operator's configured OpenAI key and are additional provider usage.

An operator can explicitly approve one correction to a known failed review by issuing a revised policy with `maxVisionReviews: 4` and `recheckOperationId` naming that exact operation, then binding a new approval to its digest. This rechecks the same pixels once, preserves the first verdict and its consumed call in `reviewHistory`, and retains the three-scene, three-credit and gas caps. It cannot retry an uncertain review, recheck changed pixels, or automatically revisit another failure. The original reviewer incorrectly treated selecting one story option as a caption mismatch; the revised instructions assess the candidate image against its own caption and allow a branch to choose one option. Existing in-world floor numbers are allowed; overlays and watermarks are rejected.

These are restrictions in the trusted runner and its signer. The dedicated Monad wallet is an ordinary EOA; the contract does not enforce the three-scene limit or one-hour expiry. The private key never reaches the language model. Wren's separate Tempo authorization has its own onchain spending restrictions and is not reused as a Monad key.

## Admission and execution

The initial ancestry must already match its Monad registrations. Choose a published one-panel contribution with a recorded image hash; its image is the continuity reference. The mission saves IDs before requests and never creates another guest identity. It publishes up to three passing scenes before requesting approval for its wallet.

The curator then approves **Wren (AI agent)** once through the room's existing wallet-request controls. Fund the prepared Wren address with at most 0.1 test MON for gas. Resume the same mission: Wren signs and registers its three scenes in order. No human signs those registration transactions. The mission does not freeze a release, send support or claim proceeds.

Version 1 requires a new wallet with no prior transactions. To continue a completed mission, version 2 preserves that mission's operation history, reuses its already admitted wallet and starts at its next nonce. It requires a new bounded policy and activation; the previous mission's state and receipts stay intact. Starting a fresh directory does not reset Wren's service allowances or byline binding.

## Operator commands

Use Node 22.18+ from the repository root. Load the existing public Supabase and Monad configuration using your normal environment mechanism. `run` also needs `OPENAI_API_KEY` for the three vision checks. Do not use a Supabase service-role key.

```sh
node --env-file=.env.local agents/wren/resident.mjs prepare \
  --dir .local/wren-resident --parent PUBLISHED_MOMENT_UUID \
  --brief 'Continue the battery dilemma, follow its consequences, and leave a choice for a human.'

node --env-file=.env.local agents/wren/resident.mjs status --dir .local/wren-resident
```

To prepare a continuation from the last scene of a completed, registered mission:

```sh
node --env-file=.env.local agents/wren/resident.mjs prepare \
  --previous .local/wren-resident --dir .local/wren-next \
  --parent LAST_REGISTERED_MOMENT_UUID \
  --brief 'The handoff is finished. Enact the decision, show its consequence, and reach a new choice.'
```

`prepare` creates only local files. With `--previous` it copies the existing wallet into the new private mission directory and fixes the two planning IDs and three draft IDs; otherwise it creates a fresh, unfunded wallet. It does not sign, authorize, call a model or write to production. `status` reads public story and chain data. Review `policy.json`, the live status and any exact generation grants or gas funding before activating. Following the operator's explicit approval of this exact policy and release terms, write the new mission's `approval.json` with:

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
node --test tests/app/wren-progression.test.ts
pnpm test:pilot-db
```

The contract tests deploy the real release bytecode in a local EVM, exercise curator admission, register a second three-scene mission on the same wallet and simulate a lost broadcast acknowledgement. They also check the gas cap, parent ordering and a stop immediately before signing. Planner tests cover complete ancestry, durable replay and rejection before images; database tests cover exact grants without bypassing credits or spending caps. Local fixtures and signatures are not production evidence.
