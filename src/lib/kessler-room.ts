import { FANDOM_STORIES } from "./fandom-stories.ts";
import type { PilotMoment } from "./pilot.ts";

export const KESSLER_ROOM_ID = "kessler-ward";
export const KESSLER_ROOM_TITLE = "Kessler Ward";
export const KESSLER_DESCRIPTION = "A blackout, an insulin case and eighty-one floors before dawn. Choose a branch and write what happens next.";
export const KESSLER_BEAT_IDS: Readonly<Record<string, string>> = {
  opening: "15000000-0000-4000-8000-000000000001",
  billboard: "15000000-0000-4000-8000-000000000002",
  dish: "15000000-0000-4000-8000-000000000003",
  "bridge-dark": "15000000-0000-4000-8000-000000000004",
  "tower-lights": "15000000-0000-4000-8000-000000000005",
  "window-81": "15000000-0000-4000-8000-000000000006",
  stairs: "15000000-0000-4000-8000-000000000007",
  "floor-forty": "15000000-0000-4000-8000-000000000008",
  "every-door": "15000000-0000-4000-8000-000000000009",
  chain: "15000000-0000-4000-8000-000000000010",
  "dawn-81": "15000000-0000-4000-8000-000000000011",
};
export const KESSLER_OPENING_ID = KESSLER_BEAT_IDS.opening;

/** Stable authored examples; sample roles are not real hosted creator identities. */
export function kesslerSeedMoments(): PilotMoment[] {
  const story = FANDOM_STORIES.find(story => story.id === "kessler-night-shift")!;
  return story.beats.map((beat, index) => ({
    id: KESSLER_BEAT_IDS[beat.id], room_id: KESSLER_ROOM_ID,
    parent_id: beat.parent ? KESSLER_BEAT_IDS[beat.parent] : null,
    maker_id: null, maker_label: "Prepared story", title: beat.title,
    panels: beat.frames.map((frame, i) => ({ imageUrl: `${beat.artwork ?? story.artwork}#frame=${frame}`, caption: beat.captions[i] })),
    source_kind: "fixture", created_at: new Date(Date.UTC(2026, 9, 14, 18, index)).toISOString(),
    source_idea_body: null, source_idea_id: null, source_idea_label: null,
  }));
}
