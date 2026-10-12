import type { FinishedExport } from "../domain/types.ts";
import { ARCHIVED_FANDOM_STORIES, FANDOM_STORIES } from "./fandom-stories.ts";
import {
  APPROVED_ART_ASSETS,
  artPosition,
  artSourceUrl,
  isLocalRasterUrl,
  STORY_ART_URL,
} from "./art.ts";

export type FinishedStoryFont = { dataUrl: string; license: string };

export function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
}

/** Self-contained finished artifact, with no private workspace fields or scripts. */
export function renderFinishedHtml(
  branch: FinishedExport,
  artwork: string | Readonly<Record<string, string>>,
  interfaceFont?: FinishedStoryFont,
) {
  if (interfaceFont && (!/^data:font\/woff2;base64,[A-Za-z0-9+/]+={0,2}$/.test(interfaceFont.dataUrl) || !interfaceFont.license.trim()))
    throw new Error("The story needs its embedded reading font and license.");
  const fontStyle = interfaceFont
    ? `@font-face{font-family:Inter;src:url(${interfaceFont.dataUrl}) format('woff2');font-style:normal;font-weight:100 900;font-display:swap}`
    : "";
  const fontLicense = interfaceFont
    ? `<script type="text/plain" id="fork-night-font-license">${escapeHtml(interfaceFont.license)}</script>`
    : "";
  // A legacy string belongs only to the original sheet, never to every panel.
  const embedded: Readonly<Record<string, string>> =
    typeof artwork === "string" ? { [STORY_ART_URL]: artwork } : artwork;
  if (!embedded || typeof embedded !== "object" || Array.isArray(embedded))
    throw new Error("The export needs embedded local artwork files.");
  for (const [asset, data] of Object.entries(embedded)) {
    if (!(APPROVED_ART_ASSETS as readonly string[]).includes(asset))
      throw new Error("The export contains an unknown artwork file.");
    if (
      typeof data !== "string" ||
      !/^data:image\/(?:webp|png);base64,[A-Za-z0-9+/]+={0,2}$/.test(data)
    )
      throw new Error("The export needs an embedded local artwork file.");
  }
  const assets = [
    ...new Set(
      branch.moments.flatMap((moment) =>
        moment.panels.map((panel) => artSourceUrl(panel.imageUrl)),
      ),
    ),
  ];
  for (const asset of assets) {
    if (!isLocalRasterUrl(asset) && !Object.hasOwn(embedded, asset))
      throw new Error(
        `The export is missing its embedded artwork file: ${asset}`,
      );
  }
  // Embed each sheet once even when a branch contains many panels from it.
  const assetStyles = assets
    .map((asset, index) =>
      isLocalRasterUrl(asset)
        ? `.art-${index}{background-image:url(${asset});background-size:contain;background-repeat:no-repeat}`
        : `.art-${index}{background-image:url(${embedded[asset]})}`,
    )
    .join("");
  const artClass = (src: string) => `art-${assets.indexOf(artSourceUrl(src))}`;
  const fanStory = [...FANDOM_STORIES, ...ARCHIVED_FANDOM_STORIES].find(story =>
    branch.moments.some(moment => moment.id.startsWith(`${story.id}-`)),
  );
  const contentLabel = fanStory
    ? `Authored unofficial fan story · ${fanStory.fandom}`
    : "Original demonstration content";
  const visualStyles = fanStory?.visualStyles?.filter(style =>
    assets.includes(style.artwork),
  );
  const visualLabel = visualStyles?.length
    ? ` · Prepared visual interpretation: ${visualStyles.map(style => style.label).join(", ")}`
    : "";
  const manifest = JSON.stringify(branch).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(branch.projectTitle)} · Fork Night</title><style>${fontStyle}body{margin:0;background:#faf9f5;color:#19192e;font:17px/1.6 Inter,sans-serif}main{max-width:800px;margin:60px auto;padding:0 24px}h1{font-family:"Bradley Hand","Segoe Print","Comic Sans MS",cursive;font-size:clamp(32px,6vw,56px);line-height:1.1}h2{margin-top:48px;line-height:1.2}.panels{display:grid;grid-template-columns:1fr 1fr;gap:20px}figure{margin:0}.image{aspect-ratio:1;background-size:300% 200%;border-radius:12px}${assetStyles}figcaption{margin-top:12px}footer{margin-top:60px;border-top:1px solid #ccc;padding-top:20px}small{color:#55516b}a{color:#5530ca}@media(max-width:550px){.panels{grid-template-columns:1fr}}</style><main><h1>${escapeHtml(branch.projectTitle)}</h1><p>A finished branch, from its first spark to the selected ending.</p>${branch.moments.map((moment) => `<article><h2>${escapeHtml(moment.title)}</h2><p>By ${escapeHtml(moment.credit.name)}</p><div class="panels">${moment.panels.map((panel) => `<figure><div class="image ${artClass(panel.imageUrl)}" role="img" aria-label="${escapeHtml(panel.caption)}" style="background-position:${artPosition(panel.imageUrl)}"></div><figcaption>${escapeHtml(panel.caption)}</figcaption></figure>`).join("")}</div>${moment.credit.thankYou ? `<p>Built on: ${escapeHtml(moment.credit.thankYou)}</p>` : ""}</article>`).join("")}<footer><p>Made by ${escapeHtml([...new Set(branch.moments.map((moment) => moment.credit.name))].join(", "))}.</p><small>${escapeHtml(contentLabel + visualLabel)}. Sample finished-work terms: ${escapeHtml(branch.termsVersion)}. The local prototype uses simulated generation and payments.</small></footer></main><script type="application/json" id="fork-night-manifest">${manifest}</script>${fontLicense}</html>`;
}
