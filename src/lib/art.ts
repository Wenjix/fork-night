export const STORY_ART_URL = "/art/midnight-story.webp";
export const APPROVED_ART_ASSETS = [
  STORY_ART_URL,
  "/art/social-worlds.webp",
  "/art/social-people.webp",
  "/art/night-city-anime.webp",
  "/art/malfoid-watercolor.webp",
  "/art/malfoy-anime.webp",
  "/art/malfoy-film.webp",
  "/art/blade-runner-cinema.webp",
  "/art/blade-runner-film.webp",
  "/art/blade-runner-anime.webp",
] as const;

export type ArtAssetUrl = (typeof APPROVED_ART_ASSETS)[number];
export type ApprovedArtUrl =
  `${ArtAssetUrl}#${"frame" | "scene"}=${0 | 1 | 2 | 3 | 4 | 5}`;
export type LocalRasterUrl =
  `data:image/${"png" | "jpeg" | "webp"};base64,${string}`;

export const LOCAL_RASTER_LIMITS = {
  maxBytes: 1_000_000,
  maxUrlLength: 32 + Math.ceil(1_000_000 / 3) * 4,
} as const;

/** Only packaged, six-frame local sheets may be loaded by a story panel. */
export function isApprovedArtUrl(value: unknown): value is ApprovedArtUrl {
  if (typeof value !== "string") return false;
  const match = /^(\/art\/[a-z0-9-]+\.webp)#(?:frame|scene)=[0-5]$/.exec(value);
  return !!match && (APPROVED_ART_ASSETS as readonly string[]).includes(match[1]);
}

/** Bounded raster data only: a MIME label alone does not make SVG or HTML safe. */
export function isLocalRasterUrl(value: unknown): value is LocalRasterUrl {
  if (
    typeof value !== "string" ||
    value.length > LOCAL_RASTER_LIMITS.maxUrlLength
  )
    return false;
  const match = /^data:image\/(png|jpeg|webp);base64,/.exec(value);
  if (!match) return false;
  const payload = value.slice(match[0].length);
  if (
    !payload.length ||
    payload.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(payload)
  )
    return false;
  const bytes =
    (payload.length / 4) * 3 -
    (payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0);
  if (bytes > LOCAL_RASTER_LIMITS.maxBytes) return false;
  try {
    const head = atob(payload.slice(0, 44));
    const tail = atob(payload.slice(-24));
    if (match[1] === "png")
      return (
        bytes >= 45 &&
        head.startsWith("\x89PNG\r\n\x1a\n") &&
        head.slice(12, 16) === "IHDR" &&
        tail.endsWith("\0\0\0\0IEND\xaeB`\x82")
      );
    if (match[1] === "jpeg")
      return (
        bytes >= 16 &&
        head.startsWith("\xff\xd8\xff") &&
        tail.endsWith("\xff\xd9")
      );
    const declaredSize =
      head.charCodeAt(4) +
      head.charCodeAt(5) * 256 +
      head.charCodeAt(6) * 65_536 +
      head.charCodeAt(7) * 16_777_216;
    return (
      bytes >= 20 &&
      head.startsWith("RIFF") &&
      head.slice(8, 12) === "WEBP" &&
      ["VP8 ", "VP8L", "VP8X"].includes(head.slice(12, 16)) &&
      declaredSize + 8 === bytes
    );
  } catch {
    return false;
  }
}

export function isStoryArtUrl(
  value: unknown,
): value is ApprovedArtUrl | LocalRasterUrl {
  return isApprovedArtUrl(value) || isLocalRasterUrl(value);
}

/** Sprite sheets retain their crop; standalone local rasters use their whole image. */
export function artSourceUrl(imageUrl: string): ArtAssetUrl | LocalRasterUrl {
  if (isLocalRasterUrl(imageUrl)) return imageUrl;
  return artAssetUrl(imageUrl);
}

export function artBackgroundSize(imageUrl: string): string {
  if (isLocalRasterUrl(imageUrl)) return "contain";
  artAssetUrl(imageUrl);
  return "300% 200%";
}

export function artAssetUrl(imageUrl: string): ArtAssetUrl {
  if (!isApprovedArtUrl(imageUrl))
    throw new Error("Choose a frame from an approved local artwork file.");
  return imageUrl.split("#")[0] as ArtAssetUrl;
}

export function artPosition(imageUrl: string): string {
  if (isLocalRasterUrl(imageUrl)) return "center";
  const frame = Number(imageUrl.match(/#(?:frame|scene)=([0-5])$/)?.[1] ?? 0);
  return `${(frame % 3) * 50}% ${Math.floor(frame / 3) * 100}%`;
}
