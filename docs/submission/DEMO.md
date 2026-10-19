# Local demo

Use Node 22.18 or newer:

```sh
pnpm install --frozen-lockfile
npm run dev
```

Open `http://127.0.0.1:3000`. No credentials are required. Sam, Priya and Jules are switchable sample makers. Generation uses predetermined artwork; fictional balances and unsigned receipts stay in this browser.

All local rooms use the same credit scale: a prepared one- or two-panel continuation costs **1 sample credit**. Open-room quotes separately reserve **1 sample credit per priced moment** in the selected ancestry; those fees settle only on publication. Private rooms have no internal reuse fees, and imported original openings have zero reuse cost. Current prices also apply when you reopen an older room. Existing reservations and receipts keep their original amounts. Sample credits have no MON exchange rate.

For the short fandom walkthrough, choose **Night City After Hours**, **Malfoy, Rewritten** or **Blade Runner: A Memory of Rain**. Each has a shared opening and two complete outcomes. **Read a complete path** selects its lead ending; **Step inside** lets you choose another branch in the upward map. In Malfoy's story, Draco has been a girl since the beginning of Hogwarts, retaining her role as Harry's Slytherin rival and foil. The lead grows rivalry into reluctant trust; the separate branch follows her defense of Hermione and personal accountability. These are unofficial, authored fan stories with fictional collaborators.

In **Malfoy, Rewritten**, switch between **Anime** and **Film style** in the room preview or story workspace. All six illustrations have both interpretations. Your selected branch, captions and maker credits stay the same, and the chosen style carries into the local storyboard video and exported story. A visual interpretation is a prepared presentation choice, rather than a new contribution or generation request.

For a quick image-to-video presentation, open `/#/project/blade-runner-memory/images-to-video`, or enter **Blade Runner: A Memory of Rain → Images → video**. On the story map, the opening's third fork lays out the same four source images as **Scene 1–4**; select **Scene 4 · A seedling** and choose **Turn these 4 scenes into a video**. On the archive fork, select **No one owns this morning**, choose **Restyle this path · image-to-image → Restyle 3 scenes**, compare before and after, then **Apply to this path** to see the path in anime on the map; **Restore original** returns it. Show the four Hunyuan v3.5 source images, then choose **Play demo video** to play the actual 12-second Wan 3.0 clip generated from those exact references through GMI Cloud. The clip includes its original audio, scene captions, and **Open video / Download MP4** links. This is a prepared October 7 example of the greenhouse ending; it remains fixed when you select another branch or edit your story. **Make a video** continues to create a separate local storyboard video from your selected path. Playback makes no provider request and spends no credits.

1. As **Sam**, find **The moon missed the bus** in the lobby. **Peek in** previews the opening; **Step inside** enters its story. Select a moment, read its path and choose **Make a version from here**.
2. Write a continuation, then visit **My spaces → Your desk**. Resume it from **Still on your workbench** to see the saved prompt and starting moment.
3. Review the quote, reserve sample credits and collect the fixture draft. Refresh during review, then publish with a thank-you. Download the finished branch: its HTML contains the selected ancestry, images and contributor credits.
4. Make another version and discard it. The fixture ledger charges delivered generation and returns upstream fees and unused reservation capacity.
5. As **Jules**, request to join **Paper Lantern**. Switch to **Sam** and approve the request in its member hall. Jules can now enter the hall; guild approval does not grant private-project access or pool spending.
6. As **Sam**, post an idea in the friends' board; reply as **Priya**. Pin it, switch to Timeline and return after navigation to check persistence.
7. On **Your desk**, try the sample pieces, arrange them and keep edits. Select two original images, review **Start a new project**, and publish the opening in preview. Its internal reuse fee is zero and no credits move. Linked inherited pieces preserve their source project.

In a story workspace, choose a tip in the upward map, then **Make a video**. Review the full storyboard in **Left to right** or **Top to bottom** order, then **Create video**. This creates a silent, downloadable storyboard video from the entire selected path, with saved captions and maker credits. Fandom paths contain four panels and take eight seconds. Video creation runs in the browser and makes no model request; it requires browser video-recording support. Other branches remain separate.

On phones, the downloaded film uses a portrait frame with readable captions and maker credits. Desktop films use a wide frame. Exported stories include their illustrations, reading font and credits for offline viewing.

## Shared development pilot

Kessler opens with a story overview: a shared beginning, an upward map and three featured path previews. **Read path** starts a chosen branch at its beginning; **Continue reading** offers saved progress. Recent, Following, All paths and search keep other paths discoverable. Following is saved in this browser. Direct scene and film links, invitations and recovered drafts keep their destinations.

Choose **Watch film** beside a path, or **Watch films** in the room guide, to open Kessler's **Films from this room** shelf. It presents three prepared 18-second Wan 3.0 films: **Decision in the Dark** (Burkes and Wren's continuation), **In through the window**, and **Dawn on eighty-one**. Play one, download its MP4, copy a direct film link, or follow its source scenes and contribution trail. The Wren film condenses a ten-scene path into six reference panels and ends at the maintenance-hatch decision. Film preparation does not register a new release or change creator shares.

**Make a film → choose up to six panels → Review** shows the chosen branch, original bylines, three-second shot timings and cost. A selection matching a prepared cut offers **Watch finished film** immediately. **Create storyboard video** makes a separate, free, silent video from the chosen images and captions in the browser. Download it before leaving or reloading. Changing the selection never relabels a prepared Wan film as a new generation. Public visitors cannot submit paid Wan requests through this flow.

Configure the server credentials and run the development worker as described in the [README](../../README.md). Open `/pilot` in two separate browser profiles or private sessions.

