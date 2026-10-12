import { createHash } from "node:crypto";
import sharp from "sharp";
import { formatUsd } from "./money.ts";
import { canonicalJson } from "./storage.ts";

/** Server/local-runner module. Never import into a browser component. */
export const OPENAI_IMAGE_MODEL = "gpt-image-2.5-flare-2026-09-08";
export const OPENAI_IMAGE_ENDPOINT = "https://api.openai.com/v1/images/edits";
export const OPENAI_IMAGE_LIMITS = {
  maxPromptCharacters: 8_000,
  maxReferenceBytes: 4 * 1024 * 1024,
  maxReferencePixels: 4_194_304,
  maxResponseBytes: 12 * 1024 * 1024,
  outputSize: 1024,
} as const;

export interface ImageReference {
  bytes: Buffer;
  role: "original" | "previous-panel";
}

export interface OpenAiPanelRequest {
  endpoint: typeof OPENAI_IMAGE_ENDPOINT;
  clientRequestId: string;
  inputDigest: string;
  references: Array<{ role: ImageReference["role"]; sha256: string; width: number; height: number }>;
  body: {
    model: typeof OPENAI_IMAGE_MODEL;
    images: Array<{ image_url: string }>;
    prompt: string;
    n: 1;
    size: "1024x1024";
    quality: "low";
    background: "opaque";
    output_format: "png";
    stream: false;
  };
}

const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

/** Actual raster bytes are sent; a reference description is not image conditioning. */
export async function prepareOpenAiPanel(input: {
  clientRequestId: string;
  panelNumber: 1 | 2 | 3;
  prompt: string;
  references: ImageReference[];
}): Promise<OpenAiPanelRequest> {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(input.clientRequestId))
    throw new Error("A short ASCII client request ID is required");
  if (![1, 2, 3].includes(input.panelNumber)) throw new Error("Panel number must be 1, 2 or 3");
  const prompt = input.prompt.trim();
  if (!prompt || prompt.length > OPENAI_IMAGE_LIMITS.maxPromptCharacters)
    throw new Error("Panel prompt is empty or exceeds the experiment limit");
  const expectedRoles = input.panelNumber === 1 ? ["original"] : ["original", "previous-panel"];
  if (input.references.map((reference) => reference.role).join() !== expectedRoles.join())
    throw new Error("Use one original reference, plus the saved preceding panel after panel one");

  const references: OpenAiPanelRequest["references"] = [];
  const images: OpenAiPanelRequest["body"]["images"] = [];
  for (const reference of input.references) {
    if (!reference.bytes.length || reference.bytes.length > OPENAI_IMAGE_LIMITS.maxReferenceBytes)
      throw new Error("Reference is empty or exceeds the experiment byte limit");
    const source = sharp(reference.bytes, { limitInputPixels: OPENAI_IMAGE_LIMITS.maxReferencePixels, failOn: "warning" });
    const metadata = await source.metadata();
    if (!["png", "jpeg", "webp"].includes(metadata.format ?? "") || (metadata.pages ?? 1) !== 1)
      throw new Error("A single-frame PNG, JPEG or WebP reference is required");
    // Full decoding detects truncation; bounded resizing keeps the request modest.
    const normalized = await source.rotate().resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
    references.push({ role: reference.role, sha256: sha256(normalized.data), width: normalized.info.width, height: normalized.info.height });
    images.push({ image_url: `data:image/png;base64,${normalized.data.toString("base64")}` });
  }
  const body: OpenAiPanelRequest["body"] = {
    model: OPENAI_IMAGE_MODEL, images, prompt, n: 1, size: "1024x1024",
    quality: "low", background: "opaque", output_format: "png", stream: false,
  };
  return { endpoint: OPENAI_IMAGE_ENDPOINT, clientRequestId: input.clientRequestId, inputDigest: sha256(canonicalJson(body)), references, body };
}

