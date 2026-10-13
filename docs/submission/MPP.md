# MPP room top-up (testnet)

A local agent can also top up a Fork Night room with **5 test credits** by paying **1.00 test pathUSD** through the [Machine Payments Protocol](https://mpp.dev) (MPP, with [`mppx`](https://github.com/wevm/mppx) 0.13.4) on **Tempo Moderato testnet** (chain 42431). It is a second way to pay for the same top-up the [x402 door](X402.md) sells. The route answers an unpaid request with an HTTP 402 `Payment` challenge. It checks the agent's signed Tempo transaction against the offer, records a durable intent, broadcasts the transaction itself, and credits the room through the pilot's existing refill only after the chain confirms the transfer. The image worker, the dollar ceiling and `/pilot` are unchanged.

What this proves: **MPP on Tempo testnet gated a room top-up of test credits; continuations then run on the operator's approved allowance.** Test pathUSD is free from the Moderato faucet, so a payment proves the payment rail, not real backing. Room credits are one pooled count, so a receipt explains a credit change, not a particular image. Test pathUSD never pays for image generation and never raises the operator's dollar ceiling. No mainnet funds moved.

## Testnet evidence

On October 12, 2026, the local agent payer funded the Paper Moon room through the MPP route. The payment moved exactly 1.00 test pathUSD from a throwaway payer to the room's throwaway receiving address.

| Network | Transaction | Room credit |
| --- | --- | --- |
| Tempo Moderato | [0x02d9b1d3…d30a20b1](https://explore.testnet.tempo.xyz/tx/0x02d9b1d3e353aee310427a498310abe9f74b5f69271de73abdaa0df1d30a20b1) | 29 → 34 test credits |

The transaction makes exactly one call, a `transferWithMemo` of 1.00 pathUSD to the receiving address. Its memo is bound to the route's realm and to this offer's challenge. The payer paid its own network fee in pathUSD. The route credited the room once, and the top-up produced one refill row whose request ID is `UUIDv5(eip155:42431:transaction)`. The operator's $10 dollar ceiling stayed unchanged, and the reconciler found nothing outstanding.

Earlier rehearsals ran on Moderato in an isolated copy of the app, with a stand-in ledger and a fake room. In one, a real RPC error arrived after [this payment](https://explore.testnet.tempo.xyz/tx/0xa13944a481f2818e190b865f15b6debd756e116937fbbe85d994dbc3f92f3560) had already landed. The route answered 202 and offered no new payment. When the agent re-sent the same signed payment, the route found it on chain and credited it once.

Later the same day, an AI agent paid this door too. Wren, an agent maker in The Night Shift room, bought a top-up from its steward's Tempo account. It used an access key whose spending limit, call scope, recipient and expiry Tempo enforces, and the door needed no change. [An AI agent in the room](AGENT-ROOM.md) has the transaction and the details.

## How it works

`POST /api/mpp/fund/[fundingRef]` is an App Router route on the Node runtime. It uses the same opaque funding reference and local opt-in as the x402 route. Room and guest identifiers never reach Tempo or any outside service. The challenge carries only a keyed tag for the room, and the on-chain memo carries hashes of the route's realm and the challenge.

1. **Offer.** A request without an `Authorization: Payment` header, for an eligible room, gets HTTP 402 with a `WWW-Authenticate: Payment` challenge. The challenge is an MPP `charge` of 1.00 pathUSD on Tempo Moderato in pull mode: the agent signs the transaction and the route broadcasts it. A room that is closed, not opted in or at its MPP top-up limit gets 409 and no offer.
2. **Check.** The route reads the agent's credential and checks that this route issued the challenge for this room, and that it has not expired. It then decodes the signed transaction. The transaction must make exactly one call: a `transferWithMemo` of the offered token, to this room's receiving address, for exactly 1.00, with a memo bound to this challenge. It must also expire no later than the offer. Anything else gets a fresh 402, and nothing is recorded. The route then simulates the transaction against the chain without sending it.
3. **Durable intent.** Before anything is broadcast, a write-once intent keyed by the challenge is stored in the pilot's private receipts bucket, with a pointer under the room. If either cannot be written, nothing is broadcast.
4. **Broadcast, then credit.** The route computes the transaction hash, broadcasts once, and credits only a confirmed transfer with that hash. It credits through the existing `pilot_refill_room` with request ID `UUIDv5(eip155:42431:transaction)`. Re-sending the same payment, or reconciling it later, therefore adds nothing. A receipt with the transaction link is stored next to the intent.
5. **Anything uncertain waits for the chain.** A payment re-sent after an intent was recorded is never broadcast again. The route answers it from its receipt or from the chain. A failure after the transaction left the process returns 202 and keeps the intent. `scripts/mpp-reconcile.ts` checks the chain for the recorded transaction and the challenge's memo. It credits only a proven payment. It marks a payment expired only once the chain's latest block is at least 120 seconds past the payment's signed deadline, three spaced receipt lookups have missed and a memo scan has found nothing.

Each top-up uses the same refill as the local operator control and the x402 route: 5 room credits, 5 more guest attempts and request headroom, with the dollar ceiling unchanged. Each payment rail has its own per-room top-up limit in local configuration.

`mppx` and its own `viem` live in an isolated package, `vendor/mpp-adapter/`, with its own exact pins and lockfile. Adding the door changed none of the app's dependencies. The route loads the adapter only after the gate, and checks the SHA-256 of its entry file and lockfile first.

## Run it locally

The route exists only on a loopback development server with `PILOT_LOCAL_CONTROLS=1`, the room's x402 opt-in and the local agent token. It returns 404 everywhere else, including any hosted deployment, and no MPP code loads until those checks pass. Use throwaway testnet wallets only.

```sh
# 0. Install the isolated adapter once (pnpm 10.18.3; 19 packages, no install scripts).
(cd vendor/mpp-adapter && pnpm install --frozen-lockfile --ignore-scripts)
# 1. Opt the room in to x402 first (see X402.md); then create the MPP wallets, challenge key and limit, and fund the payer from the Moderato faucet.
node --env-file-if-exists=.env.local scripts/mpp-setup.ts init --room <roomId> --max-top-ups 2
node --env-file-if-exists=.env.local scripts/mpp-setup.ts check
# 2. With the local app running on port 3005 (PILOT_LOCAL_CONTROLS=1), let the agent pay:
node --env-file-if-exists=.env.local scripts/mpp-fund-room.ts --room <roomId>
# 3. Evidence, and recovery for anything pending:
node --env-file-if-exists=.env.local scripts/mpp-status.ts
node --env-file-if-exists=.env.local scripts/mpp-reconcile.ts    # dry run; add --apply to write
```

The agent payer signs at most one payment per run and saves it under `.local/mpp/payments/` before sending. If an answer is lost, `--resume <record>` re-sends that same signed payment; it never signs a new one.

## Not included

Payments from browser wallets, MPP sessions (pay-as-you-go channels) inside the product, fee sponsorship, payments a client broadcasts itself, refunds, and mainnet settlement are later work. Each needs its own decisions about real funds, refunds and accounting.
