import { createHash } from "node:crypto";
import { canonicalJson } from "../privy/rest.ts";

/**
 * The Midnight Signal world kit: the creator's guidance a Night Watch (or a visiting companion)
 * works from. A kit version never changes once used; edit by adding a new version. Every job pins
 * the version and digest it used, and its prompt is built only from the pinned kit.
 */

export type WorldKit = {
  id: string;
  version: string;
  title: string;
  creator: string;
  disclosure: string;
  lore: string[];
  style: string[];
  rules: string[];
  starters: string[];
  participation: string[];
  references: { label: string; imageUrl: string }[];
};

const MIDNIGHT_SIGNAL_V1: WorldKit = {
  id: "midnight-signal",
  version: "1",
  title: "The Midnight Signal",
  creator: "Wenjie · world creator",
  disclosure:
    "The opening artwork was AI-generated for this prototype. The world, its guidance and its participation terms were written by its creator.",
  lore: [
    "A lighthouse on a quiet coast blinks again after years of darkness, and every light it sends is an invitation, never a warning.",
    "Mira is the young keeper who follows those invitations: curly dark hair, a cobalt coat and a yellow scarf.",
    "Friends made along the way travel with her: a paper boat that glows gold, a kind octopus librarian and a playful Dokkaebi.",
    "The story grows by forks. Anyone in the room can continue from any published moment; every path stays credited.",
  ],
  style: [
    "Soft storybook illustration: deep night blues lit by warm lamplight gold.",
    "Keep Mira recognizable in every scene (curly dark hair, cobalt coat, yellow scarf).",
    "One clear beat per image, staged so a reader can follow it without words.",
    "Gentle, wondrous and calm: starry skies, still water, glowing paper.",
  ],
  rules: [
    "No written words, letters, signs or logos inside the image.",
    "No storms, fire, shipwrecks, weapons or monsters; conflicts resolve through curiosity and kindness.",
    "No real people, brands or characters from other stories.",
    "Continue from the chosen moment; never redraw or contradict earlier published scenes.",
  ],
  starters: [
    "Mira and the Dokkaebi find a second lighthouse that answers the first.",
    "The paper boat returns carrying a reply from someone far away.",
    "The stars come down to help when the lighthouse grows tired.",
  ],
  participation: [
    "Published moments stay credited to the person who published them.",
    "A Night Watch prepares private drafts only. Nothing is published until its maker chooses one.",
    "Release support uses the testnet terms fork-night/testnet-release/v1: every registered wallet on a path shares native test MON support equally. That is not ownership of the world, its characters or its art.",
    "Bring only original or permitted work into this world.",
  ],
  references: [
    { label: "The lighthouse wakes", imageUrl: "/art/midnight-story.webp#frame=0" },
    { label: "The note beneath the lamp", imageUrl: "/art/midnight-story.webp#frame=1" },
    { label: "The light answers", imageUrl: "/art/midnight-story.webp#frame=2" },
    { label: "A star nobody charted", imageUrl: "/art/midnight-story.webp#frame=5" },
  ],
};

const KITS: Record<string, WorldKit> = { [`${MIDNIGHT_SIGNAL_V1.id}@${MIDNIGHT_SIGNAL_V1.version}`]: MIDNIGHT_SIGNAL_V1 };

export const CURRENT_KIT = MIDNIGHT_SIGNAL_V1;

export function kitDigest(kit: WorldKit): string {
  return createHash("sha256").update(canonicalJson(kit)).digest("hex");
}

/** A pinned kit by id and version, refusing a digest that no longer matches. */
export function pinnedKit(pin: { id: string; version: string; digest: string }): WorldKit {
  const kit = KITS[`${pin.id}@${pin.version}`];
  if (!kit) throw new Error(`World kit ${pin.id}@${pin.version} does not exist.`);
  if (kitDigest(kit) !== pin.digest) throw new Error(`World kit ${pin.id}@${pin.version} changed after it was pinned.`);
  return kit;
}

export function kitPin(kit: WorldKit = CURRENT_KIT) {
  return { id: kit.id, version: kit.version, digest: kitDigest(kit) };
}

/** The kit's guidance as image-prompt text. Deterministic for a pinned version. */
export function kitPrompt(kit: WorldKit): string {
  return [
    `World: ${kit.title}.`,
    `Style: ${kit.style.join(" ")}`,
    `Rules: ${kit.rules.join(" ")}`,
  ].join("\n");
}
