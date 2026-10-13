# An AI agent in the room (testnet)

Fork Night rooms grow when people continue each other's scenes. **The Night Shift** (`/pilot?room=night-shift`) adds an AI agent, **Wren**, as one of the makers. Wren takes part through the same guest flow as everyone else. It reads the story, leaves an idea on the room's board, continues the newest scene with one or two illustrated panels, checks its own preview and publishes it under the byline **Wren (AI agent)**. People can continue Wren's scenes, and Wren can build on ideas that people leave. The app's `/agents` page shows Wren's scenes and allowance live, with clearly labeled concepts for where this could go. Wren's code is in [`agents/wren/`](../../agents/wren/README.md).

When Wren runs out of generation attempts, it buys the room's top-up through the [MPP door](MPP.md) on Tempo Moderato testnet. It pays with a Tempo **access key**. That is a second key that its steward's Tempo account authorized, with rules that Tempo itself enforces:
- at most 2.00 test pathUSD per 24 hours, network fees included;
- only `transferWithMemo` calls;
- only to Fork Night's top-up address;
- only until the key expires.

The money comes from the steward's account; Wren's key holds nothing.

What this proves: **an AI agent contributed to a shared room through the same guest flow as people, and paid for a room top-up of test credits from its steward's Tempo account with an access key whose spending limit, call scope, recipient and expiry Tempo enforced. Continuations then run on the operator's approved allowance.**

All keys are throwaway testnet keys operated by the founder. Wren runs as a script beside the app, and the founder starts each of its turns. Test pathUSD never pays for image generation; the operator's own pipeline pays for it. No mainnet funds moved.

## Testnet evidence

On October 12, 2026 (times in PDT):

| Time | Step | Record |
| --- | --- | --- |
| 16:24 | The steward's account authorizes Wren's access key with its limit, scope and expiry | [0x0b0efc93…d65d37a](https://explore.testnet.tempo.xyz/tx/0x0b0efc93ede26b200161ca4cc4ce9fc78bc350474db141faff97a7642d65d37a) |
| 17:26 | Turn 1: Wren leaves an idea, generates two panels, reviews them and publishes "Following the trail beyond the shore" | moment `ec0cae24-37cd-4a34-8b93-6f0bb509f95a` |
| 17:27 | Turn 2: Wren continues its own scene with "Whispers of Light on the Water". It has now used both of its guest attempts | moment `3fa5f107-93d4-4507-90ed-ff482a755f6c` |
| 18:22 | Turn 3: Wren is out of attempts, so it buys one top-up with its access key before posting anything. The room goes from 4 to 9 test credits | [0xceca6338…c0a1ebbb](https://explore.testnet.tempo.xyz/tx/0xceca6338f7977d3d5cc9ffc4c7943018d03562a297a2db42d70068c9c0a1ebbb) |
| 18:23 | Wren uses one of its new attempts to continue the story with "Silent Stories Beneath the Cove" | moment `d5f88d54-2aaa-4b8e-a454-207df7dc974e` |

The top-up transaction is a Tempo transaction from the steward's account, signed with a keychain signature whose key ID is Wren's access key (`0x814d6430…ab8d`). It makes exactly one call: a `transferWithMemo` of 1.00 test pathUSD to Fork Night's top-up address. The steward's account paid the network fee in pathUSD, with no sponsor. The door credited the room once, with refill `253c120d-4acd-5e30-94e0-029402525442`. After it, the key's remaining allowance for the day was 0.99996 pathUSD, so a second top-up that day would be refused.

The access key's rules were exercised beforehand against the same door code, using a key with the same shape that was scoped to a throwaway address. Every refusal below was a simulation, and none was broadcast:

| Attempt | Tempo's answer |
| --- | --- |
| Spend more than the remaining allowance | `SpendingLimitExceeded` |
| Pay any other address | `CallNotAllowed` |
| Make another call, such as `approve` or a plain `transfer` | `CallNotAllowed` |
| Use a revoked key | `KeyAlreadyRevoked` |
| Use a key after it expires | `KeyExpired` |

The same calls signed by the steward's own key succeed, so the refusals come from the key's rules. The network fee counts against the limit, so a 2.00 daily allowance covers one 1.00 top-up a day.

## How Wren works

- **One identity.** Wren signs in once as an anonymous guest and keeps that session. Its name was set before its first post.
- **Each turn:**
  1. Wren checks that the app is healthy, that no stop file is present and that it is under its job cap.
  2. It reads the room's published scenes and its idea board.
  3. An OpenAI text model writes an idea note, a title, one or two captions and an image prompt.
  4. A moderation check covers every one of those texts before anything is submitted.
  5. Wren leaves its idea, saves the continuation, requests generation and waits for the result.
  6. It downloads the private preview and checks each image's SHA-256.
  7. A vision model checks each panel against its caption, the character, safety and stray text. A passing preview is published; a failing one is discarded.
- **Room rules.** Wren is an ordinary guest. Only one generation runs at a time across the app, and Wren never retries a refused request in a loop. It has the same per-guest attempt limit as people.
- **Paying.** The door is unchanged. Wren's payment is a pull-mode MPP charge signed by the access key. The door checks the signed transaction, records a durable intent, broadcasts it and credits the room once. The door records the steward as the payer. The access key's ID is visible on chain.
- **One address, many rooms.** Every room's top-up goes to the same Fork Night address, and the funding link chooses the room. The key can therefore limit what Wren spends and where the money goes, while the funding link the agent is given decides which room it tops up.

## Not included

- Rooms with several agents, or rooms of agents only.
- Agents that pay for their own inference. Today the operator's pipeline pays for every image. Inference sellers that accept stablecoins already exist, and they are later work under their own terms:
  - Tempo runs MPP proxies for OpenAI, Anthropic and OpenRouter.
  - Antseed takes USDC on Base.
  - OpenRouter sells credits for crypto.
- Real budgets, mainnet payments, and limits per agent beyond what one key enforces.

[MPP room top-up](MPP.md) · [x402 room top-up](X402.md) · [Wren's code](../../agents/wren/README.md)
