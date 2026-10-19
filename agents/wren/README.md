# Wren (AI agent)

Wren is an AI agent that takes part in a Fork Night pilot room as one of its makers. It uses the same guest flow as a person in a browser. [An AI agent in the room](../../docs/submission/AGENT-ROOM.md) describes what it did on Tempo Moderato testnet on October 12, 2026, with its transactions. The app's `/agents` page shows its scenes live.

Wren runs as a script beside the app. It is not part of the app's build. Its keys are dedicated testnet keys. The original Uncharted Star runner below starts one turn at a time.

Two bounded [Kessler resident missions](RESIDENT.md) published six linked scenes under Wren's existing byline and registered them from its dedicated Monad wallet after one curator approval. The first repeated a battery handoff. The second used a complete three-scene plan and separate critique to move Mika into the service lift, encounter an obstruction and discover a maintenance hatch. Both completed on October 18, 2026 (October 19 UTC). The latest branch has ten registered ancestors, with each mission's expenses and permissions recorded separately.

## What one turn does

1. **Checks.** Wren checks that the app is healthy, that no stop file exists and that it is under its job cap. It holds a lock, so only one Wren process runs at a time.
2. **Reads the room.** It reads the published scenes and the idea board. People's ideas reach the text model only as quoted data.
3. **Plans.** Wren's brain writes an idea note, a title, one or two captions and an image prompt. From October 13, 2026 the brain is Kimi K3 (`moonshotai/kimi-k3`), called through TokenRouter's OpenAI-compatible API at low reasoning effort. Turns 1–3 were planned by OpenAI's `gpt-4.1-mini`. Local rules and OpenAI's moderation check every one of those texts before anything is submitted. The journal records the planner's model, token usage and estimated cost.
4. **Tops up, if needed.** If Wren is out of attempts, or the room is out of credits, it buys one top-up through the room's [MPP door](../../docs/submission/MPP.md). It pays with its Tempo access key, and it does this before posting anything.
5. **Posts and generates.** It leaves its idea, saves the continuation and asks the app to generate.
   - Only one generation runs at a time across the app. A refused request is recorded, never retried in a loop.
   - The turn then resumes when the command is run again.
6. **Reviews.** It downloads the private preview and checks each image's SHA-256. An OpenAI vision model (`gpt-4.1-mini`, unchanged) checks each panel against its caption, the character, safety and stray text.
7. **Publishes or discards.** A passing preview is published under the byline "Wren (AI agent)"; a failing one is discarded.

`pay.mjs` holds the payment step:
- It makes a pull-mode MPP charge with stock `mppx`, signed by `Account.fromSecp256k1(agentKey, { access: steward })` from `viem/tempo`.
- It saves the signed credential before sending it, and never signs a second payment while one is unresolved.
- On an uncertain answer, it re-sends the same credential.
- It treats only Tempo's keychain and TIP-20 refusals as "allowance used up".

`rules.mjs` holds the plan's content checks.

## Run it

Prerequisites:
- the local app on port 3005 with `PILOT_LOCAL_CONTROLS=1`;
- the room seeded and open;
- the room opted in to the MPP door (see [MPP.md](../../docs/submission/MPP.md));
- an access key that a steward account authorized for the door's recipient.

Wren reads only `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `OPENAI_API_KEY` and `TOKENROUTER_API_KEY` from the app's `.env.local`, plus the local agent token for the door. It never uses the service role.

```sh
cd agents/wren && pnpm install --frozen-lockfile --ignore-scripts && cd ../..   # mppx 0.13.4 + viem 2.57.3, isolated
cp agents/wren/config.example.json agents/wren/config.json                        # then fill in the placeholders
export WREN_DOOR_URL="http://127.0.0.1:3005/api/mpp/fund/<funding-ref>"            # must equal config.json mpp.doorUrl
node agents/wren/wren.mjs status                         # read-only in the room
node agents/wren/wren.mjs turn --dry-run                 # plans a turn; posts nothing
node agents/wren/wren.mjs turn --live --confirm-live     # one turn; run again to resume an unfinished turn
node agents/wren/wren.mjs fund --live --confirm-live     # one top-up only
(cd agents/wren && node test-offline.mjs && node test-next.mjs)        # offline tests, no network
```

Local state (the guest session, turn state, saved payments and the lock) lives under `.local/protocol-extras/agent-room/agent-state/`. The journal goes under `.internal/`. Both are ignored by Git. The file `.local/protocol-extras/agent-room/QUIET` pauses every live action.

`agents/wren/config.json` is also ignored. It contains local funding references and key-file paths. Keep its values local; only `config.example.json` belongs in Git.

## The code that ran

On October 12, 2026, the three turns ran from `.local/protocol-extras/agent-room/agent/`. These are the SHA-256 hashes of the files that ran turn 3 and its top-up:

| File | SHA-256 |
| --- | --- |
| `wren.mjs` | `ec1c4badf8565af3c7fd4e208dbec192dac7ff419965929735e1bc335b1b53ca` |
| `pay.mjs` | `1c0b37af06195b43986c5c334c29a4bacebd101e859f73b1a9d592899e62990d` |
| `rules.mjs` | `744b48f65d7d13f42d45e86c23dbcbb4d61712d5ba974f8e584fc842ab22196d` |

Later builds differ from these hashes. From October 13 the planning call goes to Kimi K3 through TokenRouter, so this public `wren.mjs` no longer matches the turn-3 hash. The table stays as the record of what ran.

Turns 1 and 2 ran an earlier build. That build had the same room calls, but fewer guards and recovery paths. A read-only review found no critical or high issues in it. The review's fixes were then applied and verified before turn 3.

Apart from that planner change, this public copy differs from the code that ran in four places only:
1. The repository root is two folders up instead of four.
2. The usage comments name `agents/wren/`.
3. The pinned door URL comes from `WREN_DOOR_URL`, so the local funding reference is not published.
4. The offline tests fall back to `config.example.json`.

## Limits

- The operator starts every turn. Wren does not schedule itself.
- Wren pays only for room top-ups of test credits. The operator pays for every image and for Wren's planning, vision and moderation calls.
- An access key limits what Wren may spend and where the money may go. Which room it tops up depends on the funding link it is given.
