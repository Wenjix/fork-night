# Fork Night

Fork Night is a persistent space for making illustrated, branching stories together. A shared opening grows into many possible continuations, with each maker credited along the chosen path. Public rooms help people discover projects, guilds give recurring collaborators a home, private groups collect ideas, and a personal desk holds sketches and unfinished work between visits.

The product connects creative collaboration with explicit spending bounds and upstream rewards. Before continuing a published moment, a maker sees the inherited path's reuse fees and a separate maximum for new generation. The proposed public-project model rewards upstream contributors when a continuation is published. Private projects use a shared generation pool without internal maker fees.

## Implemented local preview

The Next.js app includes an illustrated lobby, room previews, public guild profiles and member halls, private idea boards with replies, and a personal canvas for notes, drawings and raster images. Makers can publish two original visuals as an opening or prepare a brief for an existing story.

The story workspace provides an upward branching map, path reading, contributor credit, bounded fixture quotes, reserve/review/publish/discard transitions, saved drafts and a standalone finished-story HTML export. Three switchable sample makers demonstrate the access and accounting rules.

At `/`, collaboration, generation and balances are local fixtures. They demonstrate behavior without authenticated users, live AI, wallets or onchain transactions. Separate experiment runners rehearse recovery and measure real generation.

## Shared development pilot

At `/pilot`, readers can explore three seeded rooms and join as named guests. A shared story table puts the selected moment beside its path recap and attributed saved ideas. Phones show one large panel at a time and an expandable recap. Guests can leave an idea without generating, use another person's idea to start a private continuation, or share a direct moment link. New-since-last-visit cues are stored in the current browser.

A continuation can be one illustrated scene or a sequence of up to three panels. A Trigger.dev development worker generates the selected number of reference-conditioned OpenAI images. The starting moment stays fixed while the maker browses the story. Makers review privately, then publish or discard. Published moments retain their parent and maker credit; other guests can continue them. Borrowing a note does not credit its author with the generation. Notes retain their authors on the shared idea board.

The composer starts with one freeform idea: drag or tap a saved note, speak or write, and try optional writing prompts. Preview your own words without a helper call, then add, remove or reorder panels with Undo. Cartesia Ink-2 handles optional hold-to-talk transcription; a separate OpenAI text request can suggest a layout or offer optional directions. Both helpers start paused behind separate request allowances. Browser protocol and recovery checks use simulated providers; live voice quality and physical-phone rehearsal remain to be verified. Typing remains available without either helper.

Supabase holds the shared stories, private operations, protected images and expense records. Complete, verified delivery uses one room generation credit for one or two panels, or two credits for three panels, even if discarded. Incomplete delivery uses none. Generation is founder-funded and free to participants. Room credits measure delivery capacity separately from the global provider expense allowance.

For the hackathon, the original **Midnight Signal** room demonstrates [testnet release controls](ONCHAIN.md) under an explicitly disclosed **equal-wallet policy**: every distinct registered wallet in the complete selected ancestry receives an equal share of that release's payments. Approved wallets register scene commitments, the curator freezes the path and recipients, and supporters fund independently claimable shares. This is one agreed policy for the demo's collaborating group; broader creator and organizational arrangements remain future work.

The contract is deployed on Monad testnet with MonadScan Exact Match source verification. A founder-operated browser rehearsal registered four scenes, froze a release, received 1.0 test MON support and paid two separate 0.5 claims. The user-run checker confirms zero remaining liability. Multiple bylines mapped to one wallet receive one combined share under this policy. Wallets do not establish unique creators or ownership of underlying IP; generation credits remain separate.

## Planned integration

Next stages are hosted pilot deployment, verified email account saving and owner-triggered motion-film output. A future release policy could separate admitted creator or organization identities from payout destinations, allowing several agreed individual shares to reach a shared treasury. The release controls use an Ethereum-compatible injected wallet; Privy remains a proposed account service. Trigger.dev is the selected worker; the current worker runs in Development while its local process is open. Automatic reconciliation after process failures and event-scale capacity still need operational rehearsal. The social spaces and desk remain local-preview features.

[Try the walkthrough](DEMO.md) · [Read the architecture](ARCHITECTURE.md)
