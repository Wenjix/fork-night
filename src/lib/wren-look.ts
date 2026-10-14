/**
 * A maker's look for their Wren: a plush, knitted bird. Everything here is plain data, so the look can be
 * saved, shared or attached to an agent's profile later. Today it is saved only in the maker's browser.
 */
export const YARNS = [
  { id: "sage", label: "Sage", base: "#93a983", shade: "#6f8661", light: "#c9d6bd" },
  { id: "lavender", label: "Lavender", base: "#a998c8", shade: "#8170a6", light: "#d9cfec" },
  { id: "oat", label: "Oat", base: "#e3d3b5", shade: "#bfa982", light: "#f5ecdb" },
  { id: "slate", label: "Slate blue", base: "#7d93b2", shade: "#5c7192", light: "#c3cfe0" },
  { id: "clay", label: "Clay", base: "#d77a5f", shade: "#b25a41", light: "#f0c0ae" },
  { id: "mustard", label: "Mustard", base: "#e6b84a", shade: "#c0922c", light: "#f6dea0" },
] as const;

export const PATTERNS = [
  { id: "knit", label: "Plain knit" },
  { id: "stripes", label: "Stripes" },
  { id: "speckle", label: "Speckled" },
  { id: "patchwork", label: "Patchwork" },
] as const;

export const FACES = [
  { id: "button", label: "Button eyes" },
  { id: "bright", label: "Bright" },
  { id: "sleepy", label: "Sleepy" },
  { id: "sparkle", label: "Starry" },
] as const;

export const ACCESSORIES = [
  { id: "none", label: "None" },
  { id: "glasses", label: "Round glasses" },
  { id: "scarf", label: "Scarf" },
  { id: "beanie", label: "Beanie" },
  { id: "bowtie", label: "Bow tie" },
  { id: "sprig", label: "Leaf sprig" },
] as const;

export type YarnId = (typeof YARNS)[number]["id"];
export type PatternId = (typeof PATTERNS)[number]["id"];
export type FaceId = (typeof FACES)[number]["id"];
export type AccessoryId = (typeof ACCESSORIES)[number]["id"];

export type WrenLook = {
  name: string;
  yarn: YarnId;
  accent: YarnId;
  pattern: PatternId;
  face: FaceId;
  accessory: AccessoryId;
};

export const NAME_LIMIT = 18;
export const DEFAULT_LOOK: WrenLook = { name: "Wren", yarn: "sage", accent: "oat", pattern: "knit", face: "button", accessory: "scarf" };

/** A few starting points, like a game's preset characters. */
export const PRESETS: readonly { label: string; look: WrenLook }[] = [
  { label: "Studio Wren", look: DEFAULT_LOOK },
  { label: "Night owl", look: { name: "Wren", yarn: "slate", accent: "lavender", pattern: "speckle", face: "sleepy", accessory: "beanie" } },
  { label: "Archivist", look: { name: "Wren", yarn: "mustard", accent: "clay", pattern: "stripes", face: "bright", accessory: "glasses" } },
  { label: "Gardener", look: { name: "Wren", yarn: "clay", accent: "sage", pattern: "patchwork", face: "sparkle", accessory: "sprig" } },
];

export const yarn = (id: YarnId) => YARNS.find(item => item.id === id) ?? YARNS[0];

const ids = <T extends readonly { id: string }[]>(list: T) => new Set<string>(list.map(item => item.id));
const YARN_IDS = ids(YARNS), PATTERN_IDS = ids(PATTERNS), FACE_IDS = ids(FACES), ACCESSORY_IDS = ids(ACCESSORIES);

/** Trims and limits a name; an empty name falls back to "Wren". */
export function cleanName(value: unknown): string {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, NAME_LIMIT) : "";
  return text || DEFAULT_LOOK.name;
}

/** Reads a saved look, keeping every valid field and replacing anything unknown with the default. */
export function parseLook(value: unknown): WrenLook {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const pick = <T extends string>(key: keyof WrenLook, allowed: Set<string>) =>
    (typeof input[key] === "string" && allowed.has(input[key] as string) ? input[key] : DEFAULT_LOOK[key]) as T;
  return {
    name: cleanName(input.name),
    yarn: pick<YarnId>("yarn", YARN_IDS),
    accent: pick<YarnId>("accent", YARN_IDS),
    pattern: pick<PatternId>("pattern", PATTERN_IDS),
    face: pick<FaceId>("face", FACE_IDS),
    accessory: pick<AccessoryId>("accessory", ACCESSORY_IDS),
  };
}

/** A random look that keeps the name. `random` is injectable for tests. */
export function randomLook(name: string, random: () => number = Math.random): WrenLook {
  const any = <T extends readonly { id: string }[]>(list: T) => list[Math.floor(random() * list.length) % list.length].id as T[number]["id"];
  const main = any(YARNS);
  let accent = any(YARNS);
  if (accent === main) accent = YARNS[(YARNS.findIndex(item => item.id === main) + 2) % YARNS.length].id;
  return { name: cleanName(name), yarn: main, accent, pattern: any(PATTERNS), face: any(FACES), accessory: any(ACCESSORIES) };
}

/** One readable line, used for the figure's accessible description. */
export function describeLook(look: WrenLook): string {
  const label = <T extends readonly { id: string; label: string }[]>(list: T, id: string) => list.find(item => item.id === id)?.label.toLowerCase() ?? id;
  const accessory = look.accessory === "none" ? "" : `, wearing ${label(ACCESSORIES, look.accessory).replace(/^round /, "round ")}`;
  return `${look.name}: a knitted bird in ${label(YARNS, look.yarn)} yarn with ${label(YARNS, look.accent)} trim, ${label(PATTERNS, look.pattern)}, ${label(FACES, look.face)}${accessory}.`;
}

export const LOOK_STORAGE_KEY = "fork-night:wren-look:v1";
