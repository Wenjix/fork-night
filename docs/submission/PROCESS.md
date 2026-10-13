# From exploration to Fork Night

Brainstorming began on **September 27, 2026**. Fork Night grew out of several rounds of product exploration, then moved into building, demonstrating and refining a collaborative story workspace. This record separates those stages so concept images, audience feedback and working software can each be assessed on their own evidence.

The public Git history groups the current implementation into reviewable commits prepared for publication. Their timestamps record that preparation; the development timeline begins with the September 27 exploration.

## Early concept exploration

The first four rounds compared different ways people, creative agents and communities could make things together. All of their screens were generated static concepts with illustrative people, activity and economics.

| Round | Exploration | Artifact size |
| --- | --- | --- |
| 1 | Five starting directions: Branch Commons for branching stories, Cast for characters, Studio Pact for creative commissions, Living Gallery for evolving artwork, and Place Commons for community spaces. | 10 mocks |
| 2 | Refined the story, character and commission ideas; explored self-maintaining publications, persistent agent worlds and permissioned connections between personal websites. | 14 mocks |
| 3 | Examined smaller social interactions: coordinating an evening, visiting a friend's site, borrowing experience and making trusted introductions. | 10 mocks |
| 4 | Focused on Fork Night: shared story creation, handmade contributions, attribution, discovery, funding and alternative reward arrangements. | [14 selected mocks](process/round-4/README.md) |

The Round 4 gallery is the selected public exploration artifact. Its baseline, eight named variations and combined **Made by the Room** direction show the breadth of ideas considered before implementation. Prices, voting rules and sponsorship in those images describe that exploration stage. The current release policy is documented separately in [the onchain guide](ONCHAIN.md).

## Product design and implementation

Once Fork Night became the active direction, the work shifted toward a persistent creative space: finding a room, reading a branch, choosing where to continue, reviewing a private draft and publishing with visible authorship. Comparing tree orientations led to the upward story map. Subsequent design iterations developed the illustrated lobby, guild spaces, private idea boards and personal desk.

The shared pilot then connected named guest sessions, saved ideas, reference-conditioned generation and publication through Supabase and Trigger.dev. These are implemented flows; some surrounding social spaces remain local-preview features. [Project](PROJECT.md), [architecture](ARCHITECTURE.md) and [demo instructions](DEMO.md) describe the current boundaries.

## Demonstration and feedback

On October 5, the founder presented a prepared happy-path concept at a boat demo night and gathered live audience feedback. Conversations afterward included people building AI content creators and influencers who expressed interest in the premise. On October 8, the founder showed the concept on a laptop at an AI content creators' event and gathered more feedback. The [boat-demo write-up](BOAT-DEMO.md) records the founder's recollection and links the actual October 5 photographs.

After the demo, work included storyboard review and a companion for comparing a fictional AI creator's alternatives and recording human guidance. The creator companion uses prepared examples and browser-local feedback. Autonomous influencer pipelines remain a future application to investigate.

## Verifiable economic mechanism

The hackathon implementation now includes a Monad testnet release contract. For the demo's collaborating group, the disclosed policy gives each distinct registered wallet an equal share of a frozen release's payments. A founder-operated rehearsal registered four scenes, froze a release, received **1.0 test MON** and completed two separate **0.5 test MON** claims with zero remaining liability.

That rehearsal establishes a working registration, payment and claim mechanism. The [testnet proof](ONCHAIN.md) records its scope, contract verification and equal-wallet rule. Public-project sustainability arrangements, guild licensing and other professional or private-group agreements remain distinct future economic policies.
