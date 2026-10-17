# Fork Night

Fork Night is a persistent space for making illustrated, branching stories together. A shared opening grows into many possible continuations, with each maker credited along the chosen path. Public rooms help people discover projects, guilds give recurring collaborators a home, private groups collect ideas, and a personal desk holds sketches and unfinished work between visits.

The product connects creative collaboration with explicit spending bounds and upstream rewards. Before continuing a published moment, a maker sees the inherited path's reuse fees and a separate maximum for new generation. The proposed public-project model rewards upstream contributors when a continuation is published. Private projects use a shared generation pool without internal maker fees.

## Implemented local preview

The Next.js app includes an illustrated lobby, room previews, public guild profiles and member halls, private idea boards with replies, and a personal canvas for notes, drawings and raster images. Makers can publish two original visuals as an opening or prepare a brief for an existing story.

The story workspace provides an upward branching map, path reading, contributor credit, bounded fixture quotes, reserve/review/publish/discard transitions, saved drafts and a standalone finished-story HTML export. Three switchable sample makers demonstrate the access and accounting rules.

At `/`, collaboration, generation and balances are local fixtures. They demonstrate behavior without authenticated users, live AI, wallets or onchain transactions. Separate experiment runners rehearse recovery and measure real generation.

## Hosted shared pilot

At `/pilot`, readers can explore three seeded rooms and join as named guests. A shared story table puts the selected moment beside its path recap and attributed saved ideas. Phones show one large panel at a time and an expandable recap. Guests can leave an idea without generating, use another person's idea to start a private continuation, or share a direct moment link. New-since-last-visit cues are stored in the current browser.

A continuation can be one illustrated scene or a sequence of up to three panels. A Trigger.dev Production worker generates OpenAI images using the selected story images as references. The starting moment stays fixed while the maker browses the story. Makers review privately, then publish or discard. Published moments retain their parent and maker credit; other guests can continue them. Borrowing a note does not credit its author with the generation. Notes retain their authors on the shared idea board.

The composer starts with one freeform idea: drag or tap a saved note, speak or write, and try optional writing prompts. Preview your own words without a helper call, then add, remove or reorder panels with Undo. Cartesia Ink-2 handles optional hold-to-talk transcription; a separate OpenAI text request can suggest a layout or offer optional directions. Each helper has a separate request allowance. The October 14 checkpoint records enabled text shaping; voice remains disabled. Browser protocol and recovery checks use simulated providers; live voice quality and physical-phone rehearsal remain to be verified. Typing remains available without either helper.

Supabase holds the shared stories, private operations, protected images and expense records. Complete, verified delivery uses one room generation credit for one or two panels, or two credits for three panels, even if discarded. Incomplete delivery uses none. Generation is founder-funded and free to participants. Room credits measure delivery capacity separately from the global provider expense allowance.

For the hackathon, the original **Midnight Signal** room demonstrates [testnet release controls](ONCHAIN.md) under an explicitly disclosed **equal-wallet policy**: every distinct registered wallet in the complete selected ancestry receives an equal share of that release's payments. Approved wallets register scene commitments, the curator freezes the path and recipients, and supporters fund independently claimable shares. This is one agreed policy for the demo's collaborating group; broader creator and organizational arrangements remain future work.

The contract is deployed on Monad testnet with MonadScan Exact Match source verification. A founder-operated browser rehearsal registered six scenes, froze a release, received 1.0 test MON support and paid four separate 0.25 claims across four wallets. The archived checker output (block 70416466) confirms zero remaining liability. Multiple bylines mapped to one wallet receive one combined share under this policy. Wallets do not establish unique creators or ownership of underlying IP; generation credits remain separate.

## Accounts and wallets

Direct browser-wallet authentication is implemented in the shared pilot. Visitors can select **Sign in with wallet**, authenticate through Supabase and choose a public name only when making. A returning wallet restores its saved account; these accounts default to the browser wallet. Existing anonymous bylines are preserved rather than silently merged through payout addresses. The founder confirmed same-browser logout and MetaMask sign-in. Account fixes are deployed; a fresh wallet-request walkthrough remains pending. [Setup and identity boundaries](ONBOARDING.md).

The optional [Google sign-in and in-app wallet](ONBOARDING.md) integration uses Privy 3.48.1. It links the existing Supabase storyteller identity and supplies a Monad testnet wallet provider to the release controls. The founder confirmed live Google sign-in, wallet creation, return in a second browser profile and generation/publication of a new scene. After curator approval, they confirmed registration through two Google-linked wallets. The second registration recovered after faucet funding, reconnection and a saved-action retry. Read-only Monad checks separately confirmed the wallets' funding. The [archived user-run checker](PRIVY-REHEARSAL.json) at block 70416466 verifies a fully settled six-scene, four-wallet release. It records 1.0 test MON received and paid, four 0.25 claims including both Privy wallets, and zero contract balance or liability. Existing browser wallets remain available.

The [shared wallet-request interface](WALLET-REQUESTS.md) adds supplied Google/Privy branding, maker-signed requests and full-address curator review with Approve/Deny confirmations. Its isolated database proof passed in the operator's terminal. They then confirmed hosted migration success and the curator's empty queue in the local app. The live maker request and decision walkthrough remains pending; the existing payout proof above does not claim that those new actions have been rehearsed.

## Deployment and next work

The [hosted pilot](HOSTING.md) has enabled Production generation, text shaping, bounded room creation and scheduled recovery. A Cloudflare timer starts recovery checks in Trigger each minute. The founder confirmed a two-account walkthrough; Production logs separately recorded two completed generation runs. Recovery of an interrupted generation and larger event capacity still need operational rehearsal.

This repository also includes locally tested Kessler Ward branches, private Wren requests, capped funding and updated entrance and agent pages. That work needs a matching database, worker and web rollout. The earlier Wren script remains a separate, founder-triggered agent. Social spaces and the desk remain local previews.

Future release policies may separate creator identities from payment destinations. Live motion production and broader community payment agreements also remain future work.

[Try the walkthrough](DEMO.md) · [Read the architecture](ARCHITECTURE.md)