1. Choose a room. In Kessler, choose **Read path** from the overview. The shared story table gives the selected moment most of the space, with maker credit and a **Story so far** recap. On a phone, page through its panels and expand the recap to read earlier moments. Kessler's **Room overview → Full scene map**, or **Map** in other rooms, opens the full upward branching story.
2. Choose **Leave an idea**, enter a storyteller name, and post a short note. Open the same moment in the second session: the note and its author are shared. **Use this idea** carries the attributed note into a private continuation; desktop users can also drag it into the idea pocket. It does not generate anything yet.
3. Choose **Add the next part**, or borrow the saved idea. Write one loose thought, try an optional angle, or use Cartesia Ink-2 when voice is enabled. **Preview my idea** lays out your own words without a helper call. One panel is enough; **Let it continue** adds another, up to three. Edit, reorder or remove panels, and use **Undo last change** if needed. Enabled helpers can offer possible directions or suggest a layout. Reading earlier moments keeps the original parent. The explicit **Generate** action shows the panel count and credit quote before requesting images.
4. Refresh while waiting. The saved operation returns; **Check saved result** reconnects to existing work. If a refresh happened before dispatch, **Generate saved idea** resumes the saved draft.
5. Review the complete result at full reading size, then **Publish my moment**. The moment credits its maker. Borrowed notes keep their original authors on the idea board and do not add generation credit. Discard keeps them out of the public story, while retaining the charge for a complete delivered moment (one credit for one/two panels, two credits for three).
6. After publishing, **Invite the next storyteller** gives the other guest a direct link. Reading other moments offers **Share this moment**. They can inspect the contribution and continue it. Returning in the same browser shows new moments on the selected path and the previous reading position; first visits have no invented history. These cues are local to that browser.

For this local rehearsal, generation requires an enabled operator budget and the Trigger development process. Voice and text shaping have separate allowances and start paused in a fresh database. Real transcription quality and physical-phone behavior still require rehearsal. The [hosted pilot](HOSTING.md) already runs Production generation, text shaping and scheduled recovery. Live motion generation from an edited story remains future work; the film examples play prepared results.

The room shows aggregate queued, generating and needs-checking counts; private prompts and drafts remain hidden. Your continuation distinguishes **Waiting to start**, **Generating your images**, **Ready to review** and **Generation needs checking**. Reserved credits are held for unfinished requests and become used credits only on complete delivery. A running request with no recorded progress for ten minutes needs checking. Publish a delivered preview with **Publish my moment**, then use **Invite the next storyteller** for its public scene link. The share action also reveals a selectable link. A localhost link works on the same computer; sharing with other people requires a reachable deployment. Wallet connections can use localhost in a browser with an Ethereum-compatible wallet extension.

The original **Midnight Signal** room includes an optional **Release and support this story** disclosure below the story actions. For the hackathon demo, it uses an explicitly disclosed equal-wallet policy: each distinct registered wallet on the complete selected ancestry receives an equal share. Its contract is deployed on Monad testnet and verified as Exact Match on MonadScan. A founder-operated browser rehearsal completed six registrations, release freezing, 1.0 test MON support and four separate 0.25 claims. Configure the published contract and curator addresses, restart the app, then follow the [testnet setup](ONCHAIN.md) or the [new three-wallet rehearsal](REHEARSAL.md). Guest identity stays separate from the connected wallet; the panel shows the wallet’s role and the next prerequisite. Inspecting an earlier scene retains the complete chosen path’s release. With no configured deployment, the section displays setup pending. Test MON payouts and generation credits are separate.

[Project overview](PROJECT.md) · [Architecture](ARCHITECTURE.md)

For local testing, enable `PILOT_LOCAL_CONTROLS=1` in `.env.local` and restart the server. A named guest can choose **Add 5 test credits** beside the room balance. This extends room capacity and test-attempt limits, preserves usage and reservations, and leaves the existing API dollar ceiling unchanged. It is a local operator control, not a payment flow; hosted deployments keep it disabled. A lost reply exposes **Check last refill**, which retrieves the same refill without adding credits twice.

## Shared world presentation

The separate `/world-demo` rehearsal follows Mira’s ledger scene into Kai’s continuation and a curator-published Chapter 2. Enter as Mira, preview and publish her scene, then choose **Continue as Kai**. Publish Kai’s continuation and choose **Review the chapter → Publish chapter & open film**. A solo presenter changes roles inline; each role retains its independent guest account and private draft. Invitations still support separate browsers.

The chapter’s **Create video** action renders its exact saved scene path as a downloadable storyboard video. **Prepared motion example → Play motion example** plays a fixed five-second example of the reunion ending. Its imagery and story do not change with edited captions. Neither action requests live generative motion.

**Contribution history** sits beside the player on desktop and below it on phones. Expand a contribution to see its saved panels, captions, contribution ID and parent scene. **Read this scene** opens that exact contribution. The timeline comes from the published chapter’s preserved record. **Chapter record** exposes its release ID and SHA-256 digest.

## Visual creator review

Open `/creator-demo`, also linked as **Creator review** from the shared world. Compare two prepared endings, including the example agent’s selected/discarded status and stated reasons. **Save feedback** attaches your note to the chosen ending without changing the creator bible.

Choose **Turn a lesson into a bible revision**, edit the instructions and inspect the added/removed text, then **Save bible v2 → Prepare next brief**. The original example keeps its bible v1 reference; the new brief retains the exact saved v2 instructions and feedback. **What happened** gives a compact visual history. Feedback, bible versions and briefs persist in this browser. The activity is fictional and prepared; no autonomous agent, external generation, automatic learning or social-platform publication is connected.