export interface OpenAiImageUsage {
  input_tokens: number;
  input_tokens_details: { text_tokens: number; image_tokens: number };
  output_tokens: number;
  output_tokens_details?: { text_tokens: number; image_tokens: number };
  total_tokens: number;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
function tokenCount(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error("Invalid token count");
  return value as number;
}

export function readOpenAiUsage(raw: unknown): { usage: OpenAiImageUsage; calculatedExpenseUsd: string } {
  if (!isObject(raw) || !isObject(raw.input_tokens_details)) throw new Error("Usage is missing");
  const usage: OpenAiImageUsage = {
    input_tokens: tokenCount(raw.input_tokens),
    input_tokens_details: { text_tokens: tokenCount(raw.input_tokens_details.text_tokens), image_tokens: tokenCount(raw.input_tokens_details.image_tokens) },
    output_tokens: tokenCount(raw.output_tokens), total_tokens: tokenCount(raw.total_tokens),
  };
  let outputImages = usage.output_tokens;
  if (raw.output_tokens_details !== undefined) {
    if (!isObject(raw.output_tokens_details)) throw new Error("Invalid output token details");
    usage.output_tokens_details = { text_tokens: tokenCount(raw.output_tokens_details.text_tokens), image_tokens: tokenCount(raw.output_tokens_details.image_tokens) };
    if (BigInt(usage.output_tokens_details.text_tokens) + BigInt(usage.output_tokens_details.image_tokens) !== BigInt(usage.output_tokens))
      throw new Error("Output token details do not reconcile");
    outputImages = usage.output_tokens_details.image_tokens;
  }
  if (BigInt(usage.input_tokens_details.text_tokens) + BigInt(usage.input_tokens_details.image_tokens) !== BigInt(usage.input_tokens) ||
      BigInt(usage.input_tokens) + BigInt(usage.output_tokens) !== BigInt(usage.total_tokens))
    throw new Error("Token totals do not reconcile");
  const microUsd = 5n * BigInt(usage.input_tokens_details.text_tokens) + 8n * BigInt(usage.input_tokens_details.image_tokens) + 30n * BigInt(outputImages);
  return { usage, calculatedExpenseUsd: formatUsd(microUsd) };
}

/** A decoded image and usage-derived price are distinct from an invoice or a two-panel delivery. */
export async function inspectOpenAiPanelResponse(raw: unknown): Promise<{
  png: Buffer;
  sha256: string;
  usage: OpenAiImageUsage | null;
  calculatedExpenseUsd: string | null;
  expenseStatus: "calculated-from-usage" | "unresolved";
}> {
  if (!isObject(raw) || !Array.isArray(raw.data) || raw.data.length !== 1 || !isObject(raw.data[0]) || typeof raw.data[0].b64_json !== "string")
    throw new Error("Expected exactly one base64 image");
  const encoded = raw.data[0].b64_json;
  if (!encoded || encoded.length > Math.ceil(OPENAI_IMAGE_LIMITS.maxResponseBytes / 3) * 4 || encoded.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(encoded))
    throw new Error("Invalid or oversized base64 image");
  const png = Buffer.from(encoded, "base64");
  if (png.length > OPENAI_IMAGE_LIMITS.maxResponseBytes || png.toString("base64") !== encoded)
    throw new Error("Image is not canonical base64");
  const decoder = sharp(png, { limitInputPixels: 1_048_576, failOn: "warning" });
  const metadata = await decoder.metadata();
  if (metadata.format !== "png" || metadata.width !== 1024 || metadata.height !== 1024 || (metadata.pages ?? 1) !== 1)
    throw new Error("Expected a single 1024-square PNG");
  await decoder.raw().toBuffer();
  try {
    return { png, sha256: sha256(png), ...readOpenAiUsage(raw.usage), expenseStatus: "calculated-from-usage" };
  } catch {
    // Keep the valid image; unknown usage must never turn into zero expense or a retry.
    return { png, sha256: sha256(png), usage: null, calculatedExpenseUsd: null, expenseStatus: "unresolved" };
  }
}
